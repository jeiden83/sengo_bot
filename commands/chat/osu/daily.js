const { loadToken } = require("../../utils/osu.js");
const { doOsuDailyEmbed } = require("../../../views/osuDailyViews.js");
const axios = require('axios');

async function run(messages, args) {
    const { message } = messages;

    try {
        const token = await loadToken();
        if (!token) {
            return "❌ No se pudo cargar el token de autenticación de osu!. Inténtalo más tarde.";
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
            return "⚠️ No se encontró ningún Daily Challenge activo en este momento.";
        }

        const beatmap = dailyRoom.current_playlist_item?.beatmap;
        if (!beatmap) {
            return "⚠️ No se pudo obtener la información del mapa del Daily Challenge actual.";
        }

        const beatmapset = beatmap.beatmapset;

        // Fetch leaderboard for top 3
        let topScoresText = "*No hay puntuaciones registradas aún.*";
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
                    const attempts = score.attempts > 1 ? ` (${score.attempts} intentos)` : ` (1 intento)`;
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
        return "❌ Ocurrió un error inesperado al procesar el comando del Daily Challenge.";
    }
}

run.alias = {
    "daily": {
        "args": ""
    }
};

run.description = {
    'header': 'Estadísticas del Daily Challenge actual',
    'body': 'Muestra el mapa del Daily Challenge activo, sus estrellas, autor, el tiempo restante para completarlo y el top 3 de puntuaciones actuales.',
    'usage': 's.daily'
};

module.exports = { run };
