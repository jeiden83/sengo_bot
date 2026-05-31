const { loadToken } = require("../../utils/osu.js");
const { doOsuDailyEmbed } = require("../../../views/osuDailyViews.js");
const axios = require('axios');
const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    const { message } = messages;
    const locale = message.locale || 'es';

    try {
        const token = await loadToken();
        if (!token) {
            return t(locale, 'daily.err_token_load');
        }

        const roomsUrl = 'https://osu.ppy.sh/api/v2/rooms';
        const roomsResponse = await axios.get(roomsUrl, {
            headers: {
                'Authorization': `Bearer ${token.access_token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            params: {
                mode: 'all',
                limit: 250
            }
        });

        const rooms = roomsResponse.data;
        const dailyRoom = rooms.find(room => room.category === 'daily_challenge');

        if (!dailyRoom) {
            return t(locale, 'daily.err_no_daily');
        }

        const beatmap = dailyRoom.current_playlist_item?.beatmap;
        if (!beatmap) {
            return t(locale, 'daily.err_no_beatmap');
        }

        // Fetch leaderboard for top 3
        let topScoresText = t(locale, 'daily.no_scores');
        try {
            const lbUrl = `https://osu.ppy.sh/api/v2/rooms/${dailyRoom.id}/leaderboard`;
            const lbResponse = await axios.get(lbUrl, {
                headers: {
                    'Authorization': `Bearer ${token.access_token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });
            const leaderboard = lbResponse.data.leaderboard || [];
            if (leaderboard.length > 0) {
                const medals = ["🥇", "🥈", "🥉"];
                topScoresText = leaderboard.slice(0, 3).map((score, index) => {
                    const accuracy = (score.accuracy * 100).toFixed(2);
                    const formattedScore = score.total_score.toLocaleString();
                    const username = score.user?.username || "Unknown";
                    const attempts = score.attempts > 1 
                        ? t(locale, 'daily.attempts', { count: score.attempts }) 
                        : t(locale, 'daily.one_attempt');
                    return `**${medals[index]} #${index + 1} [${username}](https://osu.ppy.sh/users/${score.user_id})** - \`${formattedScore}\` • **${accuracy}%**${attempts}`;
                }).join("\n");
            }
        } catch (lbError) {
            console.error("Error al obtener la tabla de clasificación del Daily Challenge:", lbError);
        }

        // Construir Embed utilizando la capa de visualización (View)
        const embed = doOsuDailyEmbed(message, dailyRoom, beatmap, topScoresText);

        return { embeds: [embed] };

    } catch (error) {
        console.error("Error en s.daily:", error);
        return t(locale, 'daily.err_unexpected');
    }
}

run.alias = {
    "daily": {
        "args": ""
    }
};

run.description = {
    'header': t('es', 'commands.daily.header'),
    'body': t('es', 'commands.daily.body'),
    'usage': t('es', 'commands.daily.usage')
};

module.exports = { run, description: run.description };
