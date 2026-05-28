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

/**
 * Traduce un valor aproximado de PP a una calificación de estrellas estimada.
 */
function ppToStars(pp) {
    if (pp <= 0) return 0;
    return 0.5 + Math.sqrt(pp) * 0.33;
}

/**
 * Analiza el Top 100 de jugadas de un usuario para construir su perfil vectorial.
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
        const mods = (score.mods || []).map(m => m.acronym);
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

    // Analizar mappers favoritos en el Top 50
    const top50 = topScores.slice(0, 50);
    const mapperCounts = {};
    const tagCounts = {};

    top50.forEach(score => {
        const creator = score.beatmapset?.creator;
        if (creator) {
            mapperCounts[creator] = (mapperCounts[creator] || 0) + 1;
        }
        // Extraer tags si están disponibles en el score
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

    // 1. Perfilado
    const profile = buildUserProfile(topScores);
    if (!profile) {
        throw new Error("Could not build user profile");
    }

    const activeMods = customMods || profile.preferredMod;

    // Determinar rango de estrellas objetivo
    let targetStars = profile.avgStars;
    if (customMinPP !== null) {
        // Si hay un PP especificado, estimamos las estrellas basadas en el promedio
        const targetPP = (customMinPP + (customMaxPP || customMinPP * 1.2)) / 2;
        targetStars = ppToStars(targetPP);
        // Si el usuario juega DT, ajustamos las estrellas a NM
        if (activeMods.includes("DT") || activeMods.includes("NC")) {
            targetStars /= 1.35;
        } else if (activeMods.includes("HR")) {
            targetStars /= 1.06;
        }
    }

    const minStars = Math.max(1, targetStars - 0.75);
    const maxStars = targetStars + 0.75;

    // 2. Query de candidatos en Supabase
    let query = supabase
        .from('ranked_beatmaps')
        .select('*')
        .gte('stars', minStars)
        .lte('stars', maxStars)
        .eq('mode', 0); // standard

    // Si estilo es loved o rarezas, filtramos de forma distinta
    if (style === 'rarezas') {
        query = query.in('ranked_status', [3, 4]); // Qualified, Loved
    } else {
        query = query.in('ranked_status', [1, 2]); // Ranked, Approved
    }

    const { data: candidates, error } = await query;
    if (error) {
        throw error;
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
            // Filtrar jugados si no se solicita mostrarlos
            if (!showPlayed && top100MapIds.has(idStr)) return false;
            // Filtrar mostrados en esta sesión
            if (skipSet.has(idStr)) return false;
            return true;
        })
        .map(c => {
            let score = 0;

            // BPM similarity (Max 25 pts)
            const mapBpm = (activeMods.includes("DT") || activeMods.includes("NC")) ? c.bpm * 1.5 : c.bpm;
            const bpmDiff = Math.abs(mapBpm - profile.avgBpm);
            const bpmScore = Math.max(0, 25 * (1 - bpmDiff / 50));
            score += bpmScore;

            // Length similarity (Max 15 pts)
            const mapLength = (activeMods.includes("DT") || activeMods.includes("NC")) ? c.total_length / 1.5 : c.total_length;
            const lengthDiff = Math.abs(mapLength - profile.avgLength);
            const lengthScore = Math.max(0, 15 * (1 - lengthDiff / 120));
            score += lengthScore;

            // Tag similarity (Max 30 pts)
            let tagMatches = 0;
            if (Array.isArray(c.tags)) {
                c.tags.forEach(t => {
                    if (profile.frequentTags.includes(t)) {
                        tagMatches++;
                    }
                });
            }
            const tagScore = Math.min(30, tagMatches * 4);
            score += tagScore;

            // Mapper affinity (Max 15 pts)
            if (profile.favoriteMappers.includes(c.creator)) {
                score += 15;
            }

            // Popularity/Playcount influence (Max 15 pts)
            // Logarítmico para suavizar grandes números
            const playcountScore = Math.min(15, Math.log10(c.playcount + 1) * 2.5);
            score += playcountScore;

            // Ajuste por estilo solicitado
            if (style === 'aim') {
                const hasAimTag = Array.isArray(c.tags) && c.tags.some(t => AIM_TAGS.includes(t));
                if (hasAimTag) score += 25;
            } else if (style === 'speed') {
                const hasSpeedTag = Array.isArray(c.tags) && c.tags.some(t => SPEED_TAGS.includes(t));
                if (hasSpeedTag) score += 25;
            } else if (style === 'length') {
                if (c.total_length >= 180) score += 25;
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
                matchScore: Math.round(score)
            };
        });

    // Ordenar por afinidad descendente
    scoredCandidates.sort((a, b) => b.matchScore - a.matchScore);

    // Tomar las 3 mejores
    return scoredCandidates.slice(0, 3);
}

module.exports = {
    buildUserProfile,
    getPersonalizedRecommendations,
    estimatePP,
    ppToStars
};
