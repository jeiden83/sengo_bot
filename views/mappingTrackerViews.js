const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { t } = require("../utils/i18n.js");
const { getEmbedColor, getFlagEmoji } = require("./osuViewHelpers.js");

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
 * Renderiza el embed de la guía y estado general de Mapping Tracker (Página 1).
 */
function doMappingTrackerGuideEmbed(message, activeConfig, trackedCount, locale = 'es') {
    const channelMention = activeConfig && activeConfig.channel_id ? `<#${activeConfig.channel_id}>` : t(locale, 'mapping_tracker.guide_channel_none');

    let desc = t(locale, 'mapping_tracker.guide_channel_label', { channel: channelMention, count: trackedCount });

    desc += t(locale, 'mapping_tracker.guide_header_channel');
    desc += t(locale, 'mapping_tracker.guide_line_channel_set');
    desc += t(locale, 'mapping_tracker.guide_line_channel_del');

    desc += t(locale, 'mapping_tracker.guide_header_users');
    desc += t(locale, 'mapping_tracker.guide_line_user_add');
    desc += t(locale, 'mapping_tracker.guide_line_user_server');

    desc += t(locale, 'mapping_tracker.guide_header_flags');
    desc += t(locale, 'mapping_tracker.guide_line_flag_rk');
    desc += t(locale, 'mapping_tracker.guide_line_flag_qf');
    desc += t(locale, 'mapping_tracker.guide_line_flag_lv');
    desc += t(locale, 'mapping_tracker.guide_line_flag_wip');
    desc += t(locale, 'mapping_tracker.guide_line_flag_gy');
    desc += t(locale, 'mapping_tracker.guide_line_flag_rv');
    desc += t(locale, 'mapping_tracker.guide_line_flag_nom');
    desc += t(locale, 'mapping_tracker.guide_line_flag_all');
    desc += t(locale, 'mapping_tracker.guide_flag_example');

    desc += t(locale, 'mapping_tracker.guide_header_test');
    desc += t(locale, 'mapping_tracker.guide_line_test');

    return new EmbedBuilder()
        .setTitle(t(locale, 'mapping_tracker.guide_title'))
        .setDescription(desc)
        .setColor(getEmbedColor(message))
        .setFooter({ text: t(locale, 'mapping_tracker.guide_footer') })
        .setTimestamp();
}

/**
 * Renderiza la fila de botones de la guía (Página 1).
 */
function buildTrackerGuideRow(trackedCount, locale = 'es') {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('mptrack_view_list')
            .setLabel(t(locale, 'mapping_tracker.btn_view_list', { count: trackedCount }))
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📋')
    );
}

/**
 * Renderiza el embed con la lista paginada de mappers rastreados (Página 2).
 */
function doMappingTrackerListEmbed(message, trackedList, page = 1, locale = 'es') {
    const itemsPerPage = 15;
    const totalPages = Math.max(1, Math.ceil(trackedList.length / itemsPerPage));
    const currentPage = Math.min(Math.max(1, page), totalPages);

    const startIndex = (currentPage - 1) * itemsPerPage;
    const pageItems = trackedList.slice(startIndex, startIndex + itemsPerPage);

    let listDesc = `📢 **${t(locale, 'mapping_tracker.field_status')}**: **${trackedList.length}** mappers rastreados\n\n`;

    if (pageItems.length > 0) {
        pageItems.forEach((tRow, i) => {
            const indexNum = startIndex + i + 1;
            const evs = (tRow.event_types || ['all']).join(', ');
            const flag = tRow.country_code ? `${getFlagEmoji(tRow.country_code)} ` : '';
            const countryTag = tRow.country_code ? `\`${tRow.country_code.toUpperCase()}\` ` : '';
            const mapperName = tRow.username || `Mapper #${tRow.osu_id}`;

            listDesc += `\`#${indexNum}\` ▸ ${flag}[**${mapperName}**](https://osu.ppy.sh/users/${tRow.osu_id}) ${countryTag}(\`${evs}\`)\n`;
        });
    } else {
        listDesc += t(locale, 'mapping_tracker.guide_empty_list');
    }

    const embed = new EmbedBuilder()
        .setTitle(t(locale, 'mapping_tracker.list_title'))
        .setDescription(listDesc)
        .setColor(getEmbedColor(message))
        .setFooter({ text: t(locale, 'mapping_tracker.list_page_footer', { current: currentPage, total: totalPages }) })
        .setTimestamp();

    return { embed, totalPages, currentPage };
}

/**
 * Renderiza la fila de botones de la lista de mappers (Página 2).
 */
function buildTrackerListRow(currentPage, totalPages, locale = 'es') {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('mptrack_view_guide')
            .setLabel(t(locale, 'mapping_tracker.btn_view_guide'))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📖')
    );

    if (totalPages > 1) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId('mptrack_prev')
                .setLabel(t(locale, 'mapping_tracker.btn_prev'))
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage <= 1),
            new ButtonBuilder()
                .setCustomId('mptrack_next')
                .setLabel(t(locale, 'mapping_tracker.btn_next'))
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage >= totalPages)
        );
    }
    return row;
}

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

    const titleStr = `${beatmapset.artist} - ${beatmapset.title}`;
    const mapUrl = `https://osu.ppy.sh/beatmapsets/${beatmapset.id}`;

    const fields = [
        { name: t(locale, 'mapping_tracker.field_status'), value: `**\`${statusTitle}\`**`, inline: true },
        { name: t(locale, 'mapping_tracker.field_stars'), value: `**\`${srStr}\`**`, inline: true },
        { name: t(locale, 'mapping_tracker.field_bpm_diffs'), value: `**\`${bpm} BPM\`** • **\`${diffCount}\`**`, inline: true }
    ];

    const subDateStr = beatmapset.submitted_date || beatmapset.submitted_at;
    const updDateStr = beatmapset.ranked_date || beatmapset.last_updated || beatmapset.updated_at;

    const subDate = subDateStr ? new Date(subDateStr) : null;
    const updDate = updDateStr ? new Date(updDateStr) : subDate;

    if (subDate && !isNaN(subDate.getTime())) {
        const subUnix = Math.floor(subDate.getTime() / 1000);
        const updUnix = updDate && !isNaN(updDate.getTime()) ? Math.floor(updDate.getTime() / 1000) : subUnix;

        let dateVal = `📅 **${t(locale, 'mapping_tracker.date_submitted')}**: <t:${subUnix}:R>`;
        if (updUnix && Math.abs(updUnix - subUnix) > 60) {
            dateVal += ` • ✏️ **${t(locale, 'mapping_tracker.date_updated')}**: <t:${updUnix}:R>`;
        }
        fields.push({ name: '\u200b', value: dateVal, inline: false });
    }

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
        .addFields(fields)
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
    doMappingTrackerGuideEmbed,
    buildTrackerGuideRow,
    doMappingTrackerListEmbed,
    buildTrackerListRow,
    doMappingTrackerNotificationEmbed,
    doMappingTrackerTestEmbed
};
