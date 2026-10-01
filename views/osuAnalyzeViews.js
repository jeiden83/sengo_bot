const { EmbedBuilder } = require('discord.js');
const { getEmbedColor } = require('./osuViewHelpers.js');
const { formatNumber, formatDecimal, t } = require('../utils/i18n.js');
const { formatTime } = require('../utils/replayAnalyzer.js');

/**
 * Genera el Discord Embed completo con el análisis de la replay.
 */
function doOsuAnalyzeEmbed({ message, replay, mapData, analysis, ppData, beatmapId, locale = 'es' }) {
    const embedColor = getEmbedColor(message);

    const title = mapData.title || 'Unknown Title';
    const artist = mapData.artist || 'Unknown Artist';
    const version = mapData.version || 'Normal';
    const player = replay.playerName || 'Player';
    const modsStr = replay.modsStr && replay.modsStr !== 'NM' ? `+${replay.modsStr}` : 'No Mod';

    const accuracy = formatDecimal(replay.accuracy !== undefined ? replay.accuracy * 100 : 0, locale, 2) + '%';
    const scoreStr = formatNumber(replay.totalScore || 0, locale);
    const comboStr = `${formatNumber(replay.maxCombo || 0, locale)}x / ${formatNumber(ppData.maxCombo || 0, locale)}x`;
    const hitsStr = `${formatNumber(replay.count300 || 0, locale)} / ${formatNumber(replay.count100 || 0, locale)} / ${formatNumber(replay.count50 || 0, locale)} / ${formatNumber(replay.countMiss || 0, locale)}`;

    const ppActual = ppData.pp ? formatDecimal(ppData.pp, locale, 1) + ' pp' : '0 pp';
    const ppFc = ppData.pp_fc ? formatDecimal(ppData.pp_fc, locale, 1) + ' pp' : ppActual;

    // UR y Offset
    let urStr = t(locale, 'analyze.ur_relax');
    let offsetStr = '-';
    if (analysis.unstableRate !== null) {
        urStr = formatDecimal(analysis.unstableRate, locale, 2);
        if (analysis.meanOffset !== null) {
            const offsetSign = analysis.meanOffset >= 0 ? '+' : '';
            const offsetType = analysis.meanOffset > 1 ? t(locale, 'analyze.offset_late') : (analysis.meanOffset < -1 ? t(locale, 'analyze.offset_early') : t(locale, 'analyze.offset_perfect'));
            offsetStr = `${offsetSign}${formatDecimal(analysis.meanOffset, locale, 1)}ms (${offsetType})`;
        }
    }

    // Primer choke
    const firstChokeStr = analysis.firstChoke !== null ? formatTime(analysis.firstChoke) : t(locale, 'analyze.no_choke');

    // Secciones críticas
    let sectionsText = '';
    if (analysis.topSections && analysis.topSections.length > 0) {
        sectionsText = analysis.topSections.map((s, idx) => {
            const timeRange = `${formatTime(s.startTime)} - ${formatTime(s.endTime)}`;
            return `**#${idx + 1}** \`[${timeRange}]\` ➔ **${s.count} misses** (${s.percent}%) • *${s.dominantPattern}*`;
        }).join('\n');
    } else {
        sectionsText = t(locale, 'analyze.no_critical_sections');
    }

    // Diagnóstico
    const diagnosisText = t(locale, `analyze.${analysis.patternDiagnosisKey}`);

    const embed = new EmbedBuilder()
        .setTitle(t(locale, 'analyze.embed_title', { artist, title, version }))
        .setURL(`https://osu.ppy.sh/b/${beatmapId}`)
        .setColor(embedColor)
        .setAuthor({
            name: `${player} (${modsStr})`,
            iconURL: `https://a.ppy.sh/${replay.user_id || 0}`,
            url: `https://osu.ppy.sh/users/${replay.user_id || 0}`
        })
        .addFields(
            {
                name: t(locale, 'analyze.field_stats'),
                value: [
                    `• **${t(locale, 'analyze.label_score')}:** ${scoreStr} (${accuracy})`,
                    `• **${t(locale, 'analyze.label_combo')}:** ${comboStr}`,
                    `• **${t(locale, 'analyze.label_hits')}:** [${hitsStr}]`
                ].join('\n'),
                inline: true
            },
            {
                name: t(locale, 'analyze.field_performance'),
                value: [
                    `• **PP:** **${ppActual}**`,
                    `• **${t(locale, 'analyze.label_pp_fc', { mods: modsStr })}:** **${ppFc}**`,
                    `• **Primer Choke:** \`${firstChokeStr}\``
                ].join('\n'),
                inline: true
            },
            {
                name: t(locale, 'analyze.field_tapping'),
                value: [
                    `• **Unstable Rate:** **${urStr}**`,
                    `• **Offset:** **${offsetStr}**`
                ].join('\n'),
                inline: false
            },
            {
                name: t(locale, 'analyze.field_sections'),
                value: sectionsText,
                inline: false
            },
            {
                name: t(locale, 'analyze.field_diagnosis'),
                value: `💡 ${diagnosisText}`,
                inline: false
            }
        )
        .setImage('attachment://replay_analysis.png')
        .setFooter({ text: t(locale, 'analyze.footer'), iconURL: 'https://jeiden.s-ul.eu/3ssHl9Gd' })
        .setTimestamp();

    return embed;
}

module.exports = { doOsuAnalyzeEmbed };
