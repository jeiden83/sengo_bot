const { getSupabaseClient } = require('../db/database.js');
const OsuTrackerModel = require('../models/OsuTrackerModel.js');
const OsuUserModel = require('../models/OsuUserModel.js');
const { osuApiQueue } = require('../utils/OsuApiQueue.js');
const { v2 } = require('osu-api-extended');
const Logger = require('../utils/logger.js');
const { getGuildLanguage } = require('../models/GuildConfigModel.js');
const { getBeatmap, getBeatmap_osu, calculatePP, normalizeScore } = require('../commands/utils/osu.js');
const { doOsuEmbed } = require('../views/osuEmbeds.js');

// Estado en memoria del tracking
const usersMap = new Map(); // osuId -> { osuId, osuUsername, discordId, lastScoreId, isActive, lastActiveAt, servers: [{ guildId, channelId, id }] }
let slowQueue = []; // Array de osuIds
let fastQueue = []; // Array de osuIds

let fastTimeout = null;
let slowTimeout = null;
let isInitialized = false;

// Tiempos límites y retrasos
const ACTIVE_DURATION_MS = 10 * 60 * 1000; // 10 minutos activo

function calculateFastDelay() {
    const n = fastQueue.length;
    if (n === 0) return 15000; // Si no hay activos, re-chequear cada 15s
    // Delay Rápido = max(15000 / N_activos, 1000) ms
    return Math.max(15000 / n, 1000);
}

function calculateSlowDelay() {
    const n = slowQueue.length;
    if (n === 0) return 60000; // Si no hay inactivos, re-chequear cada minuto
    // 3 minutos (180s) si hay menos de 10 usuarios inactivos en total, si no 5 minutos (300s)
    const tLento = n < 10 ? 180 : 300;
    // Delay Lento = max(T_lento * 1000 / N_inactivos, 2000) ms
    return Math.max((tLento * 1000) / n, 2000);
}

/**
 * Obtiene el ID del score más alto actual del usuario para inicializar a los nuevos trackeados.
 */
async function fetchLatestScoreIdForUser(osuId, mode = 'osu') {
    try {
        const best = await osuApiQueue.add(() => v2.scores.list({
            type: 'user_best',
            user_id: osuId,
            mode: mode,
            limit: 1
        }), 0);
        if (best && best.length > 0) {
            return best[0].id.toString();
        }
        
        const recent = await osuApiQueue.add(() => v2.scores.list({
            type: 'user_recent',
            user_id: osuId,
            mode: mode,
            limit: 1,
            include_fails: true
        }), 0);
        if (recent && recent.length > 0) {
            return recent[0].id.toString();
        }
    } catch (err) {
        console.error(`[TRACKER-SERVICE] Error al obtener score más reciente para inicializar usuario ${osuId}:`, err);
    }
    return "0";
}

/**
 * Añade un registro individual a la memoria en caliente.
 */
async function addTrackedUserInMemory(record) {
    const osuId = record.osu_id.toString();
    
    // Si ya existe en memoria, agregamos el servidor si no está
    if (usersMap.has(osuId)) {
        const userObj = usersMap.get(osuId);
        const serverExists = userObj.servers.some(s => s.guildId === record.guild_id);
        if (!serverExists) {
            userObj.servers.push({
                guildId: record.guild_id,
                channelId: record.channel_id,
                id: record.id
            });
        }
        // Si el registro de la DB tenía un lastScoreId configurado, lo actualizamos si es mayor
        if (record.last_score_id && (!userObj.lastScoreId || record.last_score_id > userObj.lastScoreId)) {
            userObj.lastScoreId = record.last_score_id;
        }
        return;
    }

    // Si es un usuario nuevo en memoria, inicializamos su lastScoreId si es null
    let lastScoreId = record.last_score_id;
    if (!lastScoreId) {
        Logger.system(`[TRACKER-SERVICE] Inicializando lastScoreId para el nuevo usuario trackeado ${record.osu_username} (${osuId})...`);
        lastScoreId = await fetchLatestScoreIdForUser(osuId);
        // Actualizar en base de datos
        await OsuTrackerModel.updateTrackedUser(record.id, { last_score_id: lastScoreId });
    }

    const userObj = {
        osuId,
        osuUsername: record.osu_username,
        discordId: record.discord_id,
        lastScoreId: lastScoreId,
        isActive: record.is_active || false,
        lastActiveAt: record.last_active_at ? new Date(record.last_active_at) : null,
        servers: [{
            guildId: record.guild_id,
            channelId: record.channel_id,
            id: record.id
        }]
    };

    usersMap.set(osuId, userObj);

    if (userObj.isActive) {
        if (!fastQueue.includes(osuId)) fastQueue.push(osuId);
    } else {
        if (!slowQueue.includes(osuId)) slowQueue.push(osuId);
    }
}

/**
 * Elimina un registro de guild y osuId de la memoria.
 */
function removeTrackedUserInMemory(guildId, osuId) {
    const osuIdStr = osuId.toString();
    if (!usersMap.has(osuIdStr)) return;

    const userObj = usersMap.get(osuIdStr);
    userObj.servers = userObj.servers.filter(s => s.guildId !== guildId);

    if (userObj.servers.length === 0) {
        // Eliminar del mapa y colas
        usersMap.delete(osuIdStr);
        slowQueue = slowQueue.filter(id => id !== osuIdStr);
        fastQueue = fastQueue.filter(id => id !== osuIdStr);
        Logger.system(`[TRACKER-SERVICE] Usuario ${osuIdStr} removido completamente del tracking.`);
    }
}

/**
 * Actualiza el canal de tracking en memoria.
 */
function updateTrackChannelInMemory(guildId, channelId) {
    for (const [, userObj] of usersMap) {
        for (const srv of userObj.servers) {
            if (srv.guildId === guildId) {
                srv.channelId = channelId;
            }
        }
    }
}

/**
 * Procesa un nuevo score detectado, verifica si entra al top 100 de mejores jugadas y las anuncia.
 */
async function processNewScore(client, userObj, score) {
    const osuId = userObj.osuId;
    
    // 1. Obtener el Top 100 de mejores puntuaciones del usuario
    const bestScores = await osuApiQueue.add(() => v2.scores.list({
        type: 'user_best',
        user_id: osuId,
        mode: score.beatmap.mode,
        limit: 100
    }), 0);

    if (!bestScores || !Array.isArray(bestScores)) return;

    // 2. Buscar si el score reciente está en el top 100
    const positionIndex = bestScores.findIndex(s => s.id.toString() === score.id.toString());
    
    if (positionIndex === -1) {
        // No es una top play, no se anuncia
        return;
    }

    Logger.system(`[TRACKER-SERVICE] ¡Nueva Top Play #${positionIndex + 1} detectada para ${userObj.osuUsername}!`);

    // 3. Preparar los datos del beatmap y PP
    let mapObj = null;
    try {
        normalizeScore(score);
        const beatmapData = await getBeatmap(score.beatmap.id);
        mapObj = await getBeatmap_osu(score.beatmap.beatmapset_id, score.beatmap.id, beatmapData);
        
        let maxAttrs = null;
        try {
            maxAttrs = calculatePP(score, mapObj, "maximo_pp");
        } catch (err) {
            console.error("[TRACKER-SERVICE] Error calculating maxAttrs:", err);
        }

        const user_pp = score.pp ? score.pp : calculatePP(score, mapObj, null, maxAttrs).pp;
        const beatmap_max_combo = beatmapData.max_combo || (maxAttrs && maxAttrs.difficulty ? maxAttrs.difficulty.maxCombo : 0);

        const statistics = score.statistics || {};
        const miss = statistics.miss || 0;
        const total_hits = (statistics.great || 0) + (statistics.ok || 0) + (statistics.meh || 0) + miss;

        let pp_fc = null;
        const isFC = score.perfect || (miss === 0 && score.max_combo >= beatmap_max_combo - 2);
        if (!isFC) {
            try {
                const fc_statistics = {
                    ...statistics,
                    great: (statistics.great || 0) + miss,
                    miss: 0
                };
                const fc_score = {
                    ...score,
                    max_combo: beatmap_max_combo,
                    statistics: fc_statistics
                };
                pp_fc = calculatePP(fc_score, mapObj, null, maxAttrs).pp;
            } catch (err) {
                console.error("[TRACKER-SERVICE] Error calculating pp_fc:", err);
            }
        }

        const pre_calculated = {
            "map": mapObj,
            "map_completion": score.passed ? 100 : total_hits / mapObj.nObjects,
            "maxAttrs": maxAttrs,
            "pp": user_pp,
            "beatmap_max_combo": beatmap_max_combo,
            "pp_fc": pp_fc
        };

        // 4. Enviar el anuncio a cada servidor trackeado
        for (const srv of userObj.servers) {
            if (!srv.channelId) continue;

            const channel = await client.channels.fetch(srv.channelId).catch(() => null);
            if (!channel || !channel.isTextBased()) continue;

            const locale = await getGuildLanguage(srv.guildId) || 'es';

            // Obtener el preferred_score_mode si es que el usuario está vinculado en la DB
            let preferredScoreMode = 'classic';
            if (userObj.discordId) {
                const supabase = getSupabaseClient();
                const { data: dbUser } = await supabase
                    .from('users')
                    .select('preferred_score_mode')
                    .eq('discord_id', userObj.discordId)
                    .maybeSingle();
                if (dbUser && dbUser.preferred_score_mode) {
                    preferredScoreMode = dbUser.preferred_score_mode;
                }
            }

            const mockMessage = {
                locale: locale,
                guild: client.guilds.cache.get(srv.guildId) || null,
                author: { id: userObj.discordId || client.user.id }
            };

            const embed = await doOsuEmbed(mockMessage, score, pre_calculated, locale, preferredScoreMode);

            // Personalizar el color del embed según el puesto del top
            let embedColor = '#3498db'; // Azul
            const rank = positionIndex + 1;
            if (rank <= 5) embedColor = '#FFD700'; // Dorado
            else if (rank <= 20) embedColor = '#C0C0C0'; // Plateado
            else if (rank <= 50) embedColor = '#CD7F32'; // Bronce
            embed.setColor(embedColor);

            // Personalizar autor del embed
            embed.setAuthor({
                name: `¡Nueva Top Play #${rank}! ▸ ${score.user.username}`,
                url: score.user.server === 'gatari' ? `https://osu.gatari.pw/u/${score.user.id}` : `https://osu.ppy.sh/users/${score.user.id}`,
                iconURL: score.user.avatar_url
            });

            await channel.send({ embeds: [embed] }).catch(err => {
                console.error(`[TRACKER-SERVICE] Error al enviar anuncio de top play a canal ${srv.channelId}:`, err);
            });
        }
    } catch (e) {
        console.error("[TRACKER-SERVICE] Error procesando y anunciando nueva play:", e);
    } finally {
        if (mapObj) {
            try {
                mapObj.free();
            } catch (err) {
                console.error("[TRACKER-SERVICE] Error al liberar Beatmap de WASM:", err);
            }
        }
    }
}

/**
 * Chequea si un usuario tiene un score más reciente.
 * @returns {Promise<boolean>} True si hay un nuevo score
 */
async function checkUserRecentScore(client, userObj) {
    const osuId = userObj.osuId;

    try {
        const scores = await osuApiQueue.add(() => v2.scores.list({
            type: 'user_recent',
            user_id: osuId,
            include_fails: true,
            limit: 1
        }), 0);

        if (!scores || scores.length === 0) return false;

        const score = scores[0];
        const scoreIdStr = score.id.toString();

        if (scoreIdStr !== userObj.lastScoreId) {
            // ¡Nuevo score detectado!
            userObj.lastScoreId = scoreIdStr;

            // Actualizar en base de datos para todos sus servidores asociados
            for (const srv of userObj.servers) {
                await OsuTrackerModel.updateTrackedUser(srv.id, { last_score_id: scoreIdStr });
            }

            // Procesar y ver si entra en el Top 100
            await processNewScore(client, userObj, score);
            return true;
        }
    } catch (err) {
        console.error(`[TRACKER-SERVICE] Error al chequear scores recientes para ${userObj.osuUsername}:`, err);
    }

    return false;
}

/**
 * Bucle de sondeo rápido.
 */
async function tickFast(client) {
    if (fastQueue.length === 0) {
        fastTimeout = setTimeout(() => tickFast(client), calculateFastDelay());
        return;
    }

    const osuId = fastQueue.shift();
    const userObj = usersMap.get(osuId);

    if (!userObj) {
        fastTimeout = setTimeout(() => tickFast(client), calculateFastDelay());
        return;
    }

    const now = Date.now();
    const elapsedSinceLastActive = now - (userObj.lastActiveAt ? userObj.lastActiveAt.getTime() : now);

    // Si pasaron 10 minutos sin actividad, lo pasamos a la cola lenta
    if (elapsedSinceLastActive > ACTIVE_DURATION_MS) {
        userObj.isActive = false;
        userObj.lastActiveAt = null;

        // Actualizar en DB
        for (const srv of userObj.servers) {
            await OsuTrackerModel.updateTrackedUser(srv.id, { is_active: false, last_active_at: null });
        }

        slowQueue.push(osuId);
        Logger.system(`[TRACKER-SERVICE] Usuario ${userObj.osuUsername} pasó a inactivo (cola lenta).`);
    } else {
        // Sondeo rápido
        const hadNewScore = await checkUserRecentScore(client, userObj);
        if (hadNewScore) {
            userObj.lastActiveAt = new Date();
            for (const srv of userObj.servers) {
                await OsuTrackerModel.updateTrackedUser(srv.id, { last_active_at: userObj.lastActiveAt.toISOString() });
            }
        }
        
        // Volver a encolar al final de la cola rápida si sigue activo
        if (userObj.isActive) {
            fastQueue.push(osuId);
        }
    }

    fastTimeout = setTimeout(() => tickFast(client), calculateFastDelay());
}

/**
 * Bucle de sondeo lento.
 */
async function tickSlow(client) {
    if (slowQueue.length === 0) {
        slowTimeout = setTimeout(() => tickSlow(client), calculateSlowDelay());
        return;
    }

    const osuId = slowQueue.shift();
    const userObj = usersMap.get(osuId);

    if (!userObj) {
        slowTimeout = setTimeout(() => tickSlow(client), calculateSlowDelay());
        return;
    }

    // Sondeo lento
    const hadNewScore = await checkUserRecentScore(client, userObj);

    if (hadNewScore) {
        // Pasa a cola rápida
        userObj.isActive = true;
        userObj.lastActiveAt = new Date();

        for (const srv of userObj.servers) {
            await OsuTrackerModel.updateTrackedUser(srv.id, {
                is_active: true,
                last_active_at: userObj.lastActiveAt.toISOString()
            });
        }

        fastQueue.push(osuId);
        Logger.system(`[TRACKER-SERVICE] Actividad detectada para ${userObj.osuUsername}. Pasa a la cola rápida.`);
    } else {
        // Volver a encolar en cola lenta
        slowQueue.push(osuId);
    }

    slowTimeout = setTimeout(() => tickSlow(client), calculateSlowDelay());
}

/**
 * Inicializa el servicio de tracking de osu!
 */
async function initOsuTracker(client) {
    if (isInitialized) return;
    isInitialized = true;

    Logger.system("[TRACKER-SERVICE] Inicializando servicio de tracking de osu!...");

    // Cargar todos los registros del tracker desde la base de datos
    const records = await OsuTrackerModel.getTrackedUsers();
    
    // Inicializar memoria secuencialmente para evitar saturar la API al encender
    for (const record of records) {
        await addTrackedUserInMemory(record);
    }

    Logger.system(`[TRACKER-SERVICE] Cargados ${usersMap.size} usuarios únicos para tracking. Cola Rápida: ${fastQueue.length}, Cola Lenta: ${slowQueue.length}`);

    // Iniciar bucles asíncronos
    tickFast(client);
    tickSlow(client);
}

module.exports = {
    initOsuTracker,
    addTrackedUserInMemory,
    removeTrackedUserInMemory,
    updateTrackChannelInMemory
};
