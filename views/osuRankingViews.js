const { EmbedBuilder } = require("discord.js");
const country_codes = require("../src/country_codes.json");
const { getEmbedColor } = require("./osuViewHelpers.js");

/**
 * Genera el embed con la tabla del ranking nacional o regional comprimido.
 */
function doOsuRankingEmbed({ chunk, total, startIndex, countryFilter, gamemodeName, targetGamemode, isAccSort, isRegional, regionName }) {
    const countryInfo = country_codes[countryFilter];
    const countryName = countryInfo ? countryInfo.country : (chunk[0]?.user?.country?.name || countryFilter);
    const embedColor = countryInfo && countryInfo.color ? (countryInfo.color.startsWith('#') ? countryInfo.color : `#${countryInfo.color}`) : "#00ffcc";

    const lines = chunk.map((item, index) => {
        const flag = `:flag_${item.user.country_code.toLowerCase()}:`;
        const displayRank = startIndex + index + 1;
        const localRank = `**#${displayRank}**`;
        const ppStr = `**${Math.round(item.pp).toLocaleString()} pp**`;
        
        let accStr = "";
        if (item.hit_accuracy !== undefined && item.hit_accuracy !== null) {
            accStr = ` | \`${item.hit_accuracy.toFixed(2)}%\` acc`;
        }

        const firstLine = `${localRank} ${flag} [**${item.user.username}**](https://osu.ppy.sh/users/${item.user.id}) - ${ppStr}${accStr}`;
        let secondLine;
        if (isRegional) {
            secondLine = `  ↳ Rango: **#${item.global_rank.toLocaleString()}** Global`;
        } else if (isAccSort) {
            secondLine = `  ↳ Rango: **#${item.country_rank}** Nacional • **#${item.global_rank.toLocaleString()}** Global`;
        } else {
            secondLine = `  ↳ Rango: **#${item.global_rank.toLocaleString()}** Global`;
        }
        return `${firstLine}\n${secondLine}`;
    });

    const currentPage = Math.floor(startIndex / 10) + 1;
    const maxPages = Math.ceil(total / 10) || 1;
    const fromRank = startIndex + 1;
    const toRank = startIndex + chunk.length;

    let titlePrefix = "Ranking Nacional";
    if (isRegional) {
        titlePrefix = "Ranking Regional";
    } else if (isAccSort) {
        titlePrefix = "Ranking Nacional por Precisión (Acc)";
    }

    const locationStr = isRegional && regionName ? `${countryName} (${regionName})` : countryName;

    const embed = new EmbedBuilder()
        .setTitle(`${titlePrefix} (${gamemodeName}) - ${locationStr}`)
        .setDescription(lines.length > 0 ? lines.join('\n\n') : "*No hay jugadores registrados en esta región.*")
        .setColor(embedColor)
        .setThumbnail(`https://flagcdn.com/w160/${countryFilter.toLowerCase()}.png`)
        .setFooter({
            text: `Página ${currentPage} de ${maxPages} • Rango #${fromRank} - #${toRank} • Total: ${total.toLocaleString()} jugadores`
        });

    return embed;
}

/**
 * Genera el embed con el listado de regiones/subdivisiones de un país.
 */
function doSubdivisionsEmbed({ subdivisions, countryFilter, page, total }) {
    const embedColor = "#00ffcc";
    const pageSize = 20;
    const startIndex = (page - 1) * pageSize;
    const chunk = subdivisions.slice(startIndex, startIndex + pageSize);
    
    const lines = chunk.map((sub, index) => {
        const itemNumber = startIndex + index + 1;
        return `${itemNumber}. **${sub.name}** (\`${sub.code}\`) - *${sub.type}*`;
    });
    
    const maxPages = Math.ceil(subdivisions.length / pageSize) || 1;
    
    const embed = new EmbedBuilder()
        .setTitle(`Regiones Disponibles - :flag_${countryFilter.toLowerCase()}: ${countryFilter}`)
        .setDescription(`Para consultar el ranking de una región, usa:\n\`.regional [nombre o código]\`\n\n**Lista de regiones:**\n${lines.join('\n')}`)
        .setColor(embedColor)
        .setThumbnail(`https://flagcdn.com/w160/${countryFilter.toLowerCase()}.png`)
        .setFooter({
            text: `Página ${page} de ${maxPages} • Total: ${subdivisions.length} regiones`
        });
        
    return embed;
}

/**
 * Genera el embed con los detalles de Ranked Play de un único usuario.
 */
function doOsuRankedProfileEmbed(message, osuUser, matchmaking) {
    const embedColor = getEmbedColor(message);
    const winRate = matchmaking.plays > 0 ? ((matchmaking.first_placements / matchmaking.plays) * 100).toFixed(1) : "0.0";
    
    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Estadísticas de Ranked Play para ${osuUser.username}`,
            url: `https://osu.ppy.sh/users/${osuUser.id}`,
            iconURL: osuUser.avatar_url
        })
        .setThumbnail(osuUser.avatar_url)
        .setImage(osuUser.cover_url)
        .setColor(embedColor)
        .setDescription(`🏆 **Ranked Play (lazer)**
 ▸ **Temporada:** \`${matchmaking.pool?.name || 'N/A'}\`
 ▸ **Rango Global:** \`#${matchmaking.rank ? matchmaking.rank.toLocaleString('es-ES') : 'Sin clasificar'}\`
 ▸ **Rating (ELO):** \`${(matchmaking.rating || 0).toLocaleString('es-ES')}\` rating ${matchmaking.is_rating_provisional ? '*(Provisional)*' : ''}
 ▸ **Partidas Jugadas:** \`${matchmaking.plays || 0}\`
 ▸ **Victorias:** \`${matchmaking.first_placements || 0}\`
 ▸ **Tasa de Victoria:** \`${winRate}%\`
        `)
        .setFooter({ text: "Sengo", iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd" })
        .setTimestamp();

    return embed;
}

/**
 * Genera el embed con la tabla de clasificación de Ranked Play (Global o Servidor).
 */
function doOsuRankedLeaderboardEmbed({ chunk, total, startIndex, isServer, serverName, isWinsSort, sortType, message }) {
    const embedColor = getEmbedColor(message);
    const effectiveSortType = sortType || (isWinsSort ? 'wins' : 'rating');
    
    const lines = chunk.map((player, index) => {
        const flag = player.countryCode ? `:flag_${player.countryCode.toLowerCase()}:` : "🏳️";
        const displayRank = startIndex + index + 1;
        const localRank = `**#${displayRank}**`;
        const ratingStr = `**${player.rating.toLocaleString('es-ES')}** rating${player.isProvisional ? '*' : ''}`;
        const winRate = player.plays > 0 ? ((player.wins / player.plays) * 100).toFixed(1) : "0.0";
        const statsStr = `**${player.wins}** wins / **${player.plays}** plays (${winRate}% WR)`;
        
        let displayStr = "";
        if (effectiveSortType === 'wins' || effectiveSortType === 'winrate' || effectiveSortType === 'plays') {
            displayStr = `${statsStr} ▸ ${ratingStr}`;
        } else {
            displayStr = `${ratingStr} ▸ ${statsStr}`;
        }
        
        return `${localRank} ${flag} [**${player.username}**](https://osu.ppy.sh/users/${player.userId}) ▸ ${displayStr}`;
    });

    const titlePrefix = isServer ? `Tabla de Clasificación del Servidor (${serverName})` : "Tabla de Clasificación Global";
    
    let sortPrefix = "por Rating (ELO)";
    if (effectiveSortType === 'wins') {
        sortPrefix = "por Victorias";
    } else if (effectiveSortType === 'winrate') {
        sortPrefix = "por Win Rate";
    } else if (effectiveSortType === 'plays') {
        sortPrefix = "por Partidas Jugadas";
    }
    
    const currentPage = Math.floor(startIndex / 10) + 1;
    const maxPages = Math.ceil(total / 10) || 1;
    
    const embed = new EmbedBuilder()
        .setTitle(`${titlePrefix} - Ranked Play ${sortPrefix}`)
        .setDescription(lines.length > 0 ? lines.join('\n') : "*No hay jugadores en esta página.*")
        .setColor(embedColor)
        .setFooter({
            text: `Sengo • Página ${currentPage} de ${maxPages} • Mostrando #${startIndex + 1} - #${startIndex + chunk.length} de ${total.toLocaleString()}`,
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
