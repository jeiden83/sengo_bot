const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { t } = require("../utils/i18n.js");
const { getEmbedColor } = require("./osuViewHelpers.js");

/**
 * Genera una barra de progreso visual usando bloques de caracteres.
 * @param {string|number} percent Porcentaje de progreso
 * @returns {string} Barra de progreso formateada
 */
function makeProgressBar(percent) {
    const totalBlocks = 12;
    const numericPercent = parseInt(percent);
    
    // Si no es un número válido (ej: "Waiting for client"), se muestra la cadena tal cual
    if (isNaN(numericPercent)) {
        return `\`${percent}\``;
    }
    
    const progress = Math.min(Math.max(numericPercent, 0), 100);
    const filledBlocks = Math.round((progress / 100) * totalBlocks);
    const emptyBlocks = totalBlocks - filledBlocks;
    
    return '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks) + ` \`${progress}%\``;
}

/**
 * Renderiza el embed inicial cuando el render es encolado.
 * @param {object} message Mensaje de Discord
 * @param {number} renderId ID del render asignado por o!rdr
 * @param {object} options Opciones de configuración del render
 * @param {string} locale Idioma del servidor
 * @returns {EmbedBuilder} EmbedBuilder de Discord
 */
function doQueueEmbed(message, renderId, options = {}, locale = 'es') {
    const embedColor = getEmbedColor(message);
    
    const embed = new EmbedBuilder()
        .setTitle(t(locale, 'render.queued_title'))
        .setDescription(t(locale, 'render.queued_desc'))
        .addFields(
            { name: t(locale, 'render.queued_id'), value: `\`#${renderId}\` ([Link](https://ordr.issou.best/render/${renderId}))`, inline: true },
            { name: t(locale, 'render.queued_skin'), value: `\`${options.skin || 'Default'}\``, inline: true },
            { name: t(locale, 'render.queued_res'), value: `\`${options.resolution || '1280x720'}\``, inline: true }
        )
        .setColor(embedColor)
        .setFooter({ text: "Sengo", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();
        
    return embed;
}

/**
 * Renderiza el embed de progreso dinámico durante la renderización.
 * @param {object} message Mensaje de Discord
 * @param {number} renderId ID del render
 * @param {string|number} progress Porcentaje de progreso (0-100 o texto)
 * @param {string} state Estado del renderizador
 * @param {string} description Descripción del render proveniente de o!rdr
 * @param {object} options Opciones de configuración del render
 * @param {string} locale Idioma del servidor
 * @returns {EmbedBuilder} EmbedBuilder de Discord
 */
function doProgressEmbed(message, renderId, progress, state, description, options = {}, locale = 'es') {
    const embedColor = getEmbedColor(message);
    
    // Si o!rdr nos provee detalles del replay (título de canción, etc.), los usamos como descripción
    const embedDescription = description 
        ? `🎬 **${description}**\n\n${t(locale, 'render.progress_desc')}`
        : t(locale, 'render.progress_desc');

    const embed = new EmbedBuilder()
        .setTitle(t(locale, 'render.progress_title'))
        .setDescription(embedDescription)
        .addFields(
            { name: t(locale, 'render.progress_status'), value: `\`${state}\``, inline: true },
            { name: t(locale, 'render.queued_skin'), value: `\`${options.skin || 'Default'}\``, inline: true },
            { name: t(locale, 'render.queued_res'), value: `\`${options.resolution || '1280x720'}\``, inline: true },
            { name: t(locale, 'render.progress_bar'), value: makeProgressBar(progress), inline: false }
        )
        .setColor(embedColor)
        .setFooter({ text: `Sengo • Render ID: #${renderId}`, iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();

    return embed;
}

/**
 * Renderiza el embed final con el enlace de descarga o visualización del video.
 * @param {object} message Mensaje de Discord
 * @param {number} renderId ID del render
 * @param {string} videoUrl Enlace de o!rdr del video finalizado
 * @param {string} description Descripción del replay proveniente de o!rdr
 * @param {object} options Opciones de configuración del render
 * @param {string} locale Idioma del servidor
 * @returns {object} Objeto conteniendo el embed y los componentes (botones)
 */
function doDoneEmbed(message, renderId, videoUrl, description, options = {}, locale = 'es') {
    const embedColor = getEmbedColor(message);
    
    const embedDescription = description 
        ? `🎬 **${description}**\n\n${t(locale, 'render.done_desc')}`
        : t(locale, 'render.done_desc');

    const embed = new EmbedBuilder()
        .setTitle(t(locale, 'render.done_title'))
        .setDescription(embedDescription)
        .addFields(
            { name: t(locale, 'render.queued_skin'), value: `\`${options.skin || 'Default'}\``, inline: true },
            { name: t(locale, 'render.queued_res'), value: `\`${options.resolution || '1280x720'}\``, inline: true }
        )
        .setColor(embedColor)
        .setFooter({ text: `Sengo • Render ID: #${renderId}`, iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel(t(locale, 'render.done_btn'))
            .setStyle(ButtonStyle.Link)
            .setURL(videoUrl)
    );

    return { embed, components: [row] };
}

/**
 * Renderiza el embed de error en caso de fallo en o!rdr.
 * @param {object} message Mensaje de Discord
 * @param {number} renderId ID del render
 * @param {string} errorMessage Explicación del error
 * @param {string} locale Idioma del servidor
 * @returns {EmbedBuilder} EmbedBuilder de Discord
 */
function doErrorEmbed(message, renderId, errorMessage, locale = 'es') {
    const embed = new EmbedBuilder()
        .setTitle(t(locale, 'render.error_title'))
        .setDescription(`${t(locale, 'render.error_desc')}\n\n> ❌ **${errorMessage}**`)
        .setColor(0xff0000) // Rojo para indicar error
        .setFooter({ text: `Sengo • Render ID: #${renderId}`, iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();

    return embed;
}

module.exports = {
    doQueueEmbed,
    doProgressEmbed,
    doDoneEmbed,
    doErrorEmbed,
    makeProgressBar
};
