const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
 * Construye la tabla ASCII compacta y alineada para las estadísticas.
 * Ancho total exacto: 35 caracteres (anti-wrap en Discord con miniatura lateral).
 * @param {Array<[string, string, string, string]>} rows Filas con [Label, Min, Avg, Max]
 * @param {[string, string, string, string]} headers Encabezados [LabelHeader, MinHeader, AvgHeader, MaxHeader]
 * @returns {string}
 */
function renderAsciiTable(rows, headers = ["", "Min", "Avg", "Max"]) {
    const w0 = 8;
    const w1 = 6;
    const w2 = 6;
    const w3 = 6;

    const padCenter = (str, len) => {
        const s = String(str);
        if (s.length >= len) return s;
        const totalPad = len - s.length;
        const left = Math.floor(totalPad / 2);
        const right = totalPad - left;
        return ' '.repeat(left) + s + ' '.repeat(right);
    };

    const headerLine = `${''.padEnd(w0)} | ${padCenter(headers[1], w1)} | ${padCenter(headers[2], w2)} | ${padCenter(headers[3], w3)}`;
    const dividerLine = `${'-'.repeat(w0 + 1)}+${'-'.repeat(w1 + 2)}+${'-'.repeat(w2 + 2)}+${'-'.repeat(w3 + 1)}`;

    const dataLines = rows.map(r => {
        return `${r[0].padEnd(w0)} | ${String(r[1]).padStart(w1)} | ${String(r[2]).padStart(w2)} | ${String(r[3]).padStart(w3)}`;
    });

    return [headerLine, dividerLine, ...dataLines].join('\n');
}

/**
 * Construye la barra de navegación interactiva de 2 páginas para -promedio.
 * 
 * @param {number} currentPage Página activa (1 o 2)
 * @param {string} locale Idioma ('es' o 'en')
 * @param {boolean} disabled Si los botones deben estar deshabilitados
 * @returns {ActionRowBuilder}
 */
function buildPromedioButtons(currentPage = 1, locale = 'es', disabled = false) {
    const page1Label = t(locale, 'topstats.btn_top_stats') || 'Top 200 Stats';
    const page2Label = t(locale, 'topstats.btn_sengo_insights') || 'Sengo Insights';

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('promedio_page_1')
            .setLabel(page1Label)
            .setEmoji('📊')
            .setStyle(currentPage === 1 ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(disabled || currentPage === 1),
        new ButtonBuilder()
            .setCustomId('promedio_page_2')
            .setLabel(page2Label)
            .setEmoji('🌌')
            .setStyle(currentPage === 2 ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(disabled || currentPage === 2)
    );
    return row;
}

/**
 * Renderiza el embed de estadísticas del Top (Página 1 de .osu -promedio)
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
        t(locale, 'topstats.col_min') || "Min",
        t(locale, 'topstats.col_avg') || "Avg",
        t(locale, 'topstats.col_max') || "Max"
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
        .setColor(embedColor)
        .setFooter({ text: t(locale, 'topstats.footer_page_1') || 'Página 1/2 • Estadísticas del Top' });

    return { embeds: [embed] };
}

/**
 * Renderiza el embed de estado de carga progresiva para la Página 2
 * 
 * @param {import('discord.js').Message} message 
 * @param {Object} osuUser Objeto de usuario de osu!
 * @param {string} mode Modo de juego
 * @param {string} locale Idioma ('es' o 'en')
 * @param {Object} details Detalles de carga
 * @returns {{ embeds: EmbedBuilder[] }}
 */
function doOsuSengoLoadingEmbed(message, osuUser, mode = 'osu', locale = 'es', details = {}) {
    const embedColor = getEmbedColor(message);
    const flag = getCountryFlag(osuUser.country_code || osuUser.country?.code);
    const authorTitle = `${flag} ${osuUser.username} — ${t(locale, 'topstats.page2_title') || 'Sengo Insights'}`;

    const loadingTitle = t(locale, 'topstats.loading_title') || '⏳ Calculando Sengo Insights...';
    const loadingDesc = t(locale, 'topstats.loading_desc', {
        username: osuUser.username,
        mode: mode.toUpperCase()
    }) || `Procesando estadísticas avanzadas para **${osuUser.username}** en **${mode.toUpperCase()}**:`;

    const snipesStatus = details.snipes || (t(locale, 'topstats.loading_snipes') || '🔄 Consultando base de datos nacional...');
    const skillsStatus = details.skills || (t(locale, 'topstats.loading_skills') || '🔄 Analizando cinemática...');
    const twinsStatus = details.twins || (t(locale, 'topstats.loading_twins') || '🔄 Buscando perfiles afines...');

    const secSnipes = t(locale, 'topstats.sec_snipes') || '🏆 Snipes & #1s Nacionales';
    const secSkills = t(locale, 'topstats.sec_skills') || '🎯 Habilidades (Skills)';
    const secAffinity = t(locale, 'topstats.sec_affinity') || '👥 Afinidad & Gemelos';

    const embed = new EmbedBuilder()
        .setAuthor({
            name: authorTitle,
            url: `https://osu.ppy.sh/users/${osuUser.id}`,
            iconURL: osuUser.avatar_url
        })
        .setTitle(loadingTitle)
        .setDescription(
            `${loadingDesc}\n\n` +
            `• ${secSnipes}: ${snipesStatus}\n` +
            `• ${secSkills}: ${skillsStatus}\n` +
            `• ${secAffinity}: ${twinsStatus}`
        )
        .setThumbnail(osuUser.avatar_url)
        .setColor(embedColor)
        .setFooter({ text: t(locale, 'topstats.footer_page_2') || 'Página 2/2 • Sengo Insights' });

    return { embeds: [embed] };
}

/**
 * Renderiza el embed de la Página 2 (Sengo Insights con tabla ASCII en el mismo formato que la Página 1)
 * 
 * @param {import('discord.js').Message} message 
 * @param {Object} osuUser Objeto de usuario de osu!
 * @param {Object} insights Resultado de calculateSengoInsights
 * @param {string} mode Modo de juego ('osu', 'taiko', 'fruits', 'mania')
 * @param {string} locale Idioma ('es' o 'en')
 * @returns {{ embeds: EmbedBuilder[] }}
 */
function doOsuSengoInsightsEmbed(message, osuUser, insights, mode = 'osu', locale = 'es') {
    const embedColor = getEmbedColor(message);
    const flag = getCountryFlag(osuUser.country_code || osuUser.country?.code);

    const ppVal = Number(osuUser.statistics?.pp || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    const globalRankVal = Number(osuUser.statistics?.global_rank || 0).toLocaleString('en-US');
    const countryRankVal = Number(osuUser.statistics?.rank?.country ?? osuUser.statistics?.country_rank ?? 0).toLocaleString('en-US');
    const countryCodeStr = (osuUser.country_code || osuUser.country?.code || '').toUpperCase();

    // Variación en el ranking últimos 90 días
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
        t(locale, 'topstats.col_min') || "Min",
        t(locale, 'topstats.col_avg') || "Avg",
        t(locale, 'topstats.col_max') || "Max"
    ];

    const rows = [];
    const skillKeys = insights.skills?.keys || ['aim', 'speed', 'acc', 'reading'];
    for (const k of skillKeys) {
        const m = insights.skills?.metrics?.[k] || { min: '0.00', avg: '0.00', max: '0.00' };
        let label = k.charAt(0).toUpperCase() + k.slice(1, 8);
        if (k === 'precision') label = 'Precis.';
        rows.push([label, m.min, m.avg, m.max]);
    }

    if (insights.snipes?.summary) {
        rows.push(['Snipe SR', insights.snipes.summary.stars.min, insights.snipes.summary.stars.avg, insights.snipes.summary.stars.max]);
        rows.push(['Snipe PP', insights.snipes.summary.pp.min, insights.snipes.summary.pp.avg, insights.snipes.summary.pp.max]);
        rows.push(['SnipeAcc', insights.snipes.summary.acc.min, insights.snipes.summary.acc.avg, insights.snipes.summary.acc.max]);
    } else {
        rows.push(['Snipe SR', '-', '-', '-']);
        rows.push(['Snipe PP', '-', '-', '-']);
        rows.push(['SnipeAcc', '-', '-', '-']);
    }

    if (insights.tops?.top10) {
        rows.push(['Top10 PP', insights.tops.top10.min, insights.tops.top10.avg, insights.tops.top10.max]);
    }
    if (insights.tops?.full) {
        rows.push(['Top PP', insights.tops.full.min, insights.tops.full.avg, insights.tops.full.max]);
    }

    const asciiTable = renderAsciiTable(rows, headers);

    const descriptionTitle = t(locale, 'topstats.insights_for', {
        username: osuUser.username,
        url: `https://osu.ppy.sh/users/${osuUser.id}`
    }) || `🔘 **Sengo Insights for [@${osuUser.username}](https://osu.ppy.sh/users/${osuUser.id}):**`;

    const summaryLines = [];
    const snipes = insights.snipes;
    if (snipes && snipes.count > 0) {
        summaryLines.push(`🏆 **Snipes:** ${snipes.count} #1s (${insights.national?.country || 'VE'}) • Mod: ${snipes.dominantMod || 'NM'}`);
    } else {
        summaryLines.push(`🏆 **Snipes:** 0 #1s registrados (${insights.national?.country || 'VE'})`);
    }

    const aff = insights.affinity || {};
    const mods = aff.mods || {};
    summaryLines.push(`👥 **Afinidad:** NM ${mods.NM || 0}% • DT ${mods.DT || 0}% • HD ${mods.HD || 0}% • HR ${mods.HR || 0}%`);

    if (aff.topTwin) {
        summaryLines.push(`🧬 **Gemelo:** **${aff.topTwin.username}** (${aff.topTwin.similarity}% afinidad)`);
    } else {
        summaryLines.push(`🧬 **Gemelo:** Sin gemelo registrado aún`);
    }

    const description = `${descriptionTitle}\n\`\`\`text\n${asciiTable}\n\`\`\`\n${summaryLines.join('\n')}`;

    const embed = new EmbedBuilder()
        .setAuthor({
            name: authorTitle,
            url: `https://osu.ppy.sh/users/${osuUser.id}`,
            iconURL: osuUser.avatar_url
        })
        .setDescription(description)
        .setThumbnail(osuUser.avatar_url)
        .setColor(embedColor)
        .setFooter({ text: t(locale, 'topstats.footer_page_2') || 'Página 2/2 • Sengo Insights' });

    return { embeds: [embed] };
}

module.exports = {
    doOsuTopStatsEmbed,
    doOsuSengoLoadingEmbed,
    doOsuSengoInsightsEmbed,
    buildPromedioButtons,
    renderAsciiTable,
    getCountryFlag
};
