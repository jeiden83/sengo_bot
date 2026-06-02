const { auth, v2 } = require('osu-api-extended');
const { getSupabaseClient } = require('../db/database.js');
const CONFIG = require('../config.js');
const Logger = require('../utils/logger.js');
const fs = require('fs');
const path = require('path');

const STATUS_FILE = path.join(__dirname, "../db/local/beatmap_sync_status.json");

const GENRES = {
    0: 'Any', 1: 'Unspecified', 2: 'Video Game', 3: 'Anime', 4: 'Rock', 5: 'Pop',
    6: 'Other', 7: 'Novelty', 9: 'Hip Hop', 10: 'Electronic', 11: 'Metal',
    12: 'Classical', 13: 'Folk', 14: 'Jazz'
};

const LANGUAGES = {
    0: 'Any', 1: 'Unspecified', 2: 'English', 3: 'Japanese', 4: 'Chinese',
    5: 'Instrumental', 6: 'Korean', 7: 'French', 8: 'German', 9: 'Swedish',
    10: 'Spanish', 11: 'Italian', 12: 'Russian', 13: 'Polish', 14: 'Other'
};

const { getBeatmapsetTags } = require('../models/BeatmapModel.js');

async function checkNewBeatmaps() {
    Logger.system("Iniciando actualización diaria de nuevos beatmaps...");
    
    const supabase = getSupabaseClient();
    if (!supabase) {
        Logger.system("Error: Cliente de Supabase no disponible para actualizar beatmaps.");
        return;
    }

    try {
        const OsuUserModel = require('../models/OsuUserModel.js');
        await OsuUserModel.NewloadToken();

        const statuses = ['ranked', 'loved'];
        let totalSaved = 0;

        for (const status of statuses) {
            const response = await v2.search({
                type: 'beatmaps',
                mode: 0, // standard
                status: status
            });

            if (!response || !response.beatmapsets || response.beatmapsets.length === 0) {
                continue;
            }

            const beatmapsToInsert = [];

            for (const set of response.beatmapsets) {
                // Obtener tags de usuario raspando la web
                let userTags = null;
                try {
                    userTags = await getBeatmapsetTags(set.id);
                } catch (e) {
                    // Silenciar y continuar
                }

                const genre = GENRES[set.genre_id] || 'Unspecified';
                const language = LANGUAGES[set.language_id] || 'Unspecified';
                
                const mapperTags = set.tags 
                    ? set.tags.toLowerCase().split(/\s+/).filter(t => t.length > 1)
                    : [];
                
                const cleanUserTags = userTags !== null
                    ? userTags.map(t => t.toLowerCase().trim()).filter(t => t.length > 1)
                    : null;

                const sanitizeNumeric = (val, defaultVal = 0) => {
                    if (val === null || val === undefined || isNaN(val) || !isFinite(val)) {
                        return defaultVal;
                    }
                    return val;
                };

                for (const map of set.beatmaps) {
                    if (map.mode_int !== 0) continue;

                    beatmapsToInsert.push({
                        beatmap_id: map.id,
                        beatmapset_id: set.id,
                        title: set.title,
                        artist: set.artist,
                        creator: set.creator,
                        version: map.version,
                        stars: sanitizeNumeric(map.difficulty_rating, 0),
                        mode: map.mode_int,
                        bpm: sanitizeNumeric(map.bpm, 0),
                        total_length: sanitizeNumeric(map.total_length, 0),
                        hit_length: sanitizeNumeric(map.hit_length, 0),
                        ar: sanitizeNumeric(map.ar, 0),
                        cs: sanitizeNumeric(map.cs, 0),
                        od: sanitizeNumeric(map.accuracy, 0),
                        hp: sanitizeNumeric(map.drain, 0),
                        max_combo: map.max_combo ? sanitizeNumeric(map.max_combo, 0) : null,
                        genre: genre,
                        language: language,
                        tags: mapperTags,
                        user_tags: cleanUserTags,
                        playcount: sanitizeNumeric(set.play_count, 0),
                        favourite_count: sanitizeNumeric(set.favourite_count, 0),
                        ranked_status: set.ranked,
                        created_at: new Date().toISOString()
                    });
                }
                // Esperar un delay aleatorio entre 2.5 y 5 segundos para evitar detección de bots por Cloudflare
                const randomDelay = Math.floor(Math.random() * 2500) + 2500;
                await new Promise(resolve => setTimeout(resolve, randomDelay));
            }

            if (beatmapsToInsert.length > 0) {
                const { error } = await supabase
                    .from('ranked_beatmaps')
                    .upsert(beatmapsToInsert, { onConflict: 'beatmap_id' });

                if (error) {
                    Logger.system(`Error al guardar nuevos mapas (${status}) en Supabase: ${error.message}`);
                } else {
                    totalSaved += beatmapsToInsert.length;
                }
            }
        }

        Logger.system(`Actualización diaria de beatmaps completada: ${totalSaved} mapas actualizados/guardados.`);
        try {
            fs.writeFileSync(STATUS_FILE, JSON.stringify({ lastSyncTime: Date.now() }, null, 2));
        } catch (writeErr) {
            console.error("Error al escribir el status de beatmap crawler:", writeErr);
        }
    } catch (err) {
        console.error("Error en la sincronización diaria de beatmaps:", err);
    }
}

function initBeatmapCrawler() {
    Logger.system("Inicializando servicio de sincronización diaria de beatmaps...");
    
    let lastSyncTime = 0;
    try {
        if (fs.existsSync(STATUS_FILE)) {
            const data = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
            lastSyncTime = data.lastSyncTime || 0;
        }
    } catch (e) {
        // Silenciar
    }

    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const timeSinceLastSync = now - lastSyncTime;

    let delayBeforeNextSync = 0;
    if (timeSinceLastSync < oneDay) {
        delayBeforeNextSync = oneDay - timeSinceLastSync;
        const hoursLeft = (delayBeforeNextSync / (60 * 60 * 1000)).toFixed(2);
        Logger.system(`[Beatmap Sync] La actualización de beatmaps ya se realizó recientemente. Próxima en ${hoursLeft} horas.`);
    } else {
        // Ejecutar después de 60 segundos si ha pasado más de 24 horas
        delayBeforeNextSync = 60000;
    }

    // Programar la primera ejecución
    setTimeout(async () => {
        await checkNewBeatmaps();
        
        // Y programar para ejecutarse cada 24 horas de ahí en adelante
        setInterval(() => {
            checkNewBeatmaps();
        }, oneDay);
    }, delayBeforeNextSync);
}

module.exports = {
    initBeatmapCrawler,
    checkNewBeatmaps
};
