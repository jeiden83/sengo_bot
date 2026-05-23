const { WebhookClient, EmbedBuilder } = require('discord.js');
const Logger = require('../utils/logger.js');
const config = require('../config.js');

const WEBHOOK_URL = config.ERROR_WEBHOOK_URL;

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

/**
 * Envía un reporte detallado del error al canal de debug mediante Webhook.
 * @param {Error} error Objeto de error capturado.
 * @param {Object} context Contexto de la ejecución (comando, argumentos, usuario, servidor, mensaje/interacción).
 */
async function reportErrorToWebhook(error, context) {
    if (!webhookClient) return;

    try {
        const { commandName, args, user, guild, channel, message, interaction } = context;

        // Construir enlace de contexto
        let contextUrl = null;
        if (message) {
            contextUrl = guild 
                ? `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}`
                : `https://discord.com/channels/@me/${channel.id}/${message.id}`;
        }

        const embed = new EmbedBuilder()
            .setTitle(`⚠️ Error crítico en comando: \`${commandName}\``)
            .setColor(0xED4245) // Rojo Discord
            .setDescription(`**Mensaje del error:**\n\`\`\`\n${error.message}\n\`\`\``)
            .setTimestamp();

        // Limitar stack trace para no exceder los límites de Discord
        let stackStr = error.stack || 'No hay stack trace disponible.';
        if (stackStr.length > 1000) {
            stackStr = stackStr.substring(0, 997) + '...';
        }
        embed.addFields({ name: 'Stack Trace', value: `\`\`\`javascript\n${stackStr}\n\`\`\`` });

        // Detalles del autor y servidor
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

        // Argumentos pasados
        const formattedArgs = args && args.length > 0 
            ? `\`${args.join(' ')}\`` 
            : '*(Ninguno)*';
        embed.addFields({ name: '📥 Argumentos', value: formattedArgs, inline: false });

        // Enlace directo al mensaje si existe
        if (contextUrl) {
            embed.addFields({ name: '🔗 Enlace al Mensaje', value: `[Ir al mensaje original](${contextUrl})` });
        } else if (interaction) {
            embed.addFields({ name: '🔗 Tipo de Contexto', value: `Comando de barra (Slash) - ID Interacción: \`${interaction.id}\`` });
        }

        await webhookClient.send({
            username: 'SengoBot Error Logger',
            avatarURL: 'https://i.imgur.com/HnB61P6.png', // Un avatar elegante por defecto
            embeds: [embed]
        });

    } catch (notifierError) {
        console.error("[ERROR-NOTIFIER] Error al enviar reporte al webhook:", notifierError.message);
    }
}

module.exports = { reportErrorToWebhook };
