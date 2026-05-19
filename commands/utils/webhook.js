const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, spawn } = require('child_process');
const Logger = require('../../utils/logger.js');
const { EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');

/**
 * Intenta obtener estadísticas del push usando la API pública de GitHub.
 */
async function fetchGithubStats(repoName, before, after) {
    if (!before || !after || before === '0000000000000000000000000000000000000000') {
        // Si no hay commit anterior (nueva rama), podemos intentar traer las estadísticas del último commit
        if (after && after !== '0000000000000000000000000000000000000000') {
            try {
                const res = await fetch(`https://api.github.com/repos/${repoName}/commits/${after}`, {
                    headers: { 'User-Agent': 'SengoBot-Discord-Webhook' }
                });
                if (res.ok) {
                    const data = await res.json();
                    return {
                        additions: data.stats?.additions || 0,
                        deletions: data.stats?.deletions || 0,
                        filesChanged: data.files?.length || 0
                    };
                }
            } catch (err) {
                console.error("Error al obtener stats del commit único de GitHub:", err);
            }
        }
        return null;
    }

    try {
        const res = await fetch(`https://api.github.com/repos/${repoName}/compare/${before}...${after}`, {
            headers: { 'User-Agent': 'SengoBot-Discord-Webhook' }
        });
        if (res.ok) {
            const data = await res.json();
            let additions = 0;
            let deletions = 0;
            let filesChanged = 0;
            if (data.files && Array.isArray(data.files)) {
                filesChanged = data.files.length;
                data.files.forEach(f => {
                    additions += f.additions || 0;
                    deletions += f.deletions || 0;
                });
            }
            return { additions, deletions, filesChanged };
        }
    } catch (err) {
        console.error("Error al comparar commits en la API de GitHub:", err);
    }
    return null;
}

let serverInstance = null;
let ngrokProcess = null;

/**
 * Intenta encontrar el ejecutable de ngrok en rutas comunes de Windows/Linux/Mac.
 * Si no lo encuentra, devuelve 'ngrok' para que intente usar el comando global.
 */
function getNgrokCommand() {
    const homedir = os.homedir();
    const commonPaths = [
        path.join(process.cwd(), 'ngrok.exe'),
        path.join(process.cwd(), 'ngrok'),
        path.join(homedir, 'ngrok.exe'),
        path.join(homedir, 'ngrok'),
        path.join(homedir, 'Downloads', 'ngrok.exe'),
        path.join(homedir, 'Downloads', 'ngrok'),
        path.join(homedir, 'Downloads', 'ngrok', 'ngrok.exe'),
        path.join(homedir, 'Downloads', 'ngrok', 'ngrok'),
    ];

    for (const p of commonPaths) {
        if (fs.existsSync(p)) {
            Logger.system(`Detectado ejecutable local de ngrok en: ${p}`);
            return p;
        }
    }

    return 'ngrok';
}

/**
 * Inicializa el servidor HTTP para escuchar webhooks de GitHub.
 * Si ya existe una instancia activa, se cierra antes para evitar conflictos de puerto.
 */
function initWebhookServer(client, dbRes, config) {
    const useSupabase = true; // SengoBot ahora siempre está en modo Supabase
    // Si es supabase, abrimos el puerto 80 por petición del usuario (a menos que se especifique un PORT de entorno como en Render)
    const port = process.env.PORT || (useSupabase ? 80 : (config.WEBHOOK_PORT || 3000));

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

    if (!dbRes || !dbRes.Webhook) {
        Logger.system("⚠️ Advertencia: Conexión de base de datos no disponible. El servidor de webhook responderá a health checks pero no procesará notificaciones de push.");
    }

    // Iniciar túnel de ngrok automáticamente si no está ya iniciado y se solicita explícitamente (solo en desarrollo local)
    const isRender = process.env.RENDER === 'true';
    const startNgrok = process.env.START_NGROK === 'true';

    if (useSupabase && !ngrokProcess && !isRender && startNgrok) {
        const ngrokCmd = getNgrokCommand();

        // Encapsulamos la ruta entre comillas dobles si contiene espacios o caracteres especiales en Windows
        const configCmd = `"${ngrokCmd}" config add-authtoken 3DufeqkRJ6frEzAPvMrqpyvC6bL_AbtCvTxdocksrGoc48LJ`;

        exec(configCmd, (err, stdout, stderr) => {
            if (err) {
                Logger.system(`Error configurando token de ngrok: ${err.message}`);
                Logger.system("⚠️ SengoBot no pudo ejecutar ngrok. Asegúrate de copiar 'ngrok.exe' directamente a la carpeta raíz del bot o añadirlo a las variables de entorno (PATH) de tu sistema.");
                return;
            }
            
            ngrokProcess = spawn(ngrokCmd, ['http', '80', '--domain', 'stoppable-passcode-riot.ngrok-free.dev'], {
                shell: true
            });

            ngrokProcess.stderr.on('data', (data) => {
                const text = data.toString().trim();
                if (text) {
                    const lowerText = text.toLowerCase();
                    // Solo alertar si es un error real, fallo o advertencia crítica
                    if (lowerText.includes('error') || lowerText.includes('failed') || lowerText.includes('authentication') || lowerText.includes('err=')) {
                        Logger.system(`[Ngrok Stderr]: ${text}`);
                    }
                }
            });

            ngrokProcess.on('close', (code) => {
                Logger.system(`Proceso de ngrok cerrado con código ${code}`);
                ngrokProcess = null;
            });

            Logger.system("Túnel de ngrok iniciado en: https://stoppable-passcode-riot.ngrok-free.dev/");
        });
    }
}

function startServer(client, dbRes, port) {
    const server = http.createServer((req, res) => {
        // Soporte para GET /health o GET / (health check para Render u otros pingers)
        if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'UP', message: 'SengoBot is running smoothly' }));
            return;
        }

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
        Logger.system(`Error en el servidor de webhook de GitHub en puerto ${port}: ${err.message}`);
    });

    // Enlazar explícitamente a 0.0.0.0 para alcance global y soporte de Docker/Render
    server.listen(port, '0.0.0.0', () => {
        // Silencioso por petición de limpieza de logs
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

    // Obtener estadísticas de líneas y archivos modificados
    const before = payload.before;
    const after = payload.after;
    const stats = await fetchGithubStats(repoName, before, after);

    let addedCount = 0;
    let modifiedCount = 0;
    let removedCount = 0;
    if (!stats) {
        commits.forEach(c => {
            if (c.added && Array.isArray(c.added)) addedCount += c.added.length;
            if (c.modified && Array.isArray(c.modified)) modifiedCount += c.modified.length;
            if (c.removed && Array.isArray(c.removed)) removedCount += c.removed.length;
        });
    }

    embedDescription += `\n─\n`;
    if (stats) {
        embedDescription += `🟢 \`+${stats.additions}\`   🔴 \`-${stats.deletions}\`   •   📁 \`${stats.filesChanged}\` archivo(s) modificado(s)`;
    } else {
        const parts = [];
        if (modifiedCount > 0) parts.push(`📂 \`${modifiedCount}\` modif.`);
        if (addedCount > 0) parts.push(`🆕 \`${addedCount}\` añad.`);
        if (removedCount > 0) parts.push(`❌ \`${removedCount}\` elim.`);
        embedDescription += parts.length > 0 ? parts.join('   •   ') : `📁 Sin cambios detectados`;
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
    serverInstance,
    getNgrokProcess: () => ngrokProcess,
    killNgrok: () => {
        if (ngrokProcess) {
            ngrokProcess.kill();
            ngrokProcess = null;
            Logger.system("Proceso de ngrok finalizado.");
        }
    }
};
