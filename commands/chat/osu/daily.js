const { loadToken } = require("../../utils/osu.js");
const { EmbedBuilder } = require("discord.js");
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

        const roleColor = message.member?.roles?.highest?.color || '#FF66AA';
        const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#FF66AA';

        const endsAtTimestamp = Math.floor(Date.parse(dailyRoom.ends_at) / 1000);
        
        // Convert length to MM:SS
        const minutes = Math.floor(beatmap.total_length / 60);
        const seconds = beatmap.total_length % 60;
        const formattedLength = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        const embed = new EmbedBuilder()
            .setAuthor({
                name: `🏆 Osu! Daily Challenge: ${dailyRoom.name.replace("Daily Challenge: ", "")}`,
                iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
            })
            .setTitle(`${beatmapset.artist} - ${beatmapset.title}`)
            .setURL(`https://osu.ppy.sh/beatmapsets/${beatmapset.id}#osu/${beatmap.id}`)
            .setDescription(`**Dificultad:** [\`${beatmap.version}\`](https://osu.ppy.sh/beatmaps/${beatmap.id})
**Creador:** [${beatmapset.creator}](https://osu.ppy.sh/users/${beatmap.user_id})

• **Estrellas:** ⭐ \`${beatmap.difficulty_rating.toFixed(2)}\`
• **Duración:** ⏱️ \`${formattedLength}\`
• **Participantes actuales:** 👥 \`${dailyRoom.participant_count.toLocaleString()}\``)
            .addFields(
                { name: "⚡ Top 3 Clasificación", value: topScoresText, inline: false },
                { name: "⏳ Tiempo Restante", value: `Termina <t:${endsAtTimestamp}:R> (<t:${endsAtTimestamp}:F>)`, inline: false },
                { name: "🔄 Actualización", value: "Se actualiza automáticamente todos los días a las **14:00 UTC**.", inline: false }
            )
            .setImage(beatmapset.covers["cover@2x"] || beatmapset.covers.cover)
            .setColor(embedColor)
            .setFooter({
                text: "SengoBot • Daily Challenge",
                iconURL: message.client?.user?.displayAvatarURL() || "https://jeiden.s-ul.eu/3ssHl9Gd"
            })
            .setTimestamp();

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
