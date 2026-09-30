const { EmbedBuilder } = require("discord.js");
const { getEmbedColor } = require("./osuViewHelpers.js");
const { t } = require("../utils/i18n.js");

function formatDailyLeaderboard(leaderboard, locale) {
    if (typeof leaderboard === 'string') return leaderboard;
    if (!Array.isArray(leaderboard) || leaderboard.length === 0) {
        return t(locale, 'daily.no_scores');
    }
    const medals = ["🥇", "🥈", "🥉"];
    return leaderboard.slice(0, 3).map((score, index) => {
        const accuracy = (score.accuracy * 100).toFixed(2);
        const formattedScore = score.total_score.toLocaleString();
        const username = score.user?.username || "Unknown";
        const attempts = score.attempts > 1 
            ? t(locale, 'daily.attempts', { count: score.attempts }) 
            : t(locale, 'daily.one_attempt');
        return `**${medals[index]} #${index + 1} [${username}](https://osu.ppy.sh/users/${score.user_id})** - \`${formattedScore}\` • **${accuracy}%**${attempts}`;
    }).join("\n");
}

/**
 * Renderiza el embed para el comando s.daily
 */
function doOsuDailyEmbed(message, dailyRoom, beatmap, topScoresText) {
    const beatmapset = beatmap.beatmapset;
    const embedColor = getEmbedColor(message);
    const endsAtTimestamp = Math.floor(Date.parse(dailyRoom.ends_at) / 1000);
    const locale = message.locale || 'es';
    const formattedLeaderboard = formatDailyLeaderboard(topScoresText, locale);

    // Convertir duración a MM:SS
    const minutes = Math.floor(beatmap.total_length / 60);
    const seconds = beatmap.total_length % 60;
    const formattedLength = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    return new EmbedBuilder()
        .setAuthor({
            name: t(locale, 'daily.embed_author', { name: dailyRoom.name.replace("Daily Challenge: ", "") }),
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTitle(`${beatmapset.artist} - ${beatmapset.title}`)
        .setURL(`https://osu.ppy.sh/beatmapsets/${beatmapset.id}#osu/${beatmap.id}`)
        .setDescription(t(locale, 'daily.embed_desc', {
            version: beatmap.version,
            id: beatmap.id,
            creator: beatmapset.creator,
            userId: beatmap.user_id,
            stars: beatmap.difficulty_rating.toFixed(2),
            duration: formattedLength,
            participants: dailyRoom.participant_count.toLocaleString()
        }))
        .addFields(
            { name: t(locale, 'daily.embed_field_leaderboard'), value: formattedLeaderboard, inline: false },
            { name: t(locale, 'daily.embed_field_time_remaining'), value: t(locale, 'daily.embed_time_value', { timestamp: endsAtTimestamp }), inline: false },
            { name: t(locale, 'daily.embed_field_update'), value: t(locale, 'daily.embed_update_value'), inline: false }
        )
        .setImage(beatmapset.covers["cover@2x"] || beatmapset.covers.cover)
        .setColor(embedColor)
        .setFooter({
            text: "Sengo • Daily Challenge",
            iconURL: message.client?.user?.displayAvatarURL() || "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();
}

module.exports = {
    doOsuDailyEmbed
};
