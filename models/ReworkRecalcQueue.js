const fs = require('fs/promises');
const path = require('path');
const { getSupabaseClient } = require('../db/database.js');

const CACHE_FILE = path.resolve('db/local/recalculated_users.json');

// Fecha de inicio del rework. Cualquier play con updated_at posterior a esta fecha ya fue recalculada.
// ponytail: se actualizó la fecha para forzar el recálculo tras ajustar la fórmula de PP clásico bajo lazer.
const REWORK_START_DATE = new Date('2026-07-11T13:20:00.000Z');

// Mapa en memoria para los usuarios ya recalculados
let recalculatedUsers = new Map();

// Cola en memoria de tareas de recalculación
// Cada tarea: { userId, username, mode, countryCode, channelId, messageId }
const queue = [];
let currentTask = null;
let clientInstance = null;

// Inicializa el cliente Discord
function initClient(client) {
    clientInstance = client;
}

// Cargar caché de usuarios recalculados
async function loadRecalculatedUsers() {
    try {
        const data = await fs.readFile(CACHE_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        recalculatedUsers = new Map(Object.entries(parsed));
    } catch (err) {
        recalculatedUsers = new Map();
    }
}

// Guardar caché de usuarios recalculados
async function saveRecalculatedUsers() {
    try {
        // Asegurar que la carpeta contenedora exista
        await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true }).catch(() => {});
        const obj = Object.fromEntries(recalculatedUsers);
        await fs.writeFile(CACHE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
        console.error("[ReworkRecalcQueue] Error al guardar caché de usuarios recalculados:", err);
    }
}

// Comprueba si un usuario (por ID de osu! y modo) ya fue recalculado
function isRecalculated(userId, mode) {
    const key = `${userId}:${mode}`;
    return recalculatedUsers.has(key);
}

// Obtiene el estado en cola de un usuario: 'running', 'queued' o null
function getQueueStatus(userId, mode) {
    if (currentTask && currentTask.userId.toString() === userId.toString() && currentTask.mode === mode) {
        return 'running';
    }
    const inQueue = queue.some(t => t.userId.toString() === userId.toString() && t.mode === mode);
    if (inQueue) {
        return 'queued';
    }
    return null;
}

// Agrega un usuario a la cola de recalculación si no está ya
function enqueue(userId, username, mode, countryCode, channelId = null, messageId = null) {
    if (isRecalculated(userId, mode)) {
        return;
    }
    const status = getQueueStatus(userId, mode);
    if (status) {
        return; // Ya está corriendo o en cola
    }

    queue.push({
        userId,
        username,
        mode,
        countryCode,
        channelId,
        messageId
    });

    console.log(`[ReworkRecalcQueue] Encolado recalculación de tops para ${username} (${userId}) en modo ${mode}`);
    
    // Iniciar el procesamiento de forma asíncrona si no hay nada corriendo
    if (!currentTask) {
        processNext();
    }
}

// Procesa la siguiente tarea de la cola
async function processNext() {
    if (queue.length === 0) {
        currentTask = null;
        return;
    }

    currentTask = queue.shift();
    console.log(`[ReworkRecalcQueue] Iniciando recalculación para ${currentTask.username} (${currentTask.userId}) en modo ${currentTask.mode}`);

    try {
        await recalculateUserTops(currentTask);
        
        // Registrar como completado
        const key = `${currentTask.userId}:${currentTask.mode}`;
        recalculatedUsers.set(key, {
            recalculatedAt: Date.now(),
            username: currentTask.username
        });
        await saveRecalculatedUsers();
        
        console.log(`[ReworkRecalcQueue] Completada recalculación para ${currentTask.username} (${currentTask.userId}) en modo ${currentTask.mode}`);

        // Intentar actualizar el mensaje de Discord quitando el aviso de recalculación/cola
        // ponytail: actualizar mensaje de Discord de forma silenciosa para mejorar UX
        if (currentTask.channelId && currentTask.messageId) {
            await removeWarningFromMessage(currentTask);
        }
    } catch (err) {
        console.error(`[ReworkRecalcQueue] Error crítico procesando tarea para ${currentTask.username}:`, err);
    } finally {
        currentTask = null;
        // Continuar con la siguiente tarea
        processNext();
    }
}

// Remueve el mensaje de advertencia y actualiza el PP en el embed
async function removeWarningFromMessage(task) {
    if (!clientInstance || !task.channelId || !task.messageId) {
        return;
    }
    try {
        const channel = await clientInstance.channels.fetch(task.channelId).catch(() => null);
        if (!channel) return;
        
        const msg = await channel.messages.fetch(task.messageId).catch(() => null);
        if (!msg) return;

        const embed = msg.embeds[0];
        if (embed && embed.description) {
            let desc = embed.description;
            // Remover mensajes de advertencia/cola tanto en inglés como en español
            desc = desc.replace(/⚠️ \*Se están recalculando las jugadas de este usuario en segundo plano debido al rework\.\*\n?\n?/g, "");
            desc = desc.replace(/⏳ \*Las jugadas de este usuario están en cola para ser recalculadas debido al rework\.\*\n?\n?/g, "");
            desc = desc.replace(/⚠️ \*This user's plays are being recalculated in the background due to the rework\.\*\n?\n?/g, "");
            desc = desc.replace(/⏳ \*This user's plays are in queue to be recalculated due to the rework\.\*\n?\n?/g, "");

            // Buscar y actualizar los PPs de los mapas que se muestran en el embed (solo para list mode)
            const matches = [...desc.matchAll(/https:\/\/osu\.ppy\.sh\/b\/(\d+)/g)];
            if (matches.length > 0) {
                const beatmapIds = matches.map(m => parseInt(m[1]));
                const supabase = getSupabaseClient();
                if (supabase) {
                    const { data, error } = await supabase
                        .from('top_scores')
                        .select('beatmap_id, pp')
                        .eq('user_id', task.userId.toString())
                        .in('beatmap_id', beatmapIds)
                        .eq('country_code', task.countryCode);

                    if (data && data.length > 0) {
                        const ppMap = new Map(data.map(d => [d.beatmap_id, d.pp]));
                        const lines = desc.split("\n");
                        let currentBeatmapId = null;
                        for (let i = 0; i < lines.length; i++) {
                            const mapMatch = lines[i].match(/https:\/\/osu\.ppy\.sh\/b\/(\d+)/);
                            if (mapMatch) {
                                currentBeatmapId = parseInt(mapMatch[1]);
                            }
                            if (currentBeatmapId && lines[i].includes("**") && lines[i].includes("pp**")) {
                                const newPP = ppMap.get(currentBeatmapId);
                                if (newPP !== undefined && newPP !== null) {
                                    lines[i] = lines[i].replace(/\*\*[\d.]+pp\*\*/, `**${newPP.toFixed(2)}pp**`);
                                }
                                currentBeatmapId = null; // Limpiar para el siguiente bloque
                            }
                        }
                        desc = lines.join("\n");
                    }
                }
            }

            const { EmbedBuilder } = require("discord.js");
            const newEmbed = EmbedBuilder.from(embed).setDescription(desc);
            
            await msg.edit({ embeds: [newEmbed] }).catch(() => {});
        }
    } catch (err) {
        console.error("[ReworkRecalcQueue] Error al eliminar el mensaje de advertencia:", err);
    }
}

// Realiza el cálculo real
async function recalculateUserTops(task) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        console.error("[ReworkRecalcQueue] Error: Cliente de Supabase no inicializado.");
        return;
    }

    // Obtener todas las jugadas del usuario en el modo y país correspondiente (paginado de 1000 en 1000)
    const plays = [];
    let from = 0;
    const PAGE_SIZE = 1000;

    while (true) {
        const { data, error } = await supabase
            .from('top_scores')
            .select('pp, mods, ended_at, score, accuracy, beatmap_id, max_combo, perfect, statistics, rank, country_code, updated_at, ranked_beatmaps!inner(mode, beatmapset_id)')
            .eq('user_id', task.userId.toString())
            .eq('ranked_beatmaps.mode', task.mode)
            .eq('country_code', task.countryCode)
            .range(from, from + PAGE_SIZE - 1);

        if (error) {
            console.error(`[ReworkRecalcQueue] Error al consultar top_scores de ${task.username}:`, error);
            return;
        }

        if (!data || data.length === 0) {
            break;
        }

        plays.push(...data);

        if (data.length < PAGE_SIZE) {
            break;
        }
        from += PAGE_SIZE;
    }

    if (plays.length === 0) {
        console.log(`[ReworkRecalcQueue] El usuario ${task.username} no tiene jugadas en top_scores.`);
        return;
    }

    console.log(`[ReworkRecalcQueue] Recalculando ${plays.length} jugadas para ${task.username}...`);

    const BeatmapModel = require('./BeatmapModel.js');
    const OsuScoreModel = require('./OsuScoreModel.js');

    for (let i = 0; i < plays.length; i++) {
        const play = plays[i];

        // Evitar recalcular jugadas con estadísticas nulas (ya que se poblarán/procesarán en segundo plano por el script principal)
        if (!play.statistics) {
            continue;
        }

        // Evitar recalcular jugadas que ya fueron recalculadas post-rework
        if (play.updated_at && new Date(play.updated_at) > REWORK_START_DATE) {
            continue;
        }

        try {
            const beatmapId = play.beatmap_id;
            const beatmapsetId = play.ranked_beatmaps.beatmapset_id;

            console.log(`[ReworkRecalcQueue] [${task.username}] Procesando jugada ${i + 1}/${plays.length} (Mapa: ${beatmapId})...`);

            // 1. Obtener metadatos del mapa
            const beatmap = await BeatmapModel.getBeatmap(beatmapId);
            if (!beatmap) continue;

            // 2. Obtener el archivo .osu
            const map = await BeatmapModel.getBeatmap_osu(beatmapsetId, beatmapId, beatmap);
            if (!map) continue;

            // 3. Normalizar jugada
            const normalizedPlay = {
                ...play,
                mode: task.mode,
                statistics: OsuScoreModel.normalizeStatistics(play.statistics)
            };

            // 4. Calcular PP
            const calculated = OsuScoreModel.calculatePP(normalizedPlay, map);
            const newPP = calculated ? calculated.pp : null;

            // Liberar memoria del mapa parser en rosu
            if (map && typeof map.free === 'function') {
                map.free();
            }

            if (newPP !== null && !isNaN(newPP)) {
                // 5. Actualizar en Supabase
                const { error: updateErr } = await supabase
                    .from('top_scores')
                    .update({ 
                        pp: newPP, 
                        updated_at: new Date().toISOString() 
                    })
                    .eq('beatmap_id', beatmapId)
                    .eq('country_code', play.country_code);

                if (updateErr) {
                    console.error(`[ReworkRecalcQueue] Error al actualizar PP para mapa ${beatmapId}:`, updateErr);
                }
            }
        } catch (playErr) {
            console.error(`[ReworkRecalcQueue] Error procesando jugada en mapa ${play.beatmap_id} del usuario ${task.username}:`, playErr);
        }

        // Delay para evitar CPU al 100% y rate limits en base de datos
        await new Promise(resolve => setTimeout(resolve, 80));
    }
}

// Inicializar al cargar el módulo
loadRecalculatedUsers();

module.exports = {
    isRecalculated,
    getQueueStatus,
    enqueue,
    initClient
};
