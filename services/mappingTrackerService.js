const Logger = require("../utils/logger.js");
const MappingTrackerModel = require("../models/MappingTrackerModel.js");
const { doMappingTrackerNotificationEmbed } = require("../views/mappingTrackerViews.js");
const axios = require("axios");

let trackerInterval = null;
let discordClient = null;

/**
 * Obtiene token Oauth cliente o del bot para peticiones a la API v2 de osu!
 */
async function getOsuApiToken() {
    try {
        const { getSupabaseClient } = require("../db/supabase.js");
        const supabase = getSupabaseClient();
        if (supabase) {
            const { data } = await supabase.from('oauth_tokens').select('access_token').limit(1);
            if (data && data.length > 0) return data[0].access_token;
        }
    } catch (e) {}

    // Fallback a variables de entorno si existen
    return process.env.OSU_CLIENT_TOKEN || null;
}

/**
 * Consulta los beatmapsets de un usuario mediante la API v2 de osu!
 */
async function fetchUserBeatmapsets(osuId) {
    const token = await getOsuApiToken();
    if (!token) return [];

    try {
        const url = `https://osu.ppy.sh/api/v2/users/${osuId}/beatmapsets/unranked?limit=50`;
        const res = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'SengoBot/2.0'
            }
        });
        const unranked = Array.isArray(res.data) ? res.data : [];

        // También consultar los ranked más recientes
        const rankedUrl = `https://osu.ppy.sh/api/v2/users/${osuId}/beatmapsets/ranked?limit=10`;
        const rankedRes = await axios.get(rankedUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'SengoBot/2.0'
            }
        });
        const ranked = Array.isArray(rankedRes.data) ? rankedRes.data : [];

        return [...ranked, ...unranked];
    } catch (err) {
        console.error(`[MAPPING-TRACKER-SERVICE] Error al consultar beatmapsets de osu_id ${osuId}:`, err.message);
        return [];
    }
}

/**
 * Ejecuta un ciclo de escaneo para todos los usuarios rastreados.
 */
async function runMappingTrackerScan() {
    if (!discordClient) return;

    try {
        const trackedIds = await MappingTrackerModel.getAllTrackedOsuIds();
        if (trackedIds.length === 0) return;

        for (const osuId of trackedIds) {
            const mapsets = await fetchUserBeatmapsets(osuId);
            if (!mapsets || mapsets.length === 0) continue;

            const lastEvents = await MappingTrackerModel.getLastEventsForOsuId(osuId);
            const prevSnapshot = lastEvents?.status_snapshot || {};
            const newSnapshot = {};

            const subscriptions = await MappingTrackerModel.getSubscriptionsForOsuId(osuId);
            if (subscriptions.length === 0) continue;

            for (const mapset of mapsets) {
                const mapsetIdStr = mapset.id.toString();
                const currentStatus = (mapset.status || 'pending').toLowerCase();
                const prevStatus = prevSnapshot[mapsetIdStr];
                newSnapshot[mapsetIdStr] = currentStatus;

                if (!prevStatus) {
                    // Primer registro o nuevo mapa subido
                    if (lastEvents) {
                        // Notificar como nuevo mapa subido
                        await notifyEvent(mapset, osuId, currentStatus, subscriptions);
                    }
                } else if (prevStatus !== currentStatus) {
                    // Cambio de estado (ej: pending -> qualified, qualified -> ranked, graveyard -> revive)
                    let eventType = currentStatus;
                    if (prevStatus === 'graveyard' && currentStatus !== 'graveyard') {
                        eventType = 'revive';
                    }
                    await notifyEvent(mapset, osuId, eventType, subscriptions);
                }
            }

            const latestMapsetId = mapsets[0]?.id;
            await MappingTrackerModel.saveLastEventsForOsuId(osuId, latestMapsetId, newSnapshot);
        }
    } catch (scanErr) {
        console.error('[MAPPING-TRACKER-SERVICE] Error durante el ciclo de escaneo:', scanErr.message);
    }
}

/**
 * Envía las notificaciones de eventos a los canales de Discord suscritos.
 */
async function notifyEvent(mapset, osuId, eventType, subscriptions) {
    const mapperUser = {
        id: osuId,
        username: mapset.creator || 'Mapper',
        avatar_url: `https://a.ppy.sh/${osuId}`
    };

    const embedResult = doMappingTrackerNotificationEmbed(mapset, mapperUser, eventType);

    for (const sub of subscriptions) {
        const types = sub.event_types || ['all'];
        const isMatch = types.includes('all') || types.includes(eventType);
        if (!isMatch) continue;

        try {
            const channel = await discordClient.channels.fetch(sub.channel_id).catch(() => null);
            if (channel && typeof channel.send === 'function') {
                await channel.send(embedResult);
            }
        } catch (sendErr) {
            console.error(`[MAPPING-TRACKER-SERVICE] Error al enviar mensaje a canal ${sub.channel_id}:`, sendErr.message);
        }
    }
}

/**
 * Inicializa el servicio en segundo plano de Mapping Tracker.
 */
function initMappingTracker(client) {
    discordClient = client;
    Logger.system("Inicializando servicio de Mapping Tracker (intervalo: 5 minutos)...");

    // Ejecutar primera verificación tras 30 segundos
    setTimeout(() => {
        runMappingTrackerScan().catch(err => {
            Logger.system(`Error en primera ejecución de Mapping Tracker: ${err.message}`);
        });
    }, 30000);

    // Repetir cada 5 minutos
    trackerInterval = setInterval(() => {
        runMappingTrackerScan().catch(err => {
            Logger.system(`Error en escaneo periódico de Mapping Tracker: ${err.message}`);
        });
    }, 5 * 60 * 1000);
}

module.exports = {
    initMappingTracker,
    runMappingTrackerScan
};
