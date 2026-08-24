const https = require('https');
const { WebhookClient, EmbedBuilder } = require('discord.js');
const { getSetting } = require('../models/BotSettingsModel.js');
const Logger = require('../utils/logger.js');

const DEFAULT_SERVICE_ID = process.env.RENDER_SERVICE_ID || 'srv-da4pr7m7bikc73ac33lg';
let lastSeenTimestamp = new Date().toISOString();
let isPolling = false;
let pollingInterval = null;

function requestRender(urlPath, apiKey) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.render.com',
            path: urlPath,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

function stripAnsi(str) {
    return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

const ERROR_PATTERNS = [
    /\b(?:error|exception|typeerror|referenceerror|syntaxerror|rangeerror)\b/i,
    /\b(?:unhandledpromiserejection|uncaughtexception)\b/i,
    /\b(?:request failed with status code|http [45]\d{2}|status code [45]\d{2})\b/i,
    /\b(?:econnrefused|etimedout|enotfound|econnreset)\b/i,
    /\[(?:error|fatal)\]/i
];

function isEntryAnError(cleanMsg, labels = []) {
    if (labels.some(l => (l.name === 'level' && (l.value === 'error' || l.value === 'err' || l.value === 'fatal')) || (l.name === 'stream' && l.value === 'stderr'))) {
        return true;
    }
    return ERROR_PATTERNS.some(rx => rx.test(cleanMsg));
}

/**
 * Envía un mensaje o lote a un webhook de Discord con reintento básico y control de límites.
 */
async function sendToWebhook(webhookUrl, payload) {
    if (!webhookUrl) return;
    try {
        const webhookClient = new WebhookClient({ url: webhookUrl });
        await webhookClient.send(payload);
    } catch (err) {
        // Si el webhook fue eliminado o es inválido, log silencioso
        if (err.code === 10015 || err.status === 404) {
            console.error('[RenderLogService] Webhook no encontrado o inválido.');
        } else {
            console.error('[RenderLogService] Error enviando webhook:', err.message);
        }
    }
}

/**
 * Envía una alerta de error inmediata al webhook de errores configurado.
 * @param {string|Error} errorOrMessage
 * @param {string} [context]
 */
async function reportErrorImmediate(errorOrMessage, context = 'Runtime') {
    try {
        const errorWebhookUrl = await getSetting('render_error_webhook_url');
        if (!errorWebhookUrl) return;

        const errorText = errorOrMessage instanceof Error 
            ? (errorOrMessage.stack || errorOrMessage.message) 
            : String(errorOrMessage);

        const cleanText = stripAnsi(errorText);
        const truncated = cleanText.length > 3900 ? cleanText.slice(0, 3900) + '...' : cleanText;

        const embed = new EmbedBuilder()
            .setTitle(`🚨 [ERROR ALERT] ${context}`)
            .setDescription(`\`\`\`js\n${truncated}\n\`\`\``)
            .setColor(0xFF0000)
            .setTimestamp();

        await sendToWebhook(errorWebhookUrl, {
            username: 'Sengo Error Monitor',
            embeds: [embed]
        });
    } catch (err) {
        console.error('[RenderLogService] Error al reportar error inmediato:', err.message);
    }
}

/**
 * Ejecuta un ciclo de polling de logs en Render.
 */
async function pollRenderLogs() {
    if (isPolling) return;
    const apiKey = process.env.RENDER_KEY;
    if (!apiKey) return;

    try {
        isPolling = true;

        const [logWebhookUrl, errorWebhookUrl] = await Promise.all([
            getSetting('render_log_webhook_url'),
            getSetting('render_error_webhook_url')
        ]);

        // Si ningún webhook está configurado, no gastamos peticiones a Render
        if (!logWebhookUrl && !errorWebhookUrl) {
            return;
        }

        const ownersRes = await requestRender('/v1/owners?limit=1', apiKey);
        const ownerId = ownersRes?.[0]?.owner?.id || ownersRes?.[0]?.id;
        if (!ownerId) return;

        const queryParams = new URLSearchParams({
            ownerId,
            resource: DEFAULT_SERVICE_ID,
            limit: '100',
            direction: 'backward'
        });

        const logsRes = await requestRender(`/v1/logs?${queryParams.toString()}`, apiKey);
        const logEntries = Array.isArray(logsRes) 
            ? logsRes 
            : (logsRes?.logs || logsRes?.data || logsRes?.entries || []);

        if (!logEntries || logEntries.length === 0) return;

        // Filtrar solo logs nuevos desde lastSeenTimestamp
        const newLogs = logEntries
            .filter(entry => entry.timestamp && entry.timestamp > lastSeenTimestamp)
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        if (newLogs.length === 0) return;

        // Actualizar último timestamp visto
        lastSeenTimestamp = newLogs[newLogs.length - 1].timestamp;

        const infoLogs = [];
        const errorLogs = [];

        for (const entry of newLogs) {
            const labels = entry.labels || [];
            const cleanMsg = stripAnsi(entry.message || '').trim();
            if (!cleanMsg) continue;

            const timeFormatted = entry.timestamp.slice(11, 19);
            const line = `[${timeFormatted}] ${cleanMsg}`;
            const isError = isEntryAnError(cleanMsg, labels);

            if (isError) {
                errorLogs.push(line);
            }
            infoLogs.push(line);
        }

        // 1. Enviar errores inmediatamente al webhook de errores si está configurado
        if (errorWebhookUrl && errorLogs.length > 0) {
            let errorChunk = '';
            for (const errLine of errorLogs) {
                if ((errorChunk + errLine).length > 1800) {
                    await sendToWebhook(errorWebhookUrl, {
                        content: `⚠️ **[Render Errors]**\n\`\`\`ansi\n${errorChunk}\n\`\`\``
                    });
                    errorChunk = '';
                }
                errorChunk += errLine + '\n';
            }
            if (errorChunk.trim()) {
                await sendToWebhook(errorWebhookUrl, {
                    content: `⚠️ **[Render Errors]**\n\`\`\`ansi\n${errorChunk}\n\`\`\``
                });
            }
        }

        // 2. Enviar logs generales agrupados al webhook normal
        if (logWebhookUrl && infoLogs.length > 0) {
            let infoChunk = '';
            for (const logLine of infoLogs) {
                if ((infoChunk + logLine).length > 1800) {
                    await sendToWebhook(logWebhookUrl, {
                        content: `\`\`\`ansi\n${infoChunk}\n\`\`\``
                    });
                    infoChunk = '';
                }
                infoChunk += logLine + '\n';
            }
            if (infoChunk.trim()) {
                await sendToWebhook(logWebhookUrl, {
                    content: `\`\`\`ansi\n${infoChunk}\n\`\`\``
                });
            }
        }

    } catch (err) {
        console.error('[RenderLogService] Error durante pollRenderLogs:', err.message);
    } finally {
        isPolling = false;
    }
}

/**
 * Inicializa el servicio de logs periódicos de Render (cada 1 minuto).
 */
function initRenderLogService() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
    }

    if (!process.env.RENDER_KEY) {
        Logger.system('Servicio de Render Logs omitido (RENDER_KEY no configurado).');
        return;
    }

    // Inicializar timestamp con el tiempo actual para no reenviar historial anterior
    lastSeenTimestamp = new Date().toISOString();

    Logger.system('Servicio de Render Logs iniciado (Polling cada 60s).');

    // Polling cada 1 minuto (60000 ms)
    pollingInterval = setInterval(pollRenderLogs, 60000);
}

module.exports = {
    initRenderLogService,
    pollRenderLogs,
    reportErrorImmediate
};
