const { EmbedBuilder } = require("discord.js");
const { t } = require("../utils/i18n.js");

const STATUS_CONFIGS = {
    ranked: { title: "🎉 ¡Mapa Ranked!", color: "#4ee44e", emoji: "🎉" },
    approved: { title: "🎉 ¡Mapa Aprobado!", color: "#4ee44e", emoji: "🎉" },
    qualified: { title: "✨ ¡Mapa Qualificado!", color: "#4ee4e4", emoji: "✨" },
    loved: { title: "💖 ¡Mapa Loved!", color: "#ff66aa", emoji: "💖" },
    pending: { title: "🚀 ¡Nuevo Mapa / Actualización!", color: "#e4e44e", emoji: "🚀" },
    wip: { title: "🚀 ¡Mapa en Trabajo (WIP)!", color: "#e4e44e", emoji: "🚀" },
    graveyard: { title: "🪦 Mapa a Graveyard", color: "#777777", emoji: "🪦" },
    revive: { title: "🔥 ¡Mapa Revivido!", color: "#ff9933", emoji: "🔥" },
    nomination: { title: "📌 ¡Nueva Nominación!", color: "#9966ff", emoji: "📌" }
};

/**
 * Renderiza el embed de notificación para un evento de Mapping Tracker.
 */
function doMappingTrackerNotificationEmbed(beatmapset, mapperUser, eventType = 'pending', locale = 'es') {
    const statusCfg = STATUS_CONFIGS[eventType.toLowerCase()] || STATUS_CONFIGS.pending;
    
    const coverUrl = beatmapset.covers?.cover
        || beatmapset.covers?.['cover@2x']
        || beatmapset.covers?.card
        || 'https://assets.ppy.sh/beatmaps/pack-default.jpg';

    const mapperName = mapperUser.username || beatmapset.creator || 'Mapper';
    const mapperAvatar = mapperUser.avatar_url || `https://a.ppy.sh/${beatmapset.user_id}`;

    const diffs = beatmapset.beatmaps || [];
    let srStr = 'N/A';
    if (diffs.length > 0) {
        const srs = diffs.map(d => Number(d.difficulty_rating || d.sr || 0)).filter(s => s > 0);
        if (srs.length > 0) {
            const minSr = Math.min(...srs).toFixed(2);
            const maxSr = Math.max(...srs).toFixed(2);
            srStr = minSr === maxSr ? `${minSr}★` : `${minSr}★ - ${maxSr}★`;
        }
    }

    const bpm = beatmapset.bpm ? `${Math.round(beatmapset.bpm)}` : 'N/A';
    const diffCount = diffs.length > 0 ? `${diffs.length} dificultad${diffs.length === 1 ? '' : 'es'}` : 'N/A';
    const statusText = (beatmapset.status || eventType).toUpperCase();

    const titleStr = `${beatmapset.artist} - ${beatmapset.title}`;
    const mapUrl = `https://osu.ppy.sh/beatmapsets/${beatmapset.id}`;

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `${statusCfg.emoji} ${mapperName} • Mapping Tracker`,
            iconURL: mapperAvatar,
            url: `https://osu.ppy.sh/users/${mapperUser.id || beatmapset.user_id}`
        })
        .setTitle(titleStr)
        .setURL(mapUrl)
        .setColor(statusCfg.color)
        .setImage(coverUrl)
        .addFields(
            { name: "📌 Estado", value: `\`${statusCfg.title}\` (${statusText})`, inline: true },
            { name: "⭐ Estrellas", value: `\`${srStr}\``, inline: true },
            { name: "🥁 BPM / Diffs", value: `\`${bpm} BPM\` • \`${diffCount}\``, inline: true }
        )
        .setFooter({ text: "Sengo • Mapping Tracker", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();

    return { embeds: [embed] };
}

/**
 * Renderiza el embed de prueba (-track -test).
 */
function doMappingTrackerTestEmbed(beatmapset, mapperUser, locale = 'es') {
    const embedResult = doMappingTrackerNotificationEmbed(beatmapset, mapperUser, beatmapset.status || 'pending', locale);
    const embed = embedResult.embeds[0];
    
    embed.setTitle(`🧪 [PRUEBA] ${embed.data.title}`);
    embed.setFooter({ text: "Sengo • Mapping Tracker (Modo de Prueba -test)", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" });

    return { embeds: [embed] };
}

module.exports = {
    doMappingTrackerNotificationEmbed,
    doMappingTrackerTestEmbed
};
