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
        let allUsers = [];
        let from = 0;
        const CHUNK_SIZE = 1000;
        const MAX_UNIVERSE = 10000;

        while (allUsers.length < MAX_UNIVERSE) {
            const { data, error } = await supabase
                .from('user_skills')
                .select('osu_id, username, country_code, gamemode, pp, global_rank, country_rank, top_play_pp, skills_data, aim, speed, acc, reading, stamina')
                .range(from, from + CHUNK_SIZE - 1);

            if (error) {
                console.error('[TwinModel] Error al cargar universo de skills:', error.message);
                break;
            }

            if (!data || data.length === 0) break;
            const valid = data.filter(u => u.skills_data && u.skills_data.modStats);
            allUsers.push(...valid);

            if (data.length < CHUNK_SIZE) break;
            from += CHUNK_SIZE;
        }

        if (allUsers.length > 0) {
            cachedUsers = allUsers;
            lastCacheTime = now;
        }
        return cachedUsers || [];
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
 * Parsea un string de mods a un array limpio de acrónimos válidos
 * @param {string} rawInput Texto con mods (ej: "EZ", "HDDT", "HD DT", "+EZ")
 * @returns {Array<string>|null}
 */
function parseModFilter(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') return null;
    const upper = rawInput.toUpperCase().replace(/[+, ]+/g, ' ').trim();
    const tokens = upper.split(' ').filter(Boolean);
    const result = [];
    const valid = new Set(['DT', 'HD', 'HR', 'NM', 'FL', 'EZ', 'HT', 'NC']);

    for (const token of tokens) {
        if (valid.has(token)) {
            result.push(token === 'NC' ? 'DT' : token);
        } else {
            const matches = token.match(/.{1,2}/g) || [];
            for (const m of matches) {
                if (valid.has(m)) result.push(m === 'NC' ? 'DT' : m);
            }
        }
    }
    return result.length > 0 ? [...new Set(result)] : null;
}

/**
 * Encuentra a los jugadores más afines para un usuario dado
 * Soporta filtros por mods (-mods), cercanía en PP (-pp), cercanía en skills (-skills), y país (-pais).
 * @param {Object} targetUser Perfil del usuario objetivo (con id, username, etc.)
 * @param {Object} targetMods Estadísticas de mods (calculadas con calculatePpWeightedModStats)
 * @param {Object} options Opciones avanzadas de filtrado y ordenamiento
 */
async function findTwins(targetUser, targetMods, options = {}) {
    const gamemode = options.gamemode || 'osu';
    const country = options.country ? options.country.toUpperCase() : null;
    const prioritizeCountry = !!options.prioritizeCountry;
    const runnerCountry = options.runnerCountry ? options.runnerCountry.toUpperCase() : null;
    const closeRank = options.closeRank || false;
    const limit = options.limit || 25;
    const requestedMods = options.requestedMods || null;
    const sortByPP = !!options.sortByPP;
    const targetPP = Number(options.targetPP != null ? options.targetPP : (targetUser.statistics?.pp || targetUser.pp || 0));
    const skillFilter = options.skillFilter || null;
    const targetSkills = options.targetSkills || {};

    const supabase = getSupabaseClient();
    let candidatesPool = [];

    // Si se especifica un país estricto (-pais CL), consultar directamente en Supabase para obtener el universo completo del país
    if (country && supabase) {
        try {
            const { data } = await supabase
                .from('user_skills')
                .select('osu_id, username, country_code, gamemode, pp, global_rank, country_rank, top_play_pp, skills_data, aim, speed, acc, reading, stamina')
                .eq('gamemode', gamemode)
                .eq('country_code', country)
                .limit(1000);
            candidatesPool = (data || []).filter(u => u.skills_data?.modStats);
        } catch {
            candidatesPool = [];
        }
    }

    if (candidatesPool.length === 0) {
        const universe = await loadSkillsUniverse();
        candidatesPool = universe.filter(u => u.gamemode === gamemode);
    }

    // Si se prioriza el país del ejecutor (-pais sin parámetros), asegurar que candidatos de ese país estén presentes
    if (prioritizeCountry && runnerCountry && !country && supabase) {
        try {
            const { data: countryUsers } = await supabase
                .from('user_skills')
                .select('osu_id, username, country_code, gamemode, pp, global_rank, country_rank, top_play_pp, skills_data, aim, speed, acc, reading, stamina')
                .eq('gamemode', gamemode)
                .eq('country_code', runnerCountry)
                .limit(1000);

            if (countryUsers && countryUsers.length > 0) {
                const map = new Map();
                candidatesPool.forEach(u => map.set(String(u.osu_id), u));
                countryUsers.forEach(u => {
                    if (u.skills_data?.modStats) map.set(String(u.osu_id), u);
                });
                candidatesPool = Array.from(map.values());
            }
        } catch {}
    }

    const targetOsuId = String(targetUser.id || targetUser.osu_id);
    const targetRank = Number(targetUser.statistics?.global_rank || targetUser.global_rank || 0);

    const candidates = [];

    for (const candidate of candidatesPool) {
        if (String(candidate.osu_id) === targetOsuId) continue;
        if (candidate.gamemode !== gamemode) continue;

        if (country && candidate.country_code?.toUpperCase() !== country) {
            continue;
        }

        const candidateRank = Number(candidate.global_rank || 0);
        if (closeRank && targetRank > 0 && candidateRank > 0) {
            const minRank = Math.max(1, Math.floor(targetRank * 0.35));
            const maxRank = Math.floor(targetRank * 2.8);
            if (candidateRank < minRank || candidateRank > maxRank) {
                continue;
            }
        }

        const candidateMods = candidate.skills_data?.modStats;
        if (!candidateMods) continue;

        // 1. Cálculo de afinidad de mods
        let similarity = 0;
        let modDiff = 0;
        let affinityPct = 0;

        if (requestedMods && requestedMods.length > 0) {
            let userModSum = 0;
            let candModSum = 0;
            let sumDiff = 0;

            for (const m of requestedMods) {
                const vA = Number(targetMods[m] || 0);
                const vB = Number(candidateMods[m] || 0);
                userModSum += vA;
                candModSum += vB;
                sumDiff += Math.abs(vA - vB);
            }

            // Omitir si el candidato no juega ninguno de los mods solicitados
            if (candModSum <= 0) continue;

            if (userModSum > 0) {
                modDiff = sumDiff / requestedMods.length;
                affinityPct = Math.max(0, Math.min(100, Number((100 - modDiff).toFixed(1))));
            } else {
                // El usuario objetivo no juega estos mods, priorizar candidatos que más los jueguen
                const avgCand = candModSum / requestedMods.length;
                modDiff = 100 - avgCand;
                affinityPct = Math.max(0, Math.min(100, Number(avgCand.toFixed(1))));
            }
            similarity = affinityPct / 100;
        } else {
            similarity = calculateModSimilarity(targetMods, candidateMods);
            affinityPct = Number((similarity * 100).toFixed(1));
            modDiff = 100 - affinityPct;
        }

        // 2. Métrica de cercanía en PP
        const candPP = Number(candidate.pp || 0);
        const diffPP = Math.abs(candPP - targetPP);
        const ppDiffSigned = candPP - targetPP;

        // 3. Métrica de cercanía en Skills
        let skillDiff = 0;
        let skillAffinityPct = 0;
        if (skillFilter) {
            const normSkill = String(skillFilter).toUpperCase();
            if (normSkill === 'ALL' || normSkill === 'SKILLS') {
                const keys = ['aim', 'speed', 'acc', 'reading'];
                let sumS = 0;
                let countS = 0;
                for (const k of keys) {
                    const sA = Number(targetSkills[k] || 0);
                    const sB = Number(candidate[k] || 0);
                    if (sA > 0 || sB > 0) {
                        sumS += Math.abs(sA - sB);
                        countS++;
                    }
                }
                skillDiff = countS > 0 ? (sumS / countS) : 100;
                skillAffinityPct = Math.max(0, Math.min(100, Number((100 - skillDiff).toFixed(1))));
            } else {
                const keyMap = { ACC: 'acc', ACCURACY: 'acc', AIM: 'aim', SPEED: 'speed', READING: 'reading', STAMINA: 'stamina' };
                const field = keyMap[normSkill] || 'aim';
                const sA = Number(targetSkills[field] || 0);
                const sB = Number(candidate[field] || 0);
                skillDiff = Math.abs(sA - sB);
                skillAffinityPct = Math.max(0, Math.min(100, Number((100 - skillDiff).toFixed(1))));
            }
        }

        candidates.push({
            osu_id: candidate.osu_id,
            username: candidate.username,
            country_code: candidate.country_code,
            global_rank: candidate.global_rank,
            country_rank: candidate.country_rank,
            pp: candPP,
            diffPP,
            ppDiffSigned,
            top_play_pp: candidate.top_play_pp,
            modStats: candidateMods,
            aim: candidate.aim,
            speed: candidate.speed,
            acc: candidate.acc,
            reading: candidate.reading,
            stamina: candidate.stamina,
            similarity,
            affinityPct,
            modDiff,
            skillDiff,
            skillAffinityPct
        });
    }

    // ponytail: Ordenamiento jerárquico según país y métricas activas
    const pCountry = (prioritizeCountry && runnerCountry && !country) ? runnerCountry : null;

    candidates.sort((a, b) => {
        if (pCountry) {
            const aIsCountry = a.country_code?.toUpperCase() === pCountry ? 1 : 0;
            const bIsCountry = b.country_code?.toUpperCase() === pCountry ? 1 : 0;
            if (aIsCountry !== bIsCountry) return bIsCountry - aIsCountry;
        }

        if (sortByPP) {
            return a.diffPP - b.diffPP;
        }
        if (skillFilter) {
            return a.skillDiff - b.skillDiff;
        }
        if (requestedMods && requestedMods.length > 0) {
            return a.modDiff - b.modDiff;
        }
        return b.similarity - a.similarity;
    });

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
    parseModFilter,
    loadSkillsUniverse,
    updateCachedUser,
    findTwins,
    compareSharedTopScores
};
