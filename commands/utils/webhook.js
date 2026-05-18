const http = require('http');
const Logger = require('../../utils/logger.js');
const { EmbedBuilder } = require('discord.js');

let serverInstance = null;

/**
 * Inicializa el servidor HTTP para escuchar webhooks de GitHub.
 * Si ya existe una instancia activa, se cierra antes para evitar conflictos de puerto.
 */
function initWebhookServer(client, dbRes, config) {
    if (!dbRes || !dbRes.Webhook) {
        Logger.system("No se puede inicializar el webhook de GitHub: Conexión de base de datos no disponible.");
        return;
    }

    const port = process.env.PORT || config.WEBHOOK_PORT || 3000;

    // Si ya hay un servidor corriendo (por ejemplo, tras una recarga 'r'), lo cerramos limpiamente
    if (serverInstance) {
        Logger.system("Cerrando servidor de webhook de GitHub existente...");
        serverInstance.close(() => {
            Logger.system("Servidor de webhook de GitHub anterior cerrado.");
            startServer(client, dbRes, port);
        });
    } else {
        startServer(client, dbRes, port);
    }
}

function startServer(client, dbRes, port) {
    const server = http.createServer((req, res) => {
        // Solo aceptamos POST a /github o /webhook
        if (req.method === 'POST' && (req.url === '/github' || req.url === '/webhook' || req.url === '/')) {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', async () => {
                try {
                    const payload = JSON.parse(body);
                    const event = req.headers['x-github-event'];

                    if (event === 'push') {
                        await handlePushEvent(client, dbRes, payload);
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (err) {
                    console.error("Error procesando el webhook de GitHub:", err);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid payload' }));
                }
            });
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }
    });

    server.on('error', (err) => {
        Logger.system(`Error en el servidor de webhook de GitHub: ${err.message}`);
    });

    server.listen(port, () => {
        Logger.system(`Servidor de webhook de GitHub escuchando en el puerto ${port}`);
    });

    serverInstance = server;
}

/**
 * Procesa el evento 'push' de GitHub y envía notificaciones a todos los canales registrados.
 */
async function handlePushEvent(client, dbRes, payload) {
    const repoName = payload.repository?.full_name || 'Desconocido';
    const repoUrl = payload.repository?.html_url || '';
    const branchName = payload.ref ? payload.ref.replace('refs/heads/', '') : 'main';
    const pusher = payload.pusher?.name || 'Desconocido';
    const pusherAvatar = payload.sender?.avatar_url || '';
    const commits = payload.commits || [];

    if (commits.length === 0) return;

    // Obtener canales registrados
    let registeredChannels = [];
    try {
        registeredChannels = await dbRes.Webhook.find();
    } catch (err) {
        console.error("Error obteniendo canales de webhook desde la BD:", err);
        return;
    }

    if (registeredChannels.length === 0) return;

    // Crear el embed de Discord con un estilo premium
    let embedDescription = '';
    const maxCommitsToShow = 5;

    commits.slice(0, maxCommitsToShow).forEach(commit => {
        const shortHash = commit.id.substring(0, 7);
        const message = commit.message.split('\n')[0];
        embedDescription += `[\`${shortHash}\`](${commit.url}) ${message} - *${commit.author.name}*\n`;
    });

    if (commits.length > maxCommitsToShow) {
        embedDescription += `\n*...y ${commits.length - maxCommitsToShow} commit(s) más.*`;
    }

    const embed = new EmbedBuilder()
        .setTitle(`[${repoName}:${branchName}] ${commits.length} nuevo(s) commit(s)`)
        .setURL(repoUrl)
        .setDescription(embedDescription)
        .setColor('#24292e') // Color gris oscuro de GitHub
        .setFooter({ text: `Pushed by ${pusher}`, iconURL: pusherAvatar })
        .setTimestamp();

    // Enviar el embed a cada canal registrado
    for (const ch of registeredChannels) {
        try {
            const channel = await client.channels.fetch(ch.channel_id);
            if (channel && channel.isTextBased()) {
                await channel.send({ embeds: [embed] });
            }
        } catch (err) {
            console.error(`No se pudo enviar notificación de commits al canal ${ch.channel_id} (Servidor: ${ch.guild_name || 'Desconocido'}):`, err.message);
        }
    }
}

module.exports = {
    initWebhookServer,
    serverInstance
};
