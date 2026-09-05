const { getSupabaseClient } = require("../db/database.js");
const Logger = require("../utils/logger.js");
const SkillsModel = require("./SkillsModel.js");

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
    } else if (mods.includes("EZ") && mods.includes("HD")) {
        // En osu! moderno (lazer/rosu-pp), HDEZ añade un enorme bonus de lectura por densidad y baja AR
        scaledStars *= 1.05;
    } else if (mods.includes("EZ")) {
        scaledStars *= 0.95;
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
async function buildUserProfileAsync(topScores, supabase = null, gamemode = 'osu') {
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
    let ezCount = 0;
    let flCount = 0;
    let nmCount = 0;
    let hdCount = 0;

    top25.forEach(score => {
        const mods = (score.mods || []).map(m => m?.acronym || m);
        const hasDT = mods.includes("DT") || mods.includes("NC");
        const hasHR = mods.includes("HR");
        const hasEZ = mods.includes("EZ");
        const hasFL = mods.includes("FL");
        const hasHD = mods.includes("HD");

        if (hasHD) hdCount++;

        if (hasEZ) ezCount++;
        else if (hasFL) flCount++;
        else if (hasDT) dtCount++;
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

    // Selección inteligente de preferredMod con soporte para EZ, FL e inclusión de HD si es predominante
    let baseMod = "NM";
    if (ezCount >= 3 && ezCount >= flCount) baseMod = "EZ";
    else if (flCount >= 3 && flCount > ezCount) baseMod = "FL";
    else if (dtCount > nmCount && dtCount > hrCount) baseMod = "DT";
    else if (hrCount > nmCount && hrCount > dtCount) baseMod = "HR";

    let preferredMod = baseMod;
    if (hdCount >= 10) {
        if (baseMod === "NM") preferredMod = "HD";
        else if (baseMod === "DT") preferredMod = "HDDT";
        else if (baseMod === "HR") preferredMod = "HDHR";
        else if (baseMod === "EZ") preferredMod = "HDEZ";
        else if (baseMod === "FL") preferredMod = "HDFL";
    }

    const avgStars = totalStars / top25.length;
    const avgBpm = validBpmCount > 0 ? (totalBpm / validBpmCount) : 180;
    const avgLength = validLengthCount > 0 ? (totalLength / validLengthCount) : 120;

    // Analizar tendencias de lectura/rarezas en el Top 100
    let ezCountTop100 = 0;
    let flCountTop100 = 0;
    let lowArCountTop100 = 0;
    let nonDtCountTop100 = 0;

    const flLengths = [];

    topScores.forEach(score => {
        const mods = (score.mods || []).map(m => m?.acronym || m);
        const hasEZ = mods.includes("EZ");
        const hasFL = mods.includes("FL");
        const hasDT = mods.includes("DT") || mods.includes("NC");

        if (hasEZ) ezCountTop100++;
        if (hasFL) flCountTop100++;

        if (hasFL) {
            let length = score.beatmap?.total_length || 0;
            if (length > 0) {
                if (hasDT) length /= 1.5;
                flLengths.push(length);
            }
        }

        if (!hasDT) {
            nonDtCountTop100++;
            const ar = score.beatmap?.ar;
            if (ar !== undefined) {
                const effectiveAr = hasEZ ? ar * 0.5 : ar;
                if (effectiveAr <= 8.0) {
                    lowArCountTop100++;
                }
            }
        }
    });

    const isEZPlayer = (ezCountTop100 / topScores.length) >= 0.05;
    const isFLPlayer = (flCountTop100 / topScores.length) >= 0.05;
    const isLowArPlayer = nonDtCountTop100 > 0 && (lowArCountTop100 / nonDtCountTop100) >= 0.15;
    
    let avgFlDuration = null;
    if (flLengths.length > 0) {
        flLengths.sort((a, b) => a - b);
        const half = Math.floor(flLengths.length / 2);
        if (flLengths.length % 2 !== 0) {
            avgFlDuration = flLengths[half];
        } else {
            avgFlDuration = (flLengths[half - 1] + flLengths[half]) / 2;
        }
    }

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
                    const { getBeatmapsetTagsDetail, updateBeatmapsetTagsInDB, getTagsForBeatmap } = require('./BeatmapModel.js');
                    
                    for (const setId of uniqueMissingSetIds) {
                        try {
                            const detail = await getBeatmapsetTagsDetail(setId, 2);
                            if (detail) {
                                await updateBeatmapsetTagsInDB(setId, detail, dbClient);
                                
                                const mapId = missingSets.get(setId);
                                const rawMapTags = getTagsForBeatmap(detail, mapId);
                                const cleanTags = rawMapTags.map(t => t.toLowerCase().trim()).filter(t => t.length > 1);
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
                if (cleanTag === 'meta/validated' || cleanTag.startsWith('meta/') || cleanTag === 'validated') {
                    return;
                }
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
                    if (cleanTag === 'meta/validated' || cleanTag.startsWith('meta/') || cleanTag === 'validated') {
                        return;
                    }
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

    const skills = SkillsModel.analyzeSkills(topScores, false, gamemode);
    const pushProfile = SkillsModel.analyzePlayerPushProfile(topScores, gamemode);

    return {
        avgStars,
        avgBpm,
        avgLength,
        preferredMod,
        favoriteMappers,
        frequentTags,
        isEZPlayer,
        isFLPlayer,
        isLowArPlayer,
        avgFlDuration,
        skills,
        pushProfile,
        gamemode
    };
}

/**
 * Analiza el perfil de forma síncrona (compatibilidad).
 */
function buildUserProfile(topScores, gamemode = 'osu') {
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
    let ezCount = 0;
    let flCount = 0;
    let nmCount = 0;
    let hdCount = 0;

    top25.forEach(score => {
        const mods = (score.mods || []).map(m => m?.acronym || m);
        const hasDT = mods.includes("DT") || mods.includes("NC");
        const hasHR = mods.includes("HR");
        const hasEZ = mods.includes("EZ");
        const hasFL = mods.includes("FL");
        const hasHD = mods.includes("HD");

        if (hasHD) hdCount++;

        if (hasEZ) ezCount++;
        else if (hasFL) flCount++;
        else if (hasDT) dtCount++;
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

    // Selección inteligente de preferredMod con soporte para EZ, FL e inclusión de HD si es predominante
    let baseMod = "NM";
    if (ezCount >= 3 && ezCount >= flCount) baseMod = "EZ";
    else if (flCount >= 3 && flCount > ezCount) baseMod = "FL";
    else if (dtCount > nmCount && dtCount > hrCount) baseMod = "DT";
    else if (hrCount > nmCount && hrCount > dtCount) baseMod = "HR";

    let preferredMod = baseMod;
    if (hdCount >= 10) {
        if (baseMod === "NM") preferredMod = "HD";
        else if (baseMod === "DT") preferredMod = "HDDT";
        else if (baseMod === "HR") preferredMod = "HDHR";
        else if (baseMod === "EZ") preferredMod = "HDEZ";
        else if (baseMod === "FL") preferredMod = "HDFL";
    }

    const avgStars = totalStars / top25.length;
    const avgBpm = validBpmCount > 0 ? (totalBpm / validBpmCount) : 180;
    const avgLength = validLengthCount > 0 ? (totalLength / validLengthCount) : 120;

    // Analizar tendencias de lectura/rarezas en el Top 100
    let ezCountTop100 = 0;
    let flCountTop100 = 0;
    let lowArCountTop100 = 0;
    let nonDtCountTop100 = 0;

    const flLengths = [];

    topScores.forEach(score => {
        const mods = (score.mods || []).map(m => m?.acronym || m);
        const hasEZ = mods.includes("EZ");
        const hasFL = mods.includes("FL");
        const hasDT = mods.includes("DT") || mods.includes("NC");

        if (hasEZ) ezCountTop100++;
        if (hasFL) flCountTop100++;

        if (hasFL) {
            let length = score.beatmap?.total_length || 0;
            if (length > 0) {
                if (hasDT) length /= 1.5;
                flLengths.push(length);
            }
        }

        if (!hasDT) {
            nonDtCountTop100++;
            const ar = score.beatmap?.ar;
            if (ar !== undefined) {
                const effectiveAr = hasEZ ? ar * 0.5 : ar;
                if (effectiveAr <= 8.0) {
                    lowArCountTop100++;
                }
            }
        }
    });

    const isEZPlayer = (ezCountTop100 / topScores.length) >= 0.05;
    const isFLPlayer = (flCountTop100 / topScores.length) >= 0.05;
    const isLowArPlayer = nonDtCountTop100 > 0 && (lowArCountTop100 / nonDtCountTop100) >= 0.15;
    
    let avgFlDuration = null;
    if (flLengths.length > 0) {
        flLengths.sort((a, b) => a - b);
        const half = Math.floor(flLengths.length / 2);
        if (flLengths.length % 2 !== 0) {
            avgFlDuration = flLengths[half];
        } else {
            avgFlDuration = (flLengths[half - 1] + flLengths[half]) / 2;
        }
    }

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
                const cleanTag = tag.toLowerCase().trim();
                if (cleanTag === 'meta/validated' || cleanTag.startsWith('meta/') || cleanTag === 'validated') {
                    return;
                }
                if (cleanTag.length > 2) {
                    tagCounts[cleanTag] = (tagCounts[cleanTag] || 0) + 1;
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

    const skills = SkillsModel.analyzeSkills(topScores, false, gamemode);
    const pushProfile = SkillsModel.analyzePlayerPushProfile(topScores, gamemode);

    return {
        avgStars,
        avgBpm,
        avgLength,
        preferredMod,
        favoriteMappers,
        frequentTags,
        isEZPlayer,
        isFLPlayer,
        isLowArPlayer,
        avgFlDuration,
        skills,
        pushProfile,
        gamemode
    };
}

let cachedMaxBeatmapsetId = null;
let lastMaxQueryTime = 0;

function getDifferentMod(mainMod) {
    const main = (mainMod || "NM").toUpperCase();
    let diffs = ['NM', 'HD', 'HR', 'DT'];
    if (main === 'NM') {
        diffs = ['HD', 'HR', 'DT', 'EZ'];
    } else if (main === 'HD') {
        diffs = ['NM', 'HR', 'DT'];
    } else if (main === 'HR') {
        diffs = ['NM', 'HD', 'DT'];
    } else if (main === 'DT') {
        diffs = ['NM', 'HD', 'HR'];
    } else {
        diffs = diffs.filter(m => m !== main);
    }
    return diffs[Math.floor(Math.random() * diffs.length)];
}

/**
 * Consulta mapas nativos de modos específicos (Taiko, Catch, Mania) desde la API de osu!
 * y los guarda en segundo plano en la base de datos local para enriquecer el catálogo.
 */
async function fetchNativeBeatmapsFromOsuApi(modeInt, minStars, maxStars) {
    try {
        const fs = require('fs');
        let token = null;
        try {
            const tokenData = JSON.parse(fs.readFileSync('./osu_api_extended_token.json', 'utf8'));
            token = tokenData.access_token;
        } catch {}
        if (!token) {
            const OsuUserModel = require('./OsuUserModel.js');
            const tokenObj = await OsuUserModel.loadToken();
            token = tokenObj?.access_token;
        }
        if (!token) return [];

        const sortParam = minStars >= 6.0 ? 'difficulty_desc' : 'plays_desc';
        const url = `https://osu.ppy.sh/api/v2/beatmapsets/search?m=${modeInt}&s=ranked&sort=${sortParam}`;
        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'x-api-version': '20240728'
            }
        });
        if (!res.ok) return [];
        const json = await res.json();
        const sets = json.beatmapsets || [];
        const candidates = [];
        const BeatmapModel = require('./BeatmapModel.js');

        for (const set of sets) {
            if (!set.beatmaps) continue;
            for (const b of set.beatmaps) {
                if (b.mode_int === modeInt) {
                    const stars = Number(b.difficulty_rating || 0);
                    if (stars >= Math.max(0.5, minStars - 0.5) && stars <= maxStars + 0.6) {
                        const formatted = {
                            beatmap_id: b.id,
                            beatmapset_id: set.id,
                            title: set.title,
                            artist: set.artist,
                            creator: set.creator,
                            version: b.version,
                            stars: stars,
                            mode: modeInt,
                            bpm: b.bpm || set.bpm || 180,
                            total_length: b.total_length || 100,
                            hit_length: b.hit_length || b.total_length || 100,
                            ar: b.ar || 9,
                            cs: b.cs || 4,
                            od: b.accuracy || 8,
                            hp: b.drain || 5,
                            max_combo: b.max_combo || null,
                            playcount: b.playcount || set.play_count || 10000,
                            ranked_status: 1,
                            user_tags: []
                        };
                        candidates.push(formatted);
                        BeatmapModel.saveBeatmapToDB(b, set).catch(() => {});
                    }
                }
            }
        }
        return candidates;
    } catch (e) {
        return [];
    }
}

/**
 * Obtiene recomendaciones de mapas para un usuario adaptadas por habilidades (Skills).
 * Soporta los 4 modos: osu (Standard), taiko, fruits (Catch) y mania.
 */
async function getPersonalizedRecommendations({
    topScores,
    customMinPP = null,
    customMaxPP = null,
    customMods = null,
    style = 'standard', // standard, aim, speed, length, rarezas
    customUserTag = null,
    showPlayed = false,
    skipSet = new Set(),
    gamemode = 'osu'
}) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Supabase client not initialized");
    }

    const MODE_INT = { osu: 0, taiko: 1, fruits: 2, catch: 2, ctb: 2, mania: 3 };
    const modeInt = MODE_INT[gamemode] ?? 0;

    // 1. Perfilado asíncrono con SkillsModel
    const profile = await buildUserProfileAsync(topScores, supabase, gamemode);
    if (!profile) {
        throw new Error("Could not build user profile");
    }

    const activeMods = customMods || profile.preferredMod;
    const isChokePusher = profile.pushProfile?.isChokePusher || false;

    // Determinar rango de estrellas objetivo considerando pushStars si es choke pusher
    let targetStars = profile.avgStars;
    const pushStars = profile.pushProfile?.pushStars || targetStars;
    let minStars = Math.max(1, targetStars - 0.85);
    let maxStars = isChokePusher ? Math.max(targetStars + 1.25, pushStars + 0.55) : (targetStars + 0.85);

    if (customMinPP !== null) {
        if (modeInt === 0) {
            const minTargetStars = ppToStars(customMinPP);
            const maxTargetStars = ppToStars(customMaxPP !== null ? customMaxPP : customMinPP * 1.3);
            
            let scale = 1.0;
            if (activeMods.includes("DT") || activeMods.includes("NC")) {
                scale = 1.35;
            } else if (activeMods.includes("HR")) {
                scale = 1.06;
            } else if (activeMods.includes("EZ") && activeMods.includes("HD")) {
                scale = 1.05;
            } else if (activeMods.includes("EZ")) {
                scale = 0.95;
            }
            
            minStars = Math.max(1, (minTargetStars / scale) - 0.1);
            maxStars = (maxTargetStars / scale) + (isChokePusher ? 0.90 : 0.45);
        } else {
            // Calibración por ratio de estrellas para Taiko, Catch y Mania
            const avgPlayPP = topScores[0]?.pp || 200;
            const ratio = customMinPP / Math.max(50, avgPlayPP);
            const scaledTarget = profile.avgStars * Math.pow(ratio, 0.25);
            minStars = Math.max(1, scaledTarget - 0.7);
            maxStars = scaledTarget + (isChokePusher ? 1.3 : 0.7);
        }
    }

    // Calcular el ID de beatmapset del corte de hace 6 meses
    let recentThreshold = 2436149;
    try {
        const now = Date.now();
        if (cachedMaxBeatmapsetId && (now - lastMaxQueryTime < 12 * 60 * 60 * 1000)) {
            recentThreshold = cachedMaxBeatmapsetId - 120000;
        } else {
            const { data: maxSetData } = await supabase
                .from('ranked_beatmaps')
                .select('beatmapset_id')
                .order('beatmapset_id', { ascending: false })
                .limit(1);
            if (maxSetData && maxSetData.length > 0) {
                cachedMaxBeatmapsetId = maxSetData[0].beatmapset_id;
                lastMaxQueryTime = now;
                recentThreshold = cachedMaxBeatmapsetId - 120000;
            }
        }
    } catch (e) {
        // Silenciar
    }

    // 2. Query de candidatos en Supabase
    const useTagsFilter = ['tags', 'aim', 'speed'].includes(style) || !!customUserTag;
    
    const buildBaseQuery = (validatedOnly = false, unvalidatedOnly = false) => {
        let q = supabase
            .from('ranked_beatmaps')
            .select('*')
            .gte('stars', minStars)
            .lte('stars', maxStars)
            .eq('mode', modeInt);

        if (style === 'rarezas') {
            q = q.in('ranked_status', [3, 4]); // Qualified, Loved
        } else {
            q = q.in('ranked_status', [1, 2]); // Ranked, Approved
        }

        if (customUserTag) {
            if (validatedOnly) {
                q = q.contains('user_tags', [customUserTag, 'meta/validated']);
            } else if (unvalidatedOnly) {
                q = q.contains('user_tags', [customUserTag]).not('user_tags', 'cs', '{"meta/validated"}');
            } else {
                q = q.contains('user_tags', [customUserTag]);
            }
        } else if (useTagsFilter) {
            if (validatedOnly) {
                q = q.contains('user_tags', ['meta/validated']);
            } else if (unvalidatedOnly) {
                q = q.not('user_tags', 'is', null).not('user_tags', 'cs', '{"meta/validated"}');
            } else {
                q = q.not('user_tags', 'is', null);
            }
        }
        return q;
    };

    const [valHigh, valMid, valLow, unvalHigh, unvalMid, unvalLow] = await Promise.all([
        buildBaseQuery(true, false).gte('playcount', 1000000).order('playcount', { ascending: false }).limit(200),
        buildBaseQuery(true, false).lt('playcount', 1000000).gte('playcount', 150000).order('playcount', { ascending: false }).limit(150),
        buildBaseQuery(true, false).lt('playcount', 150000).or(`playcount.gte.1000,beatmapset_id.gte.${recentThreshold}`).order('playcount', { ascending: false }).limit(150),
        
        buildBaseQuery(false, true).gte('playcount', 1000000).order('playcount', { ascending: false }).limit(200),
        buildBaseQuery(false, true).lt('playcount', 1000000).gte('playcount', 150000).order('playcount', { ascending: false }).limit(150),
        buildBaseQuery(false, true).lt('playcount', 150000).or(`playcount.gte.1000,beatmapset_id.gte.${recentThreshold}`).order('playcount', { ascending: false }).limit(150)
    ]);

    let candidates = [];
    const seenIds = new Set();
    const addCandidates = (data) => {
        if (data) {
            for (const item of data) {
                if (!seenIds.has(item.beatmap_id)) {
                    seenIds.add(item.beatmap_id);
                    candidates.push(item);
                }
            }
        }
    };

    addCandidates(valHigh.data);
    addCandidates(valMid.data);
    addCandidates(valLow.data);
    addCandidates(unvalHigh.data);
    addCandidates(unvalMid.data);
    addCandidates(unvalLow.data);

    // Si es un modo no-standard (Taiko, Catch, Mania) y la base de datos local tiene pocos candidatos,
    // consultar directamente la API de osu! y guardar en BD en background
    if (modeInt !== 0 && candidates.length < 15) {
        const apiCandidates = await fetchNativeBeatmapsFromOsuApi(modeInt, minStars, maxStars);
        addCandidates(apiCandidates);
    }

    // Fallback si intentamos filtrar por user_tags pero no encontramos suficientes candidatos
    if (useTagsFilter && style !== 'tags' && candidates.length < 5) {
        const buildFallbackQuery = () => {
            let q = supabase
                .from('ranked_beatmaps')
                .select('*')
                .gte('stars', minStars)
                .lte('stars', maxStars)
                .eq('mode', modeInt);

            if (style === 'rarezas') {
                q = q.in('ranked_status', [3, 4]);
            } else {
                q = q.in('ranked_status', [1, 2]);
            }
            return q;
        };

        const [fbHigh, fbMid, fbLow] = await Promise.all([
            buildFallbackQuery().gte('playcount', 1000000).order('playcount', { ascending: false }).limit(400),
            buildFallbackQuery().lt('playcount', 1000000).gte('playcount', 150000).order('playcount', { ascending: false }).limit(300),
            buildFallbackQuery().lt('playcount', 150000).or(`playcount.gte.1000,beatmapset_id.gte.${recentThreshold}`).order('playcount', { ascending: false }).limit(300)
        ]);

        candidates = [];
        seenIds.clear();
        addCandidates(fbHigh.data);
        addCandidates(fbMid.data);
        addCandidates(fbLow.data);
    }

    if (candidates.length === 0) {
        return [];
    }

    const top100MapIds = new Set(topScores.map(score => score.beatmap.id.toString()));

    const getCleanTags = (c) => {
        const rawTags = (c.user_tags && c.user_tags.length > 0) ? c.user_tags : (c.tags || []);
        return rawTags
            .map(t => t.toLowerCase().trim())
            .filter(t => t !== 'meta/validated' && !t.startsWith('meta/') && t !== 'validated');
    };

    // 3. Scoring cinético con Skills
    const scoredCandidates = candidates
        .filter(c => {
            const idStr = c.beatmap_id.toString();
            if (!showPlayed && top100MapIds.has(idStr)) return false;
            if (skipSet.has(idStr) || (c.beatmapset_id && skipSet.has(c.beatmapset_id.toString()))) return false;

            let candidateMod = customMods || profile.preferredMod;
            let isRandomMod = false;
            if (!customMods) {
                if (Math.random() < 0.15) {
                    candidateMod = getDifferentMod(profile.preferredMod);
                    isRandomMod = true;
                }
            }
            c._assignedMod = candidateMod;
            c._isRandomMod = isRandomMod;

            if (modeInt === 0 && customMinPP !== null) {
                const targetPushAcc = profile.pushProfile?.targetPushAcc || 0.985;
                const est100 = estimatePP(c.stars, 1.0, candidateMod);
                const estPush = isChokePusher ? estimatePP(c.stars, targetPushAcc, candidateMod) : est100;
                const limitMaxPP = customMaxPP !== null ? customMaxPP : customMinPP * (isChokePusher ? 1.60 : 1.30);
                
                const evalPP = isChokePusher ? estPush : est100;
                if (evalPP < customMinPP * 0.85 || evalPP > limitMaxPP) {
                    return false;
                }
            }

            if (customUserTag) {
                const tags = getCleanTags(c);
                const cleanTarget = customUserTag.toLowerCase().trim();
                const hasTargetTag = tags.some(t => t === cleanTarget || t.includes(cleanTarget));
                if (!hasTargetTag) return false;
            }

            if (style === 'aim') {
                const tags = getCleanTags(c);
                const hasAimTag = tags.some(t => {
                    if (t === 'aim' || t === 'jump' || t === 'jumps') return true;
                    if (t.includes('/') && (t.includes('aim') || t.includes('jump'))) return true;
                    return AIM_TAGS.some(at => t === at);
                });
                if (!hasAimTag) return false;
            } else if (style === 'speed') {
                const tags = getCleanTags(c);
                const hasSpeedTag = tags.some(t => {
                    if (t === 'stream' || t === 'streams' || t === 'speed' || t === 'burst' || t === 'bursts' || t === 'alt' || t === 'alternate' || t === 'stamina') return true;
                    if (t.includes('/') && (t.includes('stream') || t.includes('speed') || t.includes('burst') || t.includes('alt') || t.includes('stamina'))) return true;
                    return SPEED_TAGS.some(st => t === st);
                });
                if (!hasSpeedTag) return false;
            } else if (style === 'length') {
                const isDT = candidateMod.includes("DT") || candidateMod.includes("NC");
                if (isDT) {
                    if (c.total_length < 360) return false;
                } else {
                    if (c.total_length < 240) return false;
                }
            } else if (style === 'tags') {
                if (!c.user_tags || c.user_tags.length === 0) return false;
                const isMatchingTag = c.user_tags.some(t => {
                    const cleanTag = t.toLowerCase().trim();
                    return profile.frequentTags.includes(cleanTag);
                });
                const wantMatching = Math.random() < 0.60;
                let isRandomTag = false;
                if (wantMatching) {
                    if (!isMatchingTag) return false;
                } else {
                    if (isMatchingTag) return false;
                    isRandomTag = true;
                }
                c._isRandomTag = isRandomTag;
            }

            return true;
        })
        .map(c => {
            let score = 0;
            const reasons = [];
            const candidateMod = c._assignedMod || customMods || profile.preferredMod;

            // BPM similarity (Max 25 pts)
            const mapBpm = (candidateMod.includes("DT") || candidateMod.includes("NC")) ? c.bpm * 1.5 : c.bpm;
            const bpmDiff = Math.abs(mapBpm - profile.avgBpm);
            const bpmScore = Math.max(0, 25 * (1 - bpmDiff / 50));
            score += bpmScore;
            if (bpmScore >= 18) {
                reasons.push("BPM similar");
            }

            // Length similarity (Max 15 pts)
            const mapLength = (candidateMod.includes("DT") || candidateMod.includes("NC")) ? c.total_length / 1.5 : c.total_length;
            const lengthDiff = Math.abs(mapLength - profile.avgLength);
            const lengthScore = Math.max(0, 15 * (1 - lengthDiff / 120));
            score += lengthScore;

            if (style === 'length') {
                const isDT = candidateMod.includes("DT") || candidateMod.includes("NC");
                if (isDT) {
                    score += 25;
                    reasons.push("Largo con DT (+4m)");
                } else {
                    if (c.total_length >= 600) {
                        score += 30;
                        reasons.push("Maratón (+10m)");
                    } else {
                        score += 20;
                        reasons.push("Largo (+4m)");
                    }
                }
            } else if (lengthScore >= 11) {
                reasons.push("Duración similar");
            }

            // Tag similarity (Max 30 pts)
            let tagMatches = 0;
            let userTagMatches = 0;
            const matchedTagsList = [];
            const combinedTags = getCleanTags(c);

            profile.frequentTags.forEach(cleanTag => {
                if (cleanTag === 'meta/validated' || cleanTag.startsWith('meta/') || cleanTag === 'validated') {
                    return;
                }
                if (combinedTags.includes(cleanTag)) {
                    if (style === 'speed' && (cleanTag === 'aim' || cleanTag === 'jump' || cleanTag === 'jumps' || cleanTag.includes('aim') || cleanTag.includes('jump') || AIM_TAGS.some(at => cleanTag.includes(at)))) {
                        return;
                    }
                    if (style === 'aim' && (cleanTag === 'stream' || cleanTag === 'streams' || cleanTag === 'speed' || cleanTag === 'burst' || cleanTag === 'bursts' || cleanTag === 'alt' || cleanTag === 'alternate' || cleanTag === 'stamina' || cleanTag.includes('stream') || cleanTag.includes('speed') || cleanTag.includes('burst') || cleanTag.includes('alt') || SPEED_TAGS.some(st => cleanTag.includes(st)))) {
                        return;
                    }

                    tagMatches++;
                    if (cleanTag.includes('/') || ['jumps', 'streams', 'speed', 'aim', 'technical', 'reading'].includes(cleanTag)) {
                        userTagMatches++;
                    }
                    if (matchedTagsList.length < 2) {
                        const displayName = cleanTag.includes('/') ? cleanTag.split('/')[1] : cleanTag;
                        if (displayName && displayName !== 'validated' && !displayName.startsWith('meta')) {
                            matchedTagsList.push(displayName);
                        }
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

            // Popularity (Max 15 pts)
            const playcountScore = Math.min(15, Math.log10((c.playcount || 0) + 1) * 2.5);
            score += playcountScore;
            if (playcountScore >= 12) {
                reasons.push("Mapa popular");
            }

            if (customUserTag) {
                const cleanTarget = customUserTag.toLowerCase().trim();
                if (combinedTags.some(t => t === cleanTarget || t.includes(cleanTarget))) {
                    score += 40;
                    reasons.push(`Tag: ${customUserTag}`);
                }
            }

            if (style === 'aim') {
                const hasAimTag = combinedTags.some(t => AIM_TAGS.includes(t) || t.includes('jump'));
                if (hasAimTag) {
                    score += 25;
                    reasons.push("Enfoque: Aim");
                }
                const hasSpeedTag = combinedTags.some(t => SPEED_TAGS.includes(t) || t.includes('stream'));
                if (hasSpeedTag) {
                    score -= 35;
                }
            } else if (style === 'speed') {
                const hasSpeedTag = combinedTags.some(t => SPEED_TAGS.includes(t) || t.includes('stream'));
                if (hasSpeedTag) {
                    score += 25;
                    reasons.push("Enfoque: Speed");
                }
                const hasAimTag = combinedTags.some(t => AIM_TAGS.includes(t) || t.includes('jump'));
                if (hasAimTag) {
                    score -= 35;
                }
            } else if (style === 'tags') {
                score += 25;
                reasons.push("Afinidad de patrones");
            }

            // Boosts de nicho
            if (profile.isEZPlayer) {
                if (candidateMod.includes("EZ")) {
                    score += 25;
                }
                const hasEZTag = combinedTags.some(t => t === 'ez' || t === 'reading' || t === 'technical' || t === 'low ar' || t.includes('reading') || t.includes('gimmick'));
                if (hasEZTag) {
                    score += 25;
                    reasons.push("Estilo EZ / Gimmick");
                }
            }

            if (profile.isFLPlayer) {
                if (candidateMod.includes("FL")) {
                    score += 25;
                }
                const hasFLTag = combinedTags.some(t => t === 'fl' || t === 'flashlight' || t.includes('flashlight') || t === 'memory');
                if (hasFLTag) {
                    score += 35;
                    reasons.push("Estilo Flashlight");
                }
                if (candidateMod.includes("FL") && profile.avgFlDuration !== undefined && profile.avgFlDuration !== null) {
                    if (c.total_length >= profile.avgFlDuration) {
                        score += 25;
                        reasons.push(`Duración adecuada para FL (≥ ${Math.round(profile.avgFlDuration)}s)`);
                    } else {
                        score -= 30;
                    }
                }
            }

            if (profile.isLowArPlayer) {
                const mapAr = parseFloat(c.ar);
                if (mapAr <= 8.0) {
                    score += 35;
                    reasons.push(`Lectura: AR Bajo (${mapAr})`);
                } else if (mapAr <= 8.5) {
                    score += 15;
                    reasons.push(`AR cómodo (${mapAr})`);
                }
            }

            // ----------------------------------------------------
            // 4. Integración de SkillsModel: Evaluación Cinética Multi-Modo
            // ----------------------------------------------------
            const mapSkills = SkillsModel.estimateMapSkills(c, candidateMod, gamemode);
            let skillBonus = 0;
            const skillReasons = [];

            if (modeInt === 0) {
                // osu! Standard
                const aimSpeedGap = (profile.skills?.aim || 50) - (profile.skills?.speed || 50);
                if (aimSpeedGap > 14) {
                    if (mapSkills.speedDominance > 0.60) {
                        skillBonus -= 35;
                        skillReasons.push("Exceso de streams para tu perfil de speed");
                    } else if (mapSkills.speedDominance < 0.40) {
                        skillBonus += 25;
                        skillReasons.push("Ideal para tu maestría de Aim");
                    }
                } else if (aimSpeedGap < -14) {
                    if (mapSkills.speedDominance > 0.55) {
                        skillBonus += 30;
                        skillReasons.push("Aprovecha tu velocidad/stamina");
                    } else if (mapSkills.speedDominance < 0.35) {
                        skillBonus -= 25;
                    }
                } else {
                    skillBonus += 15;
                    skillReasons.push("Equilibrio Aim/Speed adecuado");
                }

                if ((profile.skills?.reading || 50) >= 65) {
                    if (mapSkills.readingReq >= 60 || candidateMod.includes("EZ") || candidateMod.includes("HD")) {
                        skillBonus += 30;
                        skillReasons.push("Alineado a tu alta lectura");
                    }
                } else if ((profile.skills?.reading || 50) < 45 && mapSkills.readingReq > 65) {
                    skillBonus -= 25;
                    skillReasons.push("Alta exigencia de lectura");
                }
            } else if (modeInt === 1) {
                // osu!taiko
                const stamColorGap = (profile.skills?.stamina || 50) - (profile.skills?.color || 50);
                if (stamColorGap > 10) {
                    if (mapSkills.staminaReq >= 45) {
                        skillBonus += 25;
                        skillReasons.push("Alineado a tu stamina de golpeo");
                    }
                } else {
                    if (mapSkills.colorReq >= 45) {
                        skillBonus += 25;
                        skillReasons.push("Alineado a tu técnica de switching");
                    }
                }
            } else if (modeInt === 2) {
                // osu!catch
                const moveSpeedGap = (profile.skills?.movement || 50) - (profile.skills?.speed || 50);
                if (moveSpeedGap > 10) {
                    if (mapSkills.movementReq >= 45) {
                        skillBonus += 25;
                        skillReasons.push("Ideal para tu control de plato");
                    }
                } else {
                    if (mapSkills.speedReq >= 45) {
                        skillBonus += 25;
                        skillReasons.push("Ideal para hyperdashes veloces");
                    }
                }
            } else if (modeInt === 3) {
                // osu!mania
                if (profile.keymodeInfo?.mode && mapSkills.keymode) {
                    if (profile.keymodeInfo.mode === mapSkills.keymode) {
                        skillBonus += 35;
                        skillReasons.push(`Modo ${mapSkills.keymode} preferido`);
                    } else {
                        skillBonus -= 35;
                    }
                }
                const streamJackGap = (profile.skills?.stream || 50) - (profile.skills?.jack || 50);
                if (streamJackGap > 10) {
                    if (mapSkills.streamReq >= 45) {
                        skillBonus += 20;
                        skillReasons.push("Alineado a tu velocidad de stream");
                    }
                } else {
                    skillBonus += 20;
                    skillReasons.push("Alineado a tu control de acordes");
                }
            }

            // Adaptación de Push y Choke
            const targetPushAcc = profile.pushProfile?.targetPushAcc || 0.985;
            if (profile.pushProfile?.isChokePusher) {
                if (parseFloat(c.stars) >= (profile.pushProfile.avgPlayedStars - 0.2)) {
                    skillBonus += 20;
                    skillReasons.push("Potencial de push en alta dificultad");
                }
            }
            if ((profile.skills?.acc || 50) < 45) {
                skillReasons.push(`PP calibrado para tu push (~${(targetPushAcc * 100).toFixed(1)}% acc)`);
            } else if ((profile.skills?.acc || 50) > 70) {
                skillReasons.push("Aprovecha tu alta precisión");
            }

            score += skillBonus;
            reasons.push(...skillReasons);

            if (reasons.length === 0) {
                reasons.push("Compatible con tu nivel");
            }

            const est100 = modeInt === 0 ? estimatePP(c.stars, 1.0, candidateMod) : Math.round(c.stars * 55);
            const est99 = modeInt === 0 ? estimatePP(c.stars, 0.99, candidateMod) : Math.round(c.stars * 50);

            return {
                beatmapId: c.beatmap_id.toString(),
                beatmapsetId: c.beatmapset_id.toString(),
                title: c.title,
                artist: c.artist,
                version: c.version,
                stars: parseFloat(c.stars),
                maxPP: est100,
                pp99: est99,
                mods: candidateMod,
                popularity: c.playcount,
                length: c.total_length,
                ar: parseFloat(c.ar),
                od: parseFloat(c.od),
                hp: parseFloat(c.hp),
                cs: parseFloat(c.cs),
                bpm: parseFloat(c.bpm),
                creator: c.creator,
                matchScore: Math.min(100, Math.max(0, Math.round(score))),
                rawScore: score,
                matchReasons: reasons,
                isRandomMod: c._isRandomMod || false,
                isRandomTag: c._isRandomTag || false,
                userTags: c.user_tags || [],
                mapSkills,
                targetPushAcc,
                isChokePusher
            };
        });

    const highTier = [];
    const midTier = [];
    const lowTier = [];

    for (const c of scoredCandidates) {
        const pop = c.popularity;
        if (pop >= 1000000) {
            highTier.push(c);
        } else if (pop >= 150000) {
            midTier.push(c);
        } else {
            lowTier.push(c);
        }
    }

    highTier.sort((a, b) => b.rawScore - a.rawScore);
    midTier.sort((a, b) => b.rawScore - a.rawScore);
    lowTier.sort((a, b) => b.rawScore - a.rawScore);

    const selectedHigh = highTier.slice(0, 10);
    const selectedMid = midTier.slice(0, 10);
    const selectedLow = lowTier.slice(0, 10);

    return [...selectedHigh, ...selectedMid, ...selectedLow];
}

async function recalculateExactPP(recs, activeMods, gamemode = 'osu', targetPushAcc = null) {
    try {
        const ppEngine = require("../utils/ppEngine.js");
        const BeatmapModel = require("./BeatmapModel.js");
        const MODE_INT = { osu: 0, taiko: 1, fruits: 2, catch: 2, ctb: 2, mania: 3 };
        const modeInt = MODE_INT[gamemode] ?? 0;

        for (const rec of recs) {
            try {
                const recMods = activeMods || rec.mods || "NM";
                const activeModsStr = recMods.replace(/CL/g, "").replace(/NM/g, "");
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
                    if (modeInt !== 0 && typeof map.convert === "function") {
                        map.convert(modeInt);
                    }
                    const diffAttrs = new ppEngine.Difficulty({ mods: activeModsStr, mode: modeInt }).calculate(map);
                    const perfAttrs = new ppEngine.Performance({ mods: activeModsStr, mode: modeInt }).calculate(diffAttrs);
                    const ppSS = perfAttrs.pp;
                    const pp99 = new ppEngine.Performance({ mods: activeModsStr, mode: modeInt, accuracy: 99 }).calculate(diffAttrs).pp;

                    rec.maxPP = Math.round(ppSS);
                    rec.pp99 = Math.round(pp99);
                    const starsVal = diffAttrs.stars;
                    if (typeof starsVal === 'number') {
                        rec.stars = starsVal;
                    }

                    // Push PP calibrado entre el promedio y el máximo para instigar a pushear
                    const pushAcc = targetPushAcc || rec.targetPushAcc;
                    if (pushAcc && (pushAcc < 0.99 || rec.isChokePusher)) {
                        const pushAccPct = pushAcc * 100;
                        const pushPerf = new ppEngine.Performance({ mods: activeModsStr, mode: modeInt, accuracy: pushAccPct }).calculate(diffAttrs);
                        rec.pushPP = Math.round(pushPerf.pp);
                        rec.pushAcc = pushAcc;
                    }

                    map.free();
                }
            } catch (err) {
                // Silencioso por mapa individual
            }
        }
    } catch (e) {
        console.error("[RecModel] Error recalculando exact PP:", e);
    }
    return recs;
}

function isCandidateTagValidInMemory(candidate, customUserTag, style) {
    const userTags = candidate.userTags || [];
    if (!userTags.includes("meta/validated")) {
        return null; // Requiere validación externa por HTTP
    }
    
    const actualTags = userTags.map(t => t.toLowerCase().trim());
    
    if (customUserTag) {
        const cleanTarget = customUserTag.toLowerCase().trim();
        const hasTargetTag = actualTags.some(t => t === cleanTarget || t.includes(cleanTarget));
        if (!hasTargetTag) return false;
    }
    
    if (style === 'aim') {
        const hasAimTag = actualTags.some(t => {
            if (t === 'aim' || t === 'jump' || t === 'jumps') return true;
            if (t.includes('/') && (t.includes('aim') || t.includes('jump'))) return true;
            return AIM_TAGS.some(at => t === at);
        });
        if (!hasAimTag) return false;
    } else if (style === 'speed') {
        const hasSpeedTag = actualTags.some(t => {
            if (t === 'stream' || t === 'streams' || t === 'speed' || t === 'burst' || t === 'bursts' || t === 'alt' || t === 'alternate' || t === 'stamina') return true;
            if (t.includes('/') && (t.includes('stream') || t.includes('speed') || t.includes('burst') || t.includes('alt') || t.includes('stamina'))) return true;
            return SPEED_TAGS.some(st => t === st);
        });
        if (!hasSpeedTag) return false;
    }
    
    return true;
}

async function validateCandidateTags(beatmapId, beatmapsetId, customUserTag, style) {
    try {
        const BeatmapModel = require("./BeatmapModel.js");
        const detail = await BeatmapModel.getBeatmapsetTagsDetail(beatmapsetId, 2);
        
        // Si no se pudo obtener o está bloqueado, devolvemos true por fail-safe
        if (!detail) return true;

        const actualTags = BeatmapModel.getTagsForBeatmap(detail, beatmapId).map(t => t.toLowerCase().trim());

        // Validar tag personalizado
        if (customUserTag) {
            const cleanTarget = customUserTag.toLowerCase().trim();
            const hasTargetTag = actualTags.some(t => t === cleanTarget || t.includes(cleanTarget));
            if (!hasTargetTag) {
                // Autocuración: actualizar en BD en segundo plano para no demorar la recomendación
                BeatmapModel.updateBeatmapsetTagsInDB(beatmapsetId, detail).catch(() => {});
                return false;
            }
        }

        // Validar por estilo (aim/speed)
        if (style === 'aim') {
            const hasAimTag = actualTags.some(t => {
                if (t === 'aim' || t === 'jump' || t === 'jumps') return true;
                if (t.includes('/') && (t.includes('aim') || t.includes('jump'))) return true;
                return AIM_TAGS.some(at => t === at);
            });
            if (!hasAimTag) {
                BeatmapModel.updateBeatmapsetTagsInDB(beatmapsetId, detail).catch(() => {});
                return false;
            }
        } else if (style === 'speed') {
            const hasSpeedTag = actualTags.some(t => {
                if (t === 'stream' || t === 'streams' || t === 'speed' || t === 'burst' || t === 'bursts' || t === 'alt' || t === 'alternate' || t === 'stamina') return true;
                if (t.includes('/') && (t.includes('stream') || t.includes('speed') || t.includes('burst') || t.includes('alt') || t.includes('stamina'))) return true;
                return SPEED_TAGS.some(st => t === st);
            });
            if (!hasSpeedTag) {
                BeatmapModel.updateBeatmapsetTagsInDB(beatmapsetId, detail).catch(() => {});
                return false;
            }
        }

        return true;
    } catch (err) {
        Logger.system(`Error en validateCandidateTags para mapa ${beatmapId}: ${err.message}`);
        return true; // Fail-safe
    }
}

module.exports = {
    buildUserProfile,
    buildUserProfileAsync,
    getPersonalizedRecommendations,
    recalculateExactPP,
    estimatePP,
    ppToStars,
    validateCandidateTags,
    isCandidateTagValidInMemory
};
