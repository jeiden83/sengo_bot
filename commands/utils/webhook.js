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
    const headers = { 'User-Agent': 'SengoBot-Discord-Webhook' };
    if (process.env.GITHUB_TOKEN) {
        headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
    }

    if (!before || !after || before === '0000000000000000000000000000000000000000') {
        // Si no hay commit anterior (nueva rama), podemos intentar traer las estadísticas del último commit
        if (after && after !== '0000000000000000000000000000000000000000') {
            try {
                const res = await fetch(`https://api.github.com/repos/${repoName}/commits/${after}`, { headers });
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
        const res = await fetch(`https://api.github.com/repos/${repoName}/compare/${before}...${after}`, { headers });
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
            startServer(client, dbRes, port, config);
        });
    } else {
        startServer(client, dbRes, port, config);
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

function startServer(client, dbRes, port, config) {
    const server = http.createServer((req, res) => {
        // Soporte para GET /health o GET / (health check para Render u otros pingers)
        if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'UP', message: 'SengoBot is running smoothly' }));
            return;
        }

        // Soporte para POST /shutdown (apaga la instancia vieja de forma segura antes de que la nueva inicie sesión)
        if (req.method === 'POST' && req.url === '/shutdown') {
            const token = req.headers['authorization'];
            const expectedToken = process.env.SHUTDOWN_TOKEN || (config && config.OSU_CLIENT_SECRET) || process.env.OSU_CLIENT_SECRET;
            if (token === expectedToken) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Graceful shutdown initiated' }));
                Logger.system("Petición remota de apagado validada. Iniciando apagado seguro...");
                setTimeout(() => {
                    process.kill(process.pid, 'SIGTERM');
                }, 1000);
                return;
            } else {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }
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

    // Obtener versión de SengoBot
    const pkgPath = path.join(__dirname, '../../package.json');
    let version = '2.0.0';
    try {
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            version = pkg.version;
        }
    } catch (e) {
        console.error("Error reading version in handlePushEvent:", e);
    }

    // Crear el resumen de cambios y uso de comandos
    let changesSummary = '';
    let commandUsage = '';

    commits.forEach(commit => {
        const messageLines = commit.message.split('\n').map(l => l.trim()).filter(Boolean);
        if (messageLines.length > 0) {
            const title = messageLines[0];
            const shortHash = commit.id.substring(0, 7);
            changesSummary += `• [\`${shortHash}\`](${commit.url}) ${title} - *${commit.author.name}*\n`;

            if (messageLines.length > 1) {
                const bodyLines = messageLines.slice(1);
                const bodyText = bodyLines.join('\n');
                if (/uso|comando|flag|s\.|ejemplo|alias|run/i.test(bodyText)) {
                    commandUsage += ` ▸ *Commit \`${shortHash}\`:*\n${bodyLines.map(l => `   ${l}`).join('\n')}\n`;
                }
            }
        }
    });

    if (commandUsage) {
        commandUsage = `📖 **Uso de Comandos / Nuevas Funciones:**\n${commandUsage}\n`;
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

    let statsLine = "";
    if (stats) {
        statsLine = `🟢 \`+${stats.additions}\` additions   🔴 \`-${stats.deletions}\` deletions   •   📁 \`${stats.filesChanged}\` archivo(s) modificado(s)`;
    } else {
        const parts = [];
        if (modifiedCount > 0) parts.push(`📂 \`${modifiedCount}\` modif.`);
        if (addedCount > 0) parts.push(`🆕 \`${addedCount}\` añad.`);
        if (removedCount > 0) parts.push(`❌ \`${removedCount}\` elim.`);
        statsLine = parts.length > 0 ? parts.join('   •   ') : `📁 Sin cambios detectados`;
    }

    const lastCommit = commits[commits.length - 1];
    const lastCommitHash = lastCommit.id.substring(0, 7);
    const lastCommitMessage = lastCommit.message.split('\n')[0];
    const lastCommitUrl = lastCommit.url;

    let embedDescription = 
        `**Cambios en este push:**\n${changesSummary}\n` +
        commandUsage +
        `**Detalles de la actualización:**\n` +
        `• **Último commit:** [\`${lastCommitHash}\`](${lastCommitUrl}) ${lastCommitMessage}\n` +
        `• **Commits totales:** \`${commits.length}\` commit(s)\n` +
        `• **Estadísticas:** ${statsLine}`;

    const embed = new EmbedBuilder()
        .setTitle(`🚀 Nueva version de Sengo`)
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
