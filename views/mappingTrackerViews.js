const { EmbedBuilder } = require("discord.js");
const { t } = require("../utils/i18n.js");

const STATUS_KEYS = {
    ranked: 'mapping_tracker.status_ranked',
    approved: 'mapping_tracker.status_approved',
    qualified: 'mapping_tracker.status_qualified',
    loved: 'mapping_tracker.status_loved',
    pending: 'mapping_tracker.status_pending',
    wip: 'mapping_tracker.status_wip',
    graveyard: 'mapping_tracker.status_graveyard',
    revive: 'mapping_tracker.status_revive',
    nomination: 'mapping_tracker.status_nomination'
};

const STATUS_CONFIGS = {
    ranked: { color: "#4ee44e", emoji: "🎉" },
    approved: { color: "#4ee44e", emoji: "🎉" },
    qualified: { color: "#4ee4e4", emoji: "✨" },
    loved: { color: "#ff66aa", emoji: "💖" },
    pending: { color: "#e4e44e", emoji: "🚀" },
    wip: { color: "#e4e44e", emoji: "🚀" },
    graveyard: { color: "#777777", emoji: "🪦" },
    revive: { color: "#ff9933", emoji: "🔥" },
    nomination: { color: "#9966ff", emoji: "📌" }
};

/**
 * Renderiza el embed de notificación para un evento de Mapping Tracker con i18n completo.
 */
function doMappingTrackerNotificationEmbed(beatmapset, mapperUser, eventType = 'pending', locale = 'es') {
    const statusCfg = STATUS_CONFIGS[eventType.toLowerCase()] || STATUS_CONFIGS.pending;
    const statusKey = STATUS_KEYS[eventType.toLowerCase()] || STATUS_KEYS.pending;
    const statusTitle = t(locale, statusKey);

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
    const diffCount = diffs.length > 0 ? `${diffs.length} diffs` : 'N/A';
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
            { name: t(locale, 'mapping_tracker.field_status'), value: `**\`${statusTitle}\`**`, inline: true },
            { name: t(locale, 'mapping_tracker.field_stars'), value: `**\`${srStr}\`**`, inline: true },
            { name: t(locale, 'mapping_tracker.field_bpm_diffs'), value: `**\`${bpm} BPM\`** • **\`${diffCount}\`**`, inline: true }
        )
        .setFooter({ text: t(locale, 'mapping_tracker.footer'), iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();

    return { embeds: [embed] };
}

/**
 * Renderiza el embed de prueba (-track -test).
 */
function doMappingTrackerTestEmbed(beatmapset, mapperUser, locale = 'es') {
    const embedResult = doMappingTrackerNotificationEmbed(beatmapset, mapperUser, beatmapset.status || 'pending', locale);
    const embed = embedResult.embeds[0];
    
    const prefixStr = t(locale, 'mapping_tracker.test_title_prefix');
    embed.setTitle(`${prefixStr}${embed.data.title}`);
    embed.setFooter({ text: t(locale, 'mapping_tracker.test_footer'), iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" });

    return { embeds: [embed] };
}

module.exports = {
    doMappingTrackerNotificationEmbed,
    doMappingTrackerTestEmbed
};
