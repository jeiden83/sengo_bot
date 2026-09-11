const { getSupabaseClient } = require("../db/database.js");

// Caché en memoria para evitar consultas redundantes a Supabase en cada comando
let cachedUsers = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutos

const MOD_KEYS = ['DT', 'HD', 'HR', 'NM', 'FL', 'EZ'];

/**
 * Calcula la distribución de mods ponderada por el rendimiento real de osu! (0.95^i * pp).
 * Esto evita que 50 partidas EZ del fondo de 40pp distorsionen un perfil de 400pp NoMod.
 * @param {Array} scores Lista de mejores jugadas del usuario
 * @returns {Object} Prominencia de mods en porcentaje ponderado { DT, HD, HR, NM, FL, EZ }
 */
function calculatePpWeightedModStats(scores = []) {
    const ppWeights = { DT: 0, HD: 0, HR: 0, NM: 0, FL: 0, EZ: 0 };
    let totalWeightedPP = 0;

    for (let i = 0; i < scores.length; i++) {
        const s = scores[i];
        const pp = Number(s.pp || 0);
        const w = Math.pow(0.95, i);
        const effPP = pp * w;
        totalWeightedPP += effPP;

        const rawMods = Array.isArray(s.mods)
            ? s.mods.map(m => (typeof m === 'string' ? m : m.acronym || ''))
            : (typeof s.mods === 'string' ? s.mods.match(/.{1,2}/g) || [] : []);
        const cleanMods = rawMods.map(m => m.toUpperCase()).filter(m => m !== 'CL' && m !== 'NM');
        const set = new Set(cleanMods);

        if (cleanMods.length === 0) ppWeights.NM += effPP;
        if (set.has('DT') || set.has('NC')) ppWeights.DT += effPP;
        if (set.has('HD')) ppWeights.HD += effPP;
        if (set.has('HR')) ppWeights.HR += effPP;
        if (set.has('FL')) ppWeights.FL += effPP;
        if (set.has('EZ')) ppWeights.EZ += effPP;
    }

    const result = {};
    if (totalWeightedPP > 0) {
        for (const k of MOD_KEYS) {
            result[k] = Math.round((ppWeights[k] / totalWeightedPP) * 100);
        }
    } else {
        result.NM = 100;
        result.DT = 0;
        result.HD = 0;
        result.HR = 0;
        result.FL = 0;
        result.EZ = 0;
    }

    return result;
}

/**
 * Calcula la similitud de cosenos entre dos distribuciones de mods
 * @param {Object} a Estadísticas de mods del usuario A
 * @param {Object} b Estadísticas de mods del usuario B
 * @returns {number} Valor entre 0 y 1 representando la afinidad
 */
function calculateModSimilarity(a = {}, b = {}) {
    let dot = 0;
    let magA = 0;
    let magB = 0;

    for (const m of MOD_KEYS) {
        const vA = Number(a[m] || 0);
        const vB = Number(b[m] || 0);
        dot += vA * vB;
        magA += vA * vA;
        magB += vB * vB;
    }

    if (magA === 0 || magB === 0) return 0;
    const similarity = dot / (Math.sqrt(magA) * Math.sqrt(magB));
    return Math.min(1, Math.max(0, similarity));
}

/**
 * Carga o refresca los perfiles de habilidades de la base de datos en memoria RAM
 */
async function loadSkillsUniverse(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedUsers && (now - lastCacheTime) < CACHE_TTL_MS) {
        return cachedUsers;
    }

    const supabase = getSupabaseClient();
    if (!supabase) return cachedUsers || [];

    try {
        const { data, error } = await supabase
            .from('user_skills')
            .select('osu_id, username, country_code, gamemode, pp, global_rank, country_rank, top_play_pp, skills_data');

        if (error) {
            console.error('[TwinModel] Error al cargar universo de skills:', error.message);
            return cachedUsers || [];
        }

        cachedUsers = (data || []).filter(u => u.skills_data && u.skills_data.modStats);
        lastCacheTime = now;
        return cachedUsers;
    } catch (err) {
        console.error('[TwinModel] Excepción al cargar skills universe:', err.message);
        return cachedUsers || [];
    }
}

/**
 * Agrega o actualiza dinámicamente un usuario en la caché en memoria
 */
function updateCachedUser(userRecord) {
    if (!cachedUsers || !userRecord || !userRecord.skills_data?.modStats) return;
    const index = cachedUsers.findIndex(u => String(u.osu_id) === String(userRecord.osu_id) && u.gamemode === userRecord.gamemode);
    if (index >= 0) {
        cachedUsers[index] = { ...cachedUsers[index], ...userRecord };
    } else {
        cachedUsers.push(userRecord);
    }
}

/**
 * Encuentra a los jugadores más afines en mods para un usuario dado
 * @param {Object} targetUser Perfil del usuario objetivo (con id, username, etc.)
 * @param {Object} targetMods Estadísticas de mods (preferiblemente calculadas con calculatePpWeightedModStats)
 * @param {Object} options Opciones de filtrado (gamemode, country, closeRank, limit)
 */
async function findTwins(targetUser, targetMods, options = {}) {
    const gamemode = options.gamemode || 'osu';
    const country = options.country ? options.country.toUpperCase() : null;
    const closeRank = options.closeRank || false;
    const limit = options.limit || 5;

    const allPlayers = await loadSkillsUniverse();
    const targetOsuId = String(targetUser.id || targetUser.osu_id);
    const targetRank = Number(targetUser.statistics?.global_rank || targetUser.global_rank || 0);

    const candidates = [];

    for (const candidate of allPlayers) {
        if (String(candidate.osu_id) === targetOsuId) continue;
        if (candidate.gamemode !== gamemode) continue;

        if (country && candidate.country_code?.toUpperCase() !== country) {
            continue;
        }

        const candidateRank = Number(candidate.global_rank || 0);
        if (closeRank && targetRank > 0 && candidateRank > 0) {
            // Filtrar a jugadores dentro de un factor razonable de rango (entre 0.35x y 2.8x)
            const minRank = Math.max(1, Math.floor(targetRank * 0.35));
            const maxRank = Math.floor(targetRank * 2.8);
            if (candidateRank < minRank || candidateRank > maxRank) {
                continue;
            }
        }

        const candidateMods = candidate.skills_data?.modStats;
        if (!candidateMods) continue;

        const similarity = calculateModSimilarity(targetMods, candidateMods);
        candidates.push({
            osu_id: candidate.osu_id,
            username: candidate.username,
            country_code: candidate.country_code,
            global_rank: candidate.global_rank,
            country_rank: candidate.country_rank,
            pp: candidate.pp,
            top_play_pp: candidate.top_play_pp,
            modStats: candidateMods,
            similarity,
            affinityPct: Number((similarity * 100).toFixed(1))
        });
    }

    // Ordenar de mayor a menor afinidad
    candidates.sort((a, b) => b.similarity - a.similarity);

    return candidates.slice(0, limit);
}

/**
 * Compara las mejores jugadas de dos usuarios y extrae los beatmaps compartidos y exclusivos
 * @param {Array} scoresA Lista de top scores del usuario A
 * @param {Array} scoresB Lista de top scores del usuario B
 */
function compareSharedTopScores(scoresA = [], scoresB = []) {
    const mapB = new Map();
    for (const scoreB of scoresB) {
        const bId = scoreB.beatmap?.id || scoreB.beatmap_id;
        if (bId) {
            mapB.set(String(bId), scoreB);
        }
    }

    const shared = [];
    const uniqueMapIdsA = new Set();

    for (const scoreA of scoresA) {
        const bId = String(scoreA.beatmap?.id || scoreA.beatmap_id || '');
        if (!bId) continue;
        uniqueMapIdsA.add(bId);

        if (mapB.has(bId)) {
            const scoreB = mapB.get(bId);
            const ppA = Number(scoreA.pp || 0);
            const ppB = Number(scoreB.pp || 0);
            const accA = Number(((scoreA.accuracy || 1) * 100).toFixed(2));
            const accB = Number(((scoreB.accuracy || 1) * 100).toFixed(2));

            shared.push({
                beatmapId: bId,
                beatmap: scoreA.beatmap || scoreB.beatmap,
                beatmapset: scoreA.beatmapset || scoreB.beatmapset,
                scoreA: {
                    pp: ppA,
                    acc: accA,
                    mods: scoreA.mods || [],
                    rank: scoreA.rank
                },
                scoreB: {
                    pp: ppB,
                    acc: accB,
                    mods: scoreB.mods || [],
                    rank: scoreB.rank
                },
                combinedPP: ppA + ppB,
                ppDiff: Number((ppA - ppB).toFixed(1))
            });
        }
    }

    // Ordenar los mapas compartidos por mayor PP combinado
    shared.sort((a, b) => b.combinedPP - a.combinedPP);

    const totalA = scoresA.length;
    const totalB = scoresB.length;
    const sharedCount = shared.length;

    return {
        shared,
        sharedCount,
        uniqueCountA: totalA - sharedCount,
        uniqueCountB: totalB - sharedCount,
        percentageA: totalA > 0 ? Math.round((sharedCount / totalA) * 100) : 0,
        percentageB: totalB > 0 ? Math.round((sharedCount / totalB) * 100) : 0
    };
}

module.exports = {
    calculatePpWeightedModStats,
    calculateModSimilarity,
    loadSkillsUniverse,
    updateCachedUser,
    findTwins,
    compareSharedTopScores
};
