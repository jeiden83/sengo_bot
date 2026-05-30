const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getEmbedColor } = require("./osuViewHelpers.js");
const emoji_mods = require("../src/emoji_mods.json");

function formatRecommendMods(modsStr) {
    if (!modsStr || modsStr === "NoMod") {
        return `<:NM:${emoji_mods["NM"] || '123'}> \`NM\``;
    }
    const modsList = modsStr.match(/.{1,2}/g) || [];
    const emojiStr = modsList.map(mod => {
        const id = emoji_mods[mod];
        return id ? `<:${mod}:${id}>` : mod;
    }).join("");
    return `${emojiStr} \`${modsStr}\``;
}

/**
 * Renderiza el embed para las recomendaciones de mapas (s.recommend / s.recomendar)
 * @param {object} message Mensaje de Discord
 * @param {object} profile Perfil del usuario
 * @param {Array} recommendations Lista de mapas recomendados
 * @param {object} params Parámetros de la búsqueda (minPP, maxPP, mods, showPlayed, style)
 * @returns {EmbedBuilder} EmbedBuilder configurado para Discord
 */
function doOsuRecommendEmbed(message, profile, recommendations, params) {
    const embedColor = getEmbedColor(message);
    const { minPP, maxPP, mods, showPlayed, hasSupporter, style } = params;
    const redirectBase = process.env.RENDER_EXTERNAL_URL || 'https://stoppable-passcode-riot.ngrok-free.dev';

    let description = "";

    const styleLabels = {
        'standard': 'Estándar',
        'aim': '🎯 Saltos / Aim',
        'speed': '⚡ Streams / Speed',
        'length': '⏳ Maratones / Largo',
        'rarezas': '🔮 Loved / Raros',
        'tags': '🏷️ Afinidad por Tags'
    };
    const currentStyleLabel = styleLabels[style] || 'Estándar';

    if (recommendations.length === 0) {
        description = `*No se encontraron mapas recomendados en el rango de **${minPP.toFixed(0)} - ${maxPP.toFixed(0)} pp** con los filtros seleccionados.*\n\n*Prueba usando los botones de abajo para probar alguna otra configuración (Más PP, otros mods, o incluyendo mapas ya jugados).*`;
    } else {
        recommendations.forEach((c, index) => {
            let map_link = `[${c.artist} - ${c.title} [${c.version}]](https://osu.ppy.sh/b/${c.beatmapId})`;
            if (hasSupporter) {
                map_link += ` [ [📥 osu!direct](${redirectBase}/osu/${c.beatmapsetId}) ]`;
            }
            description += `**${index + 1}.** ${map_link}\n`;
            description += `   ▸ ⭐ **${c.stars.toFixed(2)}★** | Mod sugerido: ${formatRecommendMods(c.mods)} | **${c.matchScore}% de Afinidad**\n`;
            description += `   ▸ **${c.maxPP}pp** (100% FC) | **${c.pp99}pp** (99% FC)\n`;

            const speedMultiplier = (c.mods.includes("DT") || c.mods.includes("NC")) ? 1.5 : (c.mods.includes("HT") ? 0.75 : 1.0);
            const adjustedLength = Math.floor(c.length / speedMultiplier);
            const minutes = Math.floor(adjustedLength / 60);
            const seconds = adjustedLength % 60;
            const durationStr = `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
            const displayBpm = c.bpm ? Math.round(c.bpm * speedMultiplier) : 0;
            description += `   ▸ Stats: \`${durationStr}\` | AR: \`${c.ar}\` | OD: \`${c.od}\` | BPM: \`${displayBpm}\` | Pop: \`${(c.popularity || 0).toLocaleString()}\`\n`;
            if (c.matchReasons && c.matchReasons.length > 0) {
                description += `   ▸ *Razones: ${c.matchReasons.join(" • ")}*\n`;
            }
            description += `\n`;
        });
    }

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Recomendaciones de Farm para ${profile.username}`,
            url: `https://osu.ppy.sh/users/${profile.id}`,
            iconURL: profile.avatar_url
        })
        .setTitle(`Mapas Sugeridos (~${((minPP + maxPP) / 2).toFixed(0)}pp)`)
        .setDescription(description)
        .addFields(
            {
                name: "🔍 Filtros Activos",
                value: `\`PP: ${minPP.toFixed(0)}-${maxPP.toFixed(0)}pp\` | \`Mods: ${mods || "Cualquiera"}\` | \`Jugados: ${showPlayed ? "Sí" : "No"}\` | \`Estilo: ${currentStyleLabel}\``
            }
        )
        .setColor(embedColor)
        .setFooter({
            text: "Sengo • Recomendaciones personalizadas por contenido",
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();

    return embed;
}

/**
 * Construye las filas de botones interactivos para la recomendación.
 * @param {object} params Parámetros actuales (minPP, maxPP, mods, showPlayed, style)
 * @param {string} suggestedMod El mod alternativo sugerido según su perfil (ej: "HDDT", "NM")
 * @param {boolean} hasRecs Si hay recomendaciones disponibles
 * @param {Array} recommendations Lista de mapas recomendados
 * @param {boolean} hasSupporter Si el usuario que ejecuta el comando tiene supporter activo
 * @returns {Array} Array de ActionRowBuilder
 */
function buildRecommendButtons(params, suggestedMod, hasRecs, recommendations = [], hasSupporter = false) {
    const { showPlayed, style } = params;
    const rows = [];

    // Fila 1: Controles Básicos de Rango y Estado
    const btnRefresh = new ButtonBuilder()
        .setCustomId("rec_refresh")
        .setLabel("🔄 Otra")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasRecs);

    const btnMorePP = new ButtonBuilder()
        .setCustomId("rec_more_pp")
        .setLabel("➕ Más PP")
        .setStyle(ButtonStyle.Success);

    const btnLessPP = new ButtonBuilder()
        .setCustomId("rec_less_pp")
        .setLabel("➖ Menos PP")
        .setStyle(ButtonStyle.Success);

    const toggleLabel = `🕶️ Probar ${suggestedMod || "Mods"}`;
    const btnToggleMods = new ButtonBuilder()
        .setCustomId("rec_toggle_mods")
        .setLabel(toggleLabel)
        .setStyle(ButtonStyle.Primary);

    const btnTogglePlayed = new ButtonBuilder()
        .setCustomId("rec_toggle_played")
        .setLabel(showPlayed ? "🚫 Excluir Jugados" : "🎮 Incluir Jugados")
        .setStyle(showPlayed ? ButtonStyle.Danger : ButtonStyle.Primary);

    const controlRow = new ActionRowBuilder().addComponents(
        btnRefresh,
        btnMorePP,
        btnLessPP,
        btnToggleMods,
        btnTogglePlayed
    );
    rows.push(controlRow);

    // Fila 2: Estilos de Juego y Especialidad (Filtros principales)
    const btnAim = new ButtonBuilder()
        .setCustomId("rec_style_aim")
        .setLabel("🎯 Saltos")
        .setStyle(style === 'aim' ? ButtonStyle.Success : ButtonStyle.Secondary);

    const btnSpeed = new ButtonBuilder()
        .setCustomId("rec_style_speed")
        .setLabel("⚡ Streams")
        .setStyle(style === 'speed' ? ButtonStyle.Success : ButtonStyle.Secondary);

    const btnLength = new ButtonBuilder()
        .setCustomId("rec_style_length")
        .setLabel("⏳ Maratones")
        .setStyle(style === 'length' ? ButtonStyle.Success : ButtonStyle.Secondary);

    const btnRarezas = new ButtonBuilder()
        .setCustomId("rec_style_rarezas")
        .setLabel("🔮 Loved")
        .setStyle(style === 'rarezas' ? ButtonStyle.Success : ButtonStyle.Secondary);

    const btnTags = new ButtonBuilder()
        .setCustomId("rec_style_tags")
        .setLabel("🏷️ User Tags")
        .setStyle(style === 'tags' ? ButtonStyle.Success : ButtonStyle.Secondary);

    const styleRow = new ActionRowBuilder().addComponents(
        btnAim,
        btnSpeed,
        btnLength,
        btnRarezas,
        btnTags
    );
    rows.push(styleRow);

    // Fila 3: Acciones especiales (Reset)
    const btnReset = new ButtonBuilder()
        .setCustomId("rec_style_reset")
        .setLabel("🏠 Reset Filtros")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(style === 'standard' || !style);

    const resetRow = new ActionRowBuilder().addComponents(btnReset);
    rows.push(resetRow);

    return rows;
}

module.exports = {
    doOsuRecommendEmbed,
    buildRecommendButtonsRow: buildRecommendButtons
};
