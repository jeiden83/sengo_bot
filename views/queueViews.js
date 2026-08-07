const { EmbedBuilder } = require('discord.js');
const { t } = require('../utils/i18n.js');
const { getEmbedColor } = require('./osuViewHelpers.js');

/**
 * Crea un embed premium para mostrar la queue de mapper de un usuario.
 * @param {import('discord.js').User} user El usuario de Discord dueño de la queue
 * @param {Object} queueData Objeto con datos de la queue (message, link, status, modes, updatedAt)
 * @param {string} locale Idioma del servidor/mensaje
 * @param {import('discord.js').Message} message Mensaje de Discord de origen (para fallback de color)
 * @returns {EmbedBuilder} Embed formateado de la queue
 */
function doQueueEmbed(user, queueData, locale = 'es', message) {
    const isClosed = queueData.status === 'closed';
    const embedColor = isClosed ? 0xE74C3C : 0x2ECC71;

    const title = isClosed 
        ? t(locale, "queue.embed_title_closed")
        : t(locale, "queue.embed_title_open");

    const messageText = (queueData.message && queueData.message.trim()) 
        ? queueData.message.trim() 
        : t(locale, "queue.no_message");

    // Formatear los modos aceptados
    const modesList = Array.isArray(queueData.modes) && queueData.modes.length > 0
        ? queueData.modes
        : ['osu'];

    const allFourModes = ['osu', 'taiko', 'fruits', 'mania'];
    const isAll = allFourModes.every(m => modesList.includes(m));

    let modesDisplay = "";
    if (isAll) {
        modesDisplay = `✨ **${t(locale, "queue.mode_all")}** (STD / TAIKO / CTB / MANIA)`;
    } else {
        modesDisplay = modesList.map(m => t(locale, `queue.modes.${m}`) || m.toUpperCase()).join(" • ");
    }

    const embed = new EmbedBuilder()
        .setAuthor({ 
            name: `${user.username}`, 
            iconURL: user.displayAvatarURL({ dynamic: true }) 
        })
        .setTitle(title)
        .setDescription(messageText)
        .addFields({
            name: t(locale, "queue.embed_field_modes"),
            value: modesDisplay,
            inline: false
        })
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setColor(embedColor)
        .setFooter({ 
            text: t(locale, "queue.embed_footer"), 
            iconURL: user.client ? user.client.user.displayAvatarURL() : undefined 
        });

    if (queueData.link) {
        const linkLabel = (queueData.linkName && queueData.linkName.trim()) 
            ? queueData.linkName.trim() 
            : t(locale, "queue.embed_link_text");
        embed.addFields({
            name: t(locale, "queue.embed_field_link"),
            value: `[${linkLabel}](${queueData.link})`,
            inline: false
        });
    }

    if (queueData.updatedAt) {
        embed.setTimestamp(new Date(queueData.updatedAt));
    } else {
        embed.setTimestamp();
    }

    return embed;
}

module.exports = {
    doQueueEmbed
};
