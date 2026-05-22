const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const axios = require('axios');
const rosu = require("rosu-pp-js");
const { v2 } = require('osu-api-extended');
const { getSupabaseClient } = require("../db/database.js");
const { loadToken, NewloadToken } = require('./OsuUserModel.js');

const userScoresCache = new Map();
const userTopScoresCache = new Map();
const activeTopScoresPromises = new Map();
const TOP_SCORES_CACHE_TTL = 300000; // 5 minutos

function setWithLimit(map, key, value, limit = 100) {
    if (map.size >= limit) {
        const firstKey = map.keys().next().value;
        map.delete(firstKey);
    }
    map.set(key, value);
}

function clearUserScoresCache(userId) {
    if (!userId) return;
    for (const key of userScoresCache.keys()) {
        if (key.startsWith(`${userId}:`)) {
            userScoresCache.delete(key);
        }
    }
}

function isValidDate(dateStr) {
    if (!dateStr || dateStr === "null" || dateStr === "undefined" || dateStr === "NaN") return false;
    const d = new Date(dateStr);
    return !isNaN(d.getTime());
}

function normalizeStatistics(stats) {
    stats = stats || {};
    return {
        great: stats.great !== undefined ? stats.great : (stats.count_300 !== undefined ? stats.count_300 : 0),
        ok: stats.ok !== undefined ? stats.ok : (stats.count_100 !== undefined ? stats.count_100 : 0),
        meh: stats.meh !== undefined ? stats.meh : (stats.count_50 !== undefined ? stats.count_50 : 0),
        miss: stats.miss !== undefined ? stats.miss : (stats.count_miss !== undefined ? stats.count_miss : 0),
        perfect: stats.perfect !== undefined ? stats.perfect : (stats.count_geki !== undefined ? stats.count_geki : 0),
        good: stats.good !== undefined ? stats.good : (stats.count_katu !== undefined ? stats.count_katu : 0),
        large_tick_hit: stats.large_tick_hit !== undefined ? stats.large_tick_hit : 0,
        slider_tail_hit: stats.slider_tail_hit !== undefined ? stats.slider_tail_hit : 0,
        ignore_hit: stats.ignore_hit !== undefined ? stats.ignore_hit : 0,
        small_tick_miss: stats.small_tick_miss !== undefined ? stats.small_tick_miss : 0
    };
}

function normalizeScore(score) {
    if (!score) return null;
    
    score.statistics = normalizeStatistics(score.statistics);
    
    let resolvedEndedAt = null;
    if (isValidDate(score.ended_at)) {
        resolvedEndedAt = new Date(score.ended_at).toISOString();
    } else if (isValidDate(score.created_at)) {
        resolvedEndedAt = new Date(score.created_at).toISOString();
    } else {
        resolvedEndedAt = new Date().toISOString();
    }
    score.ended_at = resolvedEndedAt;

    if (score.started_at && isValidDate(score.started_at)) {
        score.started_at = new Date(score.started_at).toISOString();
    } else {
        score.started_at = null;
    }
    
    const rawLegacy = score.legacy_total_score !== undefined && score.legacy_total_score !== null ? Number(score.legacy_total_score) : null;
    const rawClassic = score.classic_total_score !== undefined && score.classic_total_score !== null ? Number(score.classic_total_score) : null;
    const rawTotal = score.total_score !== undefined && score.total_score !== null ? Number(score.total_score) : null;
    const rawScore = score.score !== undefined && score.score !== null ? Number(score.score) : null;

    const resolvedLegacy = (rawLegacy !== null && rawLegacy > 0) ? rawLegacy : (rawClassic !== null && rawClassic > 0 ? rawClassic : (rawScore !== null ? rawScore : 0));
    const resolvedTotal = rawTotal !== null ? rawTotal : (rawScore !== null ? rawScore : 0);
    const resolvedClassic = (rawClassic !== null && rawClassic > 0) ? rawClassic : (rawLegacy !== null && rawLegacy > 0 ? rawLegacy : (rawScore !== null ? rawScore : 0));
    const resolvedScore = (rawScore !== null && rawScore > 0) ? rawScore : (rawClassic !== null && rawClassic > 0 ? rawClassic : (rawLegacy !== null && rawLegacy > 0 ? rawLegacy : (rawTotal !== null && rawTotal > 0 ? rawTotal : 0)));

    score.legacy_total_score = resolvedLegacy;
    score.total_score = resolvedTotal;
    score.classic_total_score = resolvedClassic;
    score.score = resolvedScore;

    return score;
}

function convertGatariMods(modsBitmask) {
    const ModList = [
        { bit: 1, acronym: 'NF' },
        { bit: 2, acronym: 'EZ' },
        { bit: 8, acronym: 'HD' },
        { bit: 16, acronym: 'HR' },
        { bit: 32, acronym: 'SD' },
        { bit: 64, acronym: 'DT' },
        { bit: 128, acronym: 'RX' },
        { bit: 256, acronym: 'HT' },
        { bit: 512, acronym: 'NC' },
        { bit: 1024, acronym: 'FL' },
        { bit: 4096, acronym: 'SO' },
        { bit: 16384, acronym: 'PF' }
    ];
    let mods = [];
    for (let mod of ModList) {
        if ((modsBitmask & mod.bit) === mod.bit) {
            if (mod.acronym === 'NC') mods = mods.filter(m => m.acronym !== 'DT');
            if (mod.acronym === 'PF') mods = mods.filter(m => m.acronym !== 'SD');
            mods.push({ acronym: mod.acronym });
        }
    }
    return mods;
}

/**
 * Calcula el rendimiento (PP) y el PP teórico en caso de Full Combo.
 */
function calculatePP(recent_scores, map, maximo_pp, Attrs) {
    normalizeScore(recent_scores);
    const { great = 0, ok = 0, meh = 0, miss = 0 } = recent_scores.statistics;

    const max_perfomance_constructor = { 
        mods: recent_scores.mods, 
        lazer: recent_scores.started_at ? true : false,
    };

    const difficulty_constructor = {
        ...max_perfomance_constructor,
        maxCombo: recent_scores.max_combo,
        misses: miss,
        n300: great,
        n100: ok,
        n50: meh
    };

    if (recent_scores.statistics.large_tick_hit !== undefined) difficulty_constructor.largeTickHits = recent_scores.statistics.large_tick_hit;
    if (recent_scores.statistics.slider_tail_hit !== undefined) difficulty_constructor.sliderEndHits = recent_scores.statistics.slider_tail_hit;
    if (recent_scores.statistics.ignore_hit !== undefined) difficulty_constructor.smallTickHits = recent_scores.statistics.ignore_hit;

    if (maximo_pp) {
        const maxAttrs = new rosu.Performance(max_perfomance_constructor).calculate(Attrs ? Attrs : map);
        return maxAttrs;
    }

    const total_hits = great + ok + meh + miss;
    const difficulty = new rosu.Difficulty(max_perfomance_constructor);
    return difficulty.gradualPerformance(map).nth(difficulty_constructor, total_hits);
}

/**
 * Obtiene puntuaciones locales (unranked) guardadas en la base de datos de Supabase.
 */
async function getUnrankedBeatmapUserAllScores(parsed_args) {
    const beatmapId = parsed_args.beatmap_url;
    const userId = parsed_args.username[0].toString();
    const supabase = getSupabaseClient();

    if (!supabase) {
        console.warn("⚠️ Supabase no está conectado.");
        return [];
    }

    try {
        const { data, error } = await supabase
            .from('local_scores')
            .select('*')
            .eq('beatmap_id', beatmapId.toString())
            .eq('user_id', userId.toString())
            .order('pp', { ascending: false });

        if (error) {
            console.error('❌ Error obteniendo las puntuaciones de Supabase:', error.message);
            return [];
        }

        return data || [];
    } catch (error) {
        console.error('Error obteniendo las puntuaciones unranked:', error);
        return [];
    }
}

/**
 * Obtiene jugadas recientes del usuario.
 */
async function getUserRecentScores(parsed_args) {
    if (parsed_args && parsed_args.username && parsed_args.username[0]) {
        clearUserScoresCache(parsed_args.username[0]);
    }
    const server = parsed_args.server || 'bancho';
    let result = [];

    if (server === 'gatari') {
        try {
            const modeMap = { 'osu': 0, 'taiko': 1, 'fruits': 2, 'mania': 3 };
            const m = modeMap[parsed_args.gamemode || 'osu'];
            
            const reqUrl = `https://api.gatari.pw/user/scores/recent?id=${parsed_args.username[0]}&mode=${m}&l=100`;
            const response = await fetch(reqUrl);
            const data = await response.json();
            
            if (data.scores && data.scores.length > 0) {
                const userResponse = await fetch(`https://api.gatari.pw/users/get?u=${parsed_args.username[0]}`);
                const userData = await userResponse.json();
                const u = userData.users && userData.users[0] ? userData.users[0] : { username: "Unknown", id: parsed_args.username[0], country: "XX" };

                result = data.scores.map(s => {
                    const passed = s.ranking !== "F";
                    return {
                        accuracy: s.accuracy / 100,
                        passed: passed,
                        rank: s.ranking,
                        mods: convertGatariMods(s.mods),
                        max_combo: s.max_combo,
                        statistics: {
                            perfect: s.count_gekis,
                            great: s.count_300,
                            good: s.count_katu,
                            ok: s.count_100,
                            meh: s.count_50,
                            miss: s.count_miss
                        },
                        pp: s.pp,
                        total_score: s.score,
                        legacy_total_score: s.score,
                        ended_at: new Date(s.time * 1000).toISOString(),
                        beatmap: {
                            id: s.beatmap.beatmap_id,
                            version: s.beatmap.version,
                            difficulty_rating: s.beatmap.difficulty,
                            mode: parsed_args.gamemode || 'osu',
                            beatmapset_id: s.beatmap.beatmapset_id
                        },
                        beatmapset: {
                            title: s.beatmap.title,
                            covers: { "cover@2x": `https://assets.ppy.sh/beatmaps/${s.beatmap.beatmapset_id}/covers/cover@2x.jpg` }
                        },
                        user: {
                            username: u.username,
                            id: u.id,
                            country_code: u.country,
                            avatar_url: `https://a.gatari.pw/${u.id}`,
                            server: 'gatari'
                        }
                    };
                });
            }
        } catch (e) {
            console.error("Error fetching gatari recent scores:", e);
        }
    } else {
        await NewloadToken();
        try {
            let globalToken = null;
            try {
                const tokenData = JSON.parse(fs.readFileSync('./osu_token.json', 'utf8'));
                globalToken = tokenData.access_token;
            } catch (err) {
                console.error("Error al leer osu_token.json:", err);
            }

            if (!globalToken) {
                throw new Error("No global token available");
            }

            const urlObj = new URL(`https://osu.ppy.sh/api/v2/users/${parsed_args.username[0]}/scores/recent`);
            urlObj.searchParams.append('mode', parsed_args.gamemode || "osu");
            urlObj.searchParams.append('include_fails', '1');
            urlObj.searchParams.append('limit', '100');

            const apiRes = await fetch(urlObj.toString(), {
                headers: {
                    'Authorization': `Bearer ${globalToken}`,
                    'Content-Type': 'application/json',
                    'x-api-version': '20240728'
                }
            });

            if (apiRes.ok) {
                result = await apiRes.json();
            } else {
                throw new Error(`Status ${apiRes.status}`);
            }
        } catch (e) {
            console.error("Error fetching recent scores via fetch:", e);
            try {
                result = await v2.scores.list({
                    type: 'user_recent',
                    user_id: parsed_args.username[0],
                    mode: parsed_args.gamemode || "osu",
                    include_fails: true,
                    limit: 100,
                });
            } catch (err) {
                console.error("Error in v2.scores.list user_recent fallback:", err);
            }
        }
    }

    if (Array.isArray(result)) {
        result.forEach(normalizeScore);
    }
    return result;
}

/**
 * Obtiene las mejores jugadas de un usuario (top plays), con caché de 5 minutos y deduplicador.
 */
async function getUserTopScores(parsed_args) {
    const server = parsed_args.server || 'bancho';
    const mode = parsed_args.gamemode || 'osu';
    const username = parsed_args.username[0];
    const key = `${username}:${mode}:${server}`;

    if (activeTopScoresPromises.has(key)) {
        try {
            await activeTopScoresPromises.get(key);
        } catch (e) {
            console.error(`[TOPSCORES-DEDUPLICATOR] La consulta de mejores puntuaciones en progreso para ${username} falló:`, e);
        }
        return getUserTopScores(parsed_args);
    }

    let resolveActivePromise;
    const p = new Promise(resolve => { resolveActivePromise = resolve; });
    activeTopScoresPromises.set(key, p);

    try {
        const result = await _getUserTopScores(parsed_args);
        return result;
    } finally {
        resolveActivePromise();
        activeTopScoresPromises.delete(key);
    }
}

async function _getUserTopScores(parsed_args) {
    const server = parsed_args.server || 'bancho';
    const mode = parsed_args.gamemode || 'osu';
    const username = parsed_args.username[0];
    const cacheKey = `${username}:${mode}:${server}`;
    const now = Date.now();
    const cached = userTopScoresCache.get(cacheKey);

    if (cached && (now - cached.timestamp) < TOP_SCORES_CACHE_TTL) {
        return cached.scores;
    }

    const returnAndCache = (scores) => {
        if (scores && Array.isArray(scores) && scores.length > 0) {
            setWithLimit(userTopScoresCache, cacheKey, { scores, timestamp: now });
        }
        return scores;
    };

    if (server === 'gatari') {
        try {
            const modeMap = { 'osu': 0, 'taiko': 1, 'fruits': 2, 'mania': 3 };
            const m = modeMap[parsed_args.gamemode || 'osu'];
            
            const reqUrl = `https://api.gatari.pw/user/scores/best?id=${parsed_args.username[0]}&mode=${m}&l=200`;
            const response = await fetch(reqUrl);
            const data = await response.json();
            
            if (!data.scores || data.scores.length === 0) return [];
            
            const userResponse = await fetch(`https://api.gatari.pw/users/get?u=${parsed_args.username[0]}`);
            const userData = await userResponse.json();
            const u = userData.users && userData.users[0] ? userData.users[0] : { username: "Unknown", id: parsed_args.username[0], country: "XX" };

            return returnAndCache(data.scores.map(s => {
                const passed = s.ranking !== "F";
                return {
                    accuracy: s.accuracy / 100,
                    passed: passed,
                    rank: s.ranking,
                    mods: convertGatariMods(s.mods),
                    max_combo: s.max_combo,
                    statistics: {
                        perfect: s.count_gekis,
                        great: s.count_300,
                        good: s.count_katu,
                        ok: s.count_100,
                        meh: s.count_50,
                        miss: s.count_miss
                    },
                    pp: s.pp,
                    total_score: s.score,
                    legacy_total_score: s.score,
                    ended_at: new Date(s.time * 1000).toISOString(),
                    beatmap: {
                        id: s.beatmap.beatmap_id,
                        version: s.beatmap.version,
                        difficulty_rating: s.beatmap.difficulty,
                        mode: parsed_args.gamemode || 'osu',
                        beatmapset_id: s.beatmap.beatmapset_id
                    },
                    beatmapset: {
                        title: s.beatmap.title,
                        covers: { "cover@2x": `https://assets.ppy.sh/beatmaps/${s.beatmap.beatmapset_id}/covers/cover@2x.jpg` }
                    },
                    user: {
                        username: u.username,
                        id: u.id,
                        country_code: u.country,
                        avatar_url: `https://a.gatari.pw/${u.id}`,
                        server: 'gatari'
                    }
                };
            }));
        } catch (e) {
            return [];
        }
    }

    await NewloadToken();

    try {
        let globalToken = null;
        try {
            const tokenData = JSON.parse(fs.readFileSync('./osu_token.json', 'utf8'));
            globalToken = tokenData.access_token;
        } catch (err) {
            console.error("Error al leer osu_token.json:", err);
        }

        if (!globalToken) {
            throw new Error("No global token available");
        }

        const fetchBest = async (offset) => {
            const urlObj = new URL(`https://osu.ppy.sh/api/v2/users/${parsed_args.username[0]}/scores/best`);
            urlObj.searchParams.append('mode', parsed_args.gamemode || "osu");
            urlObj.searchParams.append('limit', '100');
            urlObj.searchParams.append('offset', offset.toString());

            const apiRes = await fetch(urlObj.toString(), {
                headers: {
                    'Authorization': `Bearer ${globalToken}`,
                    'Content-Type': 'application/json',
                    'x-api-version': '20240728'
                }
            });

            if (apiRes.ok) {
                return await apiRes.json();
            } else {
                throw new Error(`Status ${apiRes.status}`);
            }
        };

        let result = [];
        const result1 = await fetchBest(0);
        if (!result1 || result1.length < 100) {
            result = result1 || [];
        } else {
            const result2 = await fetchBest(100);
            result = result1.concat(result2 || []);
        }

        if (Array.isArray(result)) {
            result.forEach(normalizeScore);
        }
        return returnAndCache(result);
    } catch (e) {
        console.error("Error fetching top scores via fetch:", e);
        try {
            const result1 = await v2.scores.list({
                type: 'user_best',
                user_id: parsed_args.username[0],
                mode: parsed_args.gamemode || "osu",
                limit: 100,
                offset: 0
            });

            if (!result1 || result1.length < 100) {
                const res = result1 || [];
                if (Array.isArray(res)) res.forEach(normalizeScore);
                return returnAndCache(res);
            }

            const result2 = await v2.scores.list({
                type: 'user_best',
                user_id: parsed_args.username[0],
                mode: parsed_args.gamemode || "osu",
                limit: 100,
                offset: 100
            });

            const res = result1.concat(result2 || []);
            if (Array.isArray(res)) res.forEach(normalizeScore);
            return returnAndCache(res);
        } catch (err) {
            console.error("Error al obtener mejores jugadas de Bancho en fallback:", err);
            return [];
        }
    }
}

/**
 * Obtiene los detalles de una score dada su ID online.
 */
async function getScoreDetails(score_id) {
    await NewloadToken();
    try {
        const result = await v2.scores.details({ id: score_id });
        if (result) normalizeScore(result);
        return result;
    } catch (e) {
        return null;
    }
}

/**
 * Obtiene la score de un usuario específico en un beatmap específico.
 */
async function getBeatmapUserScore(parsed_args) {
    const osu_token = await loadToken();
    const gamemode = parsed_args.gamemode || 'osu';
    const mods = parsed_args.mods || '';
    const beatmapId = parsed_args.beatmap_url;
    const userId = parsed_args.username[0];

    const url = `https://osu.ppy.sh/api/v2/beatmaps/${beatmapId}/scores/users/${userId}`;

    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${osu_token.access_token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'x-api-version': '20240728'
            },
            params: {
                legacy_only: 0,
                mode: gamemode,
                mods: mods
            }
        });

        if (response.data) normalizeScore(response.data);
        return response.data;
    } catch (error) {
        return null;
    }
}

/**
 * Obtiene todas las puntuaciones de un usuario en un beatmap específico (con caché de 30 segundos).
 */
async function getBeatmapUserAllScores(parsed_args) {
    const userId = parsed_args.username[0];
    const beatmapId = parsed_args.beatmap_url;
    const mode = parsed_args.gamemode || 'osu';
    const cacheKey = `${userId}:${beatmapId}:${mode}`;

    const cached = userScoresCache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.timestamp) < 30000) {
        return cached.scores;
    }

    await NewloadToken();

    let result = [];
    try {
        result = await v2.scores.list({
            type: 'user_beatmap_all',
            user_id: userId,
            beatmap_id: beatmapId,
            mode: mode,
        });
    } catch (e) {
        console.error("Error al obtener puntuaciones en v2.scores.list:", e);
    }

    // Buscamos también las locales (unranked), por si hay fallidas
    const local_scores = await getUnrankedBeatmapUserAllScores(parsed_args);  

    const allScores = result.concat(local_scores || []);
    if (Array.isArray(allScores)) {
        allScores.forEach(normalizeScore);
    }
    setWithLimit(userScoresCache, cacheKey, { scores: allScores, timestamp: now });

    return allScores;
}

/**
 * Obtiene las jugadas recientes usando osu-web.js (usado en comandos antiguos).
 */
async function getRecentScores(parsed_args, limit = 5, page = 0, include_fails = true) {
    const osu_token = await loadToken();
    const gamemode = parsed_args.gamemode || 'osu';
    const { Client } = require('osu-web.js');

    try {
        const res = await new Client(osu_token.access_token).users.getUserScores(parsed_args.username[0], 'recent', {
            query: {
                limit: limit,
                mode: gamemode,
                offset: page,
                include_fails: include_fails
            }
        });

        const scoreObj = res[0];
        if (scoreObj) {
            if (Array.isArray(scoreObj)) {
                scoreObj.forEach(normalizeScore);
            } else {
                normalizeScore(scoreObj);
            }
        }
        return scoreObj;
    } catch (e) {
        console.error("Error en getUserScores heredado:", e);
        return null;
    }
}

/**
 * Guarda la puntuación de un usuario en la base de datos (local_scores) si cumple ciertas condiciones.
 */
async function saveUserscore(recent_scores, pre_calculated, force_save = false) {
    normalizeScore(recent_scores);
    const unranked_statuses = new Set(['pending', 'graveyard', 'qualified']);

    const score = {
        "accuracy": recent_scores.accuracy,
        "ended_at": recent_scores.ended_at,
        "legacy_total_score": recent_scores.legacy_total_score,
        "max_combo": recent_scores.max_combo,
        "statistics": recent_scores.statistics,
        "mods": recent_scores.mods || [],
        "passed": recent_scores.passed !== undefined ? recent_scores.passed : true,
        "pp": pre_calculated.pp,
        "rank": recent_scores.rank,
        "started_at": recent_scores.started_at,
        "total_score": recent_scores.total_score,
        "username": recent_scores.user?.username || `User ${recent_scores.user_id}`,
        "map_completion": pre_calculated.map_completion,
        "beatmap_max_combo": pre_calculated.beatmap_max_combo,
        "beatmap_status": recent_scores.beatmap.status,
        "beatmap_id": recent_scores.beatmap.id.toString(),
        "user_id": (recent_scores.user_id || recent_scores.user?.id || '').toString(),
        "country_code": recent_scores.user?.country_code || null,
        "multi_failed": false,
        // Incluir classic_total_score temporalmente para que normalizeScore resuelva legacy_total_score correctamente en jugadores Lazer
        "classic_total_score": recent_scores.classic_total_score || null
    };

    normalizeScore(score);
    // Eliminar campos que no existen en la tabla de Supabase
    delete score.classic_total_score;
    delete score.score;

    // Play fallida en multi
    if(!score["passed"] && score["map_completion"] == 1) score.multi_failed = true;

    // Si es una play en un mapa unranked o es una play fallida, o si está forzado a guardar
    if (unranked_statuses.has(recent_scores.beatmap.status) || !score.passed || force_save) {
        const supabase = getSupabaseClient();

        if (!supabase) {
            console.warn("⚠️ Supabase no está conectado.");
            return;
        }

        try {
            // Si es una play fallida
            if (!score.passed) {
                // Buscar si ya existe una score fallida del mismo tipo (solo o multi)
                const { data: existingFails, error: selectError } = await supabase
                    .from('local_scores')
                    .select('*')
                    .eq('beatmap_id', score.beatmap_id)
                    .eq('user_id', score.user_id)
                    .eq('passed', false)
                    .eq('multi_failed', score.multi_failed);

                if (selectError) throw selectError;

                const existingScore = existingFails && existingFails[0];

                if (existingScore) {
                    // Reemplazar si es la misma play (mismo timestamp o misma puntuación) o si es mejor
                    const samePlay = existingScore.ended_at === score.ended_at || 
                                     Number(existingScore.legacy_total_score) === Number(score.legacy_total_score);
                    
                    const isBetter = score.multi_failed ? 
                        (score.pp > existingScore.pp) : 
                        (score.map_completion > existingScore.map_completion);

                    if (samePlay || isBetter) {
                        const { error: updateError } = await supabase
                            .from('local_scores')
                            .update(score)
                            .eq('id', existingScore.id);
                        
                        if (updateError) throw updateError;
                    }
                } else {
                    const { error: insertError } = await supabase
                        .from('local_scores')
                        .insert(score);
                    
                    if (insertError) throw insertError;
                }
            } else {
                // Obtener todas las puntuaciones pasadas existentes
                const { data: existingPassed, error: selectError } = await supabase
                    .from('local_scores')
                    .select('*')
                    .eq('beatmap_id', score.beatmap_id)
                    .eq('user_id', score.user_id)
                    .eq('passed', true);

                if (selectError) throw selectError;

                if (existingPassed && existingPassed.length > 0) {
                    // Encontrar la mejor de las existentes
                    const existingScore = existingPassed.reduce((a, b) => 
                        (Number(a.total_score || a.legacy_total_score || 0) > Number(b.total_score || b.legacy_total_score || 0) ? a : b)
                    );

                    const samePlay = existingScore.ended_at === score.ended_at || 
                                     Number(existingScore.legacy_total_score) === Number(score.legacy_total_score) ||
                                     existingScore.pp === score.pp;

                    const isBetter = Number(score.total_score || score.legacy_total_score || 0) >= Number(existingScore.total_score || existingScore.legacy_total_score || 0);

                    if (samePlay || isBetter) {
                        const { error: updateError } = await supabase
                            .from('local_scores')
                            .update(score)
                            .eq('id', existingScore.id);
                        
                        if (updateError) throw updateError;
                    }

                    // Limpiar duplicados si hubiera más de un registro en la base de datos
                    const idsToDelete = existingPassed.filter(s => s.id !== existingScore.id).map(s => s.id);
                    if (idsToDelete.length > 0) {
                        await supabase
                            .from('local_scores')
                            .delete()
                            .in('id', idsToDelete);
                    }
                } else {
                    const { error: insertError } = await supabase
                        .from('local_scores')
                        .insert(score);
                    
                    if (insertError) throw insertError;
                }
            }
        } catch (err) {
            console.error('❌ Error al guardar score en Supabase:', err.message);
        }
    }
}

module.exports = {
    normalizeScore,
    normalizeStatistics,
    calculatePP,
    getUnrankedBeatmapUserAllScores,
    getUserRecentScores,
    getUserTopScores,
    getScoreDetails,
    getBeatmapUserScore,
    getBeatmapUserAllScores,
    getRecentScores,
    saveUserscore
};
