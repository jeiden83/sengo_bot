const { WebhookClient, EmbedBuilder } = require('discord.js');
const Logger = require('../utils/logger.js');
const config = require('../config.js');

const WEBHOOK_URL = config.ERROR_WEBHOOK_URL;
const NTFY_TOPIC = config.NTFY_TOPIC;

let webhookClient;
if (WEBHOOK_URL) {
    try {
        webhookClient = new WebhookClient({ url: WEBHOOK_URL });
    } catch (err) {
        console.error("[ERROR-NOTIFIER] No se pudo inicializar el WebhookClient con la URL provista:", err.message);
    }
} else {
    console.warn("[ERROR-NOTIFIER] ERROR_WEBHOOK_URL no está configurado en las variables de entorno. Las notificaciones de error están desactivadas.");
}

if (NTFY_TOPIC || process.env.NTFY_TOPIC) {
    Logger.system(`[NOTIFIER] Notificaciones push de ntfy.sh activadas (Tema: ${NTFY_TOPIC || process.env.NTFY_TOPIC})`);
} else {
    console.warn("[NOTIFIER] NTFY_TOPIC no está configurado en las variables de entorno. Las alertas push a ntfy.sh están desactivadas.");
}

// Cooldown para alertas de servicios externos (15 minutos por servicio para evitar spam de notificaciones)
const serviceAlertCooldowns = new Map();
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Envía una notificación push inmediata a través de ntfy.sh (sin dependencias externas).
 * @param {Object} options Opciones de la notificación.
 * @param {string} options.title Título de la alerta.
 * @param {string} options.message Mensaje o cuerpo de la notificación.
 * @param {string} [options.priority='default'] Prioridad: 'min', 'low', 'default', 'high', 'urgent'.
 * @param {string} [options.tags='warning'] Etiquetas o emojis en formato ntfy (ej: 'warning,cloud').
 */
async function sendNtfyAlert({ title, message, priority = 'default', tags = 'warning' }) {
    const topic = process.env.NTFY_TOPIC || config.NTFY_TOPIC || NTFY_TOPIC;
    if (!topic) {
        console.warn("[NOTIFIER] Alerta omitida: NTFY_TOPIC no está configurado en las variables de entorno.");
        return;
    }

    try {
        Logger.system(`[NOTIFIER] Enviando alerta push a ntfy.sh/${topic}: "${title}"`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const priorityMap = {
            min: 1,
            low: 2,
            default: 3,
            high: 4,
            urgent: 5
        };
        const numPriority = typeof priority === 'number' ? priority : (priorityMap[priority] || 3);
        const tagsArray = Array.isArray(tags) ? tags : String(tags || '').split(',').map(t => t.trim()).filter(Boolean);

        const response = await fetch('https://ntfy.sh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                topic,
                title: title || '[SENGO] Notificación',
                message: String(message || ''),
                priority: numPriority,
                tags: tagsArray
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (response.ok) {
            Logger.system(`[NOTIFIER] Alerta push enviada exitosamente a ntfy.sh/${topic}`);
        } else {
            console.error(`[NOTIFIER] ntfy.sh respondió con estado: ${response.status} ${response.statusText}`);
        }
    } catch (err) {
        console.error("[NTFY] Error al enviar notificación push:", err.message);
    }
}

/**
 * Clasifica si un error fue provocado por una caída o lentitud de un servicio externo o por un bug de código.
 * @param {Error} error Objeto de error capturado.
 * @param {Object} [context={}] Contexto de la ejecución.
 * @returns {Object|null} Información del servicio afectado o null si es un error interno del bot.
 */
function classifyExternalServiceError(error, context = {}) {
    if (!error) return null;
    const errorStr = (error.message || String(error)).toLowerCase();
    const stackStr = (error.stack || '').toLowerCase();
    const code = error.code || error.status || error.statusCode;

    // 1. Interacción de Discord expirada por retraso de red (>3 segundos)
    if (code === 10062 || errorStr.includes('unknown interaction') || errorStr.includes('10062')) {
        let lagDetail = '';
        if (context.interaction?.createdTimestamp) {
            const elapsedMs = Date.now() - context.interaction.createdTimestamp;
            lagDetail = ` (Retraso acumulado: ${(elapsedMs / 1000).toFixed(1)}s)`;
        }
        return {
            service: 'Discord Gateway / REST',
            isExternal: true,
            reason: `Interacción expirada en Discord${lagDetail}. La API de Discord exige responder en <3s, pero la red de Render o la cola REST sufrieron un retraso mayor.`,
            suggestion: 'El bot no tiene ningún fallo de código; la interacción simplemente venció antes de poder entregarse a Discord.'
        };
    }

    // 2. Mensaje desconocido o permisos insuficientes en Discord
    if (code === 10008 || errorStr.includes('unknown message')) {
        return {
            service: 'Discord REST',
            isExternal: true,
            reason: 'El mensaje de Discord fue eliminado antes de que el bot pudiera responderlo o editarlo.',
            suggestion: 'Comportamiento normal si el usuario borró su mensaje rápidamente.'
        };
    }
    if (code === 50001 || code === 50013 || errorStr.includes('missing permissions') || errorStr.includes('missing access')) {
        return {
            service: 'Discord Permisos',
            isExternal: true,
            reason: 'Sengo no tiene permisos suficientes para enviar mensajes, insertar enlaces o gestionar el canal.',
            suggestion: 'Verifica los permisos del rol del bot en el servidor.'
        };
    }

    // 3. Rate-Limits de Discord o Cloudflare (429 / 1015)
    if (code === 429 || errorStr.includes('rate limit') || errorStr.includes('ratelimit') || errorStr.includes('1015')) {
        return {
            service: 'Discord / Cloudflare Rate Limit',
            isExternal: true,
            reason: 'Discord o Cloudflare aplicaron un límite de peticiones (429 / 1015) temporal a la IP del bot.',
            suggestion: 'Se desbloqueará automáticamente tras el tiempo de enfriamiento impuesto por Cloudflare/Discord.'
        };
    }

    // 4. Timeouts y errores de conexión por sockets/TCP (Undici, Cloudflare, Supabase)
    const isNetworkTimeout = 
        errorStr.includes('connecttimeouterror') || 
        errorStr.includes('und_err_connect_timeout') || 
        errorStr.includes('etimedout') || 
        errorStr.includes('econnreset') || 
        errorStr.includes('econnrefused') || 
        errorStr.includes('socket hang up') || 
        errorStr.includes('fetch failed') ||
        errorStr.includes('requesttimeout') ||
        stackStr.includes('connecttimeouterror') ||
        stackStr.includes('und_err_connect_timeout');

    if (isNetworkTimeout) {
        let target = 'Servicio Externo (Red)';
        const fullErrorInfo = `${errorStr} ${stackStr}`;
        if (fullErrorInfo.includes('supabase') || fullErrorInfo.includes('104.18.') || fullErrorInfo.includes('172.64.')) {
            target = 'Supabase / Cloudflare';
        } else if (fullErrorInfo.includes('discord')) {
            target = 'Discord REST';
        } else if (fullErrorInfo.includes('osu')) {
            target = 'API de osu!';
        }

        return {
            service: target,
            isExternal: true,
            reason: `Fallo de conexión o timeout TCP en el servidor de Render hacia ${target}.`,
            suggestion: 'Problema transitorio de enrutamiento o micro-corte de red en el host de Render.'
        };
    }

    // 5. Caída o inestabilidad de la API de osu!
    const isOsuApiError = 
        errorStr.includes('api de osu!') || 
        errorStr.includes('osu! superó el límite de la cola') ||
        errorStr.includes('osu api') ||
        errorStr.includes('522') ||
        errorStr.includes('cloudflare');

    if (isOsuApiError) {
        return {
            service: 'API de osu! (Bancho / Cloudflare)',
            isExternal: true,
            reason: 'Los servidores de la API de osu! o Cloudflare están caídos, saturados o no respondieron a tiempo (timeout de 15s).',
            suggestion: 'Comprueba el estado de osu.ppy.sh. El bot continuará intentando cuando la API responda.'
        };
    }

    // 6. Errores 5xx de servicios externos
    const status = error.status || error.statusCode || error.response?.status;
    if (status >= 500 && status < 600) {
        return {
            service: `Servicio Externo (HTTP ${status})`,
            isExternal: true,
            reason: `El servidor remoto devolvió un error interno de servidor (HTTP ${status}).`,
            suggestion: 'Fallo temporal en el backend del proveedor externo.'
        };
    }

    return null;
}

/**
 * Notifica directamente una incidencia externa relevante fuera del ciclo de comandos (ej. rate-limits en REST).
 * @param {string} serviceName Nombre del servicio afectado.
 * @param {string} reason Descripción del problema.
 * @param {string} [priority='high'] Prioridad de ntfy.
 */
async function notifyExternalServiceIssue(serviceName, reason, priority = 'high') {
    const now = Date.now();
    const lastAlert = serviceAlertCooldowns.get(serviceName) || 0;
    if (now - lastAlert < ALERT_COOLDOWN_MS) {
        Logger.system(`[ERROR-NOTIFIER] Alerta de ${serviceName} silenciada por cooldown (última alerta hace ${Math.round((now - lastAlert) / 1000)}s)`);
        return;
    }
    serviceAlertCooldowns.set(serviceName, now);

    await sendNtfyAlert({
        title: `[SENGO] 🌐 Alerta: ${serviceName}`,
        priority: priority,
        tags: 'warning,cloud',
        message: `Servicio: ${serviceName}\nDetalle: ${reason}\n\nℹ️ El bot Sengo está activo; este evento proviene de un bloqueo o retraso del proveedor externo.`
    });

    if (webhookClient) {
        try {
            const embed = new EmbedBuilder()
                .setTitle(`🌐 Incidencia en Servicio Externo: \`${serviceName}\``)
                .setColor(0xFEE75C) // Amarillo Discord
                .setDescription(`**Motivo:**\n${reason}\n\n*Nota: El código del bot funciona con normalidad; el retraso o fallo proviene del servicio externo.*`)
                .setTimestamp();
            await webhookClient.send({
                username: 'Sengo System Status',
                avatarURL: 'https://i.imgur.com/HnB61P6.png',
                embeds: [embed]
            });
        } catch {}
    }
}

/**
 * Envía un reporte detallado del error al canal de debug mediante Webhook y alerta por ntfy.
 * @param {Error} error Objeto de error capturado.
 * @param {Object} context Contexto de la ejecución (comando, argumentos, usuario, servidor, mensaje/interacción).
 */
async function reportErrorToWebhook(error, context) {
    const { commandName, args, user, guild, channel, message, interaction } = context || {};
    const classification = classifyExternalServiceError(error, context);

    // ponytail: Si es un fallo de servicio externo o lag de red, aplicar cooldown de 15m y reportar con diagnóstico amigable
    if (classification && classification.isExternal) {
        const now = Date.now();
        const lastAlert = serviceAlertCooldowns.get(classification.service) || 0;
        if (now - lastAlert < ALERT_COOLDOWN_MS) {
            Logger.system(`[ERROR-NOTIFIER] Alerta de ${classification.service} silenciada por cooldown (última alerta hace ${Math.round((now - lastAlert) / 1000)}s)`);
            return;
        }
        serviceAlertCooldowns.set(classification.service, now);

        await sendNtfyAlert({
            title: `[SENGO] 🌐 Caída Externa: ${classification.service}`,
            priority: 'high',
            tags: 'warning,cloud',
            message: `Servicio afectado: ${classification.service}\nComando: ${commandName || 'N/A'}\nDetalle: ${classification.reason}\n\nℹ️ Diagnóstico: ${classification.suggestion}`
        });

        if (webhookClient) {
            try {
                const embed = new EmbedBuilder()
                    .setTitle(`🌐 Incidencia en Servicio Externo: \`${classification.service}\``)
                    .setColor(0xFEE75C) // Amarillo advertencia
                    .setDescription(`**Diagnóstico:** ${classification.suggestion}\n\n**Detalle del Proveedor:**\n\`\`\`\n${classification.reason}\n\`\`\``)
                    .setTimestamp();

                const authorDetails = user ? `<@${user.id}> (${user.tag || user.username})` : 'N/A';
                const guildDetails = guild ? `**${guild.name}** (\`${guild.id}\`)` : 'DM';
                embed.addFields(
                    { name: '👤 Usuario', value: authorDetails, inline: true },
                    { name: '🌐 Contexto', value: guildDetails, inline: true },
                    { name: '📥 Comando', value: `\`${commandName || 'N/A'}\` ${args && args.length > 0 ? `\`${args.join(' ')}\`` : ''}`, inline: false }
                );

                await webhookClient.send({
                    username: 'Sengo External Watcher',
                    avatarURL: 'https://i.imgur.com/HnB61P6.png',
                    embeds: [embed]
                });
            } catch (err) {
                console.error("[ERROR-NOTIFIER] Error al enviar reporte externo al webhook:", err.message);
            }
        }
        return;
    }

    // Si es un bug interno de código en Sengo, emitir alerta urgente y el reporte detallado con stack trace
    await sendNtfyAlert({
        title: `[SENGO] ⚠️ Error Crítico en ${commandName || 'Comando'}`,
        priority: 'urgent',
        tags: 'rotating_light,bug',
        message: `Comando: ${commandName || 'Desconocido'}\nError: ${error.message}\nUsuario: ${user ? (user.tag || user.username) : 'N/A'}\nServidor: ${guild ? guild.name : 'DM'}`
    });

    if (!webhookClient) return;

    try {
        let contextUrl = null;
        if (message) {
            contextUrl = message.url || (guild 
                ? `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}`
                : `https://discord.com/channels/@me/${channel.id}/${message.id}`);
        }

        const embed = new EmbedBuilder()
            .setTitle(`⚠️ Error crítico en comando: \`${commandName}\``)
            .setColor(0xED4245) // Rojo Discord
            .setDescription(`**Mensaje del error:**\n\`\`\`\n${error.message}\n\`\`\``)
            .setTimestamp();

        let stackStr = error.stack || 'No hay stack trace disponible.';
        if (stackStr.length > 1000) {
            stackStr = stackStr.substring(0, 997) + '...';
        }
        embed.addFields({ name: 'Stack Trace', value: `\`\`\`javascript\n${stackStr}\n\`\`\`` });

        const authorDetails = user 
            ? `<@${user.id}> (${user.tag || user.username})\nID: \`${user.id}\`` 
            : 'N/A';
            
        const guildDetails = guild 
            ? `**Nombre:** ${guild.name}\nID: \`${guild.id}\`\n**Canal:** #${channel ? channel.name : 'desconocido'} (\`${channel ? channel.id : 'N/A'}\`)`
            : 'Mensaje Directo (DM)';

        embed.addFields(
            { name: '👤 Usuario', value: authorDetails, inline: true },
            { name: '🌐 Servidor / Contexto', value: guildDetails, inline: true }
        );

        const formattedArgs = args && args.length > 0 
            ? `\`${args.join(' ')}\`` 
            : '*(Ninguno)*';
        embed.addFields({ name: '📥 Argumentos', value: formattedArgs, inline: false });

        if (contextUrl) {
            embed.addFields({ name: '🔗 Enlace al Mensaje', value: `[Ir al mensaje original](${contextUrl})` });
        } else if (interaction) {
            embed.addFields({ name: '🔗 Tipo de Contexto', value: `Comando de barra (Slash) - ID Interacción: \`${interaction.id}\`` });
        }

        const attachmentContent = `=========================================
SENGO - INFORME DETALLADO DE ERROR
=========================================
Fecha/Hora: ${new Date().toISOString()}
Comando: ${commandName || 'Desconocido'}
Argumentos: ${args && args.length > 0 ? args.join(' ') : '(Ninguno)'}
Usuario: ${user ? `${user.username}#${user.discriminator || '0000'} (${user.id})` : 'N/A'}
Servidor: ${guild ? `${guild.name} (${guild.id})` : 'DM'}
Canal: ${channel ? `#${channel.name} (${channel.id})` : 'N/A'}
Enlace al Mensaje: ${contextUrl || 'N/A'}

-----------------------------------------
MENSAJE DEL ERROR
-----------------------------------------
${error.message}

-----------------------------------------
STACK TRACE COMPLETO
-----------------------------------------
${error.stack || 'No hay stack trace disponible.'}

-----------------------------------------
CONTENIDO COMPLETO DEL MENSAJE (si aplica)
-----------------------------------------
${message ? message.content : 'N/A'}
`;

        const fileAttachment = {
            attachment: Buffer.from(attachmentContent, 'utf-8'),
            name: `error_report_${commandName || 'command'}_${Date.now()}.txt`
        };

        await webhookClient.send({
            username: 'Sengo Error Logger',
            avatarURL: 'https://i.imgur.com/HnB61P6.png',
            embeds: [embed],
            files: [fileAttachment]
        });

    } catch (notifierError) {
        console.error("[ERROR-NOTIFIER] Error al enviar reporte al webhook:", notifierError.message);
    }
}

module.exports = {
    reportErrorToWebhook,
    sendNtfyAlert,
    classifyExternalServiceError,
    notifyExternalServiceIssue
};
