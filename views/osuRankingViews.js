const { EmbedBuilder } = require("discord.js");
const country_codes = require("../src/country_codes.json");

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

module.exports = { doOsuRankingEmbed, doSubdivisionsEmbed };
