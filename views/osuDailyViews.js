const { EmbedBuilder } = require("discord.js");
const { getEmbedColor } = require("./osuViewHelpers.js");

/**
 * Renderiza el embed para el comando s.daily
 */
function doOsuDailyEmbed(message, dailyRoom, beatmap, topScoresText) {
    const beatmapset = beatmap.beatmapset;
    const embedColor = getEmbedColor(message);
    const endsAtTimestamp = Math.floor(Date.parse(dailyRoom.ends_at) / 1000);

    // Convertir duración a MM:SS
    const minutes = Math.floor(beatmap.total_length / 60);
    const seconds = beatmap.total_length % 60;
    const formattedLength = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    return new EmbedBuilder()
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
            text: "Sengo • Daily Challenge",
            iconURL: message.client?.user?.displayAvatarURL() || "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();
}

module.exports = {
    doOsuDailyEmbed
};
