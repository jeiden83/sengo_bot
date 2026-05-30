const { EmbedBuilder } = require('discord.js');

/**
 * Crea un embed para confirmar el cambio de idioma exitoso.
 * @param {string} newLang Código de idioma ('es', 'en')
 * @returns {EmbedBuilder} Embed con la confirmación
 */
function doLanguageChangedEmbed(newLang) {
    const embed = new EmbedBuilder()
        .setFooter({ text: "Sengo", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();

    if (newLang === 'en') {
        embed.setColor('#5865F2')
            .setTitle("🌐 Language Changed")
            .setDescription("The language for this server has been set to **English**.");
    } else {
        embed.setColor('#5865F2')
            .setTitle("🌐 Idioma Cambiado")
            .setDescription("El idioma para este servidor ha sido configurado en **Español**.");
    }

    return embed;
}

/**
 * Crea un embed para mostrar las opciones cuando el comando se ejecuta con argumentos inválidos.
 * @returns {EmbedBuilder} Embed instructivo
 */
function doLanguageHelpEmbed() {
    return new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle("🌐 Idioma / Language")
        .setDescription("Uso correcto del comando / Correct usage:\n`s.language [es|en]` o `/language [es|en]`")
        .setFooter({ text: "Sengo", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();
}

module.exports = {
    doLanguageChangedEmbed,
    doLanguageHelpEmbed
};
