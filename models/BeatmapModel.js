const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');
const rosu = require("rosu-pp-js");
const { v2 } = require('osu-api-extended');
const OsuUserModel = require('./OsuUserModel.js');
const { localBeatmapStatus } = require("../commands/utils/admin.js");

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
    const options = {
        method: 'GET',
        url: `https://osu.direct/api/osu/${beatmap_osu_id}/raw`,
        httpsAgent: new https.Agent({
            rejectUnauthorized: false, // Ignorar certificados expirados
        }),
    };

    try {
        const { data } = await axios.request(options);

        // Crear la carpeta recursivamente si no existe
        fs.mkdirSync(folderPath, { recursive: true });

        // Guardar el archivo físicamente
        fs.writeFileSync(filePath, data);

        // Actualizar el index de beatmaps locales
        await localBeatmapStatus(beatmap_osu_id, beatmap_metadata);

        return filePath;
    } catch (error) {
        console.error('Error al descargar el beatmap:', error.message);
        throw error;
    }
}

/**
 * Obtiene los detalles de dificultad de un beatmap dado, con caché de 1 hora.
 */
async function getBeatmap(beatmap_id) {
    const cached = beatmapCache.get(beatmap_id);
    const now = Date.now();
    if (cached && (now - cached.timestamp) < 3600000) {
        return cached.data;
    }

    await OsuUserModel.NewloadToken();

    const result = await v2.beatmaps.details({
        type: 'difficulty',
        id: beatmap_id
    });

    setWithLimit(beatmapCache, beatmap_id, { data: result, timestamp: now });
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

const BeatmapModel = {
    getBeatmap_osu,
    downloadBeatmapOsuFile,
    getBeatmap,
    lookupBeatmapByMD5
};

module.exports = BeatmapModel;
