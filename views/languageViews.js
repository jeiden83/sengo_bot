const { EmbedBuilder } = require('discord.js');
const { t } = require('../utils/i18n.js');

/**
 * Crea un embed para confirmar el cambio de idioma exitoso.
 * @param {string} newLang Código de idioma ('es', 'en')
 * @returns {EmbedBuilder} Embed con la confirmación
 */
function doLanguageChangedEmbed(newLang) {
    const embed = new EmbedBuilder()
        .setFooter({ text: "Sengo", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp()
        .setColor('#5865F2')
        // El título y la descripción del cambio exitoso se muestran en el nuevo idioma configurado
        .setTitle(t(newLang, 'language.changed_title'))
        .setDescription(t(newLang, 'language.changed'));

    return embed;
}

/**
 * Crea un embed para mostrar las opciones cuando el comando se ejecuta con argumentos inválidos.
 * @param {string} locale Idioma actual del servidor/contexto
 * @param {string} prefix Prefijo de comandos del bot (por defecto 's.')
 * @returns {EmbedBuilder} Embed instructivo
 */
function doLanguageHelpEmbed(locale, prefix = 's.') {
    return new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle(t(locale, 'language.help_title'))
        .setDescription(t(locale, 'language.help_description', { prefix }))
        .setFooter({ text: "Sengo", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();
}

/**
 * Crea un embed para listar los idiomas soportados e indicar cuál es el actual.
 * @param {string} locale Idioma actual del servidor/contexto
 * @param {string} prefix Prefijo de comandos del bot (por defecto 's.')
 * @returns {EmbedBuilder} Embed instructivo
 */
function doLanguageListEmbed(locale, prefix = 's.') {
    const currentES = locale === 'es' ? `👈 (${t(locale, 'language.current')})` : '';
    const currentEN = locale === 'en' ? `👈 (${t(locale, 'language.current')})` : '';

    return new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(t(locale, 'language.list_title'))
        .setDescription(t(locale, 'language.list_description', { prefix, currentES, currentEN }))
        .setFooter({ text: "Sengo", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();
}

module.exports = {
    doLanguageChangedEmbed,
    doLanguageHelpEmbed,
    doLanguageListEmbed
};
