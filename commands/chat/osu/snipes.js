const { getOsuUser, argsParser } = require("../../utils/osu.js");
const { t } = require("../../../utils/i18n.js");
const OsuScoreModel = require("../../../models/OsuScoreModel.js");
const { doOsuSnipesEmbed, doOsuSnipesProgressEmbed } = require("../../../views/osuEmbeds.js");

const modeToInt = {
    'osu': 0,
    'taiko': 1,
    'fruits': 2,
    'mania': 3
};

async function run(messages, args){
    const { message, res } = messages;
    const locale = message.locale || 'es';

    // Parseamos argumentos de entrada del usuario
    const osu_userdata = await argsParser(args,
        {"message" : message, "res" : res, "command_function" : getOsuUser, "resolveUserByIndex": true, "ignoreBeatmap": true});  

    const { country_code, id } = osu_userdata.fn_response;
    const playmode = osu_userdata.fn_response.playmode || 'osu';
    const look_gamemode = modeToInt[playmode] ?? 0;

    // Solo soportamos Venezuela (VE) por ahora mientras se raspa la base de datos nacional
    if (country_code !== 'VE') {
        return t(locale, 'snipes.err_country_support');
    }

    // 1. Obtener total de mapas rankeados en este modo de juego
    let totalMaps = 0;
    try {
        totalMaps = await OsuScoreModel.getRankedBeatmapsCount(look_gamemode);
    } catch (errTotal) {
        console.error("Error al obtener total de mapas en snipes.js:", errTotal);
        return t(locale, 'snipes.err_db_maps');
    }

    // 2. Obtener mapas que ya han sido procesados y guardados en top_scores en este modo de juego
    let processedMaps = 0;
    try {
        processedMaps = await OsuScoreModel.getProcessedSnipesCount(look_gamemode, country_code);
    } catch (errProcessed) {
        console.error("Error al obtener mapas procesados en snipes.js:", errProcessed);
        return t(locale, 'snipes.err_db_progress');
    }

    const percentage = totalMaps > 0 ? (processedMaps / totalMaps) * 100 : 0;

    // Si el porcentaje es menor al 99.9%, mostramos la tarjeta de progreso
    if (percentage < 99.9) {
        return doOsuSnipesProgressEmbed(percentage, processedMaps, totalMaps, country_code, playmode, locale);
    }

    const isDetailed = osu_userdata.parsed_args?.detailed === true;

    // 3. Si el poblamiento está completado (o es mayor a 99.9%), extraemos y adaptamos los datos del Modelo
    let userScores = [];
    try {
        userScores = await OsuScoreModel.getUserNationalTops(id, look_gamemode, country_code, isDetailed);
    } catch (errUserScores) {
        console.error("Error al obtener puntuaciones del usuario en snipes.js:", errUserScores);
        return t(locale, 'snipes.err_db_scores');
    }

    if (!userScores || userScores.length === 0) {
        return doOsuSnipesEmbed(message, null, osu_userdata.fn_response, locale);
    }

    const modsCount = {};
    const datesSet = {};
    let totalPP = 0;
    let countWithPP = 0;

    // Métricas detalladas si isDetailed === true
    const starRanges = {
        '3★-': 0,
        '4★': 0,
        '5★': 0,
        '6★': 0,
        '7★': 0,
        '8★+': 0
    };
    const mappersCount = {};
    let totalBPM = 0, totalAR = 0, totalOD = 0, totalCS = 0;
    let bpmCount = 0, arCount = 0, odCount = 0, csCount = 0;
    let oldestScore = null;
    let newestScore = null;

    userScores.forEach(s => {
        // Agrupar mods
        const modsStr = s.mods || 'NM';
        if (modsStr === 'NM') {
            modsCount['NM'] = (modsCount['NM'] || 0) + 1;
        } else {
            const modsArr = modsStr.match(/.{1,2}/g) || [];
            modsArr.forEach(mod => {
                modsCount[mod] = (modsCount[mod] || 0) + 1;
            });
        }

        // Agrupar por año
        if (s.ended_at && s.ended_at !== new Date(0).toISOString()) {
            const year = new Date(s.ended_at).getFullYear();
            datesSet[year] = (datesSet[year] || 0) + 1;
        }

        // Promedio de PP
        if (typeof s.pp === 'number' && s.pp > 0) {
            totalPP += s.pp;
            countWithPP++;
        }

        if (isDetailed) {
            // Estrellas
            const stars = s.ranked_beatmaps?.stars ? parseFloat(s.ranked_beatmaps.stars) : 0;
            if (stars < 4) starRanges['3★-']++;
            else if (stars < 5) starRanges['4★']++;
            else if (stars < 6) starRanges['5★']++;
            else if (stars < 7) starRanges['6★']++;
            else if (stars < 8) starRanges['7★']++;
            else starRanges['8★+']++;

            // Mappers
            const creator = s.ranked_beatmaps?.creator;
            if (creator) {
                mappersCount[creator] = (mappersCount[creator] || 0) + 1;
            }

            // Specs
            const map = s.ranked_beatmaps;
            if (map) {
                if (typeof map.bpm === 'number' && map.bpm > 0) {
                    totalBPM += map.bpm;
                    bpmCount++;
                }
                if (typeof map.ar === 'number' || typeof map.ar === 'string') {
                    const val = parseFloat(map.ar);
                    if (!isNaN(val)) {
                        totalAR += val;
                        arCount++;
                    }
                }
                if (typeof map.od === 'number' || typeof map.od === 'string') {
                    const val = parseFloat(map.od);
                    if (!isNaN(val)) {
                        totalOD += val;
                        odCount++;
                    }
                }
                if (typeof map.cs === 'number' || typeof map.cs === 'string') {
                    const val = parseFloat(map.cs);
                    if (!isNaN(val)) {
                        totalCS += val;
                        csCount++;
                    }
                }
            }

            // Hitos temporales
            if (s.ended_at && s.ended_at !== new Date(0).toISOString()) {
                const time = new Date(s.ended_at).getTime();
                if (!oldestScore || time < new Date(oldestScore.ended_at).getTime()) {
                    oldestScore = s;
                }
                if (!newestScore || time > new Date(newestScore.ended_at).getTime()) {
                    newestScore = s;
                }
            }
        }
    });

    const averagePP = countWithPP > 0 ? (totalPP / countWithPP) : 0;

    const adaptedData = {
        count_total: userScores.length,
        average_pp: averagePP,
        mods_count: modsCount,
        dates_set: datesSet,
        is_detailed: isDetailed
    };

    if (isDetailed) {
        adaptedData.star_ranges = starRanges;
        adaptedData.top_mappers = Object.entries(mappersCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        adaptedData.avg_bpm = bpmCount > 0 ? (totalBPM / bpmCount) : 0;
        adaptedData.avg_ar = arCount > 0 ? (totalAR / arCount) : 0;
        adaptedData.avg_od = odCount > 0 ? (totalOD / odCount) : 0;
        adaptedData.avg_cs = csCount > 0 ? (totalCS / csCount) : 0;
        adaptedData.oldest_score = oldestScore;
        adaptedData.newest_score = newestScore;
    }

    return doOsuSnipesEmbed(message, adaptedData, osu_userdata.fn_response, locale);
}

run.description = {
    'header': t('es', 'commands.snipes.header'),
    'body': t('es', 'commands.snipes.body'),
    'usage': t('es', 'commands.snipes.usage')
};

module.exports = { run, "description": run.description };