const { EmbedBuilder } = require("discord.js");
const country_codes = require("../src/country_codes.json");
const { getEmbedColor } = require("./osuViewHelpers.js");
const { t } = require("../utils/i18n.js");

/**
 * Genera el embed con la tabla del ranking nacional o regional comprimido.
 */
function doOsuRankingEmbed({ chunk, total, startIndex, countryFilter, gamemodeName, targetGamemode, isAccSort, isRegional, regionName, message }) {
    const locale = message.locale || 'es';
    const countryInfo = country_codes[countryFilter];
    const countryName = countryInfo ? countryInfo.country : (chunk[0]?.user?.country?.name || countryFilter);
    const embedColor = getEmbedColor(message);

    const lines = chunk.map((item, index) => {
        const flag = `:flag_${item.user.country_code.toLowerCase()}:`;
        const displayRank = startIndex + index + 1;
        const localRank = `**#${displayRank}**`;
        const ppStr = `**${Math.round(item.pp).toLocaleString(locale === 'es' ? 'es-ES' : 'en-US')} pp**`;
        
        let accStr = "";
        if (item.hit_accuracy !== undefined && item.hit_accuracy !== null) {
            accStr = ` | \`${item.hit_accuracy.toFixed(2)}%\` acc`;
        }

        const rankLabel = t(locale, 'nacional.rank_label');
        const firstLine = `${localRank} ${flag} [**${item.user.username}**](https://osu.ppy.sh/users/${item.user.id}) - ${ppStr}${accStr}`;
        let secondLine;
        if (isRegional) {
            secondLine = `  ↳ ${rankLabel}: **#${item.global_rank.toLocaleString(locale === 'es' ? 'es-ES' : 'en-US')}** ${t(locale, 'nacional.global_rank_label')}`;
        } else if (isAccSort) {
            secondLine = `  ↳ ${rankLabel}: **#${item.country_rank}** ${t(locale, 'nacional.national_rank_label')} • **#${item.global_rank.toLocaleString(locale === 'es' ? 'es-ES' : 'en-US')}** ${t(locale, 'nacional.global_rank_label')}`;
        } else {
            secondLine = `  ↳ ${rankLabel}: **#${item.global_rank.toLocaleString(locale === 'es' ? 'es-ES' : 'en-US')}** ${t(locale, 'nacional.global_rank_label')}`;
        }
        return `${firstLine}\n${secondLine}`;
    });

    const currentPage = Math.floor(startIndex / 10) + 1;
    const maxPages = Math.ceil(total / 10) || 1;
    const fromRank = startIndex + 1;
    const toRank = startIndex + chunk.length;

    let titlePrefix = t(locale, 'nacional.embed_title_national');
    if (isRegional) {
        titlePrefix = t(locale, 'nacional.embed_title_regional');
    } else if (isAccSort) {
        titlePrefix = t(locale, 'nacional.embed_title_acc');
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
                total: total.toLocaleString(locale === 'es' ? 'es-ES' : 'en-US')
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
                total: subdivisions.length
            })
        });
        
    return embed;
}

/**
 * Genera el embed con los detalles de Ranked Play de un único usuario.
 */
function doOsuRankedProfileEmbed(message, osuUser, matchmaking, locale = 'es') {
    const embedColor = getEmbedColor(message);
    const winRate = matchmaking.plays > 0 ? ((matchmaking.first_placements / matchmaking.plays) * 100).toFixed(1) : "0.0";
    const formattedRank = matchmaking.rank ? matchmaking.rank.toLocaleString(locale === 'es' ? 'es-ES' : 'en-US') : t(locale, 'nacional.no_players'); // o similar
    const formattedRating = (matchmaking.rating || 0).toLocaleString(locale === 'es' ? 'es-ES' : 'en-US');
    const isProvisionalStr = matchmaking.is_rating_provisional ? ` *(${t(locale, 'ranked.profile_provisional')})*` : '';

    const descLines = [
        `🏆 **Ranked Play (lazer)**`,
        ` ▸ **${t(locale, 'ranked.profile_season')}:** \`${matchmaking.pool?.name || 'N/A'}\``,
        ` ▸ **${t(locale, 'ranked.profile_global_rank')}:** \`#${matchmaking.rank ? formattedRank : 'N/A'}\``,
        ` ▸ **${t(locale, 'ranked.profile_rating')}:** \`${formattedRating}\` rating${isProvisionalStr}`,
        ` ▸ **${t(locale, 'ranked.profile_played')}:** \`${matchmaking.plays || 0}\``,
        ` ▸ **${t(locale, 'ranked.profile_wins')}:** \`${matchmaking.first_placements || 0}\``,
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
    const numLocale = activeLocale === 'es' ? 'es-ES' : 'en-US';
    
    const lines = chunk.map((player, index) => {
        const flag = player.countryCode ? `:flag_${player.countryCode.toLowerCase()}:` : "🏳️";
        const displayRank = startIndex + index + 1;
        const localRank = `**#${displayRank}**`;
        const ratingStr = `**${player.rating.toLocaleString(numLocale)}** rating${player.isProvisional ? '*' : ''}`;
        const winRate = player.plays > 0 ? ((player.wins / player.plays) * 100).toFixed(1) : "0.0";
        
        let statsStr = "";
        if (activeLocale === 'es') {
            statsStr = `**${player.wins}** victorias / **${player.plays}** partidas (${winRate}% WR)`;
        } else {
            statsStr = `**${player.wins}** wins / **${player.plays}** matches (${winRate}% WR)`;
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
                total: total.toLocaleString(numLocale)
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
    doOsuRankedLeaderboardEmbed
};
