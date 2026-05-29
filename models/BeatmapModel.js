const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');
const rosu = require("rosu-pp-js");
const { v2 } = require('osu-api-extended');
const OsuUserModel = require('./OsuUserModel.js');
const { localBeatmapStatus } = require("../commands/utils/admin.js");
const Logger = require("../utils/logger.js");

let osuDirectOnline = true;
let lastOsuDirectCheck = 0;
const OSU_DIRECT_COOLDOWN = 60000; // 1 minuto de cooldown si falla

const beatmapCache = new Map();

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

    // Verificar si el archivo ya existe en caché local
    if (fs.existsSync(filePath)) {
        if (!unranked_statuses.has(beatmap_metadata.status)) {
            return filePath;
        }

        const beatmap_index = await localBeatmapStatus(beatmap_osu_id);

        if (!unranked_statuses.has(beatmap_metadata.status)) {
            if (!beatmap_index) await localBeatmapStatus(beatmap_osu_id, beatmap_metadata);
            return filePath;
        }

        if (beatmap_index && beatmap_index.last_updated == beatmap_metadata.last_updated) {
            return filePath;
        }
    }

    // Realizar la solicitud HTTP si el archivo no está en caché
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

        return filePath;
    } catch (error) {
        console.error('Error al guardar el beatmap localmente:', error.message);
        throw error;
    }
}

/**
 * Obtiene los detalles de dificultad de un beatmap dado, con caché de 1 hora.
 */
async function getBeatmap(beatmap_id) {
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

    await OsuUserModel.NewloadToken();

    const result = await v2.beatmaps.details({
        type: 'difficulty',
        id: cleanId
    });

    setWithLimit(beatmapCache, cleanId, { data: result, timestamp: now });
    return result;
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

const tagsCache = new Map();

/**
 * Obtiene las etiquetas de usuario (related_tags) de un beatmapset mediante scraping de la web oficial de osu!.
 */
async function getBeatmapsetTags(beatmapsetId) {
    const cached = tagsCache.get(beatmapsetId);
    const now = Date.now();
    if (cached && (now - cached.timestamp) < (cached.isError ? 3600000 : 3600000 * 24)) { // Caché de error por 1 hora, tags por 24 horas
        return cached.data;
    }

    try {
        const url = `https://osu.ppy.sh/beatmapsets/${beatmapsetId}`;
        const res = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
            return [];
        }
        const data = JSON.parse(jsonText);
        const related = data.related_tags || [];
        const tags = related.map(t => t.name);
        
        tagsCache.set(beatmapsetId, { data: tags, timestamp: now, isError: false });
        return tags;
    } catch (e) {
        const is403 = e.response && e.response.status === 403;
        if (is403) {
            Logger.system(`Scraper: Bloqueo 403 por Cloudflare al obtener tags para beatmapset ${beatmapsetId} (reintentando más tarde).`);
        } else {
            Logger.system(`Scraper: Error al obtener tags para beatmapset ${beatmapsetId}: ${e.message}`);
        }
        tagsCache.set(beatmapsetId, { data: [], timestamp: now, isError: true });
        return [];
    }
}

const BeatmapModel = {
    getBeatmap_osu,
    downloadBeatmapOsuFile,
    getBeatmap,
    lookupBeatmapByMD5,
    getOsuPpsData,
    getBeatmapsetTags
};

module.exports = BeatmapModel;

