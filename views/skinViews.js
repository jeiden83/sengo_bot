const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { t } = require('../utils/i18n.js');
const { getEmbedColor } = require('./osuViewHelpers.js');

/**
 * Crea un embed premium para mostrar la skin vinculada de un usuario.
 * @param {import('discord.js').User} user El usuario de Discord dueño de la skin
 * @param {string} skinUrl El enlace de descarga de la skin (ya sanitizado)
 * @param {string|null} skinName Nombre de la skin opcional
 * @param {string} mode Modo de juego del que es la skin ('osu', 'fruits', 'taiko', 'mania')
 * @param {string} locale Idioma del servidor
 * @param {import('discord.js').Message} message Mensaje de Discord de origen (para el color)
 * @returns {EmbedBuilder} Embed formateado
 */
function doSkinEmbed(user, skinUrl, skinName, mode, locale, message) {
    const embedColor = getEmbedColor(message);

    const linkValue = skinName 
        ? t(locale, "skin.embed_field_value_named", { name: skinName, link: skinUrl })
        : t(locale, "skin.embed_field_value", { link: skinUrl });

    const modeLabel = t(locale, `skin.modes.${mode}`);
    const description = t(locale, "skin.embed_description_mode", { username: user.username, mode: modeLabel });

    return new EmbedBuilder()
        .setAuthor({ 
            name: user.username, 
            iconURL: user.displayAvatarURL({ dynamic: true }) 
        })
        .setTitle(t(locale, "skin.embed_title", { username: user.username }))
        .setDescription(description)
        .addFields({
            name: t(locale, "skin.embed_field_name"),
            value: linkValue,
            inline: false
        })
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setColor(embedColor)
        .setFooter({ 
            text: t(locale, "skin.embed_footer"), 
            iconURL: user.client.user.displayAvatarURL() 
        })
        .setTimestamp();
}

/**
 * Crea una fila de botones de Discord para navegar por las skins vinculadas.
 * @param {string[]} availableModes Lista de modos que tienen skin
 * @param {string} activeMode El modo actualmente seleccionado
 * @param {string} locale Idioma de la traducción
 * @returns {ActionRowBuilder} Fila de botones para la interacción
 */
function buildSkinButtonsRow(availableModes, activeMode, locale) {
    const row = new ActionRowBuilder();
    
    const emojiMap = {
        osu: '⚪',
        taiko: '🥁',
        fruits: '🍎',
        mania: '🎹'
    };

    for (const mode of availableModes) {
        const btn = new ButtonBuilder()
            .setCustomId(`skin_mode_${mode}`)
            .setLabel(t(locale, `skin.modes.${mode}`))
            .setEmoji(emojiMap[mode] || '📦')
            .setStyle(mode === activeMode ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(mode === activeMode);
        row.addComponents(btn);
    }
    
    return row;
}

module.exports = {
    doSkinEmbed,
    buildSkinButtonsRow
};
