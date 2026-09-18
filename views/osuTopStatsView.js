const { EmbedBuilder } = require('discord.js');
const { getEmbedColor } = require('./osuViewHelpers.js');
const { t } = require('../utils/i18n.js');

/**
 * Genera el emoji de la bandera nacional a partir del código ISO de 2 letras
 * @param {string} countryCode 
 * @returns {string}
 */
function getCountryFlag(countryCode) {
    if (!countryCode || typeof countryCode !== "string" || countryCode.length !== 2) {
        return "🌐";
    }
    const codePoints = countryCode
        .toUpperCase()
        .split("")
        .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
}

/**
 * Construye la tabla ASCII alineada para las estadísticas
 * @param {Array<[string, string, string, string]>} rows Filas con [Label, Min, Avg, Max]
 * @param {[string, string, string, string]} headers Encabezados [LabelHeader, MinHeader, AvgHeader, MaxHeader]
 * @returns {string}
 */
function renderAsciiTable(rows, headers = ["", "Minimum", "Average", "Maximum"]) {
    let w0 = headers[0].length;
    let w1 = headers[1].length;
    let w2 = headers[2].length;
    let w3 = headers[3].length;

    for (const r of rows) {
        if (r[0].length > w0) w0 = r[0].length;
        if (r[1].length > w1) w1 = r[1].length;
        if (r[2].length > w2) w2 = r[2].length;
        if (r[3].length > w3) w3 = r[3].length;
    }

    // Asegurar anchos estándar mínimos para paridad estética con Bathbot
    w0 = Math.max(w0, 10);
    w1 = Math.max(w1, 7);
    w2 = Math.max(w2, 7);
    w3 = Math.max(w3, 7);

    const headerLine = `${headers[0].padEnd(w0)} | ${headers[1].padStart(w1)} | ${headers[2].padStart(w2)} | ${headers[3].padStart(w3)}`;
    const dividerLine = `${'-'.repeat(w0 + 1)}+${'-'.repeat(w1 + 2)}+${'-'.repeat(w2 + 2)}+${'-'.repeat(w3 + 1)}`;

    const dataLines = rows.map(r => {
        return `${r[0].padEnd(w0)} | ${r[1].padStart(w1)} | ${r[2].padStart(w2)} | ${r[3].padStart(w3)}`;
    });

    return [headerLine, dividerLine, ...dataLines].join('\n');
}

/**
 * Renderiza el embed de estadísticas del Top 100 (.osu -promedio)
 * 
 * @param {import('discord.js').Message} message 
 * @param {Object} osuUser Objeto de usuario de osu!
 * @param {Object} stats Resultado de calculateTop100Statistics
 * @param {string} mode Modo de juego ('osu', 'taiko', 'fruits', 'mania')
 * @param {string} locale Idioma ('es' o 'en')
 * @returns {{ embeds: EmbedBuilder[] }}
 */
function doOsuTopStatsEmbed(message, osuUser, stats, mode = 'osu', locale = 'es') {
    const embedColor = getEmbedColor(message);
    const flag = getCountryFlag(osuUser.country_code || osuUser.country?.code);

    const ppVal = Number(osuUser.statistics?.pp || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    const globalRankVal = Number(osuUser.statistics?.global_rank || 0).toLocaleString('en-US');
    const countryRankVal = Number(osuUser.statistics?.rank?.country ?? osuUser.statistics?.country_rank ?? 0).toLocaleString('en-US');
    const countryCodeStr = (osuUser.country_code || osuUser.country?.code || '').toUpperCase();

    // Cálculo de variación en el ranking en los últimos 90 días (rank_history)
    let rankDelta = "";
    if (osuUser.rank_history && Array.isArray(osuUser.rank_history.data) && osuUser.rank_history.data.length > 0) {
        const pastRank = osuUser.rank_history.data[0];
        const currentRank = osuUser.statistics?.global_rank;
        if (pastRank && currentRank) {
            const diff = currentRank - pastRank;
            if (diff > 0) {
                rankDelta = ` ↓${diff.toLocaleString('en-US')}`;
            } else if (diff < 0) {
                rankDelta = ` ↑${Math.abs(diff).toLocaleString('en-US')}`;
            }
        }
    }

    const authorTitle = `${flag} ${osuUser.username}: ${ppVal}pp (#${globalRankVal}${rankDelta} ${countryCodeStr}${countryRankVal})`;

    const headers = [
        "",
        t(locale, 'topstats.col_min') || "Minimum",
        t(locale, 'topstats.col_avg') || "Average",
        t(locale, 'topstats.col_max') || "Maximum"
    ];

    const f = stats.formatted;
    const rows = [
        [t(locale, 'topstats.row_accuracy') || "Accuracy", f.accuracy.min, f.accuracy.avg, f.accuracy.max],
        [t(locale, 'topstats.row_combo') || "Combo", f.combo.min, f.combo.avg, f.combo.max],
        [t(locale, 'topstats.row_misses') || "Misses", f.misses.min, f.misses.avg, f.misses.max],
        [t(locale, 'topstats.row_pp') || "PP", f.pp.min, f.pp.avg, f.pp.max],
        [t(locale, 'topstats.row_stars') || "Stars", f.stars.min, f.stars.avg, f.stars.max],
        [t(locale, 'topstats.row_bpm') || "BPM", f.bpm.min, f.bpm.avg, f.bpm.max],
        [t(locale, 'topstats.row_hp') || "HP", f.hp.min, f.hp.avg, f.hp.max],
        [t(locale, 'topstats.row_ar') || "AR", f.ar.min, f.ar.avg, f.ar.max],
        [t(locale, 'topstats.row_cs') || "CS", f.cs.min, f.cs.avg, f.cs.max],
        [t(locale, 'topstats.row_od') || "OD", f.od.min, f.od.avg, f.od.max],
        [t(locale, 'topstats.row_length') || "Length", f.length.min, f.length.avg, f.length.max]
    ];

    const asciiTable = renderAsciiTable(rows, headers);

    const descriptionTitle = t(locale, 'topstats.stats_for', {
        count: stats.count,
        username: osuUser.username,
        url: `https://osu.ppy.sh/users/${osuUser.id}`
    }) || `🔘 **Top${stats.count} statistics for [@${osuUser.username}](https://osu.ppy.sh/users/${osuUser.id}):**`;

    const description = `${descriptionTitle}\n\`\`\`text\n${asciiTable}\n\`\`\``;

    const embed = new EmbedBuilder()
        .setAuthor({
            name: authorTitle,
            url: `https://osu.ppy.sh/users/${osuUser.id}`,
            iconURL: osuUser.avatar_url
        })
        .setDescription(description)
        .setThumbnail(osuUser.avatar_url)
        .setColor(embedColor);

    return { embeds: [embed] };
}

module.exports = {
    doOsuTopStatsEmbed,
    renderAsciiTable,
    getCountryFlag
};
