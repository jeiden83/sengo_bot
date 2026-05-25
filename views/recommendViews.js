const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getEmbedColor } = require("./osuViewHelpers.js");

/**
 * Renderiza el embed para las recomendaciones de mapas (s.recommend / s.recomendar)
 * @param {object} message Mensaje de Discord
 * @param {object} profile Perfil del usuario
 * @param {Array} recommendations Lista de mapas recomendados
 * @param {object} params Parámetros de la búsqueda (minPP, maxPP, mods, showPlayed)
 * @returns {EmbedBuilder} EmbedBuilder configurado para Discord
 */
function doOsuRecommendEmbed(message, profile, recommendations, params) {
    const embedColor = getEmbedColor(message);
    const { minPP, maxPP, mods, showPlayed } = params;

    let description = "";

    if (recommendations.length === 0) {
        description = `*No se encontraron mapas recomendados en el rango de **${minPP.toFixed(0)} - ${maxPP.toFixed(0)} pp** con los filtros seleccionados.*`;
    } else {
        recommendations.forEach((c, index) => {
            const map_link = `[${c.artist} - ${c.title} [${c.version}]](https://osu.ppy.sh/b/${c.beatmapId})`;
            description += `**${index + 1}.** ${map_link}\n`;
            description += `   ▸ ⭐ **${c.stars.toFixed(2)}★** | Mod sugerido: \`${c.mods}\`\n`;
            description += `   ▸ 🎯 **${c.maxPP.toFixed(1)}pp** (100% FC) | **${c.pp99.toFixed(1)}pp** (99% FC)\n`;
            description += `   ▸ 📈 Popularidad: \`${c.popularity.toLocaleString()} jugadores\`\n\n`;
        });
    }

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Recomendaciones de Farm para ${profile.username}`,
            url: `https://osu.ppy.sh/users/${profile.id}`,
            iconURL: profile.avatar_url
        })
        .setTitle(`🎯 Mapas Sugeridos (~${((minPP + maxPP) / 2).toFixed(0)}pp)`)
        .setDescription(description)
        .addFields(
            {
                name: "🔍 Filtros Activos",
                value: `▸ **Rango de PP:** \`${minPP.toFixed(0)} - ${maxPP.toFixed(0)}pp\`\n` +
                       `▸ **Filtro de Mods:** \`${mods || "Cualquiera"}\`\n` +
                       `▸ **Jugados:** \`${showPlayed ? "Incluidos ✅" : "Excluidos 🚫"}\``,
                inline: true
            }
        )
        .setColor(embedColor)
        .setFooter({
            text: "Sengo • Basado en datos históricos de osu-pps",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();

    return embed;
}

/**
 * Construye la fila de botones interactivos para la recomendación.
 * @param {object} params Parámetros actuales (minPP, maxPP, mods, showPlayed)
 * @param {string} suggestedMod El mod alternativo sugerido según su perfil (ej: "HDDT", "NM")
 * @returns {ActionRowBuilder} Fila de botones de Discord
 */
function buildRecommendButtonsRow(params, suggestedMod) {
    const { showPlayed } = params;

    const btnRefresh = new ButtonBuilder()
        .setCustomId("rec_refresh")
        .setLabel("🔄 Otra")
        .setStyle(ButtonStyle.Secondary);

    const btnMorePP = new ButtonBuilder()
        .setCustomId("rec_more_pp")
        .setLabel("➕ Más PP")
        .setStyle(ButtonStyle.Success);

    const btnLessPP = new ButtonBuilder()
        .setCustomId("rec_less_pp")
        .setLabel("➖ Menos PP")
        .setStyle(ButtonStyle.Success);

    // Si el filtro actual es el sugerido, podemos alternar a NM o a "Cualquiera"
    const toggleLabel = params.mods === suggestedMod ? "🕶️ Probar NM/Cualquiera" : `🕶️ Probar ${suggestedMod || "Mods"}`;
    const btnToggleMods = new ButtonBuilder()
        .setCustomId("rec_toggle_mods")
        .setLabel(toggleLabel)
        .setStyle(ButtonStyle.Primary);

    const btnTogglePlayed = new ButtonBuilder()
        .setCustomId("rec_toggle_played")
        .setLabel(showPlayed ? "🚫 Excluir Jugados" : "🎮 Incluir Jugados")
        .setStyle(showPlayed ? ButtonStyle.Danger : ButtonStyle.Primary);

    return new ActionRowBuilder().addComponents(
        btnRefresh,
        btnMorePP,
        btnLessPP,
        btnToggleMods,
        btnTogglePlayed
    );
}

module.exports = {
    doOsuRecommendEmbed,
    buildRecommendButtonsRow
};
