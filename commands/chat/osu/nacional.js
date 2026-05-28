const { EmbedBuilder } = require("discord.js");
const axios = require("axios");
const OsuUserModel = require("../../../models/OsuUserModel.js");
const country_codes = require("../../../src/country_codes.json");
const { buildPaginationRow } = require("../../../views/osuViewHelpers.js");
const { argsParserNoCommand } = require("../../utils/argsParser.js");

async function run(messages, args) {
    const { message, res } = messages;

    const parsed_args = argsParserNoCommand(args);
    let countryFilter = parsed_args.country;

    // Si no se usó el flag -pais, pero hay palabras no consumidas, tomamos la primera palabra de 2 caracteres como el país
    if (!countryFilter && parsed_args.words && parsed_args.words.length > 0) {
        const potential = parsed_args.words[0].toUpperCase();
        if (potential.length === 2) {
            countryFilter = potential;
        }
    }

    // Resolver país si es "SELF" o si no se especificó nada
    if (!countryFilter || countryFilter === "SELF") {
        let dbCountry = null;
        try {
            const userToken = await OsuUserModel.getOAuthTokenRecord(message.author.id);
            if (userToken && userToken.country_code) {
                dbCountry = userToken.country_code.toUpperCase();
            }
        } catch (err) {
            console.error("Error al buscar país del usuario:", err);
        }
        countryFilter = dbCountry || "VE";
    }

    countryFilter = countryFilter.toUpperCase();

    // Determinar modo de juego
    const targetGamemode = parsed_args.gamemode || "osu";
    const gamemodeNames = {
        'osu': 'osu!standard',
        'taiko': 'osu!taiko',
        'fruits': 'osu!catch',
        'mania': 'osu!mania'
    };
    const gamemodeName = gamemodeNames[targetGamemode] || 'osu!standard';

    // Determinar página inicial (1-based)
    let embedPage = parsed_args.page || 1;
    if (embedPage < 1) embedPage = 1;

    let startIndex = (embedPage - 1) * 25;

    let initialData;
    try {
        initialData = await fetchRankingPage(countryFilter, targetGamemode, startIndex);
    } catch (err) {
        console.error("Error al obtener ranking nacional:", err);
        return `❌ Hubo un error al consultar el ranking nacional de **${countryFilter}** en la API de osu!.`;
    }

    const { chunk, total } = initialData;

    if (!chunk || chunk.length === 0) {
        return `❌ No se encontraron jugadores en el ranking nacional de **${countryFilter}** (Modo: \`${gamemodeName}\`).`;
    }

    const embed = buildRankingEmbed({
        chunk,
        total,
        startIndex,
        countryFilter,
        gamemodeName,
        targetGamemode
    });

    const getButtonsRow = (start, totalPlays) => {
        return buildPaginationRow({ prefix: 'nacional', current: start, total: totalPlays, pageSize: 25 });
    };

    const hasButtons = total > 25;
    const components = hasButtons ? [getButtonsRow(startIndex, total)] : [];

    const sent_message = await message.channel.send({
        embeds: [embed],
        components
    });

    if (!hasButtons) return;

    const btnFilter = btnInt => btnInt.user.id === message.author.id;
    const collector = sent_message.createMessageComponentCollector({
        filter: btnFilter,
        idle: 45000
    });

    collector.on('collect', async i => {
        try {
            await i.deferUpdate();

            if (i.customId === 'nacional_first') {
                startIndex = 0;
            } else if (i.customId === 'nacional_prev') {
                startIndex = Math.max(0, startIndex - 25);
            } else if (i.customId === 'nacional_next') {
                startIndex = startIndex + 25;
            } else if (i.customId === 'nacional_last') {
                startIndex = Math.floor((total - 1) / 25) * 25;
            }

            const currentData = await fetchRankingPage(countryFilter, targetGamemode, startIndex);
            const currentEmbed = buildRankingEmbed({
                chunk: currentData.chunk,
                total: currentData.total,
                startIndex,
                countryFilter,
                gamemodeName,
                targetGamemode
            });

            await i.editReply({
                embeds: [currentEmbed],
                components: [getButtonsRow(startIndex, currentData.total)]
            });
        } catch (err) {
            console.error("Error al navegar el ranking nacional:", err);
        }
    });

    collector.on('end', async () => {
        try {
            await sent_message.edit({ components: [] });
        } catch {}
    });
}

function buildRankingEmbed({ chunk, total, startIndex, countryFilter, gamemodeName, targetGamemode }) {
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

async function fetchRankingPage(countryFilter, gamemode, startIndex) {
    const embedPageSize = 25;
    const apiPageSize = 50;

    const apiPage1 = Math.floor(startIndex / apiPageSize) + 1;
    const apiPage2 = Math.floor((startIndex + embedPageSize - 1) / apiPageSize) + 1;

    const tokenData = await OsuUserModel.loadToken();
    const accessToken = tokenData.access_token;

    const fetchPage = async (page) => {
        const url = `https://osu.ppy.sh/api/v2/rankings/${gamemode}/performance?country=${countryFilter}&page=${page}`;
        const res = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'x-api-version': '20240728'
            }
        });
        return res.data;
    };

    let rankings = [];
    let total = 0;

    const data1 = await fetchPage(apiPage1);
    rankings = data1.ranking || [];
    total = Math.min(data1.total || 0, 10000);

    if (apiPage1 !== apiPage2) {
        try {
            const data2 = await fetchPage(apiPage2);
            rankings = rankings.concat(data2.ranking || []);
        } catch (e) {
            console.error("Error al obtener la segunda página de ranking:", e);
        }
    }

    const offset = startIndex % apiPageSize;
    const chunk = rankings.slice(offset, offset + embedPageSize);

    return { chunk, total };
}

run.description = {
    'header': 'Ranking nacional de rendimiento',
    'body': 'Muestra la tabla de clasificación por Performance Points (pp) para un país específico en osu!.',
    'usage': 's.nacional -pais MX : Muestra el ranking nacional de México.\ns.nacional : Autodetecta tu país y muestra su ranking.\ns.nacional CL -p2 : Muestra la página 2 del ranking de Chile.\ns.nacional -taiko : Muestra el ranking nacional en modo Taiko.'
}

module.exports = { run, description: run.description };
