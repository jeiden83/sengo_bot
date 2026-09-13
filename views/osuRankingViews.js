const { EmbedBuilder } = require("discord.js");
const country_codes = require("../src/country_codes.json");
const { getEmbedColor, formatMods, getGradeEmoji, getPlainStatsString, formatNumber, formatDecimal } = require("./osuViewHelpers.js");
const { t } = require("../utils/i18n.js");

/**
 * Genera el embed con la tabla del ranking nacional o regional comprimido.
 */
function doOsuRankingEmbed({ chunk, total, startIndex, countryFilter, gamemodeName, targetGamemode, isAccSort, isScoreSort, isTotalScoreSort, isRegional, regionName, message, isTopsSort }) {
    const locale = message.locale || 'es';
    const countryInfo = country_codes[countryFilter];
    const countryName = countryInfo ? countryInfo.country : (chunk[0]?.user?.country?.name || countryFilter);
    const embedColor = getEmbedColor(message);

    const lines = chunk.map((item, index) => {
        const flagCode = (item.user?.country_code || countryFilter).toLowerCase();
        const flag = `:flag_${flagCode}:`;
        const displayRank = startIndex + index + 1;
        const localRank = `**#${displayRank}**`;
        const userId = item.user_id || item.user?.id;
        const username = item.username || item.user?.username;
        
        let mainValueStr = "";
        let secondLine = "";
        const rankLabel = t(locale, 'nacional.rank_label');

        if (isTopsSort) {
            const topsCount = formatNumber(item.tops_count || 0, locale);
            const snipesCount = formatNumber(item.snipes_count || 0, locale);
            mainValueStr = `**${topsCount} ${t(locale, 'nacional.tops_label')}**`;
            secondLine = `  ↳ ${t(locale, 'nacional.snipes_label')}: **${snipesCount}**`;
        } else if (isScoreSort || isTotalScoreSort) {
            const scoreVal = isTotalScoreSort ? (item.total_score || 0) : (item.ranked_score || 0);
            const scoreSuffix = isTotalScoreSort ? (locale === 'es' ? 'score total' : 'total score') : 'score';
            const scoreStr = `**${formatNumber(scoreVal, locale)} ${scoreSuffix}**`;
            const ppStr = `${formatNumber(Math.round(item.pp), locale)} pp`;
            
            let accStr = "";
            if (item.hit_accuracy !== undefined && item.hit_accuracy !== null) {
                accStr = ` | \`${formatDecimal(item.hit_accuracy, locale, 2)}%\` acc`;
            }

            mainValueStr = `${scoreStr}${accStr}`;

            if (isRegional) {
                secondLine = `  ↳ pp: **${ppStr}** • ${rankLabel}: **#${formatNumber(item.global_rank, locale)}** ${t(locale, 'nacional.global_rank_label')}`;
            } else {
                const natRank = item.country_rank ? `**#${formatNumber(item.country_rank, locale)}** ${t(locale, 'nacional.national_rank_label')} • ` : "";
                secondLine = `  ↳ pp: **${ppStr}** • ${natRank}**#${formatNumber(item.global_rank, locale)}** ${t(locale, 'nacional.global_rank_label')}`;
            }
        } else {
            const ppStr = `**${formatNumber(Math.round(item.pp), locale)} pp**`;
            
            let accStr = "";
            if (item.hit_accuracy !== undefined && item.hit_accuracy !== null) {
                accStr = ` | \`${formatDecimal(item.hit_accuracy, locale, 2)}%\` acc`;
            }

            mainValueStr = `${ppStr}${accStr}`;

            if (isRegional) {
                secondLine = `  ↳ ${rankLabel}: **#${formatNumber(item.global_rank, locale)}** ${t(locale, 'nacional.global_rank_label')}`;
            } else if (isAccSort) {
                secondLine = `  ↳ ${rankLabel}: **#${formatNumber(item.country_rank, locale)}** ${t(locale, 'nacional.national_rank_label')} • **#${formatNumber(item.global_rank, locale)}** ${t(locale, 'nacional.global_rank_label')}`;
            } else {
                secondLine = `  ↳ ${rankLabel}: **#${formatNumber(item.global_rank, locale)}** ${t(locale, 'nacional.global_rank_label')}`;
            }
        }

        const firstLine = `${localRank} ${flag} [**${username}**](https://osu.ppy.sh/users/${userId}) - ${mainValueStr}`;
        return `${firstLine}\n${secondLine}`;
    });

    const currentPage = Math.floor(startIndex / 10) + 1;
    const maxPages = Math.ceil(total / 10) || 1;
    const fromRank = startIndex + 1;
    const toRank = startIndex + chunk.length;

    let titlePrefix = t(locale, 'nacional.embed_title_national');
    if (isTopsSort) {
        titlePrefix = t(locale, 'nacional.embed_title_tops');
    } else if (isRegional) {
        titlePrefix = t(locale, 'nacional.embed_title_regional');
        if (isScoreSort) {
            titlePrefix = `${t(locale, 'nacional.embed_title_regional')} ${locale === 'es' ? 'por Score' : 'by Score'}`;
        } else if (isTotalScoreSort) {
            titlePrefix = `${t(locale, 'nacional.embed_title_regional')} ${locale === 'es' ? 'por Score Total' : 'by Total Score'}`;
        }
    } else if (isAccSort) {
        titlePrefix = t(locale, 'nacional.embed_title_acc');
    } else if (isScoreSort) {
        titlePrefix = t(locale, 'nacional.embed_title_score');
    } else if (isTotalScoreSort) {
        titlePrefix = t(locale, 'nacional.embed_title_totalscore');
    }

    const locationStr = isRegional && regionName ? `${countryName} (${regionName})` : countryName;

    const embed = new EmbedBuilder()
        .setTitle(`${titlePrefix} (${gamemodeName}) - ${locationStr}`)
        .setDescription(lines.length > 0 ? lines.join('\n\n') : t(locale, 'nacional.no_players'))
        .setColor(embedColor)
        .setThumbnail(`https://flagcdn.com/w160/${countryFilter.toLowerCase()}.png`)
        .setFooter({
            text: t(locale, 'nacional.footer_page_info', {
                page: currentPage,
                pages: maxPages,
                from: fromRank,
                to: toRank,
                total: formatNumber(total, locale)
            })
        });

    return embed;
}

/**
 * Genera el embed con el listado de regiones/subdivisiones de un país.
 */
function doSubdivisionsEmbed({ subdivisions, countryFilter, page, total, message }) {
    const locale = message.locale || 'es';
    const embedColor = getEmbedColor(message);
    const pageSize = 20;
    const startIndex = (page - 1) * pageSize;
    const chunk = subdivisions.slice(startIndex, startIndex + pageSize);
    
    const lines = chunk.map((sub, index) => {
        const itemNumber = startIndex + index + 1;
        const subType = sub.type === 'State' ? t(locale, 'nacional.subdivision_type_state') : sub.type;
        return `${itemNumber}. **${sub.name}** (\`${sub.code}\`) - *${subType}*`;
    });
    
    const maxPages = Math.ceil(subdivisions.length / pageSize) || 1;
    const countryInfo = country_codes[countryFilter];
    const countryName = countryInfo ? countryInfo.country : countryFilter;
    
    const desc = t(locale, 'nacional.subdivisions_desc', {
        lines: lines.join('\n')
    });

    const embed = new EmbedBuilder()
        .setTitle(t(locale, 'nacional.subdivisions_title', { code: countryFilter.toLowerCase(), country: countryName }))
        .setDescription(desc)
        .setColor(embedColor)
        .setThumbnail(`https://flagcdn.com/w160/${countryFilter.toLowerCase()}.png`)
        .setFooter({
            text: t(locale, 'nacional.subdivisions_footer', {
                page,
                pages: maxPages,
                total: formatNumber(subdivisions.length, locale)
            })
        });
        
    return embed;
}

/**
 * Genera el embed con los detalles de Ranked Play de un único usuario.
 */
function doOsuRankedProfileEmbed(message, osuUser, matchmaking, locale = 'es') {
    const embedColor = getEmbedColor(message);
    const winRate = matchmaking.plays > 0 ? formatDecimal((matchmaking.first_placements / matchmaking.plays) * 100, locale, 1) : formatDecimal(0, locale, 1);
    const formattedRank = matchmaking.rank ? formatNumber(matchmaking.rank, locale) : t(locale, 'nacional.no_players'); // o similar
    const formattedRating = formatNumber(matchmaking.rating || 0, locale);
    const isProvisionalStr = matchmaking.is_rating_provisional ? ` *(${t(locale, 'ranked.profile_provisional')})*` : '';

    const descLines = [
        `🏆 **Ranked Play (lazer)**`,
        ` ▸ **${t(locale, 'ranked.profile_season')}:** \`${matchmaking.pool?.name || 'N/A'}\``,
        ` ▸ **${t(locale, 'ranked.profile_global_rank')}:** \`#${matchmaking.rank ? formattedRank : 'N/A'}\``,
        ` ▸ **${t(locale, 'ranked.profile_rating')}:** \`${formattedRating}\` rating${isProvisionalStr}`,
        ` ▸ **${t(locale, 'ranked.profile_played')}:** \`${formatNumber(matchmaking.plays || 0, locale)}\``,
        ` ▸ **${t(locale, 'ranked.profile_wins')}:** \`${formatNumber(matchmaking.first_placements || 0, locale)}\``,
        ` ▸ **${t(locale, 'ranked.profile_winrate')}:** \`${winRate}%\``
    ];
    
    const embed = new EmbedBuilder()
        .setAuthor({
            name: t(locale, 'ranked.profile_author', { username: osuUser.username }),
            url: `https://osu.ppy.sh/users/${osuUser.id}`,
            iconURL: osuUser.avatar_url
        })
        .setThumbnail(osuUser.avatar_url)
        .setImage(osuUser.cover_url)
        .setColor(embedColor)
        .setDescription(descLines.join('\n'))
        .setFooter({ text: "Sengo", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();

    return embed;
}

/**
 * Genera el embed con la tabla de clasificación de Ranked Play (Global o Servidor).
 */
function doOsuRankedLeaderboardEmbed({ chunk, total, startIndex, isServer, serverName, isWinsSort, sortType, message, locale }) {
    const activeLocale = locale || message.locale || 'es';
    const embedColor = getEmbedColor(message);
    const effectiveSortType = sortType || (isWinsSort ? 'wins' : 'rating');
    
    const lines = chunk.map((player, index) => {
        const flag = player.countryCode ? `:flag_${player.countryCode.toLowerCase()}:` : "🏳️";
        const displayRank = startIndex + index + 1;
        const localRank = `**#${displayRank}**`;
        const ratingStr = `**${formatNumber(player.rating, activeLocale)}** rating${player.isProvisional ? '*' : ''}`;
        const winRate = player.plays > 0 ? formatDecimal((player.wins / player.plays) * 100, activeLocale, 1) : formatDecimal(0, activeLocale, 1);
        
        let statsStr = "";
        if (activeLocale === 'es') {
            statsStr = `**${formatNumber(player.wins, activeLocale)}** victorias / **${formatNumber(player.plays, activeLocale)}** partidas (${winRate}% WR)`;
        } else {
            statsStr = `**${formatNumber(player.wins, activeLocale)}** wins / **${formatNumber(player.plays, activeLocale)}** matches (${winRate}% WR)`;
        }
        
        let displayStr = "";
        if (effectiveSortType === 'wins' || effectiveSortType === 'winrate' || effectiveSortType === 'plays') {
            displayStr = `${statsStr} ▸ ${ratingStr}`;
        } else {
            displayStr = `${ratingStr} ▸ ${statsStr}`;
        }
        
        return `${localRank} ${flag} [**${player.username}**](https://osu.ppy.sh/users/${player.userId}) ▸ ${displayStr}`;
    });

    const titlePrefix = isServer 
        ? t(activeLocale, 'ranked.leaderboard_title_server', { serverName }) 
        : t(activeLocale, 'ranked.leaderboard_title_global');
    
    let sortKey = "sort_rating";
    if (effectiveSortType === 'wins') {
        sortKey = "sort_wins";
    } else if (effectiveSortType === 'winrate') {
        sortKey = "sort_winrate";
    } else if (effectiveSortType === 'plays') {
        sortKey = "sort_plays";
    }
    const sortPrefix = t(activeLocale, `ranked.${sortKey}`);
    
    const currentPage = Math.floor(startIndex / 10) + 1;
    const maxPages = Math.ceil(total / 10) || 1;
    
    const embed = new EmbedBuilder()
        .setTitle(`${titlePrefix} - Ranked Play ${sortPrefix}`)
        .setDescription(lines.length > 0 ? lines.join('\n') : t(activeLocale, 'ranked.leaderboard_no_players'))
        .setColor(embedColor)
        .setFooter({
            text: t(activeLocale, 'ranked.leaderboard_footer', {
                page: currentPage,
                pages: maxPages,
                from: startIndex + 1,
                to: startIndex + chunk.length,
                total: formatNumber(total, activeLocale)
            }),
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();
        
    return embed;
}

/**
 * Genera el embed de lista con las mejores jugadas por PP a nivel nacional (s.nacional -pp).
 */
async function doOsuNationalPlaysListEmbed({ chunk, startIndex, total, countryFilter, gamemodeName, message, parsed_args, starsMap = {} }) {
    const locale = message.locale || 'es';
    const countryInfo = country_codes[countryFilter];
    const countryName = countryInfo ? countryInfo.country : countryFilter;
    const embedColor = getEmbedColor(message);

    let active_filters = [];
    if (parsed_args.modFilter !== null && parsed_args.modFilter !== undefined) active_filters.push(t(locale, 'top.filter_exact_mods_short', { val: parsed_args.modFilter }));
    if (parsed_args.modContainFilter !== null && parsed_args.modContainFilter !== undefined) active_filters.push(t(locale, 'top.filter_contain_mods_short', { val: parsed_args.modContainFilter }));
    if (parsed_args.searchFilter !== null && parsed_args.searchFilter !== undefined) active_filters.push(t(locale, 'top.filter_search_short', { val: parsed_args.searchFilter }));
    if (parsed_args.recentSort) active_filters.push(t(locale, 'top.filter_recent_sort_short'));
    if (parsed_args.comboSort) active_filters.push(t(locale, 'top.filter_combo_sort_short'));
    if (parsed_args.accSort) active_filters.push(t(locale, 'top.filter_acc_sort_short'));
    if (parsed_args.ppThreshold !== null && parsed_args.ppThreshold !== undefined) active_filters.push(`PP >= ${parsed_args.ppThreshold}`);
    if (parsed_args.srFilters && parsed_args.srFilters.length > 0) {
        const srTexts = parsed_args.srFilters.map(f => `SR${f.op}${f.valStr}`);
        active_filters.push(...srTexts);
    }

    let filterLine = active_filters.length > 0
        ? `🔍 *${t(locale, 'top.active_filters')}: ${active_filters.join(" | ")}*\n\n`
        : "";

    const lines = chunk.map((score, i) => {
        const globalIndex = score.originalRank || (startIndex + i + 1);
        const rankPrefix = `**#${globalIndex}**`;
        const userLink = `[**${score.user.username}**](https://osu.ppy.sh/users/${score.user.id})`;
        const mapLink = `[${score.beatmapset.title} [${score.beatmap.version}]](https://osu.ppy.sh/b/${score.beatmap.id})`;
        const isLazer = score.build_id !== null && score.build_id !== undefined;
        const modsUsed = formatMods(score.mods, isLazer);
        const gradeEmoji = getGradeEmoji(score.rank, score.passed);
        const ppStr = score.pp ? `${formatDecimal(score.pp, locale, 2)}pp` : `${formatDecimal(0, locale, 2)}pp`;
        const accStr = formatDecimal(score.accuracy * 100, locale, 2);
        const comboStr = score.max_combo !== null && score.max_combo !== undefined ? `x${score.max_combo}` : 'x?';
        const rulesetMap = { 0: 'osu', 1: 'taiko', 2: 'fruits', 3: 'mania' };
        const scoreMode = score.mode || (score.ruleset_id !== undefined ? rulesetMap[score.ruleset_id] : null) || score.beatmap?.mode || 'osu';
        const statsStr = `\`${getPlainStatsString(score.statistics, scoreMode)}\``;
        
        let starsVal = starsMap[score.beatmap.id] || score.beatmap.difficulty_rating || 0;
        const starsStr = starsVal ? `[${formatDecimal(starsVal, locale, 2)}★]` : "";
        const timeSet = `<t:${Math.floor((new Date(score.ended_at || score.created_at)).getTime() / 1000)}:R>`;

        return `${rankPrefix} ${userLink} ▸ ${mapLink} +${modsUsed} ${starsStr}\n` +
               ` ▸ ${gradeEmoji} ▸ **${ppStr}** ▸ **${accStr}%** ▸ ${comboStr} ▸ ${statsStr}\n` +
               ` ▸ ${timeSet}`;
    });

    const currentPage = Math.floor(startIndex / 5) + 1;
    const maxPages = Math.ceil(total / 5) || 1;
    const fromRank = startIndex + 1;
    const toRank = startIndex + chunk.length;

    const title = `${t(locale, 'nacional.embed_title_pp_plays')} (${gamemodeName}) - :flag_${countryFilter.toLowerCase()}: ${countryName}`;

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(filterLine + (lines.length > 0 ? lines.join('\n\n') : t(locale, 'nacional.err_no_pp_plays', { country: countryFilter })))
        .setColor(embedColor)
        .setThumbnail(`https://flagcdn.com/w160/${countryFilter.toLowerCase()}.png`)
        .setFooter({
            text: t(locale, 'nacional.footer_page_info_plays', {
                page: currentPage,
                pages: maxPages,
                from: fromRank,
                to: toRank,
                total: formatNumber(total, locale)
            }),
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd"
        })
        .setTimestamp();

    return embed;
}

module.exports = {
    doOsuRankingEmbed,
    doSubdivisionsEmbed,
    doOsuRankedProfileEmbed,
    doOsuRankedLeaderboardEmbed,
    doOsuNationalPlaysListEmbed
};
