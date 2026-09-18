const fs = require('fs');
const path = require('path');
const ppEngine = require('../utils/ppEngine.js');

/**
 * Convierte segundos a formato m:ss
 * @param {number} sec 
 * @returns {string}
 */
function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Calcula el resumen { min, avg, max } para una lista de números
 * @param {number[]} arr 
 * @returns {{ min: number, avg: number, max: number }}
 */
function summarize(arr) {
    if (!arr || arr.length === 0) return { min: 0, avg: 0, max: 0 };
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return { min, avg, max };
}

/**
 * Calcula estadísticas completas (Accuracy, Combo, Misses, PP, Stars, BPM, HP, AR, CS, OD, Length)
 * a partir de un conjunto de jugadas (habitualmente el top 100).
 * 
 * @param {Array} scores Array de puntuaciones del usuario
 * @param {string} mode Modo de juego ('osu', 'taiko', 'fruits', 'mania')
 * @returns {Object} Resumen con min, avg, max formateados y valores numéricos
 */
function calculateTop100Statistics(scores, mode = 'osu', limit = 200) {
    if (!scores || !Array.isArray(scores) || scores.length === 0) {
        return null;
    }

    const topList = scores.slice(0, limit);
    const engine = ppEngine.getEngine();
    const MODE_INT = { osu: 0, taiko: 1, fruits: 2, catch: 2, ctb: 2, mania: 3 };
    const targetModeInt = MODE_INT[mode] ?? 0;

    const accs = [];
    const combos = [];
    const misses = [];
    const pps = [];
    const stars = [];
    const bpms = [];
    const hps = [];
    const ars = [];
    const css = [];
    const ods = [];
    const lens = [];

    const beatmapBasePath = path.join(__dirname, '../db/local/beatmap.osu');

    for (const s of topList) {
        // Accuracy (%)
        const rawAcc = typeof s.accuracy === 'number' ? s.accuracy : 0;
        accs.push(rawAcc <= 1 ? rawAcc * 100 : rawAcc);

        // Max Combo
        combos.push(Number(s.max_combo || 0));

        // Misses
        const missCount = s.statistics?.miss ?? s.statistics?.count_miss ?? 0;
        misses.push(Number(missCount));

        // PP
        pps.push(Number(s.pp || 0));

        // Extracción de Mods
        const rawMods = s.mods || [];
        const modsList = Array.isArray(rawMods)
            ? rawMods.map(m => typeof m === 'string' ? m : (m.acronym || '')).filter(Boolean)
            : (typeof rawMods === 'string' ? rawMods.match(/.{1,2}/g) || [] : []);
        const upperMods = modsList.map(m => m.toUpperCase());
        const modsSet = new Set(upperMods);

        const isDT = modsSet.has("DT") || modsSet.has("NC");
        const isHT = modsSet.has("HT") || modsSet.has("DC");
        const isHR = modsSet.has("HR");
        const isEZ = modsSet.has("EZ");

        const bm = s.beatmap || {};

        // 1. Stars (Dificultad con Mods)
        let sVal = null;
        if (bm.id && bm.beatmapset_id) {
            const localOsuPath = path.join(beatmapBasePath, `${bm.beatmapset_id}`, `${bm.id}.osu`);
            if (fs.existsSync(localOsuPath)) {
                try {
                    const mapFileContent = fs.readFileSync(localOsuPath);
                    const mapInstance = new engine.Beatmap(mapFileContent);
                    const cleanMods = upperMods.filter(m => m !== 'CL');
                    const diffAttrs = new engine.Difficulty({
                        mods: cleanMods,
                        lazer: false,
                        mode: targetModeInt
                    }).calculate(mapInstance);
                    sVal = diffAttrs.stars;
                } catch {
                    sVal = null;
                }
            }
        }

        // Fallback analítico si el mapa no está en disco local
        if (sVal === null || !Number.isFinite(sVal)) {
            let baseSR = Number(bm.difficulty_rating || 0);
            if (isDT) baseSR *= 1.39;
            else if (isHT) baseSR *= 0.82;
            if (isHR) baseSR *= 1.07;
            else if (isEZ) baseSR *= 0.90;
            sVal = baseSR;
        }
        stars.push(sVal);

        // 2. BPM
        let bpm = Number(bm.bpm || 0);
        if (isDT) bpm *= 1.5;
        else if (isHT) bpm *= 0.75;
        bpms.push(bpm);

        // 3. HP
        let hp = Number(bm.drain != null ? bm.drain : 5);
        if (isHR) hp = Math.min(10, hp * 1.4);
        else if (isEZ) hp *= 0.5;
        hps.push(hp);

        // 4. CS
        let cs = Number(bm.cs != null ? bm.cs : 4);
        if (isHR) cs = Math.min(10, cs * 1.3);
        else if (isEZ) cs *= 0.5;
        css.push(cs);

        // 5. AR (Ajuste por mods según ventana temporal de ms)
        let baseAR = Number(bm.ar != null ? bm.ar : 9);
        if (isHR) baseAR = Math.min(10, baseAR * 1.4);
        else if (isEZ) baseAR *= 0.5;
        let arMs = baseAR < 5 ? (1800 - 120 * baseAR) : (1200 - 150 * (baseAR - 5));
        if (isDT) arMs /= 1.5;
        else if (isHT) arMs /= 0.75;
        let effAR = arMs > 1200 ? (1800 - arMs) / 120 : (5 + (1200 - arMs) / 150);
        ars.push(effAR);

        // 6. OD (Ajuste por mods según HitWindow300 ms)
        let baseOD = Number(bm.accuracy != null ? bm.accuracy : 8);
        let effBaseOD = isHR ? Math.min(10, baseOD * 1.4) : (isEZ ? baseOD * 0.5 : baseOD);
        let odMs = 80 - 6 * effBaseOD;
        if (isDT) odMs /= 1.5;
        else if (isHT) odMs /= 0.75;
        let effOD = (80 - odMs) / 6;
        ods.push(effOD);

        // 7. Length (hit_length o total_length escalado por velocidad)
        let len = Number(bm.hit_length || bm.total_length || 0);
        if (isDT) len /= 1.5;
        else if (isHT) len /= 0.75;
        lens.push(len);
    }

    const accSummary = summarize(accs);
    const comboSummary = summarize(combos);
    const missSummary = summarize(misses);
    const ppSummary = summarize(pps);
    const starsSummary = summarize(stars);
    const bpmSummary = summarize(bpms);
    const hpSummary = summarize(hps);
    const arSummary = summarize(ars);
    const csSummary = summarize(css);
    const odSummary = summarize(ods);
    const lenSummary = summarize(lens);

    return {
        count: topList.length,
        mode: mode,
        raw: {
            accuracy: accSummary,
            combo: comboSummary,
            misses: missSummary,
            pp: ppSummary,
            stars: starsSummary,
            bpm: bpmSummary,
            hp: hpSummary,
            ar: arSummary,
            cs: csSummary,
            od: odSummary,
            length: lenSummary
        },
        formatted: {
            accuracy: {
                min: accSummary.min.toFixed(2),
                avg: accSummary.avg.toFixed(2),
                max: accSummary.max.toFixed(2)
            },
            combo: {
                min: Math.round(comboSummary.min).toString(),
                avg: comboSummary.avg.toFixed(2),
                max: Math.round(comboSummary.max).toString()
            },
            misses: {
                min: Math.round(missSummary.min).toString(),
                avg: missSummary.avg.toFixed(2),
                max: Math.round(missSummary.max).toString()
            },
            pp: {
                min: ppSummary.min.toFixed(2),
                avg: ppSummary.avg.toFixed(2),
                max: ppSummary.max.toFixed(2)
            },
            stars: {
                min: starsSummary.min.toFixed(2),
                avg: starsSummary.avg.toFixed(2),
                max: starsSummary.max.toFixed(2)
            },
            bpm: {
                min: bpmSummary.min.toFixed(2),
                avg: bpmSummary.avg.toFixed(2),
                max: bpmSummary.max.toFixed(2)
            },
            hp: {
                min: hpSummary.min.toFixed(2),
                avg: hpSummary.avg.toFixed(2),
                max: hpSummary.max.toFixed(2)
            },
            ar: {
                min: arSummary.min.toFixed(2),
                avg: arSummary.avg.toFixed(2),
                max: arSummary.max.toFixed(2)
            },
            cs: {
                min: csSummary.min.toFixed(2),
                avg: csSummary.avg.toFixed(2),
                max: csSummary.max.toFixed(2)
            },
            od: {
                min: odSummary.min.toFixed(2),
                avg: odSummary.avg.toFixed(2),
                max: odSummary.max.toFixed(2)
            },
            length: {
                min: formatTime(lenSummary.min),
                avg: formatTime(lenSummary.avg),
                max: formatTime(lenSummary.max)
            }
        }
    };
}

/**
 * Calcula las métricas avanzadas y promedios propios de Sengo para la Página 2:
 * - Promedios de snipes / #1s nacionales (SR promedio, PP promedio, Acc promedio, mod dominante, mejores snipes)
 * - Desglose y promedio de habilidades cinéticas (SkillsModel)
 * - Rendimiento nacional y concentración de PP (Top 10 vs Total, tasa de FC)
 * - Ponderación real de mods (TwinModel) y gemelo más afín
 * 
 * @param {Object} params
 * @param {Object} params.user Perfil del usuario de osu!
 * @param {string} params.mode Modo de juego ('osu', 'taiko', 'fruits', 'mania')
 * @param {Array} params.topScores Mejores jugadas del usuario
 * @param {Array} params.nationalTops Puntuaciones #1 nacionales del usuario
 * @param {Array} params.twins Lista de gemelos encontrados
 * @param {Object} [params.skills] Habilidades ya calculadas con SkillsModel
 * @returns {Object}
 */
function calculateSengoInsights({ user, mode = 'osu', topScores = [], nationalTops = [], twins = [], skills = null }) {
    const SkillsModel = require('./SkillsModel.js');
    const TwinModel = require('./TwinModel.js');

    // 1. Desglose y promedios de Skills
    const resolvedSkills = skills || SkillsModel.analyzeSkills(topScores, false, mode);
    const skillKeys = resolvedSkills?.skillKeys || ['aim', 'speed', 'acc', 'reading'];

    let skillSum = 0;
    let highestSkillKey = skillKeys[0];
    let highestSkillVal = -1;
    const skillsValues = {};

    for (const k of skillKeys) {
        const val = Number(resolvedSkills?.[k] || 0);
        skillsValues[k] = val;
        skillSum += val;
        if (val > highestSkillVal) {
            highestSkillVal = val;
            highestSkillKey = k;
        }
    }
    const avgSkill = skillKeys.length > 0 ? (skillSum / skillKeys.length) : 0;

    // 2. Snipes y #1s Nacionales
    const snipesCount = Array.isArray(nationalTops) ? nationalTops.length : 0;
    let snipesStats = { count: 0 };
    if (snipesCount > 0) {
        let starSum = 0, ppSum = 0, accSum = 0;
        let maxPPScore = null;
        let maxStarsScore = null;
        const modCounts = {};

        for (const s of nationalTops) {
            const stars = parseFloat(s.ranked_beatmaps?.stars) || 0;
            const pp = parseFloat(s.pp) || 0;
            const rawAcc = parseFloat(s.accuracy) || 0;
            const acc = rawAcc <= 1 ? rawAcc * 100 : rawAcc;

            starSum += stars;
            ppSum += pp;
            accSum += acc;

            if (!maxPPScore || pp > (parseFloat(maxPPScore.pp) || 0)) {
                maxPPScore = s;
            }
            if (!maxStarsScore || stars > (parseFloat(maxStarsScore.ranked_beatmaps?.stars) || 0)) {
                maxStarsScore = s;
            }

            const m = (typeof s.mods === 'string' ? s.mods : (Array.isArray(s.mods) ? s.mods.join('') : 'NM')) || 'NM';
            modCounts[m] = (modCounts[m] || 0) + 1;
        }

        const dominantModEntry = Object.entries(modCounts).sort((a, b) => b[1] - a[1])[0];
        const dominantMod = dominantModEntry ? `${dominantModEntry[0]} (${Math.round((dominantModEntry[1] / snipesCount) * 100)}%)` : 'NM';

        snipesStats = {
            count: snipesCount,
            avgStars: (starSum / snipesCount).toFixed(2),
            avgPP: (ppSum / snipesCount).toFixed(1),
            avgAcc: (accSum / snipesCount).toFixed(2),
            dominantMod,
            maxPPScore: maxPPScore ? {
                pp: (parseFloat(maxPPScore.pp) || 0).toFixed(1),
                title: maxPPScore.ranked_beatmaps?.title || 'Beatmap',
                version: maxPPScore.ranked_beatmaps?.version || '',
                mods: maxPPScore.mods || 'NM',
                beatmapId: maxPPScore.beatmap_id
            } : null,
            maxStarsScore: maxStarsScore ? {
                stars: (parseFloat(maxStarsScore.ranked_beatmaps?.stars) || 0).toFixed(2),
                title: maxStarsScore.ranked_beatmaps?.title || 'Beatmap',
                version: maxStarsScore.ranked_beatmaps?.version || '',
                mods: maxStarsScore.mods || 'NM',
                beatmapId: maxStarsScore.beatmap_id
            } : null
        };
    }

    // 3. Tops, Concentración y Rendimiento Nacional
    const topsCount = topScores.length;
    let top10PP = 0;
    let fullPP = 0;
    let fcCount = 0;

    for (let i = 0; i < topsCount; i++) {
        const s = topScores[i];
        const p = parseFloat(s.pp) || 0;
        fullPP += p;
        if (i < 10) top10PP += p;

        const isFC = Boolean(
            s.legacy_perfect ||
            s.perfect ||
            (s.statistics && (s.statistics.count_miss === 0 || s.statistics.miss === 0))
        );
        if (isFC) fcCount++;
    }

    const avgTop10PP = topsCount >= 10 ? (top10PP / 10).toFixed(1) : (topsCount > 0 ? (top10PP / topsCount).toFixed(1) : '0.0');
    const avgFullPP = topsCount > 0 ? (fullPP / topsCount).toFixed(1) : '0.0';
    const ppDrop = (parseFloat(avgTop10PP) - parseFloat(avgFullPP)).toFixed(1);
    const fcRate = topsCount > 0 ? ((fcCount / topsCount) * 100).toFixed(1) : '0.0';

    // 4. Afinidad de Mods y Gemelo (Twins)
    let weightedMods = { DT: 0, HD: 0, HR: 0, NM: 100, FL: 0, EZ: 0 };
    try {
        weightedMods = TwinModel.calculatePpWeightedModStats(topScores);
    } catch {}

    let topTwin = null;
    if (Array.isArray(twins) && twins.length > 0) {
        topTwin = {
            username: twins[0].username,
            similarity: Math.round((twins[0].similarity || 0) * 100),
            country: twins[0].country_code || twins[0].country || ''
        };
    }

    let playstyle = 'Equilibrado / All-Rounder';
    if (weightedMods.DT >= 40) playstyle = '⚡ Velocidad / High BPM (DT)';
    else if (weightedMods.HR >= 40) playstyle = '🎯 Precisión / High CS (HR)';
    else if (weightedMods.HD >= 45 && weightedMods.DT < 25) playstyle = '👁️ Lectura Oculta (HD)';
    else if (weightedMods.NM >= 50) playstyle = '🛡️ Consistencia Clásica (NoMod)';
    else if (weightedMods.FL >= 15) playstyle = '🔦 Memorización Extrema (FL)';
    else if (weightedMods.EZ >= 15) playstyle = '🌀 Lectura / Baja Densidad (EZ)';

    return {
        skills: {
            keys: skillKeys,
            values: skillsValues,
            average: avgSkill.toFixed(2),
            dominantKey: highestSkillKey,
            keymodeInfo: resolvedSkills?.keymodeInfo || null
        },
        snipes: snipesStats,
        national: {
            country: (user?.country_code || user?.country?.code || 'VE').toUpperCase(),
            countryRank: user?.statistics?.country_rank || user?.country_rank || null,
            globalRank: user?.statistics?.global_rank || user?.global_rank || null,
            avgTop10PP,
            avgFullPP,
            ppDrop,
            fcRate,
            fcCount,
            topsCount
        },
        affinity: {
            mods: weightedMods,
            playstyle,
            topTwin
        }
    };
}

module.exports = {
    calculateTopStats: calculateTop100Statistics,
    calculateTop100Statistics,
    calculateSengoInsights,
    formatTime,
    summarize
};
