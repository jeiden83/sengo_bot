const { v2 } = require('osu-api-extended');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const rosu = require("rosu-pp-js");
const { getSupabaseClient } = require("../db/database.js");
const OsuUserModel = require('./OsuUserModel.js');
const BeatmapModel = require('./BeatmapModel.js');
const { Collection } = require('discord.js');
const { osuApiQueue } = require('../utils/OsuApiQueue.js');


const userScoresCache = new Map();
const userTopScoresCache = new Map();
const activeTopScoresPromises = new Map();
const TOP_SCORES_CACHE_TTL = 300000; // 5 minutos

const activeGapPromises = new Map();
const gapDiskCacheInMemory = new Map();
const GAP_DISK_CACHE_TTL = 300000; // 5 minutos de vigencia en RAM antes de leer de disco

const userPreloadRegistry = new Map();
const PRELOAD_REGISTRY_TTL = 10 * 60 * 1000; // 10 minutos de expiración de sesión

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

    // Asegurar que el objeto score.user existe y tiene country_code si están disponibles a nivel raíz (p.ej. de filas de la BD)
    if (!score.user) {
        score.user = {};
    }
    if (!score.user.id && score.user_id) {
        score.user.id = Number(score.user_id);
    }
    if (!score.user.username && score.username) {
        score.user.username = score.username;
    }
    if (!score.user.country_code && score.country_code) {
        score.user.country_code = score.country_code;
    }

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
    const { great = 0, ok = 0, meh = 0, miss = 0, perfect = 0, good = 0, small_tick_miss = 0 } = recent_scores.statistics;

    let mode = recent_scores.mode;
    if (mode === undefined) {
        const rulesetMap = { 0: 'osu', 1: 'taiko', 2: 'fruits', 3: 'mania' };
        if (recent_scores.ruleset_id !== undefined) {
            mode = rulesetMap[recent_scores.ruleset_id];
        } else if (recent_scores.mode_int !== undefined) {
            mode = rulesetMap[recent_scores.mode_int];
        }
    }
    if (typeof mode === 'number') {
        const rulesetMap = { 0: 'osu', 1: 'taiko', 2: 'fruits', 3: 'mania' };
        mode = rulesetMap[mode] || 'osu';
    }
    mode = mode || 'osu';

    const rosuModeMap = {
        'osu': rosu.GameMode.Osu,
        'taiko': rosu.GameMode.Taiko,
        'fruits': rosu.GameMode.Catch,
        'mania': rosu.GameMode.Mania,
        0: rosu.GameMode.Osu,
        1: rosu.GameMode.Taiko,
        2: rosu.GameMode.Catch,
        3: rosu.GameMode.Mania
    };
    const activeMode = rosuModeMap[mode] !== undefined ? rosuModeMap[mode] : rosu.GameMode.Osu;

    if (map.mode !== activeMode) {
        try {
            map.convert(activeMode);
        } catch (err) {
            console.error("[calculatePP] Error al convertir el mapa:", err);
        }
    }

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
        n50: meh,
        nGeki: perfect,
        nKatu: (mode === 'fruits' || mode === 'catch') ? small_tick_miss : good
    };

    if (recent_scores.statistics.large_tick_hit !== undefined) {
        difficulty_constructor.largeTickHits = recent_scores.statistics.large_tick_hit;
        difficulty_constructor.osuLargeTickHits = recent_scores.statistics.large_tick_hit;
    }
    if (recent_scores.statistics.slider_tail_hit !== undefined) {
        difficulty_constructor.sliderEndHits = recent_scores.statistics.slider_tail_hit;
    }
    if (recent_scores.statistics.ignore_hit !== undefined) {
        difficulty_constructor.smallTickHits = recent_scores.statistics.ignore_hit;
        difficulty_constructor.osuSmallTickHits = recent_scores.statistics.ignore_hit;
    }

    if (maximo_pp) {
        const maxAttrs = new rosu.Performance(max_perfomance_constructor).calculate(Attrs ? Attrs : map);
        return maxAttrs;
    }

    let total_hits = great + ok + meh + miss;
    if (mode === 'mania') {
        total_hits = perfect + great + good + ok + meh + miss;
    } else if (mode === 'fruits') {
        total_hits = great + ok + meh + miss + small_tick_miss;
    }

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

    if (server === 'mameosu') {
        try {
            let userObj;
            try {
                userObj = await OsuUserModel.getOsuUser(parsed_args);
            } catch (e) {
                console.error("Error al obtener perfil de usuario para mameosu scores:", e);
                return [];
            }
            if (typeof userObj === 'string') {
                return [];
            }

            const modeMap = { 'osu': 0, 'taiko': 1, 'fruits': 2, 'mania': 3 };
            const m = modeMap[parsed_args.gamemode || 'osu'];
            
            const reqUrl = `https://api.mamesosu.net/v1/get_player_scores?id=${userObj.id}&scope=recent&mode=${m}&limit=100`;
            const response = await fetch(reqUrl, {
                headers: { 'User-Agent': 'osu!' }
            });
            const data = await response.json();
            
            if (data.scores && data.scores.length > 0) {
                result = data.scores.map(s => {
                    const passed = s.grade !== "F";
                    return {
                        accuracy: s.acc / 100,
                        passed: passed,
                        rank: s.grade,
                        mods: convertGatariMods(s.mods),
                        max_combo: s.max_combo,
                        statistics: {
                            perfect: s.ngeki,
                            great: s.n300,
                            good: s.nkatu,
                            ok: s.n100,
                            meh: s.n50,
                            miss: s.nmiss
                        },
                        pp: s.pp,
                        total_score: s.score,
                        legacy_total_score: s.score,
                        ended_at: new Date(s.play_time + 'Z').toISOString(),
                        beatmap: {
                            id: s.beatmap.id,
                            version: s.beatmap.version,
                            difficulty_rating: s.beatmap.diff,
                            mode: parsed_args.gamemode || 'osu',
                            beatmapset_id: s.beatmap.set_id
                        },
                        beatmapset: {
                            title: s.beatmap.title,
                            artist: s.beatmap.artist,
                            creator: s.beatmap.creator,
                            covers: { "cover@2x": `https://assets.ppy.sh/beatmaps/${s.beatmap.set_id}/covers/cover@2x.jpg` }
                        },
                        user: userObj
                    };
                });
            }
        } catch (e) {
            console.error("Error fetching mameosu recent scores:", e);
        }
    } else if (server === 'gatari') {
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
        await OsuUserModel.NewloadToken();
        try {
            let globalToken = null;
            try {
                const tokenData = JSON.parse(fs.readFileSync('./osu_api_extended_token.json', 'utf8'));
                globalToken = tokenData.access_token;
            } catch (err) {
                console.error("Error al leer osu_api_extended_token.json:", err);
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
                throw err;
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

    if (server === 'mameosu') {
        try {
            let userObj;
            try {
                userObj = await OsuUserModel.getOsuUser(parsed_args);
            } catch (e) {
                console.error("Error al obtener perfil de usuario para mameosu tops:", e);
                return [];
            }
            if (typeof userObj === 'string') {
                return [];
            }

            const modeMap = { 'osu': 0, 'taiko': 1, 'fruits': 2, 'mania': 3 };
            const m = modeMap[parsed_args.gamemode || 'osu'];
            
            const reqUrl = `https://api.mamesosu.net/v1/get_player_scores?id=${userObj.id}&scope=best&mode=${m}&limit=100`;
            const response = await fetch(reqUrl, {
                headers: { 'User-Agent': 'osu!' }
            });
            const data = await response.json();
            
            if (!data.scores || data.scores.length === 0) return [];
            
            return returnAndCache(data.scores.map(s => {
                const passed = s.grade !== "F";
                return {
                    accuracy: s.acc / 100,
                    passed: passed,
                    rank: s.grade,
                    mods: convertGatariMods(s.mods),
                    max_combo: s.max_combo,
                    statistics: {
                        perfect: s.ngeki,
                        great: s.n300,
                        good: s.nkatu,
                        ok: s.n100,
                        meh: s.n50,
                        miss: s.nmiss
                    },
                    pp: s.pp,
                    total_score: s.score,
                    legacy_total_score: s.score,
                    ended_at: new Date(s.play_time + 'Z').toISOString(),
                    beatmap: {
                        id: s.beatmap.id,
                        version: s.beatmap.version,
                        difficulty_rating: s.beatmap.diff,
                        mode: parsed_args.gamemode || 'osu',
                        beatmapset_id: s.beatmap.set_id
                    },
                    beatmapset: {
                        title: s.beatmap.title,
                        artist: s.beatmap.artist,
                        creator: s.beatmap.creator,
                        covers: { "cover@2x": `https://assets.ppy.sh/beatmaps/${s.beatmap.set_id}/covers/cover@2x.jpg` }
                    },
                    user: userObj
                };
            }));
        } catch (e) {
            console.error("Error fetching mameosu top scores:", e);
            return [];
        }
    } else if (server === 'gatari') {
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

    await OsuUserModel.NewloadToken();

    try {
        let globalToken = null;
        try {
            const tokenData = JSON.parse(fs.readFileSync('./osu_api_extended_token.json', 'utf8'));
            globalToken = tokenData.access_token;
        } catch (err) {
            console.error("Error al leer osu_api_extended_token.json:", err);
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
            throw err;
        }
    }
}

/**
 * Obtiene los detalles de una score dada su ID online.
 */
async function getScoreDetails(score_id) {
    await OsuUserModel.NewloadToken();
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
    const osu_token = await OsuUserModel.loadToken();
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

    await OsuUserModel.NewloadToken();

    let result = [];
    try {
        result = await v2.scores.list({
            type: 'user_beatmap_all',
            user_id: userId,
            beatmap_id: beatmapId,
            mode: mode,
        });
    } catch (e) {
        const errorStr = e.message || String(e);
        if (errorStr.includes("difficulty couldn't be found") || errorStr.includes("404")) {
            console.log(`[API] Nota: El mapa ${beatmapId} no tiene leaderboard o dificultad oficial en Bancho.`);
        } else {
            console.error("Error al obtener puntuaciones en v2.scores.list:", e);
        }
    }

    // Buscamos también las locales (unranked), por si hay fallidas
    const local_scores = await getUnrankedBeatmapUserAllScores(parsed_args);  

    const allScores = [];
    const seenEndedAt = new Set();

    if (Array.isArray(result)) {
        result.forEach(score => {
            normalizeScore(score);
            allScores.push(score);
            if (score.ended_at) {
                seenEndedAt.add(new Date(score.ended_at).getTime());
            }
        });
    }

    if (Array.isArray(local_scores)) {
        local_scores.forEach(score => {
            normalizeScore(score);
            const time = score.ended_at ? new Date(score.ended_at).getTime() : 0;
            let isDuplicate = false;

            if (time > 0) {
                for (const seenTime of seenEndedAt) {
                    if (Math.abs(seenTime - time) <= 1000) {
                        isDuplicate = true;
                        break;
                    }
                }
            }

            if (!isDuplicate) {
                const match = allScores.find(us => 
                    Number(us.legacy_total_score) === Number(score.legacy_total_score) &&
                    us.max_combo === score.max_combo &&
                    Math.abs((us.accuracy || 0) - (score.accuracy || 0)) < 0.0001
                );
                if (match) {
                    isDuplicate = true;
                }
            }

            if (!isDuplicate) {
                allScores.push(score);
                if (time > 0) {
                    seenEndedAt.add(time);
                }
            }
        });
    }

    setWithLimit(userScoresCache, cacheKey, { scores: allScores, timestamp: now });

    return allScores;
}

/**
 * Obtiene las jugadas recientes usando osu-web.js (usado en comandos antiguos).
 */
async function getRecentScores(parsed_args, limit = 5, page = 0, include_fails = true) {
    const osu_token = await OsuUserModel.loadToken();
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
    delete score.user;

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

                let exactDuplicate = null;
                if (existingPassed && existingPassed.length > 0) {
                    const time = score.ended_at ? new Date(score.ended_at).getTime() : 0;
                    exactDuplicate = existingPassed.find(existing => {
                        const exTime = existing.ended_at ? new Date(existing.ended_at).getTime() : 0;
                        const isSameTime = time > 0 && exTime > 0 && Math.abs(exTime - time) <= 1000;
                        
                        const isSameStats = Number(existing.legacy_total_score) === Number(score.legacy_total_score) &&
                                            existing.max_combo === score.max_combo &&
                                            Math.abs((existing.accuracy || 0) - (score.accuracy || 0)) < 0.0001;
                        
                        // Si tienen tiempos válidos y difieren por más de 5 segundos, son jugadas distintas
                        if (time > 0 && exTime > 0 && Math.abs(exTime - time) > 5000) {
                            return false;
                        }
                        
                        return isSameTime || isSameStats;
                    });
                }

                if (exactDuplicate) {
                    // Si es la misma play exacta, actualizamos sus campos (por si hay mejores cálculos de PP, etc.)
                    const { error: updateError } = await supabase
                        .from('local_scores')
                        .update(score)
                        .eq('id', exactDuplicate.id);
                    
                    if (updateError) throw updateError;
                } else {
                    // Si no es la misma play exacta, la insertamos como una nueva play
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

async function getNewBeatmapUserScores(beatmapId, usersArray, gamemode = 'osu', forceUpdate = false, logger = null, beatmapMetadata = null, isLazerMode = false) {
    const key = `${beatmapId}_${gamemode}`;
    if (!forceUpdate && activeGapPromises.has(key)) {
        if (logger) logger.process(`Deduplicador: Ya existe una consulta de gap en curso para el mapa ${beatmapId}. Esperando resolución...`);
        try {
            await activeGapPromises.get(key);
        } catch (e) {
            console.error(`[GAP-DEDUPLICATOR] La consulta en progreso para ${beatmapId} falló:`, e);
        }
        if (logger) logger.process(`Deduplicador: Consulta en curso finalizada. Cargando datos desde caché.`);
        return getNewBeatmapUserScores(beatmapId, usersArray, gamemode, false, logger, beatmapMetadata, isLazerMode);
    }

    let resolveActivePromise;
    if (!forceUpdate) {
        const p = new Promise(resolve => { resolveActivePromise = resolve; });
        activeGapPromises.set(key, p);
    }

    try {
        const result = await _getNewBeatmapUserScores(beatmapId, usersArray, gamemode, forceUpdate, logger, beatmapMetadata, isLazerMode);
        return result;
    } finally {
        if (resolveActivePromise) resolveActivePromise();
        if (!forceUpdate) activeGapPromises.delete(key);
    }
}

async function _getNewBeatmapUserScores(beatmapId, usersArray, gamemode = 'osu', forceUpdate = false, logger = null, beatmapMetadata = null, isLazerMode = false) {
    await OsuUserModel.NewloadToken();
    const scores = new Collection();

    const cacheDir = path.join(process.cwd(), 'db/local/gap_cache');
    const cacheFile = path.join(cacheDir, `${beatmapId}_${gamemode}.json`);

    const key = `${beatmapId}_${gamemode}`;
    const nowTime = Date.now();
    let cachedData = { updated_at: 0, scores: {} };

    const inMemoryEntry = gapDiskCacheInMemory.get(key);
    if (inMemoryEntry && (nowTime - inMemoryEntry.timestamp) < GAP_DISK_CACHE_TTL && !forceUpdate) {
        cachedData = inMemoryEntry.data;
    } else if (fs.existsSync(cacheFile) && !forceUpdate) {
        try {
            cachedData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            setWithLimit(gapDiskCacheInMemory, key, { data: cachedData, timestamp: nowTime });
        } catch (e) {
            console.error("Error al leer cache de gap:", e);
        }
    }

    const metadata = beatmapMetadata || await BeatmapModel.getBeatmap(beatmapId);
    const needsPP = metadata && (metadata.status === 'loved' || metadata.status === 'qualified');

    const supabase = getSupabaseClient();

    // Mezclar con los scores de Supabase y tokens en paralelo
    const tokenCountryCodes = {};
    let dbScores = null;
    let dbTokens = null;

    if (supabase) {
        try {
            const promises = [
                supabase
                    .from('oauth_tokens')
                    .select('discord_id, osu_id, username, access_token, refresh_token, expires_at, country_code')
            ];
            if (!forceUpdate) {
                promises.push(
                    supabase
                        .from('local_scores')
                        .select('*')
                        .eq('beatmap_id', beatmapId.toString())
                );
            }

            const results = await Promise.all(promises);
            const tokensRes = results[0];
            const scoresRes = results[1];

            if (tokensRes && !tokensRes.error && tokensRes.data) {
                dbTokens = tokensRes.data;
                for (const row of tokensRes.data) {
                    if (row.osu_id && row.country_code) {
                        tokenCountryCodes[row.osu_id.toString()] = row.country_code;
                    }
                }
            }
            if (scoresRes && !scoresRes.error && scoresRes.data) {
                dbScores = scoresRes.data;
            }
        } catch (e) {
            console.error("[GAP] Error en precarga paralela de Supabase:", e);
        }
    }

    if (dbScores && !forceUpdate) {
        try {
            // Agrupar por usuario y elegir la mejor play pasada (o la más reciente si no hay pasadas)
            const dbByUser = {};
            const knownCountryCodes = {};
            for (const row of dbScores) {
                const uId = row.user_id.toString();
                if (!dbByUser[uId]) dbByUser[uId] = [];
                dbByUser[uId].push(row);
                if (row.country_code) {
                    knownCountryCodes[uId] = row.country_code;
                }
            }

            for (const uId in dbByUser) {
                const rows = dbByUser[uId];
                // Priorizar plays pasadas sobre fallidas
                const passedRows = rows.filter(r => r.passed !== false);
                const bestRow = passedRows.length > 0
                    ? passedRows.reduce((a, b) => (Number(a.pp || 0) > Number(b.pp || 0) ? a : b))
                    : rows.reduce((a, b) => (new Date(a.ended_at).getTime() > new Date(b.ended_at).getTime() ? a : b));

                const row = bestRow;

                // Intentar recuperar el country_code faltante
                if (!row.country_code && knownCountryCodes[uId]) {
                    row.country_code = knownCountryCodes[uId];
                }
                if (!row.country_code && tokenCountryCodes[uId]) {
                    row.country_code = tokenCountryCodes[uId];
                }

                // Saltar scores claramente inválidas (legacy y total son 0, no tiene datos útiles de score)
                const hasValidScore = Number(row.legacy_total_score || 0) > 0 || Number(row.total_score || 0) > 0;
                if (!hasValidScore && row.passed !== false) {
                    // Score inválida (Lazer guardada sin classic_total_score), no usarla como caché
                    continue;
                }
                const rowEndedAtTime = new Date(row.ended_at).getTime();
                const existing = cachedData.scores[uId];
                const cachedEndedAtTime = existing ? new Date(existing.ended_at || 0).getTime() : 0;
                
                let shouldReplace = false;
                if (!existing || existing.noScore === true) {
                    shouldReplace = true;
                } else {
                    const rowPassed = row.passed !== false;
                    const existingPassed = existing.passed !== false;

                    if (rowPassed && !existingPassed) {
                        shouldReplace = true;
                    } else if (!rowPassed && existingPassed) {
                        shouldReplace = false;
                    } else {
                        // Ambos pasaron o ambos fallaron
                        if (rowPassed) {
                            // Ambos pasaron: comparar por pp o score según el estado del mapa
                            const isLoved = metadata && metadata.status === 'loved';
                            if (isLoved) {
                                const rowScore = Number(row.legacy_total_score || row.total_score || 0);
                                const existingScore = Number(existing.legacy_total_score || existing.total_score || 0);
                                shouldReplace = rowScore > existingScore;
                            } else {
                                const rowPP = Number(row.pp || 0);
                                const existingPP = Number(existing.pp || 0);
                                shouldReplace = rowPP > existingPP;
                            }
                        } else {
                            // Ambos fallaron: comparar por map_completion o combo
                            const rowCompletion = Number(row.map_completion || 0);
                            const existingCompletion = Number(existing.map_completion || 0);
                            if (rowCompletion !== existingCompletion) {
                                shouldReplace = rowCompletion > existingCompletion;
                            } else {
                                shouldReplace = rowEndedAtTime > cachedEndedAtTime;
                            }
                        }
                    }
                }
                
                if (shouldReplace) {
                    const mappedScore = {
                        id: Number(row.id),
                        accuracy: row.accuracy,
                        ended_at: row.ended_at,
                        started_at: row.started_at,
                        legacy_total_score: Number(row.legacy_total_score),
                        total_score: Number(row.total_score),
                        max_combo: row.max_combo,
                        statistics: row.statistics || {},
                        mods: row.mods || [],
                        passed: row.passed,
                        pp: row.pp,
                        rank: row.rank,
                        map_completion: row.map_completion,
                        beatmap: {
                            id: Number(row.beatmap_id),
                            status: row.beatmap_status
                        },
                        user: {
                            id: Number(row.user_id),
                            username: row.username,
                            country_code: row.country_code
                        },
                        user_id: Number(row.user_id),
                        // Si le falta country_code, marcar como expirado para que la API lo refresque
                        fetched_at: row.country_code ? new Date(row.created_at).getTime() : 0
                    };
                    normalizeScore(mappedScore);
                    cachedData.scores[uId] = mappedScore;
                }
            }
        } catch (err) {
            console.error("[GAP] Error al mezclar cache de Supabase en getNewBeatmapUserScores:", err);
        }
    }

    let tokenPool = [];
    let tokenIndex = 0;

    if (supabase && dbTokens) {
        try {
            const OsuUserModel = require("./OsuUserModel.js");
            const refreshed = await Promise.all(dbTokens.map(async (row) => {
                try {
                    const token = await OsuUserModel.getValidTokenForUser(row.discord_id, 2, row);
                    if (token) {
                        return {
                            token,
                            username: row.username || row.discord_id
                        };
                    }
                } catch (err) {
                    console.error(`[GAP] Error al refrescar token para el usuario ${row.discord_id} en la pool:`, err);
                }
                return null;
            }));
            tokenPool = refreshed.filter(t => t !== null);
        } catch (e) {
            console.error("[GAP] Error al cargar la pool de tokens OAuth:", e);
        }
    }

    if (tokenPool.length > 0 && logger) {
        logger.process(`Pool de tokens OAuth cargada con ${tokenPool.length} tokens activos.`);
    }

    let mapInstance = null;
    let cacheModified = false;
    let processedCount = 0;
    let errorCount = 0;
    let rateLimitCount = 0;

    try {
        if (needsPP) {
            try {
                mapInstance = await BeatmapModel.getBeatmap_osu(metadata.beatmapset_id, metadata.id, metadata);
            } catch (e) {
                console.error("[GAP] Error al cargar el beatmap para el cálculo de PP:", e);
            }
        }

        const usersToFetch = [];
        const now = Date.now();
        const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas

        // Poblamos con los scores cacheados válidos
        for (const user of usersArray) {
            const cachedScore = cachedData.scores[user.osu_id];
            if (cachedScore) {
                if (!cachedScore.country_code && tokenCountryCodes[user.osu_id.toString()]) {
                    cachedScore.country_code = tokenCountryCodes[user.osu_id.toString()];
                    cacheModified = true;
                }
                if (!cachedScore.user) {
                    cachedScore.user = {};
                }
                if (!cachedScore.user.country_code && tokenCountryCodes[user.osu_id.toString()]) {
                    cachedScore.user.country_code = tokenCountryCodes[user.osu_id.toString()];
                    cacheModified = true;
                }
                normalizeScore(cachedScore);
            }
            let isFresh = false;
            if (cachedScore) {
                const fetchedAt = cachedScore.fetched_at || cachedData.updated_at || 0;
                isFresh = (now - fetchedAt < CACHE_TTL) && !forceUpdate;
            }
            if (cachedScore && isFresh) {
                if (cachedScore.noScore !== true) {
                    // Si necesita PP y no lo tiene, lo calculamos
                    if (mapInstance && (cachedScore.pp === undefined || cachedScore.pp === null || cachedScore.pp === 0)) {
                        try {
                            const ppResult = calculatePP(cachedScore, mapInstance);
                            cachedScore.pp = ppResult.pp;
                            cachedData.scores[user.osu_id] = cachedScore;
                            cacheModified = true;
                        } catch (err) {
                            console.error(`[GAP] Error al calcular el PP para el usuario en caché ${user.osu_id}:`, err);
                        }
                    }
                    scores.set(user.osu_id.toString(), cachedScore);
                }
            } else {
                usersToFetch.push(user);
            }
        }

        if (logger) {
            const cachedCount = usersArray.length - usersToFetch.length;
            if (cachedCount > 0) {
                logger.process(`Caché: Usando puntuaciones de ${cachedCount} usuarios (recientes)`);
            }
            if (usersToFetch.length > 0) {
                logger.process(`Consultando osu! API para ${usersToFetch.length} usuarios (faltantes o expirados)`);
            }
        }

        if (usersToFetch.length > 0) {
            let supporterToken = null;
            let supporterUsername = null;

            if (!forceUpdate) {
                if (process.env.OWNER_ID) {
                    try {
                        const tokenRecord = await OsuUserModel.getOAuthTokenRecord(process.env.OWNER_ID);
                        if (tokenRecord) {
                            const validToken = await OsuUserModel.getValidTokenForUser(process.env.OWNER_ID);
                            if (validToken) {
                                supporterToken = validToken;
                                supporterUsername = tokenRecord.username;
                            }
                        }
                    } catch (e) {
                        console.error("[GAP] Error al buscar token del owner:", e);
                    }
                }
            }

            let apiFriendScores = [];
            let useOptimization = false;

            if (supporterToken) {
                if (logger) logger.process(`[GAP] Intentando optimización usando el token de supporter de ${supporterUsername}`);
                try {
                    const legacyOnlyVal = isLazerMode ? 0 : 1;
                    const url = `https://osu.ppy.sh/api/v2/beatmaps/${beatmapId}/scores?mode=${gamemode}&type=friend&legacy_only=${legacyOnlyVal}`;
                    const response = await axios.get(url, {
                        headers: {
                            'Authorization': `Bearer ${supporterToken}`,
                            'Content-Type': 'application/json',
                            'x-api-version': '20240728'
                        }
                    });
                    apiFriendScores = response.data.scores || response.data || [];
                    useOptimization = true;
                } catch (e) {
                    console.error("[GAP] Error al obtener amigos de la API (es posible que el token no tenga supporter o esté inactivo):", e.message || e);
                }
            }

            if (useOptimization) {
                if (logger) logger.process(`[GAP] Optimizando consulta con éxito usando la lista de amigos del supporter`);
                for (const user of usersToFetch) {
                    const uId = user.osu_id.toString();
                    const apiScore = apiFriendScores.find(s => s.user_id?.toString() === uId || (s.user && s.user.id?.toString() === uId));
                    if (apiScore) {
                        normalizeScore(apiScore);
                        delete apiScore.beatmap;
                        delete apiScore.beatmapset;

                        if (mapInstance && (apiScore.pp === undefined || apiScore.pp === null || apiScore.pp === 0)) {
                            try {
                                const ppResult = calculatePP(apiScore, mapInstance);
                                apiScore.pp = ppResult.pp;
                            } catch (err) {
                                console.error(`[GAP] Error al calcular el PP para el usuario en listado de amigos ${user.osu_id}:`, err);
                            }
                        }

                        apiScore.fetched_at = Date.now();
                        scores.set(uId, apiScore);
                        cachedData.scores[user.osu_id] = apiScore;
                        cacheModified = true;
                        processedCount++;

                        const beatmap_max_combo = mapInstance ? (mapInstance.maxCombo || 0) : 0;
                        const { great = 0, ok = 0, meh = 0, miss = 0 } = apiScore.statistics || {};
                        const total_hits = great + ok + meh + miss;
                        const map_completion = apiScore.passed ? 100 : (mapInstance && mapInstance.nObjects > 0 ? total_hits / mapInstance.nObjects : 0);

                        const pre_calculated = {
                            pp: apiScore.pp,
                            beatmap_max_combo,
                            map_completion
                        };

                        const scoreToSave = {
                            ...apiScore,
                            beatmap: {
                                id: beatmapId,
                                status: metadata?.status || 'ranked'
                            },
                            user: {
                                username: apiScore.user?.username || user.username || `User ${user.osu_id}`,
                                country_code: apiScore.user?.country_code || null
                            },
                            user_id: user.osu_id
                        };

                        saveUserscore(scoreToSave, pre_calculated, true).catch(err => {
                            console.error(`[GAP] Error al guardar score de user ${user.osu_id} en Supabase:`, err);
                        });
                    } else {
                        // Si no está en el listado de amigos de la API:
                        // Conservamos el score de la base de datos local (cargado en cachedData.scores), si existe.
                        const existingScore = cachedData.scores[user.osu_id];
                        if (existingScore && existingScore.noScore !== true) {
                            if (mapInstance && (existingScore.pp === undefined || existingScore.pp === null || existingScore.pp === 0)) {
                                try {
                                    const ppResult = calculatePP(existingScore, mapInstance);
                                    existingScore.pp = ppResult.pp;
                                } catch (err) {
                                    console.error(`[GAP] Error al calcular el PP para el usuario en caché ${user.osu_id}:`, err);
                                }
                            }
                            existingScore.fetched_at = Date.now();
                            cachedData.scores[user.osu_id] = existingScore;
                            cacheModified = true;
                            scores.set(uId, existingScore);
                        } else {
                            // Si tampoco tiene score en la BD local ni en amigos de la API, marcar como noScore
                            cachedData.scores[user.osu_id] = { noScore: true, fetched_at: Date.now() };
                            cacheModified = true;
                        }
                        processedCount++;
                    }
                }
            } else {
                const concurrencyLimit = Math.max(25, tokenPool.length);
                const chunkTokensUsed = [];
                let nextIndex = 0;
                let lastLogTime = 0;
                let lastRequestTime = 0;
                const delayBetweenRequests = 90; // Espaciado mínimo de 90ms entre inicios de peticiones para evitar 429 por IP (burst limit)

                const executeWorker = async () => {
                    while (nextIndex < usersToFetch.length) {
                        const user = usersToFetch[nextIndex++];
                        if (!user) break;

                        const nowLaunch = Date.now();
                        const timeToWait = Math.max(0, lastRequestTime + delayBetweenRequests - nowLaunch);
                        lastRequestTime = nowLaunch + timeToWait;
                        if (timeToWait > 0) {
                            await new Promise(resolve => setTimeout(resolve, timeToWait));
                        }

                        try {
                            let result = null;
                            let success = false;
                            let useBotToken = false;
                            let tokenName = 'Bot';

                            if (tokenPool.length > 0) {
                                const tokenObj = tokenPool[tokenIndex % tokenPool.length];
                                tokenIndex++;
                                const token = tokenObj.token;
                                tokenName = tokenObj.username;
                                chunkTokensUsed.push(tokenName);

                                try {
                                    const url = `https://osu.ppy.sh/api/v2/beatmaps/${beatmapId}/scores/users/${user.osu_id}?mode=${gamemode}`;
                                    const response = await osuApiQueue.add(() => axios.get(url, {
                                        headers: {
                                            'Authorization': `Bearer ${token}`,
                                            'Content-Type': 'application/json',
                                            'Accept': 'application/json',
                                            'x-api-version': '20240728'
                                        }
                                    }));
                                    result = response.data;
                                    success = true;
                                } catch (error) {
                                    const status = error.response?.status;
                                    if (status === 404) {
                                        result = null;
                                        success = true;
                                    } else {
                                        const errorMsg = error.response?.data ? ` | Detalles: ${JSON.stringify(error.response.data)}` : '';
                                        console.warn(`[GAP] Petición fallida para user_id ${user.osu_id} con token de la pool (${tokenName}) (estado ${status})${errorMsg}. Reintentando con token del bot...`);
                                        useBotToken = true;
                                    }
                                }
                            } else {
                                useBotToken = true;
                            }

                            if (useBotToken && !success) {
                                try {
                                    result = await osuApiQueue.add(() => v2.scores.list({
                                        type: 'user_beatmap_best',
                                        beatmap_id: beatmapId,
                                        user_id: user.osu_id,
                                        mode: gamemode
                                    }));
                                    success = true;
                                } catch (error) {
                                    throw error;
                                }
                            }

                            if (success) {
                                processedCount++;
                                if (result && result.score) {
                                    normalizeScore(result.score);
                                    delete result.score.beatmap;
                                    delete result.score.beatmapset;

                                    if (mapInstance && (result.score.pp === undefined || result.score.pp === null || result.score.pp === 0)) {
                                        try {
                                            const ppResult = calculatePP(result.score, mapInstance);
                                            result.score.pp = ppResult.pp;
                                        } catch (err) {
                                            console.error(`[GAP] Error al calcular el PP para el usuario ${user.osu_id}:`, err);
                                        }
                                    }

                                    result.score.fetched_at = Date.now();
                                    scores.set(user.osu_id.toString(), result.score);
                                    cachedData.scores[user.osu_id] = result.score;
                                    cacheModified = true;

                                    const scoreObj = result.score;
                                    const beatmap_max_combo = mapInstance ? (mapInstance.maxCombo || 0) : 0;
                                    const { great = 0, ok = 0, meh = 0, miss = 0 } = scoreObj.statistics || {};
                                    const total_hits = great + ok + meh + miss;
                                    const map_completion = scoreObj.passed ? 100 : (mapInstance && mapInstance.nObjects > 0 ? total_hits / mapInstance.nObjects : 0);

                                    const pre_calculated = {
                                        pp: scoreObj.pp,
                                        beatmap_max_combo: beatmap_max_combo,
                                        map_completion: map_completion
                                    };

                                    const scoreToSave = {
                                        ...scoreObj,
                                        beatmap: {
                                            id: beatmapId,
                                            status: metadata?.status || 'ranked'
                                        },
                                        user: {
                                            username: scoreObj.user?.username || user.username || `User ${user.osu_id}`,
                                            country_code: scoreObj.user?.country_code || null
                                        },
                                        user_id: user.osu_id
                                    };

                                    saveUserscore(scoreToSave, pre_calculated, true).catch(err => {
                                        console.error(`[GAP] Error al guardar score de user ${user.osu_id} en Supabase:`, err);
                                    });
                                } else {
                                    cachedData.scores[user.osu_id] = { noScore: true, fetched_at: Date.now() };
                                    cacheModified = true;
                                }
                            }
                        } catch (error) {
                            processedCount++;
                            errorCount++;
                            const status = error.status || error.response?.status;
                            const errorMsg = error.message || error;
                            const isNoScoreError = (typeof errorMsg === 'string' && (errorMsg.includes('empty error') || errorMsg.includes('404') || errorMsg.toLowerCase().includes('not found'))) || status === 404;

                            if (status === 429) {
                                rateLimitCount++;
                            } else if (isNoScoreError) {
                                cachedData.scores[user.osu_id] = { noScore: true, fetched_at: Date.now() };
                                cacheModified = true;
                            } else {
                                if (status !== 429) {
                                    console.error(`[GAP] Error de conexión/servidor al obtener score de osu_id ${user.osu_id}:`, errorMsg);
                                }
                            }
                        }

                        const now = Date.now();
                        if (logger && (processedCount % 10 === 0 || processedCount === usersToFetch.length || now - lastLogTime > 1500)) {
                            lastLogTime = now;
                            let errorDetails = errorCount > 0 ? ` | Errores: ${errorCount}` : "";
                            if (rateLimitCount > 0) {
                                errorDetails += ` (429 RateLimit: ${rateLimitCount})`;
                            }
                            logger.process(`Progreso API: ${processedCount}/${usersToFetch.length} procesados${errorDetails}`);
                        }
                    }
                };

                const workers = [];
                const activeWorkers = Math.min(concurrencyLimit, usersToFetch.length);
                for (let w = 0; w < activeWorkers; w++) {
                    workers.push(executeWorker());
                }
                await Promise.all(workers);
            }
        }

        if (errorCount > 0) {
            const noScoreCount = errorCount - rateLimitCount;
            const limitStr = rateLimitCount > 0 ? `, ${rateLimitCount} rate limit (429)` : "";
            console.log(`[GAP] Sincronización finalizada: ${usersToFetch.length} consultados. ${noScoreCount} no tienen score registrada${limitStr}.`);
        }

        // Guardar la caché actualizada si hubo cambios
        if (cacheModified) {
            try {
                if (!fs.existsSync(cacheDir)) {
                    fs.mkdirSync(cacheDir, { recursive: true });
                }
                cachedData.updated_at = Date.now();
                fs.writeFileSync(cacheFile, JSON.stringify(cachedData, null, 2), 'utf8');
                setWithLimit(gapDiskCacheInMemory, key, { data: cachedData, timestamp: Date.now() });
            } catch (e) {
                console.error("Error al guardar cache de gap:", e);
            }
        }

    } finally {
        if (mapInstance) {
            try {
                mapInstance.free();
            } catch (e) {
                console.error("[GAP] Error freeing mapInstance:", e);
            }
        }
    }

    const unrankedScores = await getUnrankedUserScores(beatmapId, gamemode, usersArray);

    for (const [userId, score] of unrankedScores.entries()) {
        if (!scores.has(userId)) {
            scores.set(userId, score);
        }
    }

    if (logger) {
        let completionMsg = `Sincronización de scores completada. Total: ${scores.size} jugadas.`;
        if (errorCount > 0) {
            completionMsg += ` (Hubo ${errorCount} errores de conexión/rate limit)`;
        }
        logger.process(completionMsg);
    }

    return scores;
}

async function getUnrankedUserScores(beatmapId, gamemode = 'osu', usersArray = null) {
    const userScores = new Collection();
    const tokenCountryCodes = {};

    // 1. Intentar consultar Supabase si está disponible
    try {
        const supabase = getSupabaseClient();

        if (supabase) {
            const [scoresRes, tokensRes] = await Promise.all([
                supabase
                    .from('local_scores')
                    .select('*')
                    .eq('beatmap_id', beatmapId.toString()),
                supabase
                    .from('oauth_tokens')
                    .select('osu_id, country_code')
            ]);

            if (tokensRes && !tokensRes.error && tokensRes.data) {
                for (const row of tokensRes.data) {
                    if (row.osu_id && row.country_code) {
                        tokenCountryCodes[row.osu_id.toString()] = row.country_code;
                    }
                }
            }

            if (scoresRes.error) {
                console.error('❌ Error obteniendo scores locales de Supabase:', scoresRes.error.message);
            } else if (scoresRes.data && scoresRes.data.length > 0) {
                const data = scoresRes.data;
                // Agrupar todas las jugadas por user_id y recolectar códigos de país conocidos
                const tempUserScores = {};
                const knownCountryCodes = {};
                for (const row of data) {
                    const uId = row.user_id.toString();
                    if (!tempUserScores[uId]) tempUserScores[uId] = [];
                    tempUserScores[uId].push(normalizeScore(row));
                    if (row.country_code) {
                        knownCountryCodes[uId] = row.country_code;
                    }
                }

                const allowedOsuIds = usersArray ? new Set(usersArray.map(u => u.osu_id.toString())) : null;

                // Elegir la mejor play de cada usuario
                for (const uId in tempUserScores) {
                    if (allowedOsuIds && !allowedOsuIds.has(uId)) {
                        continue;
                    }
                    const scoresList = tempUserScores[uId];
                    const best = scoresList.reduce((a, b) => (Number(a.total_score || a.legacy_total_score || 0) > Number(b.total_score || b.legacy_total_score || 0) ? a : b));
                    
                    // Rellenar country_code si le falta
                    if (!best.country_code) {
                        best.country_code = knownCountryCodes[uId] || tokenCountryCodes[uId] || null;
                    }
                    if (!best.user) {
                        best.user = {};
                    }
                    if (!best.user.country_code) {
                        best.user.country_code = best.country_code;
                    }

                    userScores.set(uId, best);
                }
            }
        }
    } catch (error) {
        console.error('Error obteniendo scores locales de Supabase en getUnrankedUserScores:', error);
    }

    // 2. Mezclar/complementar con las scores locales físicas si existen
    const scoresPath = path.join(process.cwd(), 'db/local/scores', `${beatmapId}`);
    if (fs.existsSync(scoresPath)) {
        try {
            const userFolders = fs.readdirSync(scoresPath).filter(f => fs.statSync(path.join(scoresPath, f)).isDirectory());

            for (const userId of userFolders) {
                const folderPath = path.join(scoresPath, userId);
                const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.json'));
                const localList = [];

                for (const file of files) {
                    const filePath = path.join(folderPath, file);
                    try {
                        const data = JSON.parse(fs.readFileSync(filePath));
                        localList.push(data);
                    } catch (e) {
                        console.error(`Error leyendo ${filePath}:`, e);
                    }
                }

                if (localList.length > 0) {
                    const bestLocal = localList.reduce((a, b) => (Number(a.total_score || a.legacy_total_score || a.score || 0) > Number(b.total_score || b.legacy_total_score || b.score || 0) ? a : b));
                    const uId = userId.toString();
                    const normalizedLocal = normalizeScore(bestLocal);
                    
                    if (!normalizedLocal.country_code) {
                        normalizedLocal.country_code = tokenCountryCodes[uId] || null;
                    }
                    if (!normalizedLocal.user) {
                        normalizedLocal.user = {};
                    }
                    if (!normalizedLocal.user.country_code) {
                        normalizedLocal.user.country_code = normalizedLocal.country_code;
                    }

                    // Si ya existe de Supabase, quedarnos con la de mayor total_score
                    if (userScores.has(uId)) {
                        const existing = userScores.get(uId);
                        if (Number(normalizedLocal.total_score) > Number(existing.total_score)) {
                            userScores.set(uId, normalizedLocal);
                        }
                    } else {
                        userScores.set(uId, normalizedLocal);
                    }
                }
            }
        } catch (e) {
            console.error("Error al leer scores locales físicas:", e);
        }
    }

    return userScores;
}

async function triggerBackgroundGapCache(message, beatmapId, gamemode = 'osu') {
    try {
        const supabase = getSupabaseClient();
        if (!supabase) return;

        const guildId = message.guild ? message.guild.id : null;
        if (!guildId) return;

        const linkedUsers = await OsuUserModel.getLinkedUsers({ guildId, guild: message.guild });
        if (!linkedUsers || linkedUsers.length === 0) return;

        const targetMode = gamemode || 'osu';
        const filteredUsers = linkedUsers.filter(user => {
            if (targetMode !== 'osu' && linkedUsers.length <= 30) {
                return true;
            }
            const userMode = user.main_gamemode || 'osu';
            return userMode === targetMode;
        });

        const usersArray = filteredUsers.map(user => ({
            id: user.discord_id,
            osu_id: user.osu_id,
            main_gamemode: user.main_gamemode
        }));

        if (usersArray.length === 0) return;

        getNewBeatmapUserScores(beatmapId, usersArray, gamemode, false, null)
            .then(() => {
                console.log(`[BG-GAP] Caché de gap completado para el mapa ${beatmapId} (${usersArray.length} usuarios).`);
            })
            .catch(err => {
                console.error(`[BG-GAP] Error en la ejecución de cache de gap:`, err);
            });

    } catch (err) {
        console.error(`[BG-GAP] Error al inicializar el proceso en segundo plano:`, err);
    }
}

async function handlePredictivePreload(discordId, beatmapId, gamemode = 'osu', message = null) {
    if (!discordId) return;

    let cleanBeatmapId = beatmapId;
    if (beatmapId && typeof beatmapId === 'string' && (beatmapId.includes('osu.ppy.sh') || beatmapId.includes('#'))) {
        const match = /#(?:osu|taiko|fruits|mania)\/(\d+)|osu\.ppy\.sh\/b(?:eatmaps)?\/(\d+)/i.exec(beatmapId);
        if (match) {
            cleanBeatmapId = match[1] || match[2];
        }
    }

    const now = Date.now();
    let userState = userPreloadRegistry.get(discordId);

    // Si no existe, expiró o cambió de mapa, inicializamos el estado
    if (!userState || (now - userState.timestamp) > PRELOAD_REGISTRY_TTL || (cleanBeatmapId && userState.beatmapId !== cleanBeatmapId)) {
        userState = {
            beatmapId: cleanBeatmapId || null,
            stages: new Set(),
            timestamp: now
        };
        setWithLimit(userPreloadRegistry, discordId, userState, 150);
    } else {
        userState.timestamp = now; // Refrescar vigencia
        if (cleanBeatmapId && !userState.beatmapId) {
            userState.beatmapId = cleanBeatmapId;
        }
    }

    // FASE 1: Precarga de Beatmap (.osu) y Caché de Gap
    if (userState.beatmapId && !userState.stages.has('beatmap_and_gap')) {
        userState.stages.add('beatmap_and_gap');
        triggerBackgroundOsuPreload(null, userState.beatmapId, gamemode, message);
    }

    // FASE 2: Precarga de Perfil de Usuario y Top Scores
    if (!userState.stages.has('profile_and_top')) {
        userState.stages.add('profile_and_top');
        triggerBackgroundOsuPreload(discordId, null, gamemode, message);
    }
}

async function triggerBackgroundOsuPreload(discordId, beatmapId, gamemode = 'osu', message = null) {
    try {
        Promise.resolve().then(async () => {
            // 1. Precarga del Beatmap y del archivo .osu
            if (beatmapId) {
                try {
                    const mapMeta = await BeatmapModel.getBeatmap(beatmapId);
                    if (mapMeta && mapMeta.beatmapset_id) {
                        await BeatmapModel.getBeatmap_osu(mapMeta.beatmapset_id, beatmapId, mapMeta);
                        console.log(`[BG-PRELOAD] Mapa precargado: ${beatmapId}`);

                        // Si hay un mensaje provisto y pertenece a una guild, gatillar precarga del gap y compare
                        if (message && message.guild) {
                            triggerBackgroundGapCache(message, beatmapId, gamemode).catch(err => {
                                console.error(`[BG-PRELOAD] Error al precargar gap para el mapa ${beatmapId}:`, err);
                            });
                        }
                    }
                } catch (err) {
                    console.error(`[BG-PRELOAD] Error al precargar beatmap ${beatmapId}:`, err);
                }
            }

            // 2. Precarga del Perfil de Usuario y mejores puntuaciones (Top 100)
            if (discordId) {
                try {
                    const supabase = getSupabaseClient();
                    if (supabase) {
                        const { data: userRecord, error } = await supabase
                            .from('users')
                            .select('osu_id, username, main_gamemode')
                            .eq('discord_id', discordId)
                            .maybeSingle();

                        if (!error && userRecord && userRecord.username) {
                            const osuUsername = userRecord.username;
                            const targetMode = gamemode || userRecord.main_gamemode || 'osu';
                            const targetServer = 'bancho';

                            const dummyArgs = {
                                username: [osuUsername],
                                gamemode: targetMode,
                                server: targetServer
                            };

                            await Promise.all([
                                OsuUserModel.getOsuUser(dummyArgs).catch(e => console.error(`[BG-PRELOAD] Error al precargar perfil de ${osuUsername}:`, e)),
                                getUserTopScores(dummyArgs).catch(e => console.error(`[BG-PRELOAD] Error al precargar top scores de ${osuUsername}:`, e))
                            ]);
                            console.log(`[BG-PRELOAD] Perfil/top precargado: ${osuUsername}`);
                        }
                    }
                } catch (err) {
                    console.error(`[BG-PRELOAD] Error al precargar perfil del usuario discord ${discordId}:`, err);
                }
            }
        });
    } catch (err) {
        console.error(`[BG-PRELOAD] Error general en triggerBackgroundOsuPreload:`, err);
    }
}

async function triggerBackgroundRecentPreload(message, recentScore, parsed_args) {
    if (!recentScore || !recentScore.beatmap) return;
    
    const beatmapId = recentScore.beatmap.id;
    const mode = recentScore.beatmap.mode || parsed_args?.gamemode || 'osu';
    const userId = recentScore.user_id || recentScore.user?.id;
    const username = recentScore.user?.username;
    
    let countryCode = recentScore.user?.country_code || recentScore.country_code;

    Promise.resolve().then(async () => {
        // 1. Precarga del Compare (.c), perfil de usuario y metadatos del mapa en ese mapa (Máxima prioridad)
        if (userId && beatmapId) {
            try {
                const compareArgs = {
                    username: [userId.toString()],
                    beatmap_url: beatmapId.toString(),
                    gamemode: mode,
                    server: parsed_args?.server || 'bancho'
                };
                const OsuUserModel = require("./OsuUserModel.js");
                const BeatmapModel = require("./BeatmapModel.js");
                await Promise.all([
                    getBeatmapUserAllScores(compareArgs),
                    OsuUserModel.getOsuUser(compareArgs).catch(() => {}),
                    BeatmapModel.getBeatmap(beatmapId).catch(() => {})
                ]);
                console.log(`[BG-RECENT-PRELOAD] Compare (.c), Perfil y Mapa precargados en segundo plano para ${username || userId} (ID: ${userId}) en el mapa ${beatmapId}`);
            } catch (err) {
                console.error(`[BG-RECENT-PRELOAD] Error al precargar compare/perfil/mapa para ${username || userId} en el mapa ${beatmapId}:`, err);
            }
        }

        // 2. Precarga del Leaderboard del país (.lb) de ese usuario en ese mapa (Prioridad media)
        if (!countryCode && message && message.author) {
            try {
                const supabase = getSupabaseClient();
                if (supabase) {
                    const { data: userToken } = await supabase
                        .from('users')
                        .select('country_code')
                        .eq('discord_id', message.author.id)
                        .maybeSingle();
                    if (userToken && userToken.country_code) {
                        countryCode = userToken.country_code;
                    }
                }
            } catch (err) {
                console.error(`[BG-RECENT-PRELOAD] Error al buscar país del usuario en DB:`, err);
            }
        }

        if (countryCode && beatmapId) {
            try {
                const { preloadCountryLeaderboard } = require("../commands/chat/osu/lb.js");
                const isLazer = recentScore.build_id !== null && recentScore.build_id !== undefined;
                await preloadCountryLeaderboard(beatmapId, mode, countryCode, isLazer);
            } catch (err) {
                console.error(`[BG-RECENT-PRELOAD] Error al precargar leaderboard nacional de ${countryCode} para el mapa ${beatmapId}:`, err);
            }
        }

        // 3. Precarga del Gap en segundo plano (Prioridad baja)
        try {
            await triggerBackgroundGapCache(message, beatmapId, mode);
        } catch (err) {
            console.error(`[BG-RECENT-PRELOAD] Error al precargar gap para el mapa ${beatmapId}:`, err);
        }
    }).catch(err => {
        console.error(`[BG-RECENT-PRELOAD] Error general en el proceso en segundo plano:`, err);
    });
}

function calculateNoChokeRank(stats, mods, mode = 'osu') {
    const hasHDorFL = mods && mods.some(m => {
        const acronym = typeof m === 'object' ? m.acronym : m;
        return acronym === 'HD' || acronym === 'FL';
    });

    const great = stats.great || 0;
    const ok = stats.ok || 0;
    const meh = stats.meh || 0;
    const miss = stats.miss || 0;
    const perfect = stats.perfect || 0;
    const good = stats.good || 0;

    if (mode === 'osu' || mode === 0) {
        const total = great + ok + meh + miss;
        if (total === 0) return "S";
        
        const ratio300 = great / total;
        const ratio50 = meh / total;

        if (ratio300 === 1.0) {
            return hasHDorFL ? "XH" : "X";
        }
        if (ratio300 > 0.90 && ratio50 <= 0.01 && miss === 0) {
            return hasHDorFL ? "SH" : "S";
        }
        if (ratio300 > 0.80) return "A";
        if (ratio300 > 0.70) return "B";
        if (ratio300 > 0.60) return "C";
        return "D";
    }

    if (mode === 'taiko' || mode === 1) {
        const total = great + ok + miss;
        if (total === 0) return "S";

        const ratioGreat = great / total;
        if (ratioGreat === 1.0) {
            return hasHDorFL ? "XH" : "X";
        }
        if (ratioGreat > 0.95 && miss === 0) {
            return hasHDorFL ? "SH" : "S";
        }
        if (ratioGreat > 0.90) return "A";
        if (ratioGreat > 0.80) return "B";
        return "C";
    }

    if (mode === 'fruits' || mode === 2) {
        return hasHDorFL ? "SH" : "S"; 
    }

    if (mode === 'mania' || mode === 3) {
        const total = perfect + great + good + ok + meh + miss;
        if (total === 0) return "S";

        const scoreVal = (perfect * 305 + great * 300 + good * 200 + ok * 100 + meh * 50) / (total * 305);
        if (scoreVal >= 1.0) {
            return hasHDorFL ? "XH" : "X";
        }
        if (scoreVal > 0.95) {
            return hasHDorFL ? "SH" : "S";
        }
        if (scoreVal > 0.90) return "A";
        if (scoreVal > 0.80) return "B";
        if (scoreVal > 0.70) return "C";
        return "D";
    }

    return "S";
}

async function ensureNoChokeScores(scores, gamemode) {
    if (!Array.isArray(scores) || scores.length === 0) return;

    // Precargar todos los mapas de las puntuaciones en lote desde la base de datos
    const beatmapIds = scores
        .map(s => s.beatmap?.id || s.beatmap_id)
        .filter(Boolean);
        
    if (beatmapIds.length > 0) {
        try {
            await BeatmapModel.batchGetBeatmaps(beatmapIds);
        } catch (err) {
            // Silencioso, getBeatmap individual se encargará
        }
    }

    const promises = scores.map(async (score) => {
        if (score.noChoke) return;

        const stats = score.statistics || {};
        const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
        const ok = stats.ok !== undefined ? stats.ok : (stats.count_100 || 0);
        const meh = stats.meh !== undefined ? stats.meh : (stats.count_50 || 0);
        const miss = stats.miss !== undefined ? stats.miss : (stats.count_miss || 0);
        const perfect = stats.perfect !== undefined ? stats.perfect : (stats.count_geki || 0);
        const good = stats.good !== undefined ? stats.good : (stats.count_katu || 0);

        let beatmap_id = score.beatmap?.id;
        if (!beatmap_id) return;

        try {
            let beatmap = score.beatmap;
            if (!beatmap || beatmap.max_combo === undefined || beatmap.status === undefined) {
                beatmap = await BeatmapModel.getBeatmap(beatmap_id);
            }
            const maxCombo = beatmap.max_combo || 0;
            const isFC = miss === 0 && score.max_combo >= (maxCombo - 2);

            const ncStats = {
                perfect: perfect,
                great: great + miss,
                good: good,
                ok: ok,
                meh: meh,
                miss: 0
            };

            let ncAcc = score.accuracy;
            const mode = score.beatmap?.mode || gamemode || 'osu';
            const totalHits = great + ok + meh + miss;

            if (mode === 'osu' || mode === 0) {
                if (totalHits > 0) {
                    ncAcc = (300 * (great + miss) + 100 * ok + 50 * meh) / (300 * totalHits);
                }
            } else if (mode === 'taiko' || mode === 1) {
                const totalObjects = great + ok + miss;
                if (totalObjects > 0) {
                    ncAcc = (great + miss + 0.5 * ok) / totalObjects;
                }
            } else if (mode === 'fruits' || mode === 2) {
                ncAcc = 1.0;
            } else if (mode === 'mania' || mode === 3) {
                if (totalHits > 0) {
                    ncAcc = (305 * perfect + 300 * (great + miss) + 200 * good + 100 * ok + 50 * meh) / (305 * totalHits);
                }
            }

            const ncRank = calculateNoChokeRank(ncStats, score.mods, mode);

            const map = await BeatmapModel.getBeatmap_osu(score.beatmap.beatmapset_id || score.beatmap.set_id || beatmap.beatmapset_id, beatmap_id, beatmap);
            const maxAttrs = calculatePP(score, map, "maximo_pp");
            
            const nc_score = {
                ...score,
                max_combo: maxCombo || score.max_combo,
                statistics: ncStats,
                mods: score.mods
            };
            const live_nc_pp = calculatePP(nc_score, map, null, maxAttrs).pp;
            map.free();

            let rework_nc_pp = live_nc_pp;
            if (score.values && typeof score.values.local_pp === 'number' && typeof score.values.live_pp === 'number' && score.values.live_pp > 0) {
                rework_nc_pp = live_nc_pp * (score.values.local_pp / score.values.live_pp);
            }

            score.noChoke = {
                accuracy: ncAcc * 100,
                pp: score.values ? rework_nc_pp : live_nc_pp,
                live_pp: live_nc_pp,
                rank: ncRank,
                max_combo: maxCombo || score.max_combo,
                statistics: ncStats
            };
        } catch (err) {
            console.error(`Error calculating no-choke for score ${score.score_id || score.id}:`, err);
            score.noChoke = {
                accuracy: score.accuracy * 100,
                pp: score.values ? score.values.local_pp : (score.pp || 0),
                live_pp: score.values ? score.values.live_pp : (score.pp || 0),
                rank: score.rank,
                max_combo: score.max_combo,
                statistics: score.statistics
            };
        }
    });

    await Promise.all(promises);
}

/**
 * Obtiene el total de mapas rankeados en un modo específico.
 */
async function getRankedBeatmapsCount(mode) {
    const supabase = getSupabaseClient();
    const { count, error } = await supabase
        .from('ranked_beatmaps')
        .select('beatmap_id', { count: 'exact', head: true })
        .eq('mode', mode);
    if (error) throw error;
    return count || 0;
}

/**
 * Obtiene el total de mapas procesados/guardados para snipes en un modo específico y país.
 */
async function getProcessedSnipesCount(mode, country_code = 'VE') {
    const supabase = getSupabaseClient();
    const { count, error } = await supabase
        .from('top_scores')
        .select('beatmap_id, ranked_beatmaps!inner(mode)', { count: 'exact', head: true })
        .eq('ranked_beatmaps.mode', mode)
        .eq('country_code', country_code);
    if (error) throw error;
    return count || 0;
}

/**
 * Obtiene las puntuaciones nacionales (#1) de un usuario en un modo específico y país.
 */
async function getUserNationalTops(userId, mode, country_code = 'VE', detailed = false) {
    const supabase = getSupabaseClient();
    const selectFields = detailed
        ? 'pp, mods, ended_at, score, accuracy, beatmap_id, ranked_beatmaps!inner(mode, title, version, creator, stars, bpm, ar, od, cs)'
        : 'pp, mods, ended_at, ranked_beatmaps!inner(mode)';
    const { data, error } = await supabase
        .from('top_scores')
        .select(selectFields)
        .eq('user_id', userId.toString())
        .eq('ranked_beatmaps.mode', mode)
        .eq('country_code', country_code);
    if (error) throw error;
    return data || [];
}

const OsuScoreModel = {
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
    saveUserscore,
    getNewBeatmapUserScores,
    getUnrankedUserScores,
    triggerBackgroundGapCache,
    handlePredictivePreload,
    triggerBackgroundOsuPreload,
    triggerBackgroundRecentPreload,
    ensureNoChokeScores,
    getRankedBeatmapsCount,
    getProcessedSnipesCount,
    getUserNationalTops
};

module.exports = OsuScoreModel;
