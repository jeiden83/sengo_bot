const { getSupabaseClient } = require("../db/database.js");
const Logger = require("../utils/logger.js");

const AIM_TAGS = ['jump', 'aim', 'cross-screen', 'wide-angle', 'farm', 'sotarks', 'nevo', 'fieryrage', 'complexity'];
const SPEED_TAGS = ['stream', 'burst', 'speed', 'stamina', 'deathstream', 'alt', 'alternate', 'finger control'];

/**
 * Formula empírica para estimar el PP aproximado basado en estrellas, mods y accuracy.
 */
function estimatePP(stars, accuracy = 0.99, mods = "NM") {
    let scaledStars = stars;
    if (mods.includes("DT") || mods.includes("NC")) {
        scaledStars *= 1.35;
    } else if (mods.includes("HR")) {
        scaledStars *= 1.06;
    } else if (mods.includes("EZ")) {
        scaledStars *= 0.70;
    }
    
    let basePP = 0.15 * Math.pow(scaledStars, 4.15);
    
    if (accuracy < 1.0) {
        basePP *= Math.pow(accuracy, 15);
    }
    
    if (mods.includes("HD")) {
        basePP *= 1.04;
    }
    if (mods.includes("FL")) {
        basePP *= 1.05;
    }
    
    return Math.round(basePP);
}

function ppToStars(pp) {
    if (pp <= 0) return 0;
    return Math.pow(pp / 0.15, 1 / 4.15);
}

/**
 * Analiza el Top 100 de jugadas de un usuario de forma asíncrona para construir su perfil
 * utilizando los tags enriquecidos de la base de datos local.
 */
async function buildUserProfileAsync(topScores, supabase = null) {
    if (!Array.isArray(topScores) || topScores.length === 0) {
        return null;
    }
    const dbClient = supabase || getSupabaseClient();

    const top25 = topScores.slice(0, 25);
    let totalStars = 0;
    let totalBpm = 0;
    let totalLength = 0;
    let validBpmCount = 0;
    let validLengthCount = 0;

    let dtCount = 0;
    let hrCount = 0;
    let nmCount = 0;

    top25.forEach(score => {
        const mods = (score.mods || []).map(m => m?.acronym || m);
        const hasDT = mods.includes("DT") || mods.includes("NC");
        const hasHR = mods.includes("HR");

        if (hasDT) dtCount++;
        else if (hasHR) hrCount++;
        else nmCount++;

        totalStars += score.beatmap?.difficulty_rating || 0;

        let bpm = score.beatmap?.bpm || 0;
        let length = score.beatmap?.total_length || 0;

        if (bpm > 0) {
            if (hasDT) bpm *= 1.5;
            totalBpm += bpm;
            validBpmCount++;
        }
        if (length > 0) {
            if (hasDT) length /= 1.5;
            totalLength += length;
            validLengthCount++;
        }
    });

    let preferredMod = "NM";
    if (dtCount > nmCount && dtCount > hrCount) preferredMod = "DT";
    else if (hrCount > nmCount && hrCount > dtCount) preferredMod = "HR";

    const avgStars = totalStars / top25.length;
    const avgBpm = validBpmCount > 0 ? (totalBpm / validBpmCount) : 180;
    const avgLength = validLengthCount > 0 ? (totalLength / validLengthCount) : 120;

    // Analizar mappers favoritos y obtener tags de la BD en el Top 50
    const top50 = topScores.slice(0, 50);
    const mapperCounts = {};
    const tagCounts = {};

    // Obtener los tags desde nuestra BD local para el Top 50 de forma masiva
    const mapIds = top50.map(score => score.beatmap?.id).filter(Boolean);
    let dbTagsMap = new Map();
    if (dbClient && mapIds.length > 0) {
        try {
            const { data } = await dbClient
                .from('ranked_beatmaps')
                .select('beatmap_id, beatmapset_id, user_tags')
                .in('beatmap_id', mapIds);
            
            if (data) {
                const missingSets = new Map();
                data.forEach(row => {
                    if (row.user_tags && row.user_tags.length > 0) {
                        dbTagsMap.set(row.beatmap_id.toString(), row.user_tags);
                    } else if (row.beatmapset_id) {
                        missingSets.set(row.beatmapset_id.toString(), row.beatmap_id.toString());
                    }
                });

                // Si faltan tags, raspar un máximo de 5 al vuelo para autocurar la base de datos
                if (missingSets.size > 0) {
                    const uniqueMissingSetIds = Array.from(missingSets.keys()).slice(0, 5);
                    const { getBeatmapsetTags } = require('./BeatmapModel.js');
                    
                    for (const setId of uniqueMissingSetIds) {
                        try {
                            const tags = await getBeatmapsetTags(setId);
                            if (tags && tags.length > 0) {
                                const cleanTags = tags.map(t => t.toLowerCase().trim()).filter(t => t.length > 1);
                                
                                await dbClient
                                    .from('ranked_beatmaps')
                                    .update({ user_tags: cleanTags })
                                    .eq('beatmapset_id', setId);
                                
                                const mapId = missingSets.get(setId);
                                dbTagsMap.set(mapId, cleanTags);
                            }
                        } catch (err) {
                            // Continuar silenciosamente
                        }
                    }
                }
            }
        } catch (e) {
            Logger.system("Error consultando/raspando user_tags de perfil en BD: " + e.message);
        }
    }

    top50.forEach(score => {
        const creator = score.beatmapset?.creator;
        if (creator) {
            mapperCounts[creator] = (mapperCounts[creator] || 0) + 1;
        }

        const mapIdStr = score.beatmap?.id?.toString();
        const dbTags = dbTagsMap.get(mapIdStr);
        if (dbTags && dbTags.length > 0) {
            dbTags.forEach(tag => {
                const cleanTag = tag.toLowerCase().trim();
                if (cleanTag.length > 2) {
                    // Darle el doble de peso a los tags de patrón específicos (jumps/linear, etc)
                    const weight = cleanTag.includes('/') ? 3 : 2;
                    tagCounts[cleanTag] = (tagCounts[cleanTag] || 0) + weight;
                }
            });
        } else {
            // Fallback a tags del score
            const tags = score.beatmapset?.tags;
            if (typeof tags === 'string') {
                tags.toLowerCase().split(/\s+/).forEach(tag => {
                    const cleanTag = tag.toLowerCase().trim();
                    if (cleanTag.length > 2) {
                        tagCounts[cleanTag] = (tagCounts[cleanTag] || 0) + 1;
                    }
                });
            }
        }
    });

    const favoriteMappers = Object.keys(mapperCounts)
        .sort((a, b) => mapperCounts[b] - mapperCounts[a])
        .slice(0, 5);

    const frequentTags = Object.keys(tagCounts)
        .sort((a, b) => tagCounts[b] - tagCounts[a])
        .slice(0, 20); // Incrementar a 20 para capturar más variedad de user tags

    return {
        avgStars,
        avgBpm,
        avgLength,
        preferredMod,
        favoriteMappers,
        frequentTags
    };
}

/**
 * Analiza el perfil de forma síncrona (compatibilidad).
 */
function buildUserProfile(topScores) {
    if (!Array.isArray(topScores) || topScores.length === 0) {
        return null;
    }

    const top25 = topScores.slice(0, 25);
    let totalStars = 0;
    let totalBpm = 0;
    let totalLength = 0;
    let validBpmCount = 0;
    let validLengthCount = 0;

    let dtCount = 0;
    let hrCount = 0;
    let nmCount = 0;

    top25.forEach(score => {
        const mods = (score.mods || []).map(m => m?.acronym || m);
        const hasDT = mods.includes("DT") || mods.includes("NC");
        const hasHR = mods.includes("HR");

        if (hasDT) dtCount++;
        else if (hasHR) hrCount++;
        else nmCount++;

        totalStars += score.beatmap?.difficulty_rating || 0;

        let bpm = score.beatmap?.bpm || 0;
        let length = score.beatmap?.total_length || 0;

        if (bpm > 0) {
            if (hasDT) bpm *= 1.5;
            totalBpm += bpm;
            validBpmCount++;
        }
        if (length > 0) {
            if (hasDT) length /= 1.5;
            totalLength += length;
            validLengthCount++;
        }
    });

    let preferredMod = "NM";
    if (dtCount > nmCount && dtCount > hrCount) preferredMod = "DT";
    else if (hrCount > nmCount && hrCount > dtCount) preferredMod = "HR";

    const avgStars = totalStars / top25.length;
    const avgBpm = validBpmCount > 0 ? (totalBpm / validBpmCount) : 180;
    const avgLength = validLengthCount > 0 ? (totalLength / validLengthCount) : 120;

    const top50 = topScores.slice(0, 50);
    const mapperCounts = {};
    const tagCounts = {};

    top50.forEach(score => {
        const creator = score.beatmapset?.creator;
        if (creator) {
            mapperCounts[creator] = (mapperCounts[creator] || 0) + 1;
        }
        const tags = score.beatmapset?.tags;
        if (typeof tags === 'string') {
            tags.toLowerCase().split(/\s+/).forEach(tag => {
                if (tag.length > 2) {
                    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                }
            });
        }
    });

    const favoriteMappers = Object.keys(mapperCounts)
        .sort((a, b) => mapperCounts[b] - mapperCounts[a])
        .slice(0, 5);

    const frequentTags = Object.keys(tagCounts)
        .sort((a, b) => tagCounts[b] - tagCounts[a])
        .slice(0, 15);

    return {
        avgStars,
        avgBpm,
        avgLength,
        preferredMod,
        favoriteMappers,
        frequentTags
    };
}

/**
 * Obtiene recomendaciones de mapas para un usuario.
 */
async function getPersonalizedRecommendations({
    topScores,
    customMinPP = null,
    customMaxPP = null,
    customMods = null,
    style = 'standard', // standard, aim, speed, length, rarezas
    showPlayed = false,
    skipSet = new Set()
}) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Supabase client not initialized");
    }

    // 1. Perfilado asíncrono
    const profile = await buildUserProfileAsync(topScores, supabase);
    if (!profile) {
        throw new Error("Could not build user profile");
    }

    const activeMods = customMods || profile.preferredMod;

    // Determinar rango de estrellas objetivo
    let targetStars = profile.avgStars;
    let minStars = Math.max(1, targetStars - 0.85);
    let maxStars = targetStars + 0.85;

    if (customMinPP !== null) {
        const minTargetStars = ppToStars(customMinPP);
        const maxTargetStars = ppToStars(customMaxPP !== null ? customMaxPP : customMinPP * 1.3);
        
        let scale = 1.0;
        if (activeMods.includes("DT") || activeMods.includes("NC")) {
            scale = 1.35;
        } else if (activeMods.includes("HR")) {
            scale = 1.06;
        }
        
        minStars = Math.max(1, (minTargetStars / scale) - 0.1);
        maxStars = (maxTargetStars / scale) + 0.45;
    }

    // 2. Query de candidatos en Supabase
    let query = supabase
        .from('ranked_beatmaps')
        .select('*')
        .gte('stars', minStars)
        .lte('stars', maxStars)
        .eq('mode', 0); // standard

    // Soporte para approved (1 = ranked, 2 = approved, 3 = qualified, 4 = loved)
    if (style === 'rarezas') {
        query = query.in('ranked_status', [3, 4]); // Qualified, Loved
    } else {
        query = query.in('ranked_status', [1, 2]); // Ranked, Approved
    }

    const useTagsFilter = ['tags', 'aim', 'speed'].includes(style);
    if (useTagsFilter) {
        query = query.not('user_tags', 'is', null);
    }

    query = query.order('playcount', { ascending: false }).limit(1000);

    let { data: candidates, error } = await query;
    if (error) {
        throw error;
    }

    // Fallback: si intentamos filtrar por user_tags pero no encontramos suficientes candidatos,
    // reintentamos sin el filtro de user_tags para aim/speed.
    if (useTagsFilter && style !== 'tags' && (!candidates || candidates.length < 5)) {
        let fallbackQuery = supabase
            .from('ranked_beatmaps')
            .select('*')
            .gte('stars', minStars)
            .lte('stars', maxStars)
            .eq('mode', 0);

        if (style === 'rarezas') {
            fallbackQuery = fallbackQuery.in('ranked_status', [3, 4]);
        } else {
            fallbackQuery = fallbackQuery.in('ranked_status', [1, 2]);
        }

        fallbackQuery = fallbackQuery.order('playcount', { ascending: false }).limit(1000);
        const fallbackRes = await fallbackQuery;
        if (!fallbackRes.error && fallbackRes.data && fallbackRes.data.length > 0) {
            candidates = fallbackRes.data;
        }
    }

    if (!candidates || candidates.length === 0) {
        return [];
    }

    // Listado de IDs jugados en el Top 100
    const top100MapIds = new Set(topScores.map(score => score.beatmap.id.toString()));

    // 3. Scoring
    const scoredCandidates = candidates
        .filter(c => {
            const idStr = c.beatmap_id.toString();
            // Filtrar jugados si no se solicita mostrarlos explicitamente con flag -jugados
            if (!showPlayed && top100MapIds.has(idStr)) return false;
            // Filtrar mostrados en esta sesión
            if (skipSet.has(idStr)) return false;

            // 1. Filtrar estrictamente por el rango de PP estimado al 100% de acc
            if (customMinPP !== null) {
                const est100 = estimatePP(c.stars, 1.0, activeMods);
                const limitMaxPP = customMaxPP !== null ? customMaxPP : customMinPP * 1.3;
                if (est100 < customMinPP || est100 > limitMaxPP) {
                    return false;
                }
            }

            // 2. Filtrar estrictamente por estilo para Aim/Streams (usando user_tags y tags de creador como fallback)
            if (style === 'aim') {
                const combinedTags = [...(c.user_tags || []), ...(c.tags || [])];
                const hasAimTag = combinedTags.some(t => {
                    const tag = t.toLowerCase().trim();
                    if (tag === 'aim' || tag === 'jump' || tag === 'jumps') return true;
                    if (tag.includes('/') && (tag.includes('aim') || tag.includes('jump'))) return true;
                    return AIM_TAGS.some(at => tag === at);
                });
                if (!hasAimTag) return false;
            } else if (style === 'speed') {
                const combinedTags = [...(c.user_tags || []), ...(c.tags || [])];
                const hasSpeedTag = combinedTags.some(t => {
                    const tag = t.toLowerCase().trim();
                    if (tag === 'stream' || tag === 'streams' || tag === 'speed' || tag === 'burst' || tag === 'bursts' || tag === 'alt' || tag === 'alternate' || tag === 'stamina') return true;
                    if (tag.includes('/') && (tag.includes('stream') || tag.includes('speed') || tag.includes('burst') || tag.includes('alt') || tag.includes('stamina'))) return true;
                    return SPEED_TAGS.some(st => tag === st);
                });
                if (!hasSpeedTag) return false;
            } else if (style === 'length') {
                // Filtrar estrictamente: mínimo 5 minutos (300 segundos) para maratones
                if (c.total_length < 300) return false;
            } else if (style === 'tags') {
                // Filtrar estrictamente: solo mapas que contengan user_tags y que coincidan con al menos un tag frecuente del jugador
                if (!c.user_tags || c.user_tags.length === 0) return false;
                const hasMatchingTag = c.user_tags.some(t => {
                    const cleanTag = t.toLowerCase().trim();
                    return profile.frequentTags.includes(cleanTag);
                });
                if (!hasMatchingTag) return false;
            }

            return true;
        })
        .map(c => {
            let score = 0;
            const reasons = [];

            // BPM similarity (Max 25 pts)
            const mapBpm = (activeMods.includes("DT") || activeMods.includes("NC")) ? c.bpm * 1.5 : c.bpm;
            const bpmDiff = Math.abs(mapBpm - profile.avgBpm);
            const bpmScore = Math.max(0, 25 * (1 - bpmDiff / 50));
            score += bpmScore;
            if (bpmScore >= 18) {
                reasons.push("BPM similar");
            }

            // Length similarity (Max 15 pts)
            const mapLength = (activeMods.includes("DT") || activeMods.includes("NC")) ? c.total_length / 1.5 : c.total_length;
            const lengthDiff = Math.abs(mapLength - profile.avgLength);
            const lengthScore = Math.max(0, 15 * (1 - lengthDiff / 120));
            score += lengthScore;

            if (style === 'length') {
                if (c.total_length >= 600) {
                    score += 40;
                    reasons.push("Maratón extra largo (+10m)");
                } else {
                    score += 25;
                    reasons.push("Maratón largo (+5m)");
                }
            } else if (lengthScore >= 11) {
                reasons.push("Duración similar");
            }

            // Tag similarity (Max 30 pts)
            let tagMatches = 0;
            let userTagMatches = 0;
            const matchedTagsList = [];
            const combinedTags = (c.user_tags || []).concat(c.tags || []).map(t => t.toLowerCase().trim());

            profile.frequentTags.forEach(cleanTag => {
                if (combinedTags.includes(cleanTag)) {
                    tagMatches++;
                    // Si es un tag de estilo específico, darle doble peso
                    if (cleanTag.includes('/') || ['jumps', 'streams', 'speed', 'aim', 'technical', 'reading'].includes(cleanTag)) {
                        userTagMatches++;
                    }
                    if (matchedTagsList.length < 2) {
                        const displayName = cleanTag.includes('/') ? cleanTag.split('/')[1] : cleanTag;
                        matchedTagsList.push(displayName);
                    }
                }
            });
            const tagScore = Math.min(30, (tagMatches * 3) + (userTagMatches * 4));
            score += tagScore;
            if (matchedTagsList.length > 0) {
                reasons.push(`Estilo: ${matchedTagsList.join(', ')}`);
            }

            // Mapper affinity (Max 15 pts)
            if (profile.favoriteMappers.includes(c.creator)) {
                score += 15;
                reasons.push("Mapper favorito");
            }

            // Popularity/Playcount influence (Max 15 pts)
            // Logarítmico para suavizar grandes números
            const playcountScore = Math.min(15, Math.log10(c.playcount + 1) * 2.5);
            score += playcountScore;
            if (playcountScore >= 12) {
                reasons.push("Mapa popular");
            }

            // Ajuste por estilo solicitado
            if (style === 'aim') {
                const hasAimTag = combinedTags.some(t => AIM_TAGS.includes(t) || t.includes('jump'));
                if (hasAimTag) {
                    score += 25;
                    reasons.push("Enfoque: Aim");
                }
            } else if (style === 'speed') {
                const hasSpeedTag = combinedTags.some(t => SPEED_TAGS.includes(t) || t.includes('stream'));
                if (hasSpeedTag) {
                    score += 25;
                    reasons.push("Enfoque: Speed");
                }
            } else if (style === 'tags') {
                score += 25;
                reasons.push("Afinidad de patrones");
            }

            if (reasons.length === 0) {
                reasons.push("Compatible con tu nivel");
            }

            // Estimar PP
            const est100 = estimatePP(c.stars, 1.0, activeMods);
            const est99 = estimatePP(c.stars, 0.99, activeMods);

            return {
                beatmapId: c.beatmap_id.toString(),
                beatmapsetId: c.beatmapset_id.toString(),
                title: c.title,
                artist: c.artist,
                version: c.version,
                stars: parseFloat(c.stars),
                maxPP: est100,
                pp99: est99,
                mods: activeMods,
                popularity: c.playcount,
                length: c.total_length,
                ar: parseFloat(c.ar),
                od: parseFloat(c.od),
                hp: parseFloat(c.hp),
                cs: parseFloat(c.cs),
                creator: c.creator,
                matchScore: Math.min(100, Math.round(score)),
                matchReasons: reasons
            };
        });

    // Ordenar por afinidad descendente
    scoredCandidates.sort((a, b) => b.matchScore - a.matchScore);

    return scoredCandidates.slice(0, 30);
}

async function recalculateExactPP(recs, activeMods) {
    try {
        const rosu = require("rosu-pp-js");
        const BeatmapModel = require("./BeatmapModel.js");
        const activeModsStr = activeMods.replace(/CL/g, "");

        for (const rec of recs) {
            try {
                const meta = {
                    status: 'ranked',
                    last_updated: new Date().toISOString(),
                    version: rec.version,
                    beatmapset: {
                        artist: rec.artist,
                        title: rec.title
                    }
                };
                const map = await BeatmapModel.getBeatmap_osu(rec.beatmapsetId, rec.beatmapId, meta);
                if (map) {
                    const ppSS = new rosu.Performance({ mods: activeModsStr }).calculate(map).pp;
                    const pp99 = new rosu.Performance({ mods: activeModsStr, accuracy: 99 }).calculate(map).pp;

                    rec.maxPP = Math.round(ppSS);
                    rec.pp99 = Math.round(pp99);

                    map.free();
                }
            } catch (innerErr) {
                Logger.system(`Error al recalcular PP exacto con rosu para mapa ${rec.beatmapId}: ${innerErr.message}`);
            }
        }
    } catch (outerErr) {
        Logger.system(`Error cargando rosu-pp para recalculación de recomendaciones: ${outerErr.message}`);
    }
    return recs;
}

module.exports = {
    buildUserProfile,
    buildUserProfileAsync,
    getPersonalizedRecommendations,
    recalculateExactPP,
    estimatePP,
    ppToStars
};
