const { EmbedBuilder } = require("discord.js");
const { getEmbedColor } = require("./osuViewHelpers.js");
const { t } = require("../utils/i18n.js");

function doYuriStatsEmbed({ message, total, mediosCount, sortedUploaders, sortedSeries, lastUploadText, isLocal, locale = 'es' }) {
    const embedColor = getEmbedColor(message);
    const titleKey = isLocal ? 'yuri.stats_title_local' : 'yuri.stats_title';
    
    // Distribución por medio
    const mangaPct = total > 0 ? ((mediosCount.manga / total) * 100).toFixed(1) : '0.0';
    const novelPct = total > 0 ? ((mediosCount['novela ligera'] / total) * 100).toFixed(1) : '0.0';
    const animePct = total > 0 ? ((mediosCount.anime / total) * 100).toFixed(1) : '0.0';

    const distributionValue = t(locale, 'yuri.stats_medium_values', {
        manga: mediosCount.manga,
        mangaPct,
        novel: mediosCount['novela ligera'],
        novelPct,
        anime: mediosCount.anime,
        animePct
    });

    const embed = new EmbedBuilder()
        .setTitle(t(locale, titleKey))
        .setColor(embedColor)
        .setDescription(t(locale, 'yuri.stats_description', { total }))
        .addFields(
            { 
                name: t(locale, 'yuri.stats_medium_dist'), 
                value: distributionValue,
                inline: false 
            },
            {
                name: t(locale, 'yuri.stats_uploaders'),
                value: sortedUploaders.map(([user, count]) => `• **${user}**: ${count} (${((count / total) * 100).toFixed(1)}%)`).join('\n') || t(locale, 'yuri.none'),
                inline: false
            },
            {
                name: t(locale, 'yuri.stats_top_series'),
                value: sortedSeries.map(([serie, count], idx) => `**${idx + 1}.** ${serie} — **${count}** capturas`).join('\n') || t(locale, 'yuri.none'),
                inline: false
            },
            {
                name: t(locale, 'yuri.stats_last_upload'),
                value: lastUploadText || t(locale, 'yuri.none'),
                inline: false
            }
        )
        .setFooter({ text: t(locale, 'yuri.stats_footer') })
        .setTimestamp();

    return embed;
}

function doYuriImageEmbed({ message, imageUrl, dbData, currentIndex, totalImages, locale = 'es' }) {
    const embedColor = getEmbedColor(message);
    const embed = new EmbedBuilder()
        .setImage(imageUrl)
        .setColor(embedColor);

    if (dbData) {
        // Capitalize medio
        const medioText = dbData.medio 
            ? dbData.medio.charAt(0).toUpperCase() + dbData.medio.slice(1)
            : '';

        embed.setTitle(dbData.nombre_serie || 'Yuri')
            .addFields(
                { name: t(locale, 'yuri.embed_medium'), value: medioText || t(locale, 'yuri.not_available'), inline: true },
                { name: t(locale, 'yuri.embed_chapter'), value: dbData.capitulo || t(locale, 'yuri.one_shot'), inline: true },
                { name: t(locale, 'yuri.embed_page'), value: dbData.pagina || t(locale, 'yuri.not_available'), inline: true }
            )
            .setFooter({ text: t(locale, 'yuri.embed_footer_db', { uploader: dbData.subida_por, current: currentIndex, total: totalImages }) });
    } else {
        embed.setTitle('Yuri')
            .setFooter({ text: t(locale, 'yuri.embed_footer_simple', { current: currentIndex, total: totalImages }) });
    }

    return embed;
}

module.exports = {
    doYuriStatsEmbed,
    doYuriImageEmbed
};
