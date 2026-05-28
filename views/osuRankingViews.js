const { EmbedBuilder } = require("discord.js");
const country_codes = require("../src/country_codes.json");

/**
 * Genera el embed con la tabla del ranking nacional comprimido.
 */
function doOsuRankingEmbed({ chunk, total, startIndex, countryFilter, gamemodeName, targetGamemode }) {
    const countryInfo = country_codes[countryFilter];
    const countryName = countryInfo ? countryInfo.country : (chunk[0]?.user?.country?.name || countryFilter);
    const embedColor = countryInfo && countryInfo.color ? (countryInfo.color.startsWith('#') ? countryInfo.color : `#${countryInfo.color}`) : "#00ffcc";

    const lines = chunk.map((item) => {
        const flag = `:flag_${item.user.country_code.toLowerCase()}:`;
        const localRank = `**#${item.country_rank}**`;
        const globalRankStr = `(Global: \`#${item.global_rank.toLocaleString()}\`)`;
        const ppStr = `**${Math.round(item.pp).toLocaleString()} pp**`;
        const accStr = `\`${item.hit_accuracy.toFixed(2)}%\``;
        const playCountStr = `\`${item.play_count.toLocaleString()}\` pc`;

        return `${localRank} ${flag} [**${item.user.username}**](https://osu.ppy.sh/users/${item.user.id}) ${globalRankStr} - ${ppStr} | ${accStr} acc | ${playCountStr}`;
    });

    const currentPage = Math.floor(startIndex / 25) + 1;
    const maxPages = Math.ceil(total / 25);
    const fromRank = startIndex + 1;
    const toRank = startIndex + chunk.length;

    const embed = new EmbedBuilder()
        .setTitle(`Ranking Nacional (${gamemodeName}) - ${countryName}`)
        .setDescription(lines.join('\n'))
        .setColor(embedColor)
        .setThumbnail(`https://flagcdn.com/w160/${countryFilter.toLowerCase()}.png`)
        .setFooter({
            text: `Página ${currentPage} de ${maxPages} • Rango #${fromRank} - #${toRank} • Total: ${total.toLocaleString()} jugadores`
        });

    return embed;
}

module.exports = { doOsuRankingEmbed };
