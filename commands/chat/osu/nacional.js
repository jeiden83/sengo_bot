const OsuUserModel = require("../../../models/OsuUserModel.js");
const { doOsuRankingEmbed, doSubdivisionsEmbed } = require("../../../views/osuRankingViews.js");
const { buildPaginationRow } = require("../../../views/osuViewHelpers.js");
const { argsParserNoCommand } = require("../../utils/argsParser.js");
const iso = require("iso-3166-2");

/**
 * Obtiene todas las subdivisiones disponibles para un país específico.
 */
function getCountrySubdivisions(countryCode) {
    try {
        const countryData = iso.country(countryCode.toUpperCase());
        if (!countryData || !countryData.sub) return [];
        return Object.entries(countryData.sub).map(([code, sub]) => ({
            code,
            name: sub.name,
            type: sub.type
        })).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
        return [];
    }
}

/**
 * Busca una subdivisión por nombre o código de manera insensible a mayúsculas y acentos.
 */
function findSubdivision(countryCode, searchStr) {
    const subdivisions = getCountrySubdivisions(countryCode);
    const clean = str => str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const query = clean(searchStr);
    
    // Primero: búsqueda exacta limpia
    let match = subdivisions.find(sub => clean(sub.name) === query || clean(sub.code) === query);
    if (match) return match;
    
    // Segundo: búsqueda parcial limpia
    match = subdivisions.find(sub => clean(sub.name).includes(query) || clean(sub.code).includes(query));
    return match;
}

/**
 * Obtiene los detalles de un usuario en osu!World.
 */
async function getOsuWorldUser(osuId) {
    const fetch = require('node-fetch');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
        const response = await fetch(`https://osuworld.octo.moe/api/users/${osuId}`, {
            signal: controller.signal
        });
        clearTimeout(timeout);
        if (!response.ok) return null;
        return await response.json();
    } catch {
        clearTimeout(timeout);
        return null;
    }
}

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

    // Determinar modo de juego con soporte completo
    let targetGamemode = parsed_args.gamemode;
    if (!targetGamemode) {
        try {
            const user_found = await OsuUserModel.getLinkedUser(messages.res?.User, message.author.id);
            if (user_found && user_found.main_gamemode) {
                targetGamemode = user_found.main_gamemode;
            }
        } catch (e) {
            console.error("Error al obtener main_gamemode del usuario para nacional:", e);
        }
        targetGamemode = targetGamemode || "osu";
    }

    if (targetGamemode === "std") {
        targetGamemode = "osu";
    } else if (targetGamemode === "ctb") {
        targetGamemode = "fruits";
    }

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

    let viewMode = 'national'; // 'national', 'regional', 'subdivisions'
    let selectedRegion = null;
    let selectedRegionName = null;
    let subdivisions = [];

    // Lógica regional
    if (parsed_args.regional) {
        const regionalArg = parsed_args.regional.trim().toLowerCase();
        if (regionalArg === 'lista' || regionalArg === 'list') {
            viewMode = 'subdivisions';
            subdivisions = getCountrySubdivisions(countryFilter);
            if (subdivisions.length === 0) {
                return `❌ No se encontraron subdivisiones/regiones para el país **${countryFilter}** en la base de datos ISO 3166-2.`;
            }
        } else if (regionalArg === 'self') {
            // Resolver región del usuario desde osu!World
            let osuId = null;
            try {
                const user_found = await OsuUserModel.getLinkedUser(messages.res?.User, message.author.id);
                if (user_found) {
                    osuId = user_found.osu_id;
                }
            } catch {}

            if (!osuId) {
                return `❌ No se encontró una cuenta de osu! vinculada a tu Discord.\nUsa \`s.link -oauth\` para vincularla primero.`;
            }

            const worldUser = await getOsuWorldUser(osuId);
            if (!worldUser || !worldUser.region_id) {
                return `❌ Tu cuenta de osu! no tiene una región configurada en osu!World.\nConfigúrala entrando a https://osuworld.octo.moe/ con tu cuenta de osu! y luego reintenta.`;
            }

            selectedRegion = worldUser.region_id;
            // Si el código de región no empieza con el país (ej: "VE-B" vs "B"), nos aseguramos
            countryFilter = worldUser.country_id ? worldUser.country_id.toUpperCase() : countryFilter;
            
            const subData = iso.subdivision(selectedRegion);
            selectedRegionName = (subData && subData.name) ? subData.name : selectedRegion;
            viewMode = 'regional';
        } else {
            // Buscar por nombre/código de región provisto
            const match = findSubdivision(countryFilter, parsed_args.regional);
            if (!match) {
                return `❌ No se encontró ninguna región que coincida con "${parsed_args.regional}" en **${countryFilter}**. Usa \`.regional lista\` para ver las opciones disponibles.`;
            }
            selectedRegion = match.code;
            selectedRegionName = match.name;
            viewMode = 'regional';
        }
    }

    const pageSize = viewMode === 'subdivisions' ? 20 : 10;
    let startIndex = (embedPage - 1) * pageSize;

    const isAccSort = !!parsed_args.accSort;
    let playersList = [];
    let total = 0;
    let progressMessage = null;

    if (viewMode === 'subdivisions') {
        total = subdivisions.length;
    } else if (viewMode === 'regional') {
        try {
            const currentData = await OsuUserModel.fetchRegionalRankingPage(countryFilter, selectedRegion, targetGamemode, embedPage);
            playersList = currentData.chunk;
            total = currentData.total;
        } catch (err) {
            console.error("Error al obtener ranking regional:", err);
            return `❌ Hubo un error al consultar el ranking regional de **${selectedRegionName}** en osu!World.`;
        }
    } else {
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
    }

    if (viewMode !== 'subdivisions' && (!playersList || playersList.length === 0)) {
        const noPlayersMsg = viewMode === 'regional'
            ? `❌ No se encontraron jugadores en el ranking regional de **${selectedRegionName}** (Modo: \`${gamemodeName}\`).`
            : `❌ No se encontraron jugadores en el ranking nacional de **${countryFilter}** (Modo: \`${gamemodeName}\`).`;
        if (progressMessage) {
            await progressMessage.edit(noPlayersMsg);
            return;
        }
        return noPlayersMsg;
    }

    let embed;
    if (viewMode === 'subdivisions') {
        embed = doSubdivisionsEmbed({
            subdivisions,
            countryFilter,
            page: embedPage,
            total
        });
    } else if (viewMode === 'regional') {
        embed = doOsuRankingEmbed({
            chunk: playersList,
            total,
            startIndex,
            countryFilter,
            gamemodeName,
            targetGamemode,
            isAccSort: false,
            isRegional: true,
            regionName: selectedRegionName
        });
    } else {
        const chunk = isAccSort ? playersList.slice(startIndex, startIndex + 10) : playersList;
        embed = doOsuRankingEmbed({
            chunk,
            total,
            startIndex,
            countryFilter,
            gamemodeName,
            targetGamemode,
            isAccSort
        });
    }

    const getButtonsRow = (start, totalPlays) => {
        return buildPaginationRow({ prefix: 'nacional', current: start, total: totalPlays, pageSize });
    };

    const hasButtons = total > pageSize;
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
                startIndex = Math.max(0, startIndex - pageSize);
            } else if (i.customId === 'nacional_next') {
                startIndex = startIndex + pageSize;
            } else if (i.customId === 'nacional_last') {
                startIndex = Math.floor((total - 1) / pageSize) * pageSize;
            }

            const currentPage = Math.floor(startIndex / pageSize) + 1;

            let currentEmbed;
            if (viewMode === 'subdivisions') {
                currentEmbed = doSubdivisionsEmbed({
                    subdivisions,
                    countryFilter,
                    page: currentPage,
                    total
                });
            } else if (viewMode === 'regional') {
                const currentData = await OsuUserModel.fetchRegionalRankingPage(countryFilter, selectedRegion, targetGamemode, currentPage);
                currentEmbed = doOsuRankingEmbed({
                    chunk: currentData.chunk,
                    total,
                    startIndex,
                    countryFilter,
                    gamemodeName,
                    targetGamemode,
                    isAccSort: false,
                    isRegional: true,
                    regionName: selectedRegionName
                });
            } else {
                let currentChunk;
                if (isAccSort) {
                    currentChunk = playersList.slice(startIndex, startIndex + 10);
                } else {
                    const currentData = await OsuUserModel.fetchRankingPage(countryFilter, targetGamemode, startIndex);
                    currentChunk = currentData.chunk;
                }

                currentEmbed = doOsuRankingEmbed({
                    chunk: currentChunk,
                    total,
                    startIndex,
                    countryFilter,
                    gamemodeName,
                    targetGamemode,
                    isAccSort
                });
            }

            await i.editReply({
                embeds: [currentEmbed],
                components: [getButtonsRow(startIndex, total)]
            });
        } catch (err) {
            console.error("Error al navegar:", err);
        }
    });

    collector.on('collect', async i => {
        // Nada más requerido
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
    'usage': 's.nacional -pais MX : Muestra el ranking nacional de México.\ns.nacional : Autodetecta tu país y muestra su ranking.\ns.nacional CL -p2 : Muestra la página 2 del ranking de Chile.\ns.nacional -taiko : Muestra el ranking nacional en modo Taiko.\ns.nacional -acc MX : Muestra el ranking de México ordenado por precisión (Acc).\ns.nacional -regional : Muestra el ranking regional para tu región.\ns.nacional -regional lista : Muestra las regiones/subdivisiones de tu país.\ns.nacional -regional Anzoategui : Muestra el ranking de la región Anzoátegui.'
}

module.exports = { run, description: run.description };
