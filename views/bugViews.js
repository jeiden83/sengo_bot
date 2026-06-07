const { EmbedBuilder } = require("discord.js");

/**
 * Genera el embed de reporte de bug para enviar al webhook.
 * @param {object} reporter El usuario que reporta el bug (User de discord.js)
 * @param {object|null} guild Servidor desde el que se reporta (Guild de discord.js)
 * @param {object} channel Canal desde el que se reporta (Channel de discord.js)
 * @param {Date} timestamp Fecha/hora del reporte
 * @param {string|null} title Título del bug
 * @param {string|null} body Cuerpo/descripción del bug
 * @param {object|null} replyMessage Mensaje al que responde (si aplica)
 * @param {string|null} attachmentUrl URL del archivo adjunto (foto)
 * @returns {EmbedBuilder} Embed para enviar al webhook
 */
function doBugReportEmbed(reporter, guild, channel, timestamp, title, body, replyMessage, attachmentUrl) {
    const embed = new EmbedBuilder()
        .setTitle(title ? `🐛 Reporte de Bug: ${title}` : "🐛 Nuevo Reporte de Bug")
        .setColor(0xE67E22) // Naranja
        .setTimestamp(timestamp)
        .setFooter({
            text: "Sengo Bug Reporter",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        });

    if (body) {
        embed.setDescription(body);
    } else {
        embed.setDescription("*(Sin descripción)*");
    }

    // Información del reporte
    const reporterInfo = `<@${reporter.id}> (${reporter.tag})\nID: \`${reporter.id}\``;
    const guildInfo = guild 
        ? `**Servidor:** ${guild.name}\nID: \`${guild.id}\`\n**Canal:** <#${channel.id}> (\`${channel.id}\`)`
        : "Mensaje Directo (DM)";

    embed.addFields(
        { name: "👤 Reportado por", value: reporterInfo, inline: true },
        { name: "🌐 Servidor / Contexto", value: guildInfo, inline: true }
    );

    // Información de reply (si existe)
    if (replyMessage) {
        const replyTimestamp = Math.floor(replyMessage.createdAt.getTime() / 1000);
        const replyAuthor = `<@${replyMessage.author.id}> (${replyMessage.author.tag})\nID: \`${replyMessage.author.id}\``;
        
        let messageLink = `https://discord.com/channels/`;
        if (guild) {
            messageLink += `${guild.id}/${channel.id}/${replyMessage.id}`;
        } else {
            messageLink += `@me/${channel.id}/${replyMessage.id}`;
        }

        embed.addFields(
            { name: "💬 En respuesta a", value: replyAuthor, inline: true },
            { name: "📅 Hora del mensaje original", value: `<t:${replyTimestamp}:F> (<t:${replyTimestamp}:R>)`, inline: true },
            { name: "🔗 Enlace de Mensaje", value: `[Ir al mensaje respondido](${messageLink})`, inline: false }
        );

        if (replyMessage.content) {
            let cleanContent = replyMessage.content;
            if (cleanContent.length > 500) {
                cleanContent = cleanContent.substring(0, 497) + "...";
            }
            embed.addFields({ name: "📝 Contenido del mensaje original", value: `>>> ${cleanContent}` });
        }
    }

    // Si hay foto adjunta
    if (attachmentUrl) {
        embed.setImage(attachmentUrl);
    }

    return embed;
}

module.exports = {
    doBugReportEmbed
};
