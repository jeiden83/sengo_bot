const { EmbedBuilder } = require("discord.js");
const country_codes = require("../src/country_codes.json");

/**
 * Genera el embed con la tabla del ranking nacional comprimido.
 */
function doOsuRankingEmbed({ chunk, total, startIndex, countryFilter, gamemodeName, targetGamemode, isAccSort }) {
    const countryInfo = country_codes[countryFilter];
    const countryName = countryInfo ? countryInfo.country : (chunk[0]?.user?.country?.name || countryFilter);
    const embedColor = countryInfo && countryInfo.color ? (countryInfo.color.startsWith('#') ? countryInfo.color : `#${countryInfo.color}`) : "#00ffcc";

    const lines = chunk.map((item, index) => {
        const flag = `:flag_${item.user.country_code.toLowerCase()}:`;
        const displayRank = startIndex + index + 1;
        const localRank = `**#${displayRank}**`;
        const ppStr = `**${Math.round(item.pp).toLocaleString()} pp**`;
        const accStr = `\`${item.hit_accuracy.toFixed(2)}%\` acc`;

        const firstLine = `${localRank} ${flag} [**${item.user.username}**](https://osu.ppy.sh/users/${item.user.id}) - ${ppStr} | ${accStr}`;
        let secondLine;
        if (isAccSort) {
            secondLine = `  ↳ Rango: **#${item.country_rank}** Nacional • **#${item.global_rank.toLocaleString()}** Global`;
        } else {
            secondLine = `  ↳ Rango: **#${item.global_rank.toLocaleString()}** Global`;
        }
        return `${firstLine}\n${secondLine}`;
    });

    const currentPage = Math.floor(startIndex / 20) + 1;
    const maxPages = Math.ceil(total / 20);
    const fromRank = startIndex + 1;
    const toRank = startIndex + chunk.length;

    const titlePrefix = isAccSort ? "Ranking Nacional por Precisión (Acc)" : "Ranking Nacional";

    const embed = new EmbedBuilder()
        .setTitle(`${titlePrefix} (${gamemodeName}) - ${countryName}`)
        .setDescription(lines.join('\n'))
        .setColor(embedColor)
        .setThumbnail(`https://flagcdn.com/w160/${countryFilter.toLowerCase()}.png`)
        .setFooter({
            text: `Página ${currentPage} de ${maxPages} • Rango #${fromRank} - #${toRank} • Total: ${total.toLocaleString()} jugadores`
        });

    return embed;
}

module.exports = { doOsuRankingEmbed };
