const { EmbedBuilder } = require('discord.js');
const { t } = require('../utils/i18n.js');

/**
 * Crea un embed para confirmar el cambio de idioma exitoso.
 * @param {string} newLang Código de idioma ('es', 'en')
 * @param {boolean} isUser Si el cambio es personal o del servidor
 * @returns {EmbedBuilder} Embed con la confirmación
 */
function doLanguageChangedEmbed(newLang, isUser = true) {
    const embed = new EmbedBuilder()
        .setFooter({ text: "Sengo", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp()
        .setColor('#5865F2')
        .setTitle(t(newLang, isUser ? 'language.user_changed_title' : 'language.changed_title'))
        .setDescription(t(newLang, isUser ? 'language.user_changed' : 'language.changed'));

    return embed;
}

/**
 * Crea un embed para confirmar el restablecimiento de idioma personal.
 * @param {string} locale Idioma del embed
 * @returns {EmbedBuilder} Embed con la confirmación
 */
function doLanguageResetEmbed(locale) {
    return new EmbedBuilder()
        .setFooter({ text: "Sengo", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp()
        .setColor('#5865F2')
        .setTitle(t(locale, 'language.user_changed_title'))
        .setDescription(t(locale, 'language.user_reset'));
}

/**
 * Crea un embed para mostrar las opciones cuando el comando se ejecuta con argumentos inválidos.
 * @param {string} locale Idioma actual del contexto
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
 * @param {string} locale Idioma actual del contexto
 * @param {string} prefix Prefijo de comandos del bot (por defecto 's.')
 * @param {string|null} userLang Idioma configurado para el usuario (si tiene)
 * @param {string|null} serverLang Idioma configurado para el servidor (si está en guild)
 * @returns {EmbedBuilder} Embed instructivo
 */
function doLanguageListEmbed(locale, prefix = 's.', userLang = null, serverLang = null) {
    const activeLang = userLang || locale;
    const currentES = activeLang === 'es' ? `👈 (${t(locale, 'language.current')})` : '';
    const currentEN = activeLang === 'en' ? `👈 (${t(locale, 'language.current')})` : '';

    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(t(locale, 'language.list_title'))
        .setDescription(t(locale, 'language.list_description', { prefix, currentES, currentEN }))
        .setFooter({ text: "Sengo", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();

    let statusText = `• **${t(locale, 'language.status_personal')}**: ${userLang ? `\`${userLang.toUpperCase()}\`` : `*${t(locale, 'language.status_default')}*`}`;
    if (serverLang) {
        statusText += `\n• **${t(locale, 'language.status_server')}**: \`${serverLang.toUpperCase()}\``;
    }
    embed.addFields({ name: t(locale, 'language.status_title'), value: statusText });

    return embed;
}

module.exports = {
    doLanguageChangedEmbed,
    doLanguageResetEmbed,
    doLanguageHelpEmbed,
    doLanguageListEmbed
};
