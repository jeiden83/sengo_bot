const { EmbedBuilder } = require('discord.js');
const { t } = require('../utils/i18n.js');

/**
 * Genera el embed principal con la lista paginada de usuarios vinculados.
 */
function doContributorsEmbed({ chunk, totalUsers, countryCounts, page, maxPages, embedColor, syncSummary, locale = 'es' }) {
    let description = "";
    if (syncSummary) {
        description += `${syncSummary}\n\n`;
    }
    description += `${t(locale, 'contributors.total_linked', { total: totalUsers })}\n`;

    const groups = {};
    chunk.forEach(user => {
        const code = (user.country_code || 'UN').toUpperCase();
        if (!groups[code]) groups[code] = [];
        groups[code].push(user);
    });

    const countriesInChunk = Object.keys(groups).sort();
    for (const country of countriesInChunk) {
        const flagEmoji = country !== 'UN' ? `:flag_${country.toLowerCase()}:` : '🏳️';
        const totalInCountry = countryCounts[country] || 0;
        description += `\n${flagEmoji} **${country}** (${totalInCountry})\n`;

        groups[country].forEach(user => {
            const suppIcon = user.is_supporter ? ' 💖' : '';
            description += `  • **${user.username}**${suppIcon}\n`;
        });
    }

    return new EmbedBuilder()
        .setTitle(t(locale, 'contributors.title'))
        .setDescription(description)
        .setColor(embedColor)
        .setThumbnail("https://jeiden.s-ul.eu/3ssHl9Gd")
        .setFooter({
            text: t(locale, 'contributors.footer', { page, total: maxPages }),
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();
}

/**
 * Genera el embed indicando que no hay usuarios vinculados.
 */
function doContributorsEmptyEmbed(embedColor, locale = 'es') {
    return new EmbedBuilder()
        .setTitle(t(locale, 'contributors.title'))
        .setColor(embedColor)
        .setThumbnail("https://jeiden.s-ul.eu/3ssHl9Gd")
        .setDescription(t(locale, 'contributors.empty'))
        .setFooter({ text: "Sengo", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();
}

/**
 * Genera el embed para mostrar en caso de error inesperado.
 */
function doContributorsErrorEmbed(embedColor, locale = 'es') {
    return new EmbedBuilder()
        .setTitle(t(locale, 'contributors.title'))
        .setColor(embedColor)
        .setThumbnail("https://jeiden.s-ul.eu/3ssHl9Gd")
        .setDescription(t(locale, 'contributors.error'))
        .setFooter({ text: "Sengo", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();
}

module.exports = {
    doContributorsEmbed,
    doContributorsEmptyEmbed,
    doContributorsErrorEmbed
};
