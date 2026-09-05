// ponytail: adminViews actúa como adaptador ligero delegando a osuCardViews.js para s.yo
const { renderOsuCard, doOsuCardEmbed } = require("./osuCardViews.js");

/**
 * Renderiza la tarjeta de perfil en Canvas (compatibilidad hacia atrás para s.yo).
 */
async function renderYoCard(user, topScores = []) {
    return renderOsuCard(user, topScores);
}

/**
 * Genera el embed para la imagen YO.png o la imagen generada.
 * @param {any} message El mensaje u objeto de interacción de Discord
 * @param {string} imageName Nombre del archivo adjunto (por defecto YO.png)
 * @returns {EmbedBuilder}
 */
function doYoEmbed(message, imageName = "YO.png") {
    return doOsuCardEmbed(message, imageName);
}

module.exports = {
    doYoEmbed,
    renderYoCard
};
