const OsuUserModel = require("../../../models/OsuUserModel.js");
const { doOsuRankingEmbed, doSubdivisionsEmbed } = require("../../../views/osuRankingViews.js");
const { buildPaginationRow } = require("../../../views/osuViewHelpers.js");
const { argsParserNoCommand } = require("../../utils/argsParser.js");
const regionsData = require("../../../src/regions.json");
const { t } = require("../../../utils/i18n.js");

/**
 * Obtiene todas las subdivisiones disponibles para un país específico.
 */
function getCountrySubdivisions(countryCode) {
    try {
        const countrySub = regionsData[countryCode.toUpperCase()];
        if (!countrySub) return [];
        return Object.entries(countrySub).map(([code, name]) => ({
            code,
            name,
            type: "State"
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
async function run(messages, args) {
    const { message } = messages;
    const locale = message.locale || 'es';

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
                return t(locale, 'nacional.err_no_subdivisions', { country: countryFilter });
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
                return t(locale, 'nacional.err_not_linked');
            }

            const worldUser = await OsuUserModel.getOsuWorldUser(osuId);
            if (!worldUser || !worldUser.region_id) {
                return t(locale, 'nacional.err_no_osuworld_region');
            }

            selectedRegion = worldUser.region_id;
            // Si el código de región no empieza con el país (ej: "VE-B" vs "B"), nos aseguramos
            countryFilter = worldUser.country_id ? worldUser.country_id.toUpperCase() : countryFilter;
            
            const countryCode = selectedRegion.split("-")[0];
            const countrySub = regionsData[countryCode];
            selectedRegionName = (countrySub && countrySub[selectedRegion]) ? countrySub[selectedRegion] : selectedRegion;
            viewMode = 'regional';
        } else {
            // Buscar por nombre/código de región provisto
            const match = findSubdivision(countryFilter, parsed_args.regional);
            if (!match) {
                return t(locale, 'nacional.err_region_not_found', { query: parsed_args.regional, country: countryFilter });
            }
            selectedRegion = match.code;
            selectedRegionName = match.name;
            viewMode = 'regional';
        }
    }

    const pageSize = viewMode === 'subdivisions' ? 20 : 10;
    let startIndex = (embedPage - 1) * pageSize;

    const isAccSort = !!parsed_args.accSort;
    const isScoreSort = !!parsed_args.scoreSort;
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

            if (isScoreSort && playersList.length > 0) {
                playersList = await Promise.all(
                    playersList.map(async (p) => {
                        try {
                            const profile = await OsuUserModel.getOsuUser({
                                username: [p.user.id.toString()],
                                gamemode: targetGamemode,
                                server: 'bancho'
                            });
                            if (profile && typeof profile === 'object' && profile.statistics) {
                                return {
                                    ...p,
                                    ranked_score: profile.statistics.ranked_score || 0,
                                    pp: profile.statistics.pp || p.pp
                                };
                            }
                        } catch (e) {
                            console.error(`Error al obtener perfil de ${p.user.id}:`, e);
                        }
                        return { ...p, ranked_score: 0 };
                    })
                );
                playersList.sort((a, b) => b.ranked_score - a.ranked_score);
            }
        } catch (err) {
            console.error("Error al obtener ranking regional:", err);
            return t(locale, 'nacional.err_fetch_regional', { region: selectedRegionName });
        }
    } else {
        if (isAccSort) {
            let lastUpdate = 0;
            const onProgress = async (current, totalVal) => {
                const now = Date.now();
                if (!progressMessage) {
                    progressMessage = await message.channel.send(t(locale, 'nacional.fetching_acc', { current, total: totalVal }));
                    lastUpdate = now;
                } else if (now - lastUpdate > 1500 || current === totalVal) {
                    try {
                        await progressMessage.edit(t(locale, 'nacional.fetching_acc', { current, total: totalVal }));
                        lastUpdate = now;
                    } catch {}
                }
            };

            try {
                playersList = await OsuUserModel.fetchRankingAcc(countryFilter, targetGamemode, onProgress);
                total = playersList.length;
            } catch (err) {
                console.error("Error al obtener ranking por Acc:", err);
                const errMsg = t(locale, 'nacional.err_fetch_acc', { country: countryFilter });
                if (progressMessage) {
                    await progressMessage.edit(errMsg);
                    return;
                }
                return errMsg;
            }
        } else if (isScoreSort) {
            let lastUpdate = 0;
            const onProgress = async (current, totalVal) => {
                const now = Date.now();
                if (!progressMessage) {
                    progressMessage = await message.channel.send(t(locale, 'nacional.fetching_score', { current, total: totalVal }));
                    lastUpdate = now;
                } else if (now - lastUpdate > 1500 || current === totalVal) {
                    try {
                        await progressMessage.edit(t(locale, 'nacional.fetching_score', { current, total: totalVal }));
                        lastUpdate = now;
                    } catch {}
                }
            };

            try {
                playersList = await OsuUserModel.fetchRankingScore(countryFilter, targetGamemode, onProgress);
                total = playersList.length;
            } catch (err) {
                console.error("Error al obtener ranking por Score:", err);
                const errMsg = t(locale, 'nacional.err_fetch_score', { country: countryFilter });
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
                return t(locale, 'nacional.err_fetch_national', { country: countryFilter });
            }
        }
    }

    if (viewMode !== 'subdivisions' && (!playersList || playersList.length === 0)) {
        const noPlayersMsg = viewMode === 'regional'
            ? t(locale, 'nacional.err_no_regional_players', { region: selectedRegionName, mode: gamemodeName })
            : t(locale, 'nacional.err_no_national_players', { country: countryFilter, mode: gamemodeName });
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
            total,
            message
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
            isScoreSort,
            isRegional: true,
            regionName: selectedRegionName,
            message
        });
    } else {
        const chunk = (isAccSort || isScoreSort) ? playersList.slice(startIndex, startIndex + 10) : playersList;
        embed = doOsuRankingEmbed({
            chunk,
            total,
            startIndex,
            countryFilter,
            gamemodeName,
            targetGamemode,
            isAccSort,
            isScoreSort,
            message
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
                    total,
                    message
                });
            } else if (viewMode === 'regional') {
                const currentData = await OsuUserModel.fetchRegionalRankingPage(countryFilter, selectedRegion, targetGamemode, currentPage);
                let chunk = currentData.chunk;
                if (isScoreSort && chunk.length > 0) {
                    chunk = await Promise.all(
                        chunk.map(async (p) => {
                            try {
                                const profile = await OsuUserModel.getOsuUser({
                                    username: [p.user.id.toString()],
                                    gamemode: targetGamemode,
                                    server: 'bancho'
                                });
                                if (profile && typeof profile === 'object' && profile.statistics) {
                                    return {
                                        ...p,
                                        ranked_score: profile.statistics.ranked_score || 0,
                                        pp: profile.statistics.pp || p.pp
                                    };
                                }
                            } catch (e) {
                                console.error(`Error al obtener perfil de ${p.user.id}:`, e);
                            }
                            return { ...p, ranked_score: 0 };
                        })
                    );
                    chunk.sort((a, b) => b.ranked_score - a.ranked_score);
                }
                currentEmbed = doOsuRankingEmbed({
                    chunk,
                    total,
                    startIndex,
                    countryFilter,
                    gamemodeName,
                    targetGamemode,
                    isAccSort: false,
                    isScoreSort,
                    isRegional: true,
                    regionName: selectedRegionName,
                    message
                });
            } else {
                let currentChunk;
                if (isAccSort || isScoreSort) {
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
                    isAccSort,
                    isScoreSort,
                    message
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
    'header': t('es', 'commands.nacional.header'),
    'body': t('es', 'commands.nacional.body'),
    'usage': t('es', 'commands.nacional.usage')
};

module.exports = { run, description: run.description };
