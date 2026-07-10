const { EmbedBuilder } = require('discord.js');
const { t } = require('../utils/i18n.js');
const { getEmbedColor } = require('./osuViewHelpers.js');

/**
 * Crea un embed premium para mostrar la skin vinculada de un usuario.
 * @param {import('discord.js').User} user El usuario de Discord dueño de la skin
 * @param {string} skinUrl El enlace de descarga de la skin (ya sanitizado)
 * @param {string} locale Idioma del servidor
 * @param {import('discord.js').Message} message Mensaje de Discord de origen (para el color)
 * @returns {EmbedBuilder} Embed formateado
 */
function doSkinEmbed(user, skinUrl, locale, message) {
    const embedColor = getEmbedColor(message);

    return new EmbedBuilder()
        .setAuthor({ 
            name: user.username, 
            iconURL: user.displayAvatarURL({ dynamic: true }) 
        })
        .setTitle(t(locale, "skin.embed_title", { username: user.username }))
        .setDescription(t(locale, "skin.embed_description", { username: user.username }))
        .addFields({
            name: t(locale, "skin.embed_field_name"),
            value: t(locale, "skin.embed_field_value", { link: skinUrl }),
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

module.exports = {
    doSkinEmbed
};
