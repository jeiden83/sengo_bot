// utils/droidDifficultyEngine.js
// Motor aislado de dificultad y rendimiento oficial para osu!droid (dpp / touch reworks)
// Utiliza exclusivamente @rian8337/osu-difficulty-calculator y @rian8337/osu-base

let osuBase = null;
let osuDifficulty = null;

function loadDroidModules() {
    if (!osuBase) {
        osuBase = require('@rian8337/osu-base');
        osuDifficulty = require('@rian8337/osu-difficulty-calculator');
    }
    return { osuBase, osuDifficulty };
}

// Caché en memoria de Beatmaps decodificados para evitar re-parsear el mismo .osu
const decodedBeatmapCache = new Map();
const MAX_BEATMAP_CACHE = 150;

function getDecodedBeatmap(contentStr, cacheKey = null) {
    const { osuBase } = loadDroidModules();
    if (cacheKey && decodedBeatmapCache.has(cacheKey)) {
        return decodedBeatmapCache.get(cacheKey);
    }
    const beatmap = new osuBase.BeatmapDecoder().decode(contentStr).result;
    if (cacheKey) {
        if (decodedBeatmapCache.size >= MAX_BEATMAP_CACHE) {
            const firstKey = decodedBeatmapCache.keys().next().value;
            decodedBeatmapCache.delete(firstKey);
        }
        decodedBeatmapCache.set(cacheKey, beatmap);
    }
    return beatmap;
}

/**
 * Normaliza cualquier formato de mods de entrada a un array de Mod de @rian8337/osu-base
 */
function parseMods(modsInput) {
    const { osuBase } = loadDroidModules();
    if (!modsInput) return [];

    if (Array.isArray(modsInput)) {
        // Caso: array de objetos [{ acronym: 'HD' }] o strings ['HD', 'DT']
        const acronyms = modsInput.map(m => {
            if (typeof m === 'string') return m.toUpperCase();
            if (m && typeof m.acronym === 'string') return m.acronym.toUpperCase();
            return '';
        }).filter(Boolean);
        const combined = acronyms.filter(a => a !== 'CL' && a !== 'NM').join('');
        return osuBase.ModUtil.pcStringToMods(combined);
    }

    if (typeof modsInput === 'string') {
        const clean = modsInput.replace(/[^A-Za-z]/g, '').toUpperCase();
        return osuBase.ModUtil.pcStringToMods(clean);
    }

    return [];
}

/**
 * Calcula la dificultad y atributos de rendimiento de una jugada de osu!droid
 * @param {string|Buffer} osuContent Contenido del archivo .osu
 * @param {object} score Objeto de score normalizado de osu!droid
 * @param {string|null} cacheKey Clave opcional (MD5 o beatmapId) para caché de parseo
 * @returns {object} Atributos de dificultad y PP nativos de droid
 */
function calculateDroidScoreSkills(osuContent, score, cacheKey = null) {
    const { osuBase, osuDifficulty } = loadDroidModules();
    const contentStr = Buffer.isBuffer(osuContent) ? osuContent.toString('utf8') : String(osuContent);
    const beatmap = getDecodedBeatmap(contentStr, cacheKey);

    const mods = parseMods(score.mods || score.droid_mods);
    const diffCalc = new osuDifficulty.DroidDifficultyCalculator(beatmap);
    diffCalc.calculate({ mods });

    const diffAttrs = diffCalc.attributes;
    const maxCombo = diffAttrs.maxCombo || 1;
    const combo = typeof score.max_combo === 'number' ? score.max_combo : maxCombo;

    const stats = score.statistics || {};
    const n300 = Number(stats.count_300 ?? stats.great ?? stats.perfect ?? 0);
    const n100 = Number(stats.count_100 ?? stats.ok ?? stats.good ?? 0);
    const n50 = Number(stats.count_50 ?? stats.meh ?? stats.bad ?? 0);
    const nmiss = Number(stats.count_miss ?? stats.miss ?? 0);

    const totalHits = diffAttrs.hitCircleCount + diffAttrs.sliderCount + diffAttrs.spinnerCount;
    let accObj;

    if (n300 + n100 + n50 + nmiss > 0) {
        accObj = new osuBase.Accuracy({
            n300: n300 > 0 ? n300 : Math.max(0, totalHits - n100 - n50 - nmiss),
            n100,
            n50,
            nmiss
        });
    } else {
        const rawAcc = typeof score.accuracy === 'number'
            ? (score.accuracy <= 1 ? score.accuracy * 100 : score.accuracy)
            : 100;
        accObj = new osuBase.Accuracy({
            percent: rawAcc,
            nobjects: totalHits,
            nmiss
        });
    }

    const perfCalc = new osuDifficulty.DroidPerformanceCalculator(diffAttrs);
    perfCalc.calculate({
        combo,
        accPercent: accObj
    });

    const aimPP = Number.isFinite(perfCalc.aim) ? perfCalc.aim : 0;
    const tapPP = Number.isFinite(perfCalc.tap) ? perfCalc.tap : 0;
    const accPP = Number.isFinite(perfCalc.accuracy) ? perfCalc.accuracy : 0;
    const visualPP = Number.isFinite(perfCalc.visual) ? perfCalc.visual : 0;
    const flPP = Number.isFinite(perfCalc.flashlight) ? perfCalc.flashlight : 0;
    const readingPP = Math.max(visualPP, flPP);
    const totalPP = Number.isFinite(perfCalc.total) ? perfCalc.total : 0;

    return {
        stars: Number((diffAttrs.starRating || 0).toFixed(2)),
        pp: Number(totalPP.toFixed(2)),
        aimPP: Number(aimPP.toFixed(2)),
        speedPP: Number(tapPP.toFixed(2)),   // Tap en droid equivale a Speed
        accPP: Number(accPP.toFixed(2)),
        readingPP: Number(readingPP.toFixed(2)),
        visualPP: Number(visualPP.toFixed(2)),
        flashlightPP: Number(flPP.toFixed(2)),
        aimDifficulty: diffAttrs.aimDifficulty,
        tapDifficulty: diffAttrs.tapDifficulty,
        rhythmDifficulty: diffAttrs.rhythmDifficulty,
        visualDifficulty: diffAttrs.visualDifficulty
    };
}

/**
 * Calcula atributos de juego completos para una jugada de osu!droid:
 * - stars (estrellas nativas de droid con mods)
 * - beatmap_max_combo
 * - maxAttrs ({ pp: maxPP, stars, difficulty: { stars, maxCombo } })
 * - user_pp (PP oficial de rework)
 * - pp_fc (PP de FC simulado en el rework de droid si la jugada no fue FC)
 * @param {string|Buffer} osuContent Contenido del archivo .osu
 * @param {object} score Objeto de la jugada
 * @param {string|null} cacheKey Clave para la caché del Beatmap
 */
function calculateDroidPlayAttributes(osuContent, score, cacheKey = null) {
    const { osuBase, osuDifficulty } = loadDroidModules();
    const contentStr = Buffer.isBuffer(osuContent) ? osuContent.toString('utf8') : String(osuContent);
    const beatmap = getDecodedBeatmap(contentStr, cacheKey);

    const mods = parseMods(score.mods || score.droid_mods);
    const diffCalc = new osuDifficulty.DroidDifficultyCalculator(beatmap);
    diffCalc.calculate({ mods });

    const diffAttrs = diffCalc.attributes;
    const maxCombo = diffAttrs.maxCombo || 1;
    const combo = typeof score.max_combo === 'number' ? score.max_combo : maxCombo;

    const stats = score.statistics || {};
    const n300 = Number(stats.count_300 ?? stats.great ?? stats.perfect ?? 0);
    const n100 = Number(stats.count_100 ?? stats.ok ?? stats.good ?? 0);
    const n50 = Number(stats.count_50 ?? stats.meh ?? stats.bad ?? 0);
    const nmiss = Number(stats.count_miss ?? stats.miss ?? 0);
    const totalHits = diffAttrs.hitCircleCount + diffAttrs.sliderCount + diffAttrs.spinnerCount;

    // 1. Current Play
    let currentAccObj;
    if (n300 + n100 + n50 + nmiss > 0) {
        currentAccObj = new osuBase.Accuracy({
            n300: n300 > 0 ? n300 : Math.max(0, totalHits - n100 - n50 - nmiss),
            n100,
            n50,
            nmiss
        });
    } else {
        const rawAcc = typeof score.accuracy === 'number'
            ? (score.accuracy <= 1 ? score.accuracy * 100 : score.accuracy)
            : 100;
        currentAccObj = new osuBase.Accuracy({
            percent: rawAcc,
            nobjects: totalHits,
            nmiss
        });
    }

    const currentPerf = new osuDifficulty.DroidPerformanceCalculator(diffAttrs);
    currentPerf.calculate({ combo, accPercent: currentAccObj });

    // 2. FC Play (si no fue FC)
    const isFC = score.perfect || (nmiss === 0 && combo >= maxCombo - 2);
    let pp_fc = null;
    if (!isFC) {
        let fcAccObj;
        if (n300 + n100 + n50 + nmiss > 0) {
            fcAccObj = new osuBase.Accuracy({
                n300: (n300 > 0 ? n300 : Math.max(0, totalHits - n100 - n50 - nmiss)) + nmiss,
                n100,
                n50,
                nmiss: 0
            });
        } else {
            const rawAcc = typeof score.accuracy === 'number'
                ? (score.accuracy <= 1 ? score.accuracy * 100 : score.accuracy)
                : 100;
            fcAccObj = new osuBase.Accuracy({
                percent: rawAcc,
                nobjects: totalHits,
                nmiss: 0
            });
        }
        const fcPerf = new osuDifficulty.DroidPerformanceCalculator(diffAttrs);
        fcPerf.calculate({ combo: maxCombo, accPercent: fcAccObj });
        pp_fc = Number(fcPerf.total.toFixed(2));
    }

    // 3. 100% SS Max PP
    const ssAccObj = new osuBase.Accuracy({ percent: 100, nobjects: totalHits });
    const ssPerf = new osuDifficulty.DroidPerformanceCalculator(diffAttrs);
    ssPerf.calculate({ combo: maxCombo, accPercent: ssAccObj });

    const stars = Number((diffAttrs.starRating || 0).toFixed(2));
    const user_pp = Number(currentPerf.total.toFixed(2));
    const max_pp = Number(ssPerf.total.toFixed(2));

    return {
        stars,
        beatmap_max_combo: maxCombo,
        maxAttrs: {
            pp: max_pp,
            stars,
            difficulty: {
                stars,
                maxCombo
            }
        },
        user_pp,
        pp_fc,
        isFC
    };
}

module.exports = {
    loadDroidModules,
    calculateDroidScoreSkills,
    calculateDroidPlayAttributes,
    parseMods
};
