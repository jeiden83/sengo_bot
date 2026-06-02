const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');
const rosu = require("rosu-pp-js");
const { v2 } = require('osu-api-extended');
const OsuUserModel = require('./OsuUserModel.js');
const { localBeatmapStatus } = require("../commands/utils/admin.js");
const Logger = require("../utils/logger.js");
const { osuApiQueue } = require('../utils/OsuApiQueue.js');
const { getSupabaseClient } = require("../db/database.js");

let osuDirectOnline = true;
let lastOsuDirectCheck = 0;
const OSU_DIRECT_COOLDOWN = 60000; // 1 minuto de cooldown si falla

const beatmapCache = new Map();
const beatmapsetCache = new Map();

function setWithLimit(map, key, value, limit = 100) {
    if (map.size >= limit) {
        const firstKey = map.keys().next().value;
        map.delete(firstKey);
    }
    map.set(key, value);
}

/**
 * Obtiene y descarga el beatmap.osu dado el ID del set y del mapa.
 * Usado principalmente para el cálculo de PP.
 */
async function getBeatmap_osu(beatmapset_id, beatmap_osu_id, beatmap_metadata) {
    const filePath = await downloadBeatmapOsuFile(beatmapset_id, beatmap_osu_id, beatmap_metadata);
    return new rosu.Beatmap(fs.readFileSync(filePath));
}

/**
 * Descarga el archivo .osu físicamente si no existe o ha cambiado, y actualiza el estado local.
 */
async function downloadBeatmapOsuFile(beatmapset_id, beatmap_osu_id, beatmap_metadata) {
    const unranked_statuses = new Set(['pending', 'graveyard', 'qualified']);
    
    // Ruta del archivo local en la base de datos de caché
    const beatmapsetPath = path.join(__dirname, '../db/local/beatmap.osu');
    const folderPath = path.join(beatmapsetPath, `${beatmapset_id}`);
    const filePath = path.join(folderPath, `${beatmap_osu_id}.osu`);
    const storagePath = `${beatmapset_id}/${beatmap_osu_id}.osu`;

    let beatmap_index = null;
    let localFileIsValid = false;

    // 1. Verificar si el archivo ya existe en caché local y es válido
    if (fs.existsSync(filePath)) {
        if (!unranked_statuses.has(beatmap_metadata.status)) {
            localFileIsValid = true;
        } else {
            beatmap_index = await localBeatmapStatus(beatmap_osu_id);
            if (beatmap_index && beatmap_index.last_updated == beatmap_metadata.last_updated) {
                localFileIsValid = true;
            }
        }
    }

    if (localFileIsValid) {
        return filePath;
    }

    // 2. Si no es válido o no está localmente, verificar si podemos recuperarlo desde Supabase Storage
    let trySupabase = false;
    if (!beatmap_index) {
        beatmap_index = await localBeatmapStatus(beatmap_osu_id);
    }

    if (beatmap_index) {
        if (!unranked_statuses.has(beatmap_metadata.status) || 
            (beatmap_index.last_updated == beatmap_metadata.last_updated)) {
            trySupabase = true;
        }
    }

    if (trySupabase) {
        const supabase = getSupabaseClient();
        if (supabase) {
            try {
                const { data: downloadData, error: downloadError } = await supabase.storage
                    .from('osu_beatmaps')
                    .download(storagePath);
                
                if (!downloadError && downloadData) {
                    const fileText = await downloadData.text();
                    fs.mkdirSync(folderPath, { recursive: true });
                    fs.writeFileSync(filePath, fileText);
                    console.log(`[BeatmapModel] Beatmap ${beatmap_osu_id} recuperado desde Supabase Storage.`);
                    return filePath;
                }
            } catch (err) {
                console.warn(`[BeatmapModel] Error al descargar ${beatmap_osu_id} de Supabase Storage:`, err.message);
            }
        }
    }

    // 3. Realizar la solicitud HTTP si el archivo no está en caché local ni en Supabase Storage
    let data;
    let downloadSuccess = false;
    const nowTime = Date.now();

    // Comprobar si debemos intentar con osu.direct (si está online o el cooldown expiró)
    const shouldTryDirect = osuDirectOnline || (nowTime - lastOsuDirectCheck > OSU_DIRECT_COOLDOWN);

    if (shouldTryDirect) {
        try {
            const response = await axios.get(`https://osu.direct/api/osu/${beatmap_osu_id}/raw`, {
                timeout: 2500, // Timeout reducido a 2.5s para no hacer esperar demasiado en caso de caída
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false, // Ignorar certificados expirados
                }),
            });
            data = response.data;
            downloadSuccess = true;
            if (!osuDirectOnline) {
                osuDirectOnline = true;
                console.log("[BeatmapModel] osu.direct ha vuelto a estar online.");
            }
        } catch (error) {
            osuDirectOnline = false;
            lastOsuDirectCheck = Date.now();
            console.warn(`[BeatmapModel] osu.direct falló (${error.message}). Marcado como OFFLINE por 1 minuto. Intentando fallback a osu.ppy.sh...`);
        }
    }

    // Si falló osu.direct o está marcado como offline temporalmente, usar osu.ppy.sh como fallback inmediato
    if (!downloadSuccess) {
        try {
            const response = await axios.get(`https://osu.ppy.sh/osu/${beatmap_osu_id}`, {
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                }
            });
            data = response.data;
            downloadSuccess = true;
        } catch (error) {
            console.error(`[BeatmapModel] Error crítico: No se pudo descargar el beatmap ${beatmap_osu_id} desde ninguna fuente.`, error.message);
            throw error;
        }
    }

    try {
        // Crear la carpeta recursivamente si no existe
        fs.mkdirSync(folderPath, { recursive: true });

        // Guardar el archivo físicamente
        fs.writeFileSync(filePath, data);

        // Actualizar el index de beatmaps locales
        await localBeatmapStatus(beatmap_osu_id, beatmap_metadata);

        // Subir a Supabase Storage en segundo plano
        const supabase = getSupabaseClient();
        if (supabase) {
            supabase.storage
                .from('osu_beatmaps')
                .upload(storagePath, data, {
                    contentType: 'text/plain',
                    upsert: true
                })
                .then(({ error }) => {
                    if (error) {
                        console.error(`[BeatmapModel] Error al subir beatmap ${beatmap_osu_id} a Supabase Storage:`, error.message);
                    } else {
                        console.log(`[BeatmapModel] Beatmap ${beatmap_osu_id} subido exitosamente a Supabase Storage.`);
                    }
                })
                .catch(err => {
                    console.error(`[BeatmapModel] Excepción al subir beatmap ${beatmap_osu_id} a Supabase Storage:`, err.message);
                });
        }

        return filePath;
    } catch (error) {
        console.error('Error al guardar el beatmap localmente:', error.message);
        throw error;
    }
}

const activeBeatmapPromises = new Map();

/**
 * Obtiene los detalles de dificultad de un beatmap dado, con caché de 1 hora.
 */
async function getBeatmap(beatmap_id, priority = 2) {
    let cleanId = beatmap_id;
    if (typeof beatmap_id === 'string') {
        const match = beatmap_id.match(/\/beatmaps\/(\d+)/) || beatmap_id.match(/\/b\/(\d+)/);
        if (match) {
            cleanId = parseInt(match[1]);
        } else if (/^\d+$/.test(beatmap_id)) {
            cleanId = parseInt(beatmap_id);
        }
    } else if (typeof beatmap_id === 'number') {
        cleanId = beatmap_id;
    }

    const cached = beatmapCache.get(cleanId);
    const now = Date.now();
    if (cached && (now - cached.timestamp) < 3600000) {
        return cached.data;
    }

    // 1. Intentar buscar en la base de datos local (ranked_beatmaps) primero
    try {
        const supabase = getSupabaseClient();
        if (supabase) {
            const { data: dbMaps, error } = await supabase
                .from('ranked_beatmaps')
                .select('*')
                .eq('beatmap_id', cleanId)
                .limit(1);

            const dbMap = dbMaps?.[0];

            if (!error && dbMap) {
                const STATUS_MAP = {
                    1: 'ranked',
                    2: 'approved',
                    3: 'qualified',
                    4: 'loved'
                };
                const result = {
                    id: dbMap.beatmap_id,
                    beatmapset_id: dbMap.beatmapset_id,
                    max_combo: dbMap.max_combo || 0,
                    status: STATUS_MAP[dbMap.ranked_status] || 'ranked',
                    ar: dbMap.ar,
                    cs: dbMap.cs,
                    accuracy: dbMap.od,
                    hp: dbMap.hp,
                    bpm: dbMap.bpm,
                    difficulty_rating: dbMap.stars,
                    mode: dbMap.mode === 0 ? 'osu' : dbMap.mode === 1 ? 'taiko' : dbMap.mode === 2 ? 'fruits' : 'mania',
                    mode_int: dbMap.mode,
                    version: dbMap.version,
                    total_length: dbMap.total_length || 0,
                    hit_length: dbMap.hit_length || 0,
                    url: `https://osu.ppy.sh/beatmaps/${dbMap.beatmap_id}`,
                    beatmapset: {
                        id: dbMap.beatmapset_id,
                        title: dbMap.title,
                        artist: dbMap.artist,
                        creator: dbMap.creator,
                        covers: {
                            cover: `https://assets.ppy.sh/beatmaps/${dbMap.beatmapset_id}/covers/cover.jpg`,
                            "cover@2x": `https://assets.ppy.sh/beatmaps/${dbMap.beatmapset_id}/covers/cover@2x.jpg`,
                            list: `https://assets.ppy.sh/beatmaps/${dbMap.beatmapset_id}/covers/list.jpg`,
                            "list@2x": `https://assets.ppy.sh/beatmaps/${dbMap.beatmapset_id}/covers/list@2x.jpg`,
                            card: `https://assets.ppy.sh/beatmaps/${dbMap.beatmapset_id}/covers/card.jpg`,
                            "card@2x": `https://assets.ppy.sh/beatmaps/${dbMap.beatmapset_id}/covers/card@2x.jpg`,
                            slimcover: `https://assets.ppy.sh/beatmaps/${dbMap.beatmapset_id}/covers/slimcover.jpg`,
                            "slimcover@2x": `https://assets.ppy.sh/beatmaps/${dbMap.beatmapset_id}/covers/slimcover@2x.jpg`
                        }
                    }
                };
                setWithLimit(beatmapCache, cleanId, { data: result, timestamp: Date.now() });
                return result;
            }
        }
    } catch (dbErr) {
        Logger.system(`Error al consultar ranked_beatmaps para beatmap ${cleanId}: ${dbErr.message}`);
    }

    if (activeBeatmapPromises.has(cleanId)) {
        return activeBeatmapPromises.get(cleanId);
    }

    const promise = (async () => {
        await OsuUserModel.NewloadToken();
        const result = await osuApiQueue.add(() => v2.beatmaps.details({
            type: 'difficulty',
            id: cleanId
        }), priority);
        setWithLimit(beatmapCache, cleanId, { data: result, timestamp: Date.now() });
        return result;
    })();

    activeBeatmapPromises.set(cleanId, promise);
    try {
        return await promise;
    } finally {
        activeBeatmapPromises.delete(cleanId);
    }
}

/**
 * Obtiene los detalles de un beatmapset (incluyendo todas sus dificultades).
 */
async function getBeatmapset(beatmapset_id, priority = 2) {
    const cleanId = typeof beatmapset_id === 'string' ? parseInt(beatmapset_id) : beatmapset_id;
    if (isNaN(cleanId)) return null;

    const cached = beatmapsetCache.get(cleanId);
    const now = Date.now();
    if (cached && (now - cached.timestamp) < 3600000) {
        return cached.data;
    }

    await OsuUserModel.NewloadToken();
    const result = await osuApiQueue.add(() => v2.beatmaps.details({
        type: 'set',
        id: cleanId
    }), priority);

    setWithLimit(beatmapsetCache, cleanId, { data: result, timestamp: Date.now() });
    return result;
}

/**
 * Obtiene los detalles de dificultad para múltiples beatmaps en lote consultando a la DB.
 * Esto evita consultas secuenciales individuales y peticiones HTTP.
 */
async function batchGetBeatmaps(beatmapIds) {
    if (!Array.isArray(beatmapIds) || beatmapIds.length === 0) {
        return [];
    }

    const cleanIds = beatmapIds.map(id => {
        if (typeof id === 'string') {
            return parseInt(id);
        }
        return id;
    }).filter(id => !isNaN(id));

    if (cleanIds.length === 0) return [];

    // Encontrar qué IDs NO están en la caché
    const idsToQuery = [];
    const now = Date.now();
    for (const id of cleanIds) {
        const cached = beatmapCache.get(id);
        if (!cached || (now - cached.timestamp) >= 3600000) {
            idsToQuery.push(id);
        }
    }

    if (idsToQuery.length > 0) {
        try {
            const supabase = getSupabaseClient();
            if (supabase) {
                const { data, error } = await supabase
                    .from('ranked_beatmaps')
                    .select('*')
                    .in('beatmap_id', idsToQuery);

                if (!error && data) {
                    const STATUS_MAP = {
                        1: 'ranked',
                        2: 'approved',
                        3: 'qualified',
                        4: 'loved'
                    };
                    for (const dbMap of data) {
                        const result = {
                            id: dbMap.beatmap_id,
                            beatmapset_id: dbMap.beatmapset_id,
                            max_combo: dbMap.max_combo || 0,
                            status: STATUS_MAP[dbMap.ranked_status] || 'ranked',
                            ar: dbMap.ar,
                            cs: dbMap.cs,
                            accuracy: dbMap.od,
                            hp: dbMap.hp,
                            bpm: dbMap.bpm,
                            difficulty_rating: dbMap.stars,
                            mode: dbMap.mode === 0 ? 'osu' : dbMap.mode === 1 ? 'taiko' : dbMap.mode === 2 ? 'fruits' : 'mania',
                            mode_int: dbMap.mode,
                            version: dbMap.version,
                            total_length: dbMap.total_length || 0,
                            hit_length: dbMap.hit_length || 0,
                            url: `https://osu.ppy.sh/beatmaps/${dbMap.beatmap_id}`,
                            beatmapset: {
                                id: dbMap.beatmapset_id,
                                title: dbMap.title,
                                artist: dbMap.artist,
                                creator: dbMap.creator,
                                covers: {
                                    cover: `https://assets.ppy.sh/beatmaps/${dbMap.beatmapset_id}/covers/cover.jpg`,
                                    "cover@2x": `https://assets.ppy.sh/beatmaps/${dbMap.beatmapset_id}/covers/cover@2x.jpg`,
                                    list: `https://assets.ppy.sh/beatmaps/${dbMap.beatmapset_id}/covers/list.jpg`,
                                    "list@2x": `https://assets.ppy.sh/beatmaps/${dbMap.beatmapset_id}/covers/list@2x.jpg`,
                                    card: `https://assets.ppy.sh/beatmaps/${dbMap.beatmapset_id}/covers/card.jpg`,
                                    "card@2x": `https://assets.ppy.sh/beatmaps/${dbMap.beatmapset_id}/covers/card@2x.jpg`,
                                    slimcover: `https://assets.ppy.sh/beatmaps/${dbMap.beatmapset_id}/covers/slimcover.jpg`,
                                    "slimcover@2x": `https://assets.ppy.sh/beatmaps/${dbMap.beatmapset_id}/covers/slimcover@2x.jpg`
                                }
                            }
                        };
                        setWithLimit(beatmapCache, dbMap.beatmap_id, { data: result, timestamp: Date.now() });
                    }
                }
            }
        } catch (dbErr) {
            Logger.system(`Error en consulta por lote de ranked_beatmaps: ${dbErr.message}`);
        }
    }

    // Retornar los mapas que ya están en caché (que ahora incluye los recién consultados de la DB)
    const results = [];
    for (const id of cleanIds) {
        const cached = beatmapCache.get(id);
        if (cached) {
            results.push(cached.data);
        }
    }
    return results;
}

/**
 * Busca los detalles de dificultad de un beatmap dado su hash MD5.
 */
async function lookupBeatmapByMD5(md5) {
    await OsuUserModel.NewloadToken();
    try {
        const result = await v2.beatmaps.lookup({ type: 'difficulty', checksum: md5 });
        return result;
    } catch (e) {
        return null;
    }
}

const ppsCaches = {};
const PPS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas

function parseCSV(csvText) {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) return [];
    const headers = lines[0].split(",");
    
    return lines.slice(1).map(line => {
        const parts = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                parts.push(current);
                current = "";
            } else {
                current += char;
            }
        }
        parts.push(current);
        
        const row = {};
        headers.forEach((header, index) => {
            let val = parts[index] || "";
            if (val.startsWith('"') && val.endsWith('"')) {
                val = val.slice(1, -1);
            }
            row[header.trim()] = val.trim();
        });
        return row;
    });
}

async function getOsuPpsData(gamemode = 'osu') {
    const normalizedMode = (gamemode || 'osu').toLowerCase();
    const validModes = ['osu', 'taiko', 'mania', 'fruits'];
    const mode = validModes.includes(normalizedMode) ? normalizedMode : 'osu';

    const now = Date.now();
    const cached = ppsCaches[mode];
    if (cached && (now - cached.timestamp) < PPS_CACHE_TTL) {
        return cached.data;
    }

    const diffsUrl = `https://raw.githubusercontent.com/grumd/osu-pps/data/data/maps/${mode}/diffs.csv`;
    const mapsetsUrl = `https://raw.githubusercontent.com/grumd/osu-pps/data/data/maps/${mode}/mapsets.csv`;

    try {
        const [diffsRes, mapsetsRes] = await Promise.all([
            axios.get(diffsUrl, { timeout: 10000 }),
            axios.get(mapsetsUrl, { timeout: 10000 })
        ]);

        const diffs = parseCSV(diffsRes.data);
        const mapsets = parseCSV(mapsetsRes.data);

        const mapsetsMap = new Map();
        mapsets.forEach(set => {
            mapsetsMap.set(set.s, set);
        });

        const data = { diffs, mapsetsMap };
        ppsCaches[mode] = { data, timestamp: now };
        return data;
    } catch (error) {
        console.error(`Error al descargar datos de osu-pps para el modo ${mode}:`, error.message);
        if (cached) {
            return cached.data; // Fallback a la caché expirada
        }
        throw error;
    }
}

let lastScraperBlockTime = 0;
const tagsDetailCache = new Map();

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 OPR/107.0.0.0'
];

async function getBeatmapsetTagsDetail(beatmapsetId, priority = 0) {
    const now = Date.now();
    
    // Si fuimos bloqueados recientemente por Cloudflare, evitar nuevas peticiones HTTP por 15 minutos
    if (now - lastScraperBlockTime < 15 * 60 * 1000) {
        return null;
    }

    const cached = tagsDetailCache.get(beatmapsetId);
    if (cached && (now - cached.timestamp) < (cached.isError ? 3600000 : 3600000 * 24)) { // Caché de error por 1 hora, tags por 24 horas
        return cached.isError ? null : cached.data;
    }

    return osuApiQueue.add(async () => {
        try {
            const randomUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
            const url = `https://osu.ppy.sh/beatmapsets/${beatmapsetId}`;
            const res = await axios.get(url, {
                headers: { 
                    'User-Agent': randomUA,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3',
                    'Referer': 'https://osu.ppy.sh/beatmapsets',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                },
                timeout: 5000
            });
            const cheerio = require('cheerio');
            const $ = cheerio.load(res.data);
            const jsonText = $('#json-beatmapset').html();
            if (!jsonText) {
                return null;
            }
            const data = JSON.parse(jsonText);
            const result = {
                related_tags: data.related_tags || [],
                beatmaps: (data.beatmaps || []).map(b => ({
                    id: b.id,
                    top_tag_ids: b.top_tag_ids || []
                }))
            };
            
            tagsDetailCache.set(beatmapsetId, { data: result, timestamp: Date.now(), isError: false });
            return result;
        } catch (e) {
            const is403 = e.response && e.response.status === 403;
            if (is403) {
                lastScraperBlockTime = Date.now();
                Logger.system(`Scraper: Bloqueo 403 por Cloudflare al obtener tags detallados para beatmapset ${beatmapsetId} (cooldown de scraping activado por 15 minutos).`);
            } else {
                Logger.system(`Scraper: Error al obtener tags detallados para beatmapset ${beatmapsetId}: ${e.message}`);
            }
            tagsDetailCache.set(beatmapsetId, { data: null, timestamp: Date.now(), isError: true });
            return null;
        }
    }, priority);
}

function getTagsForBeatmap(detail, beatmapId) {
    if (!detail || !detail.beatmaps || !detail.related_tags) return [];
    
    const bm = detail.beatmaps.find(b => b.id === parseInt(beatmapId));
    if (!bm || !bm.top_tag_ids || bm.top_tag_ids.length === 0) {
        // Fallback: si no hay tags por dificultad, devolvemos los tags del set completo
        return detail.related_tags.map(t => t.name);
    }
    
    const tagMap = new Map();
    detail.related_tags.forEach(t => {
        tagMap.set(t.id, t.name);
    });
    
    return bm.top_tag_ids
        .map(obj => tagMap.get(obj.tag_id))
        .filter(Boolean);
}

async function updateBeatmapsetTagsInDB(beatmapsetId, detail, supabase = null) {
    const dbClient = supabase || getSupabaseClient();
    if (!dbClient || !detail) return;

    try {
        const promises = detail.beatmaps.map(async (bm) => {
            const tags = getTagsForBeatmap(detail, bm.id);
            const cleanTags = tags.map(t => t.toLowerCase().trim()).filter(t => t.length > 1);
            
            return dbClient
                .from('ranked_beatmaps')
                .update({ user_tags: cleanTags })
                .eq('beatmap_id', bm.id);
        });
        
        await Promise.all(promises);
    } catch (err) {
        Logger.system(`Error al actualizar tags por dificultad en BD para set ${beatmapsetId}: ${err.message}`);
    }
}

async function getBeatmapsetTags(beatmapsetId, priority = 0) {
    const detail = await getBeatmapsetTagsDetail(beatmapsetId, priority);
    if (!detail || !detail.related_tags) return null;
    return detail.related_tags.map(t => t.name);
}

function isScraperBlocked() {
    return (Date.now() - lastScraperBlockTime) < 15 * 60 * 1000;
}

const BeatmapModel = {
    getBeatmap_osu,
    downloadBeatmapOsuFile,
    getBeatmap,
    getBeatmapset,
    batchGetBeatmaps,
    lookupBeatmapByMD5,
    getOsuPpsData,
    getBeatmapsetTags,
    getBeatmapsetTagsDetail,
    getTagsForBeatmap,
    updateBeatmapsetTagsInDB,
    isScraperBlocked
};

module.exports = BeatmapModel;

