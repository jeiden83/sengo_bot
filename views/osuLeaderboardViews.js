const { EmbedBuilder } = require("discord.js");
const {
    getEmbedColor,
    getFormattedScore,
    getGradeEmoji,
    formatMods,
    getPlainStatsString,
    getFlagEmoji
} = require("./osuViewHelpers.js");
const { t } = require("../utils/i18n.js");

/**
 * Renderiza el embed para el comando gap (usuarios vinculados en el beatmap)
 */
function doOsuGapEmbed(message, user_scores, beatmap_metadata, startIndex = 0, total_plays = 0, locale = "es") {
    let embed_description = '';
    let position = startIndex + 1;

    user_scores.forEach(score => {
        const flag = getFlagEmoji((score.user && score.user.country_code) ? score.user.country_code : "XX");
        const username = score.user ? score.user.username : score.username;
        const username_link = `[${username}](https://osu.ppy.sh/users/${score.user_id})`;

        const isLazer = score.build_id !== null && score.build_id !== undefined;
        const mods_used = formatMods(score.mods, isLazer);

        const total_score = getFormattedScore(score);
        let accuracy = (score.accuracy * 100).toFixed(2);
    
        const max_combo = score.max_combo;
        const beatmap_max_combo = beatmap_metadata.max_combo;
 
        const statistics = `\`${getPlainStatsString(score.statistics, beatmap_metadata.mode)}\``;
        let ratio_str = "";
        if (beatmap_metadata.mode === 'mania') {
            const stats = score.statistics || {};
            const perfect = stats.perfect !== undefined ? stats.perfect : (stats.count_geki || 0);
            const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
            const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
            ratio_str = ` - ${ratio}:1`;
        }
        accuracy = `${accuracy}%${ratio_str}`;
    
        const pp = `${score.pp ? score.pp.toFixed(2) : 0}`;
        const time_set = `<t:${Math.floor((new Date(score.ended_at || score.created_at)).getTime() / 1000)}:R>`;
    
        let grade_emoji = getGradeEmoji(score.rank, score.passed);
        if (!score.passed && score.map_completion !== undefined) {
            grade_emoji += ` (${(score.map_completion * 100).toFixed(2)}%)`;
        }
 
        const isFirstGlobal = position === 1;
        embed_description = embed_description.concat(isFirstGlobal ?
            `#**${position++}** - ${flag} **${username_link}** - ${time_set} - ${grade_emoji}
            **${total_score}** - **${accuracy}** - **x${max_combo}/${beatmap_max_combo}** - ${statistics} - **${pp}PP** - ${mods_used}\n\n`
            :
            `#${position++} - ${flag} ${username_link} - ${time_set} - ${grade_emoji}
            ${total_score} - ${accuracy} - x${max_combo}/${beatmap_max_combo} - ${statistics} - ${pp}PP - ${mods_used}\n\n`
        );
    });
    
    const embedColor = getEmbedColor(message);

    const embed = new EmbedBuilder()
        .setDescription(embed_description)
        .setColor(embedColor)
        .setFooter({
            text: t(locale, 'gap.embed_footer', { start: startIndex + 1, end: startIndex + user_scores.length, total: total_plays }),
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

/**
 * Genera el string de contenido de encabezado para el comando gap
 */
function doOsuGapContent(beatmap_metadata, user_scores, sorted_user_scores, page = 1, max_pages = 1, locale = "es") {
    const { title } = beatmap_metadata.beatmapset;
    const { difficulty_rating, version, url} = beatmap_metadata;

    const mapa = `[${title} [${version}] - ${difficulty_rating + '★'} ](${url})`;
    let content = t(locale, 'gap.content_title', { totalUsers: user_scores.length, scoreUsers: sorted_user_scores.length, mapa });

    if (sorted_user_scores.length > 5) {
        content = content.concat(t(locale, 'gap.content_page', { page, max_pages }));
    }

    return content;
}

/**
 * Renderiza el embed para el comando lb (tabla de clasificación de beatmap)
 */
function doOsuLbEmbed(message, scores_chunk, beatmap_metadata, startIndex = 0, total_plays = 0, page = 1, max_pages = 1, parsed_args = {}, usedSupporter = null, locale = "es") {
    let embed_description = '';

    const isFiltered = (parsed_args.modFilter !== null && parsed_args.modFilter !== undefined) || 
                       (parsed_args.modContainFilter !== null && parsed_args.modContainFilter !== undefined) ||
                       (parsed_args.friendsFilter !== null && parsed_args.friendsFilter !== undefined) ||
                       (parsed_args.country !== null && parsed_args.country !== undefined) ||
                       (usedSupporter && usedSupporter.fallback === false);

    scores_chunk.forEach((score, i) => {
        const globalIndex = startIndex + i + 1;
        const flag = getFlagEmoji(score.user ? score.user.country_code : "");
        const username = score.user ? score.user.username : 'Usuario';
        const userId = score.user ? score.user.id : score.user_id;
        const userUrl = `https://osu.ppy.sh/users/${userId}`;
        const userLink = `[${username}](${userUrl})`;

        const isLazer = score.build_id !== null && score.build_id !== undefined;
        const mods_used = formatMods(score.mods, isLazer);

        const isLazerMode = parsed_args.lazerMode || parsed_args.isLazerMode;
        const legacy_score = isLazerMode 
            ? (score.total_score || score.score || 0).toLocaleString('es-ES')
            : getFormattedScore(score);
        const accuracy = (score.accuracy * 100).toFixed(2);
        const max_combo = score.max_combo;
        const beatmap_max_combo = beatmap_metadata.max_combo;

        const stats_str = getPlainStatsString(score.statistics, beatmap_metadata.mode);
        let ratio_str = "";
        if (beatmap_metadata.mode === 'mania') {
            const stats = score.statistics || {};
            const perfect = stats.perfect !== undefined ? stats.perfect : (stats.count_geki || 0);
            const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
            const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
            ratio_str = ` ▸ **${ratio}:1**`;
        }

        const pp = score.pp ? score.pp.toFixed(2) : "0.00";
        const time_set = `<t:${Math.floor((new Date(score.ended_at || score.created_at)).getTime() / 1000)}:R>`;

        let grade_emoji = getGradeEmoji(score.rank, score.passed);

        const isFirst = globalIndex === 1;
        const rank_pos = isFirst ? `**#${globalIndex}**` : `#${globalIndex}`;
        const global_rank = isFiltered ? ` (🌐 #${score.leaderboardRank})` : "";

        const formatted_score = isFirst ? `**${legacy_score}**` : `${legacy_score}`;
        const formatted_accuracy = isFirst ? `**${accuracy}%**` : `${accuracy}%`;
        const formatted_pp = isFirst ? `__**${pp}pp**__` : `__${pp}pp__`;
        const formatted_combo = isFirst ? `**x${max_combo}**` : `x${max_combo}`;

        const score_line = `${rank_pos}${global_rank} ▸ ${flag} ${userLink} ▸ ${formatted_score} ▸ ${formatted_accuracy}${ratio_str} ▸ ${formatted_pp} ▸ ${formatted_combo}/${beatmap_max_combo} ▸ +${mods_used}\n ▸ ${time_set} ▸ ${stats_str}\n\n`;

        embed_description = embed_description.concat(score_line);
    });

    const embedColor = getEmbedColor(message);

    const beatmap_cover = beatmap_metadata.beatmapset.covers["list@2x"] || beatmap_metadata.beatmapset.covers.cover;

    let footerText = t(locale, 'leaderboard.embed_footer', {
        start: startIndex + 1,
        end: startIndex + scores_chunk.length,
        total: total_plays,
        page,
        max_pages
    });
    if (usedSupporter) {
        const fallbackText = usedSupporter.fallback ? t(locale, 'leaderboard.pool_fallback') : '';
        footerText += t(locale, 'leaderboard.embed_footer_pool', {
            username: usedSupporter.username,
            fallbackText
        });
    }

    const embed = new EmbedBuilder()
        .setDescription(embed_description)
        .setColor(embedColor)
        .setThumbnail(beatmap_cover)
        .setFooter({
            text: footerText,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

/**
 * Genera el string de contenido de encabezado para el comando lb
 */
function doOsuLbContent(beatmap_metadata, targetGamemode, countryCode = null, friendsUsername = null, isLazerMode = false, locale = "es") {
    const { title } = beatmap_metadata.beatmapset;
    const { difficulty_rating, version, url } = beatmap_metadata;
    const displayMode = targetGamemode === 'osu' ? 'std' : (targetGamemode === 'fruits' ? 'ctb' : targetGamemode);
    const suffix = isLazerMode ? " (lazer)" : " (stable)";

    const mapa = `[${title} [${version}] - ${difficulty_rating + '★'} ](${url})`;
    let titleText = "";
    if (countryCode) {
        titleText = t(locale, 'leaderboard.content_country', {
            country: countryCode.toUpperCase(),
            suffix,
            mode: displayMode
        });
    } else if (friendsUsername) {
        titleText = t(locale, 'leaderboard.content_friends', {
            username: friendsUsername,
            suffix,
            mode: displayMode
        });
    } else {
        titleText = t(locale, 'leaderboard.content_standard', {
            suffix,
            mode: displayMode
        });
    }
    return `${titleText}\n${mapa}`;
}

module.exports = {
    doOsuGapEmbed,
    doOsuGapContent,
    doOsuLbEmbed,
    doOsuLbContent
};
