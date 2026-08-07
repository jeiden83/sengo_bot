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

/**
 * Crea un embed compacto para listar las queues de mappers de un servidor o globales.
 * @param {string} titleName Nombre del servidor o 'Globales'
 * @param {Array<{user: import('discord.js').User|null, queue: Object}>} items Lista de mappers de la página actual
 * @param {number} page Número de página actual
 * @param {number} totalPages Total de páginas
 * @param {number} totalCount Total de mappers
 * @param {string} locale Idioma
 * @param {string|null} modeFilter Nombre del filtro de modos aplicado (opcional)
 * @returns {EmbedBuilder} Embed formateado
 */
function doServerQueuesEmbed(titleName, items, page, totalPages, totalCount, locale = 'es', modeFilter = null) {
    const modeEmojis = {
        osu: "<:osu:1535098503213355099>",
        taiko: "<:taiko:1535098499824091136>",
        fruits: "<:catch:1535098500822470706>",
        mania: "<:mania:1535098502206595102>"
    };

    let title = t(locale, "queue.server_embed_title", { name: titleName });
    if (modeFilter) {
        title += ` [${modeFilter}]`;
    }

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(0x3498DB);

    if (!items || items.length === 0) {
        embed.setDescription(t(locale, "queue.server_no_mappers"));
        return embed;
    }

    const lines = items.map((item, index) => {
        const globalIndex = (page - 1) * 5 + index + 1;
        const statusEmoji = item.queue.status === 'closed' ? '🔴' : '🟢';
        
        const modes = Array.isArray(item.queue.modes) ? item.queue.modes : ['osu'];
        const modesDisplay = modes.map(m => modeEmojis[m] || '⚪').join(' ');

        let linkPart = "";
        if (item.queue.link) {
            const label = (item.queue.linkName && item.queue.linkName.trim()) 
                ? item.queue.linkName.trim() 
                : t(locale, "queue.embed_link_text");
            linkPart = ` • [${label}](${item.queue.link})`;
        }

        let msgSnippet = "";
        if (item.queue.message && item.queue.message.trim()) {
            const cleanMsg = item.queue.message.replace(/[\r\n]+/g, ' ').trim();
            const snippet = cleanMsg.length > 70 ? cleanMsg.slice(0, 67) + '...' : cleanMsg;
            msgSnippet = `\n   ↳ *"${snippet}"*`;
        }

        const username = item.user ? item.user.username : `ID: ${item.discordId}`;
        return `**${globalIndex}.** ${statusEmoji} **${username}** (${modesDisplay})${linkPart}${msgSnippet}`;
    });

    embed.setDescription(lines.join('\n\n'));
    embed.setFooter({
        text: `Página ${page}/${totalPages} • Total: ${totalCount} Mappers • Sengo Bot`
    });

    return embed;
}

/**
 * Crea la fila de botones de paginación para la lista de queues del servidor.
 * @param {number} page Página actual
 * @param {number} totalPages Total de páginas
 * @returns {import('discord.js').ActionRowBuilder} Fila de botones
 */
function buildQueuePaginationRow(page, totalPages) {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const row = new ActionRowBuilder();

    row.addComponents(
        new ButtonBuilder()
            .setCustomId('queue_page_first')
            .setLabel('⏮️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page <= 1),
        new ButtonBuilder()
            .setCustomId('queue_page_prev')
            .setLabel('◀️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page <= 1),
        new ButtonBuilder()
            .setCustomId('queue_page_next')
            .setLabel('▶️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page >= totalPages),
        new ButtonBuilder()
            .setCustomId('queue_page_last')
            .setLabel('⏭️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages)
    );

    return row;
}

module.exports = {
    doQueueEmbed,
    doServerQueuesEmbed,
    buildQueuePaginationRow
};
