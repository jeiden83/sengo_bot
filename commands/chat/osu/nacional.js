const OsuUserModel = require("../../../models/OsuUserModel.js");
const { doOsuRankingEmbed } = require("../../../views/osuRankingViews.js");
const { buildPaginationRow } = require("../../../views/osuViewHelpers.js");
const { argsParserNoCommand } = require("../../utils/argsParser.js");

async function run(messages, args) {
    const { message } = messages;

    const parsed_args = argsParserNoCommand(args);
    let countryFilter = parsed_args.country;

    // Si no se usó el flag -pais, pero hay palabras no consumidas, tomamos la primera palabra de 2 caracteres como el país
    if (!countryFilter && parsed_args.username && parsed_args.username[0]) {
        const potential = parsed_args.username[0].trim().toUpperCase();
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

    let startIndex = (embedPage - 1) * 20;

    const isAccSort = !!parsed_args.accSort;
    let playersList = [];
    let total = 0;
    let progressMessage = null;

    if (isAccSort) {
        let lastUpdate = 0;
        const onProgress = async (current, totalVal) => {
            const now = Date.now();
            if (!progressMessage) {
                progressMessage = await message.channel.send(`⏳ Obteniendo top 1000 jugadores para ordenar por precisión (Acc)... **${current}/${totalVal}**`);
                lastUpdate = now;
            } else if (now - lastUpdate > 1500 || current === totalVal) {
                try {
                    await progressMessage.edit(`⏳ Obteniendo top 1000 jugadores para ordenar por precisión (Acc)... **${current}/${totalVal}**`);
                    lastUpdate = now;
                } catch {}
            }
        };

        try {
            playersList = await OsuUserModel.fetchRankingAcc(countryFilter, targetGamemode, onProgress);
            total = playersList.length;
        } catch (err) {
            console.error("Error al obtener ranking por Acc:", err);
            const errMsg = `❌ Hubo un error al consultar el ranking por Acc de **${countryFilter}** en la API de osu!.`;
            if (progressMessage) {
                await progressMessage.edit(errMsg);
                return;
            }
            return errMsg;
        }
    } else {
        let initialData;
        try {
            initialData = await OsuUserModel.fetchRankingPage(countryFilter, targetGamemode, startIndex);
            playersList = initialData.chunk;
            total = initialData.total;
        } catch (err) {
            console.error("Error al obtener ranking nacional:", err);
            return `❌ Hubo un error al consultar el ranking nacional de **${countryFilter}** en la API de osu!.`;
        }
    }

    if (!playersList || playersList.length === 0) {
        const noPlayersMsg = `❌ No se encontraron jugadores en el ranking nacional de **${countryFilter}** (Modo: \`${gamemodeName}\`).`;
        if (progressMessage) {
            await progressMessage.edit(noPlayersMsg);
            return;
        }
        return noPlayersMsg;
    }

    const chunk = isAccSort ? playersList.slice(startIndex, startIndex + 20) : playersList;

    const embed = doOsuRankingEmbed({
        chunk,
        total,
        startIndex,
        countryFilter,
        gamemodeName,
        targetGamemode,
        isAccSort
    });

    const getButtonsRow = (start, totalPlays) => {
        return buildPaginationRow({ prefix: 'nacional', current: start, total: totalPlays, pageSize: 20 });
    };

    const hasButtons = total > 20;
    const components = hasButtons ? [getButtonsRow(startIndex, total)] : [];

    let sent_message;
    if (progressMessage) {
        sent_message = await progressMessage.edit({
            content: null,
            embeds: [embed],
            components
        });
    } else {
        sent_message = await message.channel.send({
            embeds: [embed],
            components
        });
    }

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
                startIndex = Math.max(0, startIndex - 20);
            } else if (i.customId === 'nacional_next') {
                startIndex = startIndex + 20;
            } else if (i.customId === 'nacional_last') {
                startIndex = Math.floor((total - 1) / 20) * 20;
            }

            let currentChunk;
            if (isAccSort) {
                currentChunk = playersList.slice(startIndex, startIndex + 20);
            } else {
                const currentData = await OsuUserModel.fetchRankingPage(countryFilter, targetGamemode, startIndex);
                currentChunk = currentData.chunk;
            }

            const currentEmbed = doOsuRankingEmbed({
                chunk: currentChunk,
                total,
                startIndex,
                countryFilter,
                gamemodeName,
                targetGamemode,
                isAccSort
            });

            await i.editReply({
                embeds: [currentEmbed],
                components: [getButtonsRow(startIndex, total)]
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

run.description = {
    'header': 'Ranking nacional de rendimiento',
    'body': 'Muestra la tabla de clasificación por Performance Points (pp) para un país específico en osu!.',
    'usage': 's.nacional -pais MX : Muestra el ranking nacional de México.\ns.nacional : Autodetecta tu país y muestra su ranking.\ns.nacional CL -p2 : Muestra la página 2 del ranking de Chile.\ns.nacional -taiko : Muestra el ranking nacional en modo Taiko.\ns.nacional -acc MX : Muestra el ranking de México ordenado por precisión (Acc).'
}

module.exports = { run, description: run.description };
