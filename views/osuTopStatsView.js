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
 * @param {boolean} isMeow Si fue activado con el flag secreto -meow
 * @param {string} locale Idioma ('es' o 'en')
 * @param {boolean} disabled Si los botones deben estar deshabilitados
 * @returns {ActionRowBuilder}
 */
function buildPromedioButtons(currentPage = 1, isMeow = false, locale = 'es', disabled = false) {
    const page1Label = t(locale, 'topstats.btn_top_stats') || 'Top 200 Stats';
    const page2Label = isMeow
        ? (t(locale, 'topstats.btn_meow_insights') || 'Meow Insights')
        : (t(locale, 'topstats.btn_sengo_insights') || 'Métricas Sengo');

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
            .setEmoji(isMeow ? '🐾' : '🌌')
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
 * @param {boolean} isMeow Flag secreto activado
 * @returns {{ embeds: EmbedBuilder[] }}
 */
function doOsuTopStatsEmbed(message, osuUser, stats, mode = 'osu', locale = 'es', isMeow = false) {
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

    const footerText = isMeow
        ? (t(locale, 'topstats.footer_meow_1') || '🐾 Página 1/2 • Meow Top Stats')
        : (t(locale, 'topstats.footer_page_1') || 'Página 1/2 • Estadísticas del Top');

    const embed = new EmbedBuilder()
        .setAuthor({
            name: authorTitle,
            url: `https://osu.ppy.sh/users/${osuUser.id}`,
            iconURL: osuUser.avatar_url
        })
        .setDescription(description)
        .setThumbnail(osuUser.avatar_url)
        .setColor(embedColor)
        .setFooter({ text: footerText });

    return { embeds: [embed] };
}

/**
 * Renderiza el embed de estado de carga progresiva para la Página 2
 * 
 * @param {import('discord.js').Message} message 
 * @param {Object} osuUser Objeto de usuario de osu!
 * @param {string} mode Modo de juego
 * @param {string} locale Idioma ('es' o 'en')
 * @param {boolean} isMeow Flag secreto
 * @param {Object} details Detalles de carga
 * @returns {{ embeds: EmbedBuilder[] }}
 */
function doOsuSengoLoadingEmbed(message, osuUser, mode = 'osu', locale = 'es', isMeow = false, details = {}) {
    const embedColor = getEmbedColor(message);
    const flag = getCountryFlag(osuUser.country_code || osuUser.country?.code);
    const authorTitle = `${flag} ${osuUser.username} — ${isMeow ? (t(locale, 'topstats.page2_meow_title') || 'Meow Insights') : (t(locale, 'topstats.page2_title') || 'Métricas Sengo')}`;

    const loadingTitle = isMeow
        ? (t(locale, 'topstats.loading_meow_title') || '🐾 Calculando promedios Meow...')
        : (t(locale, 'topstats.loading_title') || '⏳ Calculando promedios y métricas de Sengo...');

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
        .setFooter({ text: isMeow ? '🐾 Sengo Bot • Meow Engine' : '🌌 Sengo Bot • Sengo Engine' });

    return { embeds: [embed] };
}

/**
 * Renderiza el embed de la Página 2 (Métricas & Promedios propios de Sengo)
 * 
 * @param {import('discord.js').Message} message 
 * @param {Object} osuUser Objeto de usuario de osu!
 * @param {Object} insights Resultado de calculateSengoInsights
 * @param {string} mode Modo de juego ('osu', 'taiko', 'fruits', 'mania')
 * @param {string} locale Idioma ('es' o 'en')
 * @param {boolean} isMeow Flag secreto
 * @returns {{ embeds: EmbedBuilder[] }}
 */
function doOsuSengoInsightsEmbed(message, osuUser, insights, mode = 'osu', locale = 'es', isMeow = false) {
    const embedColor = getEmbedColor(message);
    const flag = getCountryFlag(osuUser.country_code || osuUser.country?.code);

    const ppVal = Number(osuUser.statistics?.pp || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    const globalRankVal = Number(osuUser.statistics?.global_rank || 0).toLocaleString('en-US');
    const countryRankVal = Number(osuUser.statistics?.rank?.country ?? osuUser.statistics?.country_rank ?? 0).toLocaleString('en-US');
    const countryCodeStr = (osuUser.country_code || osuUser.country?.code || '').toUpperCase();

    const authorTitle = `${flag} ${osuUser.username}: ${ppVal}pp (#${globalRankVal} ${countryCodeStr}${countryRankVal})`;

    const embed = new EmbedBuilder()
        .setAuthor({
            name: authorTitle,
            url: `https://osu.ppy.sh/users/${osuUser.id}`,
            iconURL: osuUser.avatar_url
        })
        .setTitle(isMeow ? (t(locale, 'topstats.page2_meow_title') || '🐱 Métricas & Promedios Meow') : (t(locale, 'topstats.page2_title') || '🌌 Métricas & Promedios Sengo'))
        .setThumbnail(osuUser.avatar_url)
        .setColor(embedColor)
        .setFooter({
            text: isMeow
                ? (t(locale, 'topstats.footer_meow_2') || '🐾 Página 2/2 • Meow Insights • Nya!')
                : (t(locale, 'topstats.footer_page_2') || 'Página 2/2 • Sengo Insights')
        });

    // 1. Campo Snipes
    const snipes = insights.snipes || {};
    let snipesValue = '';
    if (snipes.count > 0) {
        const lines = [
            `• ${t(locale, 'topstats.snipes_count') || 'Cantidad'}: **${snipes.count}** primeros lugares`,
            `• ${t(locale, 'topstats.snipes_avg_sr') || 'Promedio Stars'}: **${snipes.avgStars}★**`,
            `• ${t(locale, 'topstats.snipes_avg_pp') || 'Promedio PP'}: **${snipes.avgPP} pp**`,
            `• ${t(locale, 'topstats.snipes_avg_acc') || 'Promedio Precisión'}: **${snipes.avgAcc}%**`,
            `• ${t(locale, 'topstats.snipes_dominant_mod') || 'Mod Dominante'}: **${snipes.dominantMod}**`
        ];
        if (snipes.maxPPScore) {
            lines.push(`• ${t(locale, 'topstats.snipes_best_pp') || 'Mejor #1 (PP)'}: [${snipes.maxPPScore.title}](https://osu.ppy.sh/b/${snipes.maxPPScore.beatmapId || ''}) +${snipes.maxPPScore.mods} (**${snipes.maxPPScore.pp}pp**)`);
        }
        snipesValue = lines.join('\n');
    } else {
        snipesValue = `• ${t(locale, 'topstats.snipes_none') || 'Sin primeros lugares registrados en la base de datos nacional.'}`;
    }
    embed.addFields({
        name: t(locale, 'topstats.sec_snipes') || '🏆 Snipes & #1s Nacionales',
        value: snipesValue,
        inline: false
    });

    // 2. Campo Skills
    const skills = insights.skills || {};
    const skillVals = skills.values || {};
    let skillsValue = '';
    if (mode === 'osu') {
        const aimStr = Number(skillVals.aim || 0).toFixed(2);
        const speedStr = Number(skillVals.speed || 0).toFixed(2);
        const accStr = Number(skillVals.acc || 0).toFixed(2);
        const readStr = Number(skillVals.reading || 0).toFixed(2);

        const DOMINANT_NAMES = {
            aim: '🎯 Aim Specialist',
            speed: '⚡ Speed Demon',
            acc: '🎯 Precision (Acc)',
            reading: '👁️ Reading Master'
        };
        const dominantName = DOMINANT_NAMES[skills.dominantKey] || skills.dominantKey?.toUpperCase() || 'Balanced';

        skillsValue = [
            `• Aim: **${aimStr}** pts | Speed: **${speedStr}** pts`,
            `• Acc: **${accStr}** pts | Reading: **${readStr}** pts`,
            `• ${t(locale, 'topstats.skills_avg_overall') || 'Promedio General'}: **${skills.average || '0.00'}** pts`,
            `• ${t(locale, 'topstats.skills_dominant') || 'Perfil Dominante'}: **${dominantName}**`
        ].join('\n');
    } else {
        const skillEntries = (skills.keys || Object.keys(skillVals)).map(k => {
            const val = Number(skillVals[k] || 0).toFixed(2);
            const cap = k.charAt(0).toUpperCase() + k.slice(1);
            return `• ${cap}: **${val}** pts`;
        });
        skillEntries.push(`• ${t(locale, 'topstats.skills_avg_overall') || 'Promedio General'}: **${skills.average || '0.00'}** pts`);
        if (skills.keymodeInfo) {
            skillEntries.push(`• Keymode Dominante: **${skills.keymodeInfo.mode} (${skills.keymodeInfo.pct}%)**`);
        }
        skillsValue = skillEntries.join('\n');
    }
    embed.addFields({
        name: t(locale, 'topstats.sec_skills') || '🎯 Habilidades Cinéticas (Skills)',
        value: skillsValue,
        inline: false
    });

    // 3. Campo Rendimiento Nacional
    const nat = insights.national || {};
    const rankGlobalStr = Number(nat.globalRank || 0).toLocaleString('en-US');
    const countryRankText = nat.countryRank ? `#${nat.country} ${nat.countryRank}` : `#${nat.country} -`;
    const ppDropSign = parseFloat(nat.ppDrop) >= 0 ? `-${nat.ppDrop}` : `+${Math.abs(parseFloat(nat.ppDrop))}`;

    const natLines = [
        `• ${t(locale, 'topstats.nat_country_rank') || 'Posición País'}: **${countryRankText}** (#${rankGlobalStr} Global)`,
        `• ${t(locale, 'topstats.nat_avg_top10') || 'Promedio Top 10'}: **${nat.avgTop10PP} pp**`,
        `• ${(t(locale, 'topstats.nat_avg_top_all') || 'Promedio Top {count}').replace('{count}', nat.topsCount || 200)}: **${nat.avgFullPP} pp** (Spread: **${ppDropSign} pp**)`,
        `• ${t(locale, 'topstats.nat_fc_rate') || 'Tasa de FCs'}: **${nat.fcRate}%** (${nat.fcCount}/${nat.topsCount} FCs en top)`
    ];
    embed.addFields({
        name: t(locale, 'topstats.sec_national') || '📊 Rendimiento Nacional & Tops',
        value: natLines.join('\n'),
        inline: false
    });

    // 4. Campo Afinidad & Gemelo (Twins)
    const aff = insights.affinity || {};
    const mods = aff.mods || {};
    const twin = aff.topTwin;
    const twinText = twin ? `**${twin.username}** (${twin.similarity}% afinidad)` : (t(locale, 'topstats.affinity_no_twin') || 'Sin gemelo registrado aún');

    const affLines = [
        `• ${t(locale, 'topstats.affinity_weights') || 'Ponderación'}: **NM ${mods.NM || 0}%** • **DT ${mods.DT || 0}%** • **HD ${mods.HD || 0}%** • **HR ${mods.HR || 0}%**`,
        `• ${t(locale, 'topstats.affinity_playstyle') || 'Estilo de Juego'}: **${aff.playstyle || 'All-Rounder'}**`,
        `• ${t(locale, 'topstats.affinity_twin') || 'Gemelo Sengo'}: ${twinText}`
    ];
    embed.addFields({
        name: t(locale, 'topstats.sec_affinity') || '👥 Afinidad de Mods & Gemelo',
        value: affLines.join('\n'),
        inline: false
    });

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
