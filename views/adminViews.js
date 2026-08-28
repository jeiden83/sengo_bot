const { EmbedBuilder } = require("discord.js");
const { getEmbedColor } = require("./osuViewHelpers.js");

/**
 * Genera el embed para la imagen YO.png.
 * @param {any} message El mensaje u objeto de interacción de Discord
 * @returns {EmbedBuilder}
 */
function doYoEmbed(message) {
    const embedColor = getEmbedColor(message);
    return new EmbedBuilder()
        .setColor(embedColor)
        .setImage("attachment://YO.png");
}

module.exports = {
    doYoEmbed
};
