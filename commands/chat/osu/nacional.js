const OsuUserModel = require("../../../models/OsuUserModel.js");
const OsuScoreModel = require("../../../models/OsuScoreModel.js");
const { doOsuRankingEmbed, doSubdivisionsEmbed, doOsuNationalPlaysListEmbed } = require("../../../views/osuRankingViews.js");
const { buildPaginationRow } = require("../../../views/osuViewHelpers.js");
const { argsParserNoCommand } = require("../../utils/argsParser.js");
const regionsData = require("../../../src/regions.json");
const { t } = require("../../../utils/i18n.js");

function matchCondition(stars, cond) {
    const { op, val, hasDecimal } = cond;
    if (hasDecimal) {
        switch (op) {
            case '>': return stars > val;
            case '<': return stars < val;
            case '>=': return stars >= val;
            case '<=': return stars <= val;
            case '=':
            case '==':
                return Math.abs(stars - val) < 0.005;
        }
    } else {
        switch (op) {
            case '>': return stars >= (val + 1);
            case '<': return stars < val;
            case '>=': return stars >= val;
            case '<=': return stars < (val + 1);
            case '=':
            case '==':
                return stars >= val && stars < (val + 1);
        }
    }
    return true;
}

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
    const countryCodesData = require("../../../src/country_codes.json");
    if (!countryFilter) {
        if (parsed_args.username && parsed_args.username[0]) {
            const potential = parsed_args.username[0].trim().toUpperCase();
            if (potential.length === 2 && countryCodesData[potential]) {
                countryFilter = potential;
            }
        }
        if (!countryFilter && Array.isArray(args)) {
            for (const a of args) {
                if (typeof a !== "string") continue;
                const pot = a.trim().toUpperCase();
                if (/^[a-zA-Z]{2}$/.test(pot) && countryCodesData[pot] && !a.startsWith("-")) {
                    countryFilter = pot;
                    break;
                }
            }
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

    // Modo de mejores jugadas por PP a nivel nacional (-pp / -plays)
    const isPPSort = Boolean(parsed_args.ppSort || (Array.isArray(args) && args.some(a => typeof a === 'string' && (a.toLowerCase() === '-pp' || a.toLowerCase() === '-plays'))));
    if (isPPSort) {
        return await handleNationalPPPlays(messages, args, parsed_args, countryFilter, targetGamemode, gamemodeName, embedPage);
    }

    // Modo de habilidades a nivel nacional (-skills / -aim / -speed / -acc / -reading / -stamina)
    const SKILL_FLAGS = new Set(["-skills", "--skills", "-skill", "--skill", "-aim", "--aim", "-speed", "--speed", "-acc", "--acc", "-reading", "--reading", "-read", "--read", "-stamina", "--stamina", "-stam", "--stam"]);
    const hasSkillFlag = Array.isArray(args) && args.some(a => typeof a === 'string' && SKILL_FLAGS.has(a.toLowerCase()));
    if (hasSkillFlag) {
        const skillsCommand = require("./skills.js");
        return await skillsCommand.run(messages, [...(args || []), "-nacional", "-pais", countryFilter]);
    }

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

    const isTopsSort = Boolean(parsed_args.topsSort || (Array.isArray(args) && args.some(a => typeof a === 'string' && (a.toLowerCase() === '-tops' || a.toLowerCase() === '-top'))));
    const isAccSort = !isTopsSort && !!parsed_args.accSort;
    const isScoreSort = !isTopsSort && !!parsed_args.scoreSort;
    const isTotalScoreSort = !isTopsSort && !!parsed_args.totalScoreSort;
    let playersList = [];
    let total = 0;
    let progressMessage = null;

    if (viewMode === 'subdivisions') {
        total = subdivisions.length;
    } else if (isTopsSort) {
        try {
            playersList = await OsuScoreModel.getCountryTopsLeaderboard(countryFilter);
            total = playersList.length;
        } catch (err) {
            console.error("Error al obtener ranking nacional de tops:", err);
            return t(locale, 'nacional.err_fetch_national', { country: countryFilter });
        }
    } else if (viewMode === 'regional') {
        try {
            const currentData = await OsuUserModel.fetchRegionalRankingPage(countryFilter, selectedRegion, targetGamemode, embedPage);
            playersList = currentData.chunk;
            total = currentData.total;

            if ((isScoreSort || isTotalScoreSort) && playersList.length > 0) {
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
                                    total_score: profile.statistics.total_score || 0,
                                    pp: profile.statistics.pp || p.pp
                                };
                            }
                        } catch (e) {
                            console.error(`Error al obtener perfil de ${p.user.id}:`, e);
                        }
                        return { ...p, ranked_score: 0, total_score: 0 };
                    })
                );
                if (isTotalScoreSort) {
                    playersList.sort((a, b) => b.total_score - a.total_score);
                } else {
                    playersList.sort((a, b) => b.ranked_score - a.ranked_score);
                }
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
        } else if (isTotalScoreSort) {
            let lastUpdate = 0;
            const onProgress = async (current, totalVal) => {
                const now = Date.now();
                if (!progressMessage) {
                    progressMessage = await message.channel.send(t(locale, 'nacional.fetching_totalscore', { current, total: totalVal }));
                    lastUpdate = now;
                } else if (now - lastUpdate > 1500 || current === totalVal) {
                    try {
                        await progressMessage.edit(t(locale, 'nacional.fetching_totalscore', { current, total: totalVal }));
                        lastUpdate = now;
                    } catch {}
                }
            };

            try {
                playersList = await OsuUserModel.fetchRankingTotalScore(countryFilter, targetGamemode, onProgress);
                total = playersList.length;
            } catch (err) {
                console.error("Error al obtener ranking por Score Total:", err);
                const errMsg = t(locale, 'nacional.err_fetch_totalscore', { country: countryFilter });
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
        let noPlayersMsg;
        if (isTopsSort) {
            noPlayersMsg = t(locale, 'nacional.err_no_tops_players', { country: countryFilter });
        } else if (viewMode === 'regional') {
            noPlayersMsg = t(locale, 'nacional.err_no_regional_players', { region: selectedRegionName, mode: gamemodeName });
        } else {
            noPlayersMsg = t(locale, 'nacional.err_no_national_players', { country: countryFilter, mode: gamemodeName });
        }
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
            isTotalScoreSort,
            isRegional: true,
            regionName: selectedRegionName,
            message
        });
    } else if (isTopsSort) {
        const chunk = playersList.slice(startIndex, startIndex + 10);
        embed = doOsuRankingEmbed({
            chunk,
            total,
            startIndex,
            countryFilter,
            gamemodeName: 'osu!standard',
            targetGamemode: 'osu',
            isAccSort: false,
            isScoreSort: false,
            isTotalScoreSort: false,
            isTopsSort: true,
            message
        });
    } else {
        const chunk = (isAccSort || isScoreSort || isTotalScoreSort) ? playersList.slice(startIndex, startIndex + 10) : playersList;
        embed = doOsuRankingEmbed({
            chunk,
            total,
            startIndex,
            countryFilter,
            gamemodeName,
            targetGamemode,
            isAccSort,
            isScoreSort,
            isTotalScoreSort,
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
            } else if (isTopsSort) {
                const currentChunk = playersList.slice(startIndex, startIndex + 10);
                currentEmbed = doOsuRankingEmbed({
                    chunk: currentChunk,
                    total,
                    startIndex,
                    countryFilter,
                    gamemodeName: 'osu!standard',
                    targetGamemode: 'osu',
                    isAccSort: false,
                    isScoreSort: false,
                    isTotalScoreSort: false,
                    isTopsSort: true,
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

/**
 * Maneja la lógica y vista de las mejores jugadas por PP a nivel nacional (s.nacional -pp)
 */
async function handleNationalPPPlays(messages, args, parsed_args, countryFilter, targetGamemode, gamemodeName, embedPage) {
    const { message, res } = messages;
    const locale = message.locale || 'es';

    const modeToInt = { 'osu': 0, 'taiko': 1, 'fruits': 2, 'mania': 3 };
    const look_gamemode = modeToInt[targetGamemode] ?? 0;

    // Verificar si el país está soportado / poblado en la base de datos
    const isScraped = await OsuUserModel.isCountryScraped(countryFilter);
    if (!isScraped) {
        return t(locale, 'snipes.err_country_support');
    }

    // Consultar mejores jugadas en Turso
    const rawScores = await OsuScoreModel.getCountryTopPlays(countryFilter, look_gamemode, 1000);
    if (!rawScores || rawScores.length === 0) {
        return t(locale, 'nacional.err_no_pp_plays', { country: countryFilter });
    }

    // Adaptar scores al formato estándar
    const adaptedScores = rawScores.map(dbScore => {
        const modsString = dbScore.mods || 'NM';
        const scoreMods = (Array.isArray(modsString))
            ? modsString
            : ((modsString === 'NM' || modsString === 'NONE')
                ? []
                : modsString.match(/.{1,2}/g).map(mod => ({ acronym: mod })));

        const hasHiddenOrFlashlight = scoreMods.some(m => m.acronym === 'HD' || m.acronym === 'FL');
        const acc = dbScore.accuracy || 0;
        let calculatedRank = dbScore.rank;
        if (!calculatedRank) {
            calculatedRank = 'D';
            if (acc >= 1.0) {
                calculatedRank = hasHiddenOrFlashlight ? 'SSH' : 'SS';
            } else if (acc >= 0.95) {
                calculatedRank = hasHiddenOrFlashlight ? 'SH' : 'S';
            } else if (acc >= 0.90) {
                calculatedRank = 'A';
            } else if (acc >= 0.85) {
                calculatedRank = 'B';
            } else if (acc >= 0.80) {
                calculatedRank = 'C';
            }
        }

        const dbMaxCombo = dbScore.max_combo !== undefined && dbScore.max_combo !== null ? dbScore.max_combo : null;
        const dbPerfect = dbScore.perfect !== undefined && dbScore.perfect !== null ? dbScore.perfect : false;
        const isStatsEstimated = !dbScore.statistics;

        const mode = dbScore.ranked_beatmaps?.mode || 0;
        const limitCombo = dbScore.ranked_beatmaps?.max_combo || 1000;

        let great = limitCombo;
        let ok = 0;
        let meh = 0;
        let miss = 0;

        if (dbScore.statistics) {
            const stats = dbScore.statistics;
            great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
            ok = stats.ok !== undefined ? stats.ok : (stats.count_100 || 0);
            meh = stats.meh !== undefined ? stats.meh : (stats.count_50 || 0);
            miss = stats.miss !== undefined ? stats.miss : (stats.count_miss || 0);
        } else {
            if (mode === 1) { // Taiko
                great = Math.max(0, Math.min(limitCombo, Math.round(limitCombo * (2 * acc - 1))));
                ok = Math.max(0, limitCombo - great);
            } else { // osu!std, mania, catch
                great = Math.max(0, Math.min(limitCombo, Math.round(limitCombo * (3 * acc - 1) / 2)));
                ok = Math.max(0, limitCombo - great);
            }
        }

        return {
            id: dbScore.beatmap_id,
            beatmap: {
                id: dbScore.beatmap_id,
                version: dbScore.ranked_beatmaps?.version || '',
                difficulty_rating: dbScore.ranked_beatmaps?.stars ? parseFloat(dbScore.ranked_beatmaps.stars) : 0,
                bpm: dbScore.ranked_beatmaps?.bpm ? parseFloat(dbScore.ranked_beatmaps.bpm) : 0,
                ar: dbScore.ranked_beatmaps?.ar ? parseFloat(dbScore.ranked_beatmaps.ar) : 0,
                od: dbScore.ranked_beatmaps?.od ? parseFloat(dbScore.ranked_beatmaps.od) : 0,
                cs: dbScore.ranked_beatmaps?.cs ? parseFloat(dbScore.ranked_beatmaps.cs) : 0,
                hp: dbScore.ranked_beatmaps?.hp ? parseFloat(dbScore.ranked_beatmaps.hp) : 0,
                max_combo: dbScore.ranked_beatmaps?.max_combo || 0,
                ranked_status: dbScore.ranked_beatmaps?.ranked_status ?? null,
                status: dbScore.ranked_beatmaps?.status || (dbScore.ranked_beatmaps?.ranked_status === 4 ? 'loved' : null)
            },
            beatmapset: {
                id: dbScore.ranked_beatmaps?.beatmapset_id || 0,
                title: dbScore.ranked_beatmaps?.title || '',
                artist: dbScore.ranked_beatmaps?.artist || '',
                creator: dbScore.ranked_beatmaps?.creator || '',
                covers: {
                    cover: `https://assets.ppy.sh/beatmaps/${dbScore.ranked_beatmaps?.beatmapset_id || 0}/covers/cover.jpg`,
                    "cover@2x": `https://assets.ppy.sh/beatmaps/${dbScore.ranked_beatmaps?.beatmapset_id || 0}/covers/cover@2x.jpg`,
                    card: `https://assets.ppy.sh/beatmaps/${dbScore.ranked_beatmaps?.beatmapset_id || 0}/covers/card.jpg`,
                    "card@2x": `https://assets.ppy.sh/beatmaps/${dbScore.ranked_beatmaps?.beatmapset_id || 0}/covers/card@2x.jpg`,
                    list: `https://assets.ppy.sh/beatmaps/${dbScore.ranked_beatmaps?.beatmapset_id || 0}/covers/list.jpg`,
                    "list@2x": `https://assets.ppy.sh/beatmaps/${dbScore.ranked_beatmaps?.beatmapset_id || 0}/covers/list@2x.jpg`,
                    slimcover: `https://assets.ppy.sh/beatmaps/${dbScore.ranked_beatmaps?.beatmapset_id || 0}/covers/slimcover.jpg`,
                    "slimcover@2x": `https://assets.ppy.sh/beatmaps/${dbScore.ranked_beatmaps?.beatmapset_id || 0}/covers/slimcover@2x.jpg`
                }
            },
            mods: scoreMods,
            build_id: dbScore.build_id ?? null,
            rank: calculatedRank,
            pp: dbScore.pp || 0,
            accuracy: dbScore.accuracy || 0,
            max_combo: dbMaxCombo,
            perfect: dbPerfect,
            isStatsEstimated: isStatsEstimated,
            passed: true,
            ended_at: dbScore.ended_at,
            created_at: dbScore.ended_at,
            statistics: {
                great: great,
                ok: ok,
                meh: meh,
                miss: miss,
                count_300: great,
                count_100: ok,
                count_50: meh,
                count_miss: miss,
                is_estimated: isStatsEstimated
            },
            user: {
                id: dbScore.user_id,
                username: dbScore.username,
                avatar_url: `https://a.ppy.sh/${dbScore.user_id}`
            },
            user_id: dbScore.user_id
        };
    });

    // Ordenar por PP desc por defecto y asignar rango original
    adaptedScores.sort((a, b) => b.pp - a.pp);
    adaptedScores.forEach((score, idx) => {
        score.originalRank = idx + 1;
    });

    let filtered_scores = adaptedScores;

    // 1. Filtrar por mods exactos (-m)
    if (parsed_args.modFilter !== null && parsed_args.modFilter !== undefined) {
        const filterStr = parsed_args.modFilter;
        const hasExplicitCL = filterStr.includes("CL");

        filtered_scores = filtered_scores.filter(score => {
            const scoreAcronyms = score.mods.map(m => m.acronym);
            const filteredScoreAcronyms = hasExplicitCL ? scoreAcronyms : scoreAcronyms.filter(mod => mod !== 'CL');

            if (filterStr === "NM" || filterStr === "NONE") {
                return filteredScoreAcronyms.length === 0;
            }

            const getModChunks = (str) => {
                const chunks = [];
                for (let j = 0; j < str.length; j += 2) {
                    chunks.push(str.slice(j, j + 2));
                }
                return chunks.sort().join("").toUpperCase();
            };
            const filterNormalized = getModChunks(filterStr);
            const scoreNormalized = filteredScoreAcronyms.sort().join("").toUpperCase();
            return scoreNormalized === filterNormalized;
        });
    }

    // 2. Filtrar por mods contenidos (-mx)
    if (parsed_args.modContainFilter !== null && parsed_args.modContainFilter !== undefined) {
        const filterStr = parsed_args.modContainFilter;
        const hasExplicitCL = filterStr.includes("CL");

        const filterChunks = [];
        for (let j = 0; j < filterStr.length; j += 2) {
            filterChunks.push(filterStr.slice(j, j + 2));
        }

        filtered_scores = filtered_scores.filter(score => {
            const scoreAcronyms = score.mods.map(m => m.acronym);
            const filteredScoreAcronyms = hasExplicitCL ? scoreAcronyms : scoreAcronyms.filter(mod => mod !== 'CL');

            if (filterStr === "NM" || filterStr === "NONE") {
                return filteredScoreAcronyms.length === 0;
            }

            return filterChunks.every(mod => filteredScoreAcronyms.includes(mod));
        });
    }

    // 3. Filtrar por dificultad de estrellas (-sr)
    if (parsed_args.srFilters && parsed_args.srFilters.length > 0) {
        filtered_scores = filtered_scores.filter(s => {
            const stars = s.beatmap?.difficulty_rating || 0;
            return parsed_args.srFilters.every(cond => matchCondition(stars, cond));
        });
    }

    // 4. Filtrar por umbral mínimo de PP (-g)
    if (parsed_args.ppThreshold !== null && parsed_args.ppThreshold !== undefined) {
        filtered_scores = filtered_scores.filter(s => s.pp >= parsed_args.ppThreshold);
    }

    // 5. Filtrar por búsqueda de texto (-? / -query)
    if (parsed_args.searchFilter) {
        const q = parsed_args.searchFilter.toLowerCase();
        filtered_scores = filtered_scores.filter(s => {
            const title = (s.beatmapset?.title || "").toLowerCase();
            const artist = (s.beatmapset?.artist || "").toLowerCase();
            const version = (s.beatmap?.version || "").toLowerCase();
            const creator = (s.beatmapset?.creator || "").toLowerCase();
            return title.includes(q) || artist.includes(q) || version.includes(q) || creator.includes(q);
        });
    }

    // 6. Ordenamientos alternativos si se especifican (-r, -c, -acc)
    if (parsed_args.recentSort) {
        filtered_scores.sort((a, b) => new Date(b.ended_at).getTime() - new Date(a.ended_at).getTime());
    } else if (parsed_args.comboSort) {
        filtered_scores.sort((a, b) => (b.max_combo || 0) - (a.max_combo || 0));
    } else if (parsed_args.accSort) {
        filtered_scores.sort((a, b) => (b.accuracy || 0) - (a.accuracy || 0));
    }

    const total_plays = filtered_scores.length;
    if (total_plays === 0) {
        if (parsed_args.modFilter) {
            return locale === 'es'
                ? `❌ No se encontraron jugadas registradas con los mods **${parsed_args.modFilter}** en el ranking de **${countryFilter}**.`
                : `❌ No plays found with mods **${parsed_args.modFilter}** in the national ranking of **${countryFilter}**.`;
        }
        if (parsed_args.srFilters && parsed_args.srFilters.length > 0) {
            const filterStrings = parsed_args.srFilters.map(f => `${f.op}${f.valStr}`);
            return locale === 'es'
                ? `❌ No se encontraron jugadas con dificultad \`${filterStrings.join(' y ')}\` en el ranking de **${countryFilter}**.`
                : `❌ No plays found matching difficulty \`${filterStrings.join(' and ')}\` in the national ranking of **${countryFilter}**.`;
        }
        if (parsed_args.ppThreshold !== null && parsed_args.ppThreshold !== undefined) {
            return locale === 'es'
                ? `❌ No se encontraron jugadas con **${parsed_args.ppThreshold}pp** o más en el ranking de **${countryFilter}**.`
                : `❌ No plays found with **${parsed_args.ppThreshold}pp** or more in the national ranking of **${countryFilter}**.`;
        }
        return t(locale, 'nacional.err_no_pp_plays', { country: countryFilter });
    }

    const pageSize = 5;
    let startIndex = (embedPage - 1) * pageSize;
    if (startIndex >= total_plays) {
        startIndex = Math.floor((total_plays - 1) / pageSize) * pageSize;
    }

    // --- MODO 1: SINGLE PLAY (-i <index>) ---
    if (parsed_args.explicitIndex) {
        let index = parsed_args.index || 1;
        if (index > total_plays) index = total_plays;
        if (index < 1) index = 1;

        const { doOsuTopSingleEmbed } = require("../../../views/osuEmbeds.js");
        const { buildTopSingleButtonsRow } = require("../../../views/osuViewHelpers.js");
        const linkedUser = await OsuUserModel.getLinkedUser(res?.User, message.author.id);
        let currentScoreMode = (linkedUser && linkedUser.preferred_score_mode) ? linkedUser.preferred_score_mode : 'classic';

        const processScore = async (scoreIndex) => {
            const score = filtered_scores[scoreIndex - 1];
            const stats = score.statistics || {};
            const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
            const ok = stats.ok !== undefined ? stats.ok : (stats.count_100 || 0);
            const meh = stats.meh !== undefined ? stats.meh : (stats.count_50 || 0);
            const miss = stats.miss !== undefined ? stats.miss : (stats.count_miss || 0);
            const total_hits = great + ok + meh + miss;

            const { getBeatmap, getBeatmap_osu, calculatePP } = require("../../utils/osu.js");
            const beatmap = await getBeatmap(score.beatmap.id);
            const map = await getBeatmap_osu(score.beatmapset.id, score.beatmap.id, beatmap);
            const maxAttrs = calculatePP(score, map, "maximo_pp");

            const user_pp = score.pp ? score.pp : calculatePP(score, map, null, maxAttrs).pp;
            const beatmap_max_combo = beatmap.max_combo || (maxAttrs && maxAttrs.difficulty ? maxAttrs.difficulty.maxCombo : 0);

            let pp_fc = null;
            const isFC = score.perfect || (score.accuracy === 1) || (!score.isStatsEstimated && miss === 0 && score.max_combo !== null && score.max_combo >= beatmap_max_combo - 2);
            if (!isFC) {
                try {
                    const fc_statistics = {
                        ...score.statistics,
                        great: (score.statistics.great || 0) + miss,
                        miss: 0
                    };
                    const fc_score = {
                        ...score,
                        max_combo: beatmap_max_combo,
                        statistics: fc_statistics
                    };
                    pp_fc = calculatePP(fc_score, map, null, maxAttrs).pp;
                } catch (err) {}
            }

            const pre_calculated = {
                "map": map,
                "map_completion": score.passed ? 100 : total_hits / map.nObjects,
                "maxAttrs": maxAttrs,
                "pp": user_pp,
                "beatmap_max_combo": beatmap_max_combo,
                "pp_fc": pp_fc
            };

            const embed = await doOsuTopSingleEmbed(message, score, pre_calculated, scoreIndex, total_plays, parsed_args, null, locale, currentScoreMode);
            map.free();
            return embed;
        };

        const initialEmbed = await processScore(index);
        const getSingleButtonsRow = (curr, max, scoreObj, renderDisabled = false) => {
            return buildTopSingleButtonsRow(curr, max, scoreObj, renderDisabled, currentScoreMode);
        };

        const sent_message = await message.channel.send({
            content: t(locale, 'top.showing_score_index', { index, total: total_plays }),
            embeds: [initialEmbed],
            components: getSingleButtonsRow(index, total_plays, filtered_scores[index - 1])
        });

        const filter = btnInt => btnInt.user.id === message.author.id;
        const collector = sent_message.createMessageComponentCollector({
            filter,
            idle: 30000
        });

        collector.on('collect', async i => {
            try {
                if (i.customId === 'top_render') {
                    const currentScore = filtered_scores[index - 1];
                    try {
                        const updatedComponents = getSingleButtonsRow(index, total_plays, currentScore, true);
                        if (typeof i.update === 'function') {
                            await i.update({ components: updatedComponents });
                        } else {
                            await i.deferUpdate();
                        }
                    } catch (err) {
                        try { await i.deferUpdate(); } catch {}
                    }
                    const infoMsg = await i.channel.send(`📥 **[o!rdr]** Preparando renderizado para la jugada de **${currentScore.user?.username || 'Usuario'}**...`);
                    try {
                        const scoreId = currentScore.id;
                        const replayBuffer = await OsuUserModel.downloadReplay(scoreId, currentScore.mode || parsed_args.gamemode || 'osu');
                        const renderCmd = require("../osu/render.js");
                        const mockMessages = {
                            message: { ...message, channel: i.channel, author: i.user },
                            res: res,
                            reply: { reply: async (opts) => await i.channel.send(opts) }
                        };
                        await renderCmd.startRenderFlow(
                            mockMessages,
                            replayBuffer,
                            `recent_${scoreId}.osr`,
                            { skin: 'default', resolution: '1280x720', skinSpecified: false },
                            locale
                        );
                    } catch (err) {
                        await infoMsg.edit(`❌ **Error:** ${t(locale, 'render.err_fetch_replay')}`);
                    }
                    return;
                }

                await i.deferUpdate();

                if (i.customId.startsWith('top_toggle_score_')) {
                    currentScoreMode = currentScoreMode === 'classic' ? 'lazer' : 'classic';
                    await OsuUserModel.setPreferredScoreMode(message.author.id, currentScoreMode);
                } else if (i.customId === 'top_first') {
                    index = 1;
                } else if (i.customId === 'top_prev') {
                    index = Math.max(1, index - 1);
                } else if (i.customId === 'top_next') {
                    index = Math.min(total_plays, index + 1);
                } else if (i.customId === 'top_last') {
                    index = total_plays;
                }

                const embed = await processScore(index);
                await i.editReply({
                    content: t(locale, 'top.showing_score_index', { index, total: total_plays }),
                    embeds: [embed],
                    components: getSingleButtonsRow(index, total_plays, filtered_scores[index - 1])
                });
            } catch (btnErr) {
                console.error("Error en botón de single play de nacional -pp:", btnErr);
            }
        });

        collector.on('end', async () => {
            try {
                const disabledRow = getSingleButtonsRow(index, total_plays, filtered_scores[index - 1], true);
                await sent_message.edit({ components: disabledRow });
            } catch {}
        });

        return;
    }

    // --- MODO 2: LIST VIEW (5 jugadas por página) ---
    const getListStars = async (chunk) => {
        const { getBeatmap, getBeatmap_osu, calculatePP } = require("../../utils/osu.js");
        const starsMap = {};
        await Promise.all(chunk.map(async (score) => {
            try {
                const beatmap = await getBeatmap(score.beatmap.id);
                const map = await getBeatmap_osu(score.beatmapset.id, score.beatmap.id, beatmap);
                const maxAttrs = calculatePP(score, map, "maximo_pp");
                const stars = maxAttrs.stars || (maxAttrs.difficulty ? maxAttrs.difficulty.stars : score.beatmap.difficulty_rating);
                map.free();
                starsMap[score.beatmap.id] = stars;
            } catch (e) {
                starsMap[score.beatmap.id] = score.beatmap.difficulty_rating;
            }
        }));
        return starsMap;
    };

    const initialChunk = filtered_scores.slice(startIndex, startIndex + pageSize);
    const initialStars = await getListStars(initialChunk);
    const initialEmbed = await doOsuNationalPlaysListEmbed({
        chunk: initialChunk,
        startIndex,
        total: total_plays,
        countryFilter,
        gamemodeName,
        message,
        parsed_args,
        starsMap: initialStars
    });

    const getButtonsRow = (start, total) => {
        return buildPaginationRow({ prefix: 'nac_pp', current: start, total, pageSize });
    };

    const hasButtons = total_plays > pageSize;
    const components = hasButtons ? [getButtonsRow(startIndex, total_plays)] : [];

    const sent_message = await message.channel.send({
        embeds: [initialEmbed],
        components
    });

    if (!hasButtons) return;

    const btnFilter = btnInt => btnInt.user.id === message.author.id;
    const collector = sent_message.createMessageComponentCollector({
        filter: btnFilter,
        idle: 60000
    });

    collector.on('collect', async i => {
        try {
            await i.deferUpdate();

            if (i.customId === 'nac_pp_first') {
                startIndex = 0;
            } else if (i.customId === 'nac_pp_prev') {
                startIndex = Math.max(0, startIndex - pageSize);
            } else if (i.customId === 'nac_pp_next') {
                startIndex = startIndex + pageSize;
            } else if (i.customId === 'nac_pp_last') {
                startIndex = Math.floor((total_plays - 1) / pageSize) * pageSize;
            }

            const chunk = filtered_scores.slice(startIndex, startIndex + pageSize);
            const starsMap = await getListStars(chunk);
            const embed = await doOsuNationalPlaysListEmbed({
                chunk,
                startIndex,
                total: total_plays,
                countryFilter,
                gamemodeName,
                message,
                parsed_args,
                starsMap
            });

            await i.editReply({
                embeds: [embed],
                components: [getButtonsRow(startIndex, total_plays)]
            });
        } catch (err) {
            console.error("Error en paginación de nacional -pp:", err);
        }
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
