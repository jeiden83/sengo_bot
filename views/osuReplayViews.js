const { EmbedBuilder } = require("discord.js");
const { t } = require("../utils/i18n.js");
const { getEmbedColor } = require("./osuViewHelpers.js");

/**
 * Renderiza el embed que detalla la información técnica de una replay (.osr)
 */
function doOsuReplayEmbed(message, replayData, modeStr, displayMods, dateObj) {
    const locale = message.locale || 'es';
    const embedColor = getEmbedColor(message);

    const statsVal = t(locale, 'replay.stats_value', {
        count300: replayData.count300,
        count100: replayData.count100,
        count50: replayData.count50,
        countMiss: replayData.countMiss,
        countGeki: replayData.countGeki,
        countKatu: replayData.countKatu
    });

    const embed = new EmbedBuilder()
        .setTitle(t(locale, 'replay.embed_title', { name: replayData.playerName }))
        .setDescription(t(locale, 'replay.embed_desc', {
            mode: modeStr,
            version: replayData.gameVersion,
            mods: displayMods.join(', ')
        }))
        .addFields(
            { name: t(locale, 'replay.field_score'), value: `${replayData.totalScore.toLocaleString(locale === 'es' ? 'es-ES' : 'en-US')}`, inline: true },
            { name: t(locale, 'replay.field_max_combo'), value: `${replayData.maxCombo}x`, inline: true },
            { name: t(locale, 'replay.field_perfect_combo'), value: replayData.perfect ? t(locale, 'replay.yes') : t(locale, 'replay.no'), inline: true },
            { name: t(locale, 'replay.field_stats'), value: statsVal, inline: false },
            { name: t(locale, 'replay.field_beatmap_md5'), value: `\`${replayData.beatmapMD5}\``, inline: false }
        )
        .setColor(embedColor)
        .setFooter({ text: t(locale, 'replay.footer') });

    if (dateObj && !isNaN(dateObj.getTime())) {
        embed.setTimestamp(dateObj);
    }

    return embed;
}

module.exports = {
    doOsuReplayEmbed
};
