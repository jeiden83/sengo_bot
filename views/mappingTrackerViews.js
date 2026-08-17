const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { t } = require("../utils/i18n.js");
const { getEmbedColor, getFlagEmoji, getDifficultyEmoji } = require("./osuViewHelpers.js");

const STATUS_KEYS = {
    ranked: 'mapping_tracker.status_ranked',
    approved: 'mapping_tracker.status_approved',
    qualified: 'mapping_tracker.status_qualified',
    loved: 'mapping_tracker.status_loved',
    pending: 'mapping_tracker.status_pending',
    wip: 'mapping_tracker.status_wip',
    upload: 'mapping_tracker.status_upload',
    disqualified: 'mapping_tracker.status_disqualified',
    graveyard: 'mapping_tracker.status_graveyard',
    revive: 'mapping_tracker.status_revive',
    nomination: 'mapping_tracker.status_nomination'
};

const STATUS_CONFIGS = {
    new: { color: 1826303, titleKey: 'mapping_tracker.title_new', showDiffs: true, showRank: false },
    pending: { color: 1826303, titleKey: 'mapping_tracker.title_new', showDiffs: true, showRank: false },
    wip: { color: 1826303, titleKey: 'mapping_tracker.title_new', showDiffs: true, showRank: false },
    upload: { color: 3066993, titleKey: 'mapping_tracker.title_upload', showDiffs: true, showRank: false },
    disqualified: { color: 15548997, titleKey: 'mapping_tracker.title_disqualified', showDiffs: true, showRank: false },
    revive: { color: 8034423, titleKey: 'mapping_tracker.title_revive', showDiffs: true, showRank: false },
    nomination: { color: 12970478, titleKey: 'mapping_tracker.title_nomination', showDiffs: false, showRank: false },
    qualified: { color: 16723295, titleKey: 'mapping_tracker.title_qualified', showDiffs: false, showRank: false },
    ranked: { color: 16735016, titleKey: 'mapping_tracker.title_ranked', showDiffs: true, showRank: true },
    approved: { color: 16735016, titleKey: 'mapping_tracker.title_ranked', showDiffs: true, showRank: true },
    loved: { color: 16737962, titleKey: 'mapping_tracker.title_loved', showDiffs: true, showRank: true },
    graveyard: { color: 7829367, titleKey: 'mapping_tracker.title_graveyard', showDiffs: true, showRank: false }
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
    desc += t(locale, 'mapping_tracker.guide_line_flag_up');
    desc += t(locale, 'mapping_tracker.guide_line_flag_dq');
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
 * Renderiza el embed de notificación para un evento de Mapping Tracker.
 */
function doMappingTrackerNotificationEmbed(beatmapset, mapperUser, eventType = 'pending', locale = 'es', ranksInfo = null, extraInfo = null) {
    const statusKey = (eventType || 'pending').toLowerCase();
    const statusCfg = STATUS_CONFIGS[statusKey] || STATUS_CONFIGS.pending;
    const titleText = t(locale, statusCfg.titleKey);

    const firstBeatmapId = beatmapset.beatmaps && beatmapset.beatmaps.length > 0 ? beatmapset.beatmaps[0].id : null;
    const mapUrl = firstBeatmapId
        ? `https://osu.ppy.sh/beatmapsets/${beatmapset.id}#osu/${firstBeatmapId}`
        : `https://osu.ppy.sh/beatmapsets/${beatmapset.id}`;

    const mapperName = mapperUser?.username || beatmapset.creator || 'Mapper';
    const mapperId = mapperUser?.id || beatmapset.user_id;

    // Construcción de la descripción
    const titleMarkdown = `### [**${beatmapset.artist} - ${beatmapset.title}**](${mapUrl})`;
    const mapperMarkdown = t(locale, 'mapping_tracker.mapped_by', {
        mapper: `[**${mapperName}**](https://osu.ppy.sh/users/${mapperId})`
    });

    let desc = `${titleMarkdown}\n${mapperMarkdown}\n\n`;

    const diffs = beatmapset.beatmaps || [];
    if (statusCfg.showDiffs && diffs.length > 0) {
        desc += ` **${t(locale, 'mapping_tracker.diffs_label')}**\n`;
        const sortedDiffs = [...diffs].sort((a, b) => (Number(a.difficulty_rating || a.sr || 0)) - (Number(b.difficulty_rating || a.sr || 0)));
        const displayedDiffs = sortedDiffs.slice(0, 6);

        const MAX_DIFF_NAME_LEN = 32;
        const processedDiffs = displayedDiffs.map(d => {
            let name = d.version || d.name || 'Diff';
            if (name.length > MAX_DIFF_NAME_LEN) {
                name = name.slice(0, MAX_DIFF_NAME_LEN - 3) + '...';
            }
            return { ...d, formattedName: name };
        });

        const maxLen = Math.max(...processedDiffs.map(p => p.formattedName.length));

        for (const d of processedDiffs) {
            const srVal = Number(d.difficulty_rating || d.sr || 0);
            const srFormatted = Number.isInteger(srVal) ? srVal : parseFloat(srVal.toFixed(2));
            const srEmoji = getDifficultyEmoji(srVal);
            const paddedName = d.formattedName.padEnd(maxLen, ' ');
            const diffId = d.id || d.beatmap_id;
            const diffUrl = diffId ? `https://osu.ppy.sh/b/${diffId}` : `https://osu.ppy.sh/beatmapsets/${beatmapset.id}`;

            desc += `o ${srEmoji} [\`${paddedName}\`](${diffUrl}) **|** **${srFormatted} ⭐**\n`;
        }
        if (sortedDiffs.length > 6) {
            desc += `*... (+${sortedDiffs.length - 6} diffs)*\n`;
        }
        const bpmVal = beatmapset.bpm ? Math.round(beatmapset.bpm) : 0;
        desc += `\n🥁 **${t(locale, 'mapping_tracker.bpm_label')}**\n**\`${bpmVal}\`**\n`;
    } else if (!statusCfg.showDiffs) {
        const commentText = extraInfo?.comment || beatmapset.comment;
        if (commentText) {
            desc += `-# ${commentText}\n`;
        } else {
            desc += `-# ${t(locale, 'mapping_tracker.comment_placeholder')}\n`;
        }
    }

    const embed = new EmbedBuilder()
        .setTitle(titleText)
        .setDescription(desc)
        .setColor(statusCfg.color);

    // Configurar author si se trata de nominación o calificación con un nominador conocido
    const nominator = extraInfo?.nominator || beatmapset.nominator;
    if (nominator && (statusKey === 'nomination' || statusKey === 'qualified')) {
        const nomName = nominator.username || nominator.name || 'BN';
        const nomAvatar = nominator.avatar_url || nominator.icon_url || `https://a.ppy.sh/${nominator.id}`;
        const nomUrl = nominator.url || `https://osu.ppy.sh/users/${nominator.id}`;
        embed.setAuthor({
            name: nomName,
            iconURL: nomAvatar,
            url: nomUrl
        });
    }

    // Configurar thumbnail (carátula lista/cuadrada del mapa)
    const thumbnailUrl = beatmapset.covers?.list
        || beatmapset.covers?.['list@2x']
        || beatmapset.covers?.card
        || `https://assets.ppy.sh/beatmaps/${beatmapset.id}/covers/list.jpg`;
    embed.setThumbnail(thumbnailUrl);

    // Campos de Ranking si están disponibles y el evento lo amerita (Ranked / Loved)
    if (statusCfg.showRank && ranksInfo) {
        const rankParts = [];
        const countryCode = ranksInfo.countryCode || mapperUser?.country_code || beatmapset.user?.country_code;
        const flag = countryCode ? getFlagEmoji(countryCode) : '🌐';
        const modeLabel = ranksInfo.gamemode ? (ranksInfo.gamemode === 'osu' ? 'std' : (ranksInfo.gamemode === 'fruits' ? 'ctb' : ranksInfo.gamemode)) : null;

        if (ranksInfo.nationalRank) {
            const natDisplay = (ranksInfo.oldNationalRank && ranksInfo.oldNationalRank !== ranksInfo.nationalRank)
                ? `#${ranksInfo.oldNationalRank} ➔ #${ranksInfo.nationalRank}`
                : `#${ranksInfo.nationalRank}`;
            const cc = countryCode ? countryCode.toUpperCase() : '';
            const natTag = (cc && modeLabel) ? `${cc}, ${modeLabel}` : (cc || modeLabel || '');
            rankParts.push(`${flag} **${natDisplay} (${natTag})**`);
        }
        if (ranksInfo.serverRank) {
            const serverLabel = t(locale, 'mapping_tracker.rank_server_suffix').replace(/[()]/g, '');
            const srvDisplay = (ranksInfo.oldServerRank && ranksInfo.oldServerRank !== ranksInfo.serverRank)
                ? `#${ranksInfo.oldServerRank} ➔ #${ranksInfo.serverRank}`
                : `#${ranksInfo.serverRank}`;
            const srvTag = modeLabel ? `${serverLabel}, ${modeLabel}` : serverLabel;
            rankParts.push(`🏠 **${srvDisplay} (${srvTag})**`);
        }

        if (rankParts.length > 0) {
            const fieldName = t(locale, 'mapping_tracker.field_mapper_rank').replace(/^🏆\s*/, '');
            embed.addFields({
                name: `🏆 ${fieldName} `,
                value: rankParts.join(' • '),
                inline: false
            });
        }
    }

    // Footer
    embed.setFooter({
        text: t(locale, 'mapping_tracker.footer'),
        iconURL: "https://images-ext-1.discordapp.net/external/HICVv7z-LIJOfhJCn2bVIRKfJE2wgNUUk3uSI2DIsT8/https/cdn.discordapp.com/avatars/1064201701210468454/78f4bd4f093e75a0a501e9aaeaa6d205.png?format=webp&quality=lossless"
    });
    embed.setTimestamp();

    return { embeds: [embed] };
}

/**
 * Renderiza el embed de prueba (-track -test).
 */
function doMappingTrackerTestEmbed(beatmapset, mapperUser, locale = 'es', ranksInfo = null, extraInfo = null) {
    const embedResult = doMappingTrackerNotificationEmbed(beatmapset, mapperUser, beatmapset.status || 'pending', locale, ranksInfo, extraInfo);
    const embed = embedResult.embeds[0];
    
    embed.setFooter({
        text: t(locale, 'mapping_tracker.test_footer'),
        iconURL: embed.data.footer?.icon_url
    });

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
