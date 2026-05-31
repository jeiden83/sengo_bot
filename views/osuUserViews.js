const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getEmbedColor, getFlagEmoji } = require("./osuViewHelpers.js");
const { t } = require("../utils/i18n.js");

/**
 * Renderiza el embed para el enlace seguro de OAuth (link.js)
 */
function doOsuOAuthEmbed(authUrl, message) {
    const locale = message.locale || 'es';
    return new EmbedBuilder()
        .setTitle(t(locale, 'link.oauth_title'))
        .setDescription(t(locale, 'link.oauth_desc', { url: authUrl }))
        .setColor("#ff66aa")
        .setFooter({ text: t(locale, 'link.oauth_footer') })
        .setTimestamp();
}

/**
 * Renderiza el embed de usuarios vinculados faltantes (amigos.js -sengo)
 */
function doOsuMissingFriendsEmbed(message, missingFriends) {
    const embedColor = getEmbedColor(message);
    const locale = message.locale || 'es';

    const missingEmbed = new EmbedBuilder()
        .setTitle(t(locale, 'amigos.missing_title'))
        .setColor(embedColor)
        .setThumbnail("https://jeiden.s-ul.eu/3ssHl9Gd")
        .setTimestamp();

    if (missingFriends.length === 0) {
        missingEmbed.setDescription(t(locale, 'amigos.missing_empty'));
    } else {
        let desc = t(locale, 'amigos.missing_desc_header', { count: missingFriends.length });
        let addedCount = 0;
        for (let idx = 0; idx < missingFriends.length; idx++) {
            const user = missingFriends[idx];
            const line = t(locale, 'amigos.missing_line', {
                index: idx + 1,
                username: user.username,
                osuId: user.osu_id,
                discordId: user.discord_id
            });
            if (desc.length + line.length > 3900) {
                desc += t(locale, 'amigos.missing_more', { count: missingFriends.length - addedCount });
                break;
            }
            desc += line;
            addedCount++;
        }
        missingEmbed.setDescription(desc);
    }

    return missingEmbed;
}

/**
 * Renderiza una página de la lista de amigos en osu! (amigos.js)
 */
function doOsuFriendsListEmbed(message, friends, chunk, page, maxPages, startIndex, totalFriends) {
    const embedColor = getEmbedColor(message);
    const locale = message.locale || 'es';
    let desc = t(locale, 'amigos.list_header', { total: totalFriends });

    chunk.forEach((friend, idx) => {
        const globalIndex = startIndex + idx + 1;
        const flag = getFlagEmoji(friend.country_code);
        const SuppIcon = friend.is_supporter ? '💖' : '❌';
        const SengoIcon = friend.sengo ? '✅' : '❌';

        let mutualIcon = '❌';
        if (friend.mutual === 'yes') mutualIcon = '✅';
        else if (friend.mutual === 'unknown') mutualIcon = '❓';

        desc += `\`#${globalIndex.toString().padEnd(2, ' ')}\` ▸ ${flag} [**${friend.username}**](https://osu.ppy.sh/users/${friend.id}) ▸ Supporter: ${SuppIcon} ▸ Mutual: ${mutualIcon} ▸ Sengo: ${SengoIcon}\n`;
    });

    desc += t(locale, 'amigos.list_legend');

    return new EmbedBuilder()
        .setTitle(t(locale, 'amigos.list_title'))
        .setDescription(desc)
        .setColor(embedColor)
        .setThumbnail("https://jeiden.s-ul.eu/3ssHl9Gd")
        .setFooter({ text: t(locale, 'amigos.list_footer', { page, maxPages }), iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();
}

/**
 * Renderiza el embed para las estadísticas de creador/mapper (.mapper)
 */
function doOsuMapperEmbed(message, user, locale = 'es') {
    const embedColor = getEmbedColor(message);
    const flag = getFlagEmoji(user.country_code);
    const locTag = locale === 'es' ? 'es-ES' : 'en-US';
    
    // Kudosu y seguidores de mapeo
    const mappingFollowers = user.mapping_follower_count?.toLocaleString(locTag) || '0';
    const kudosuTotal = user.kudosu?.total?.toLocaleString(locTag) || '0';
    const kudosuAvailable = user.kudosu?.available?.toLocaleString(locTag) || '0';
    
    // Conteo de sets de beatmaps
    const rankedCount = user.ranked_and_approved_beatmapset_count?.toLocaleString(locTag) || '0';
    const lovedCount = user.loved_beatmapset_count?.toLocaleString(locTag) || '0';
    const pendingCount = user.pending_beatmapset_count?.toLocaleString(locTag) || '0';
    const graveyardCount = user.graveyard_beatmapset_count?.toLocaleString(locTag) || '0';
    const guestCount = user.guest_beatmapset_count?.toLocaleString(locTag) || '0';
    const nominatedCount = user.nominated_beatmapset_count?.toLocaleString(locTag) || '0';
    
    const isSupporter = user.is_supporter ? " 💖" : "";
    
    // Crear embed
    const embed = new EmbedBuilder()
        .setTitle(t(locale, 'mapper.embed_title', { flag, username: user.username, supporter: isSupporter }))
        .setURL(`https://osu.ppy.sh/users/${user.id}`)
        .setColor(embedColor)
        .setThumbnail(user.avatar_url)
        .addFields(
            { 
                name: t(locale, 'mapper.field_community'), 
                value: t(locale, 'mapper.field_community_val', { followers: mappingFollowers, kudosu: kudosuTotal, available: kudosuAvailable }), 
                inline: false 
            },
            { 
                name: t(locale, 'mapper.field_official_maps'), 
                value: t(locale, 'mapper.field_official_maps_val', { ranked: rankedCount, loved: lovedCount }), 
                inline: true 
            },
            { 
                name: t(locale, 'mapper.field_other_maps'), 
                value: t(locale, 'mapper.field_other_maps_val', { pending: pendingCount, graveyard: graveyardCount }), 
                inline: true 
            },
            { 
                name: t(locale, 'mapper.field_collabs'), 
                value: t(locale, 'mapper.field_collabs_val', { guest: guestCount, nominated: nominatedCount }), 
                inline: false 
            }
        )
        .setFooter({ text: t(locale, 'mapper.footer'), iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();
        
    if (user.cover_url || (user.cover && user.cover.url)) {
        embed.setImage(user.cover_url || user.cover.url);
    }
    
    return embed;
}

function buildMapperButtonsRow(user, activeType, currentPage = 1, totalPages = 1, locale = 'es') {
    const rankedCount = user.ranked_and_approved_beatmapset_count || 0;
    const lovedCount = user.loved_beatmapset_count || 0;
    const pendingCount = user.pending_beatmapset_count || 0;
    const graveyardCount = user.graveyard_beatmapset_count || 0;
    const guestCount = user.guest_beatmapset_count || 0;
    const totalCount = rankedCount + lovedCount + pendingCount + graveyardCount + guestCount;

    const hasPagination = ['ranked', 'loved', 'pending', 'graveyard', 'guest'].includes(activeType);

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("mapper_first")
            .setLabel("<<")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!hasPagination || currentPage <= 1),
        new ButtonBuilder()
            .setCustomId("mapper_prev")
            .setLabel("<")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!hasPagination || currentPage <= 1),
        new ButtonBuilder()
            .setCustomId("mapper_next")
            .setLabel(">")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!hasPagination || currentPage >= totalPages),
        new ButtonBuilder()
            .setCustomId("mapper_last")
            .setLabel(">>")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!hasPagination || currentPage >= totalPages)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("mapper_ranked")
            .setLabel(t(locale, 'mapper.btn_ranked'))
            .setEmoji("🟢")
            .setStyle(ButtonStyle.Success)
            .setDisabled(activeType === 'ranked' || rankedCount === 0),
        new ButtonBuilder()
            .setCustomId("mapper_loved")
            .setLabel(t(locale, 'mapper.btn_loved'))
            .setEmoji("🔮")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(activeType === 'loved' || lovedCount === 0),
        new ButtonBuilder()
            .setCustomId("mapper_graveyard")
            .setLabel(t(locale, 'mapper.btn_graveyard'))
            .setEmoji("🪦")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(activeType === 'graveyard' || graveyardCount === 0),
        new ButtonBuilder()
            .setCustomId("mapper_guest")
            .setLabel(t(locale, 'mapper.btn_guest'))
            .setEmoji("🤝")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(activeType === 'guest' || guestCount === 0),
        new ButtonBuilder()
            .setCustomId("mapper_all")
            .setLabel(t(locale, 'mapper.btn_all'))
            .setEmoji("🗺️")
            .setStyle(ButtonStyle.Success)
            .setDisabled(activeType === 'all' || totalCount === 0)
    );

    return [row1, row2];
}

function formatBeatmapset(set, index, type, userId, locale = 'es') {
    const diffs = set.beatmaps || [];
    let starsStr = "N/A";
    if (diffs.length > 0) {
        const ratings = diffs.map(b => b.difficulty_rating || 0);
        const minS = Math.min(...ratings).toFixed(2);
        const maxS = Math.max(...ratings).toFixed(2);
        starsStr = minS === maxS ? `${maxS}★` : `${minS}★ - ${maxS}★`;
    }

    const locTag = locale === 'es' ? 'es-ES' : 'en-US';
    const playcount = (set.play_count || 0).toLocaleString(locTag);
    const favorites = (set.favourite_count || 0).toLocaleString(locTag);
    const diffsCount = diffs.length;
    const diffsLabel = diffsCount === 1 ? t(locale, 'mapper.one_diff') : t(locale, 'mapper.diffs_count', { count: diffsCount });

    const submittedUnix = set.submitted_date ? Math.floor(new Date(set.submitted_date).getTime() / 1000) : null;
    const updatedUnix = set.last_updated ? Math.floor(new Date(set.last_updated).getTime() / 1000) : null;
    
    let targetBeatmapId = null;
    if (type === 'guest') {
        const guestDiffs = diffs.filter(b => b.user_id === userId);
        if (guestDiffs.length > 0) {
            const sortedGuest = [...guestDiffs].sort((a, b) => (b.difficulty_rating || 0) - (a.difficulty_rating || 0));
            if (sortedGuest[0] && sortedGuest[0].id) {
                targetBeatmapId = sortedGuest[0].id;
            }
        }
    }
    
    if (!targetBeatmapId && diffs.length > 0) {
        const sortedDiffs = [...diffs].sort((a, b) => (b.difficulty_rating || 0) - (a.difficulty_rating || 0));
        if (sortedDiffs[0] && sortedDiffs[0].id) {
            targetBeatmapId = sortedDiffs[0].id;
        }
    }

    const mapUrl = targetBeatmapId 
        ? `https://osu.ppy.sh/beatmaps/${targetBeatmapId}` 
        : `https://osu.ppy.sh/s/${set.id}`;

    let line = `**${index}.** [${set.artist} - ${set.title}](${mapUrl})`;
    if (type === 'guest') {
        const guestDiffs = diffs.filter(b => b.user_id === userId);
        if (guestDiffs.length > 0) {
            const diffsNames = guestDiffs.map(b => `\`${b.version}\` (⭐${(b.difficulty_rating || 0).toFixed(2)}★)`).join(", ");
            line += t(locale, 'mapper.host_gds', { creator: set.creator, userId: set.user_id, diffs: diffsNames });
        } else {
            line += t(locale, 'mapper.host_stars', { creator: set.creator, userId: set.user_id, stars: starsStr });
        }
        if (submittedUnix || updatedUnix) {
            const parts = [];
            if (submittedUnix) parts.push(t(locale, 'mapper.created', { unix: submittedUnix }));
            if (updatedUnix) parts.push(t(locale, 'mapper.updated', { unix: updatedUnix }));
            line += `\n   ↳ ${parts.join(" | ")}`;
        }
    } else {
        line += t(locale, 'mapper.plays_favs', { stars: starsStr, diffsLabel, plays: playcount, favs: favorites });
        if (submittedUnix || updatedUnix) {
            const parts = [];
            if (submittedUnix) parts.push(t(locale, 'mapper.created', { unix: submittedUnix }));
            if (updatedUnix) parts.push(t(locale, 'mapper.updated', { unix: updatedUnix }));
            line += `\n   ▸ ${parts.join(" | ")}`;
        }
    }
    return line;
}

function doOsuMapperListEmbed(message, user, type, data, page = 1, locale = 'es') {
    const embedColor = getEmbedColor(message);
    const flag = getFlagEmoji(user.country_code);
    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setThumbnail(user.avatar_url)
        .setFooter({ text: t(locale, 'mapper.footer'), iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();

    if (user.cover_url || (user.cover && user.cover.url)) {
        embed.setImage(user.cover_url || user.cover.url);
    }

    const titleType = {
        'ranked': t(locale, 'mapper.list_ranked'),
        'loved': t(locale, 'mapper.list_loved'),
        'pending': t(locale, 'mapper.list_pending'),
        'graveyard': t(locale, 'mapper.list_graveyard'),
        'guest': t(locale, 'mapper.list_guest'),
        'all': t(locale, 'mapper.list_all')
    }[type] || 'Maps';

    if (type === 'all') {
        embed.setTitle(`${titleType} de ${flag} ${user.username}`);
        let desc = t(locale, 'mapper.summary', { username: user.username });
        
        // Ranked
        const rankedList = data.ranked || [];
        const rankedCount = user.ranked_and_approved_beatmapset_count || 0;
        desc += `🟢 **${t(locale, 'mapper.btn_ranked')} (${rankedCount})**\n`;
        if (rankedList.length === 0) {
            desc += t(locale, 'mapper.none');
        } else {
            desc += rankedList.slice(0, 3).map((set, idx) => {
                const ratings = (set.beatmaps || []).map(b => b.difficulty_rating || 0);
                const maxS = ratings.length > 0 ? Math.max(...ratings).toFixed(2) : '0';
                return `• [${set.title}](https://osu.ppy.sh/s/${set.id}) (⭐${maxS}★)`;
            }).join("\n") + (rankedList.length > 3 ? t(locale, 'mapper.and_more', { count: rankedCount - 3 }) : "") + `\n\n`;
        }

        // Loved
        const lovedList = data.loved || [];
        const lovedCount = user.loved_beatmapset_count || 0;
        desc += `🔮 **${t(locale, 'mapper.btn_loved')} (${lovedCount})**\n`;
        if (lovedList.length === 0) {
            desc += t(locale, 'mapper.none');
        } else {
            desc += lovedList.slice(0, 3).map((set, idx) => {
                const ratings = (set.beatmaps || []).map(b => b.difficulty_rating || 0);
                const maxS = ratings.length > 0 ? Math.max(...ratings).toFixed(2) : '0';
                return `• [${set.title}](https://osu.ppy.sh/s/${set.id}) (⭐${maxS}★)`;
            }).join("\n") + (lovedList.length > 3 ? t(locale, 'mapper.and_more', { count: lovedCount - 3 }) : "") + `\n\n`;
        }

        // Pending
        const pendingList = data.pending || [];
        const pendingCount = user.pending_beatmapset_count || 0;
        desc += `⚫ **WIP (${pendingCount})**\n`;
        if (pendingList.length === 0) {
            desc += t(locale, 'mapper.none');
        } else {
            desc += pendingList.slice(0, 3).map((set, idx) => {
                const ratings = (set.beatmaps || []).map(b => b.difficulty_rating || 0);
                const maxS = ratings.length > 0 ? Math.max(...ratings).toFixed(2) : '0';
                return `• [${set.title}](https://osu.ppy.sh/s/${set.id}) (⭐${maxS}★)`;
            }).join("\n") + (pendingList.length > 3 ? t(locale, 'mapper.and_more', { count: pendingCount - 3 }) : "") + `\n\n`;
        }

        // Graveyard
        const graveyardList = data.graveyard || [];
        const graveyardCount = user.graveyard_beatmapset_count || 0;
        desc += `🪦 **${t(locale, 'mapper.btn_graveyard')} (${graveyardCount})**\n`;
        if (graveyardList.length === 0) {
            desc += t(locale, 'mapper.none');
        } else {
            desc += graveyardList.slice(0, 3).map((set, idx) => {
                const ratings = (set.beatmaps || []).map(b => b.difficulty_rating || 0);
                const maxS = ratings.length > 0 ? Math.max(...ratings).toFixed(2) : '0';
                return `• [${set.title}](https://osu.ppy.sh/s/${set.id}) (⭐${maxS}★)`;
            }).join("\n") + (graveyardList.length > 3 ? t(locale, 'mapper.and_more', { count: graveyardCount - 3 }) : "") + `\n\n`;
        }

        // Guest
        const guestList = data.guest || [];
        const guestCount = user.guest_beatmapset_count || 0;
        desc += `🤝 **GDs (${guestCount})**\n`;
        if (guestList.length === 0) {
            desc += t(locale, 'mapper.none');
        } else {
            desc += guestList.slice(0, 3).map((set, idx) => {
                const guestDiffs = (set.beatmaps || []).filter(b => b.user_id === user.id);
                const diffsNames = guestDiffs.map(b => `\`${b.version}\` (⭐${(b.difficulty_rating || 0).toFixed(2)}★)`).join(", ");
                return `• [${set.title}](https://osu.ppy.sh/s/${set.id}) - GDs: ${diffsNames}`;
            }).join("\n") + (guestList.length > 3 ? t(locale, 'mapper.and_more', { count: guestCount - 3 }) : "") + `\n\n`;
        }

        embed.setDescription(desc);
    } else {
        if (!data || data.length === 0) {
            embed.setTitle(`${titleType} de ${flag} ${user.username}`);
            embed.setDescription(t(locale, 'mapper.no_maps'));
        } else {
            const itemsPerPage = 5;
            const totalPages = Math.max(1, Math.ceil(data.length / itemsPerPage));
            const currentPage = Math.min(Math.max(1, page), totalPages);
            
            embed.setTitle(t(locale, 'mapper.list_title_page', { title: titleType, flag, username: user.username, current: currentPage, total: totalPages }));

            const pageData = data.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
            let desc = t(locale, 'mapper.showing_maps', {
                start: (currentPage - 1) * itemsPerPage + 1,
                end: Math.min(currentPage * itemsPerPage, data.length),
                total: data.length
            });
            desc += pageData.map((set, idx) => formatBeatmapset(set, (currentPage - 1) * itemsPerPage + idx + 1, type, user.id, locale)).join("\n\n");
            
            const totalCount = {
                'ranked': user.ranked_and_approved_beatmapset_count,
                'loved': user.loved_beatmapset_count,
                'pending': user.pending_beatmapset_count,
                'graveyard': user.graveyard_beatmapset_count,
                'guest': user.guest_beatmapset_count
            }[type] || data.length;

            if (totalCount > data.length) {
                desc += t(locale, 'mapper.note_limit', { limit: data.length });
            }
            embed.setDescription(desc);
        }
    }

    return embed;
}

function doOsuMapperTopEmbed(message, mappers, page, maxPages, sortBy, countryFilter, mode = 'sengo', playmodeFilter = null, locale = 'es') {
    const embedColor = getEmbedColor(message);
    const startIndex = (page - 1) * 10;
    const chunk = mappers.slice(startIndex, startIndex + 10);
    
    const sortLabels = {
        'ranked': t(locale, 'mapper.sort_ranked'),
        'loved': t(locale, 'mapper.sort_loved'),
        'wip': t(locale, 'mapper.sort_wip'),
        'graveyard': t(locale, 'mapper.sort_graveyard'),
        'gd': t(locale, 'mapper.sort_gd'),
        'followers': t(locale, 'mapper.sort_followers'),
        'kudosus': t(locale, 'mapper.sort_kudosus'),
        'recent': t(locale, 'mapper.sort_recent')
    };
    
    let totalLabel = t(locale, 'mapper.total_registered', { count: mappers.length });
    let title = t(locale, 'mapper.top_title');
    
    if (mode === 'server') {
        totalLabel = t(locale, 'mapper.total_server', { count: mappers.length });
        title = t(locale, 'mapper.top_title_server');
    } else if (mode === 'sengo') {
        totalLabel = t(locale, 'mapper.total_sengo', { count: mappers.length });
        title = t(locale, 'mapper.top_title_sengo');
    } else if (mode === 'national') {
        totalLabel = t(locale, 'mapper.total_national', { country: countryFilter, count: mappers.length });
        title = t(locale, 'mapper.top_title_national', { country: countryFilter });
    } else if (mode === 'global') {
        totalLabel = t(locale, 'mapper.total_global', { count: mappers.length });
        title = t(locale, 'mapper.top_title_global');
    }
    
    let description = totalLabel;
    if (countryFilter && mode !== 'national') {
        const flag = getFlagEmoji(countryFilter);
        description += t(locale, 'mapper.filtered_by_country', { flag, country: countryFilter });
    }
    if (playmodeFilter) {
        const modeLabels = {
            'osu': t(locale, 'mapper.mode_std'),
            'taiko': t(locale, 'mapper.mode_taiko'),
            'fruits': t(locale, 'mapper.mode_fruits'),
            'mania': t(locale, 'mapper.mode_mania'),
            'all': t(locale, 'mapper.mode_all')
        };
        description += t(locale, 'mapper.gamemode', { mode: modeLabels[playmodeFilter] || playmodeFilter });
    }
    description += t(locale, 'mapper.ordered_by', { sort: sortLabels[sortBy] || sortBy });
    
    if (mappers.length === 0) {
        description += t(locale, 'mapper.no_mappers');
    } else {
        chunk.forEach((mapper, idx) => {
            const globalIndex = startIndex + idx + 1;
            const flag = getFlagEmoji(mapper.country_code || 'XX');
            
            let highlightStat = '';
            if (sortBy === 'kudosus') {
                highlightStat = t(locale, 'mapper.stat_kudosu', { count: mapper.kudosu_total });
            } else if (sortBy === 'followers') {
                highlightStat = t(locale, 'mapper.stat_followers', { count: mapper.followers });
            } else if (sortBy === 'recent') {
                highlightStat = mapper.last_updated 
                    ? t(locale, 'mapper.stat_last_map', { unix: Math.floor(new Date(mapper.last_updated).getTime() / 1000) })
                    : t(locale, 'mapper.stat_never');
            }
            
            const usernameLink = `[**${mapper.username}**](https://osu.ppy.sh/users/${mapper.osu_id})`;
            description += `**#${globalIndex}** ▸ ${flag} ${usernameLink} ${highlightStat}\n`;
            
            // Fila de estadísticas
            description += t(locale, 'mapper.row_stats', {
                ranked: mapper.ranked_count,
                loved: mapper.loved_count,
                wip: mapper.pending_count,
                gds: mapper.guest_count,
                graveyard: mapper.graveyard_count,
                followers: mapper.followers,
                kudosu: mapper.kudosu_total
            });
            
            // Fila de actualización
            if (sortBy !== 'recent') {
                if (mapper.last_updated) {
                    const ts = Math.floor(new Date(mapper.last_updated).getTime() / 1000);
                    description += t(locale, 'mapper.row_last_map', { unix: ts });
                } else {
                    description += t(locale, 'mapper.row_last_never');
                }
            }
            description += `\n`;
        });
    }
    
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(embedColor)
        .setFooter({ text: t(locale, 'mapper.top_footer', { start: startIndex + 1, end: startIndex + chunk.length, total: mappers.length, current: page, max: maxPages }), iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();
        
    return embed;
}

module.exports = {
    doOsuOAuthEmbed,
    doOsuMissingFriendsEmbed,
    doOsuFriendsListEmbed,
    doOsuMapperEmbed,
    buildMapperButtonsRow,
    doOsuMapperListEmbed,
    doOsuMapperTopEmbed
};
