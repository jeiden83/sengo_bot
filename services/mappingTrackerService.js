const Logger = require("../utils/logger.js");
const MappingTrackerModel = require("../models/MappingTrackerModel.js");
const { doMappingTrackerNotificationEmbed } = require("../views/mappingTrackerViews.js");
const axios = require("axios");

let trackerInterval = null;
let eventsInterval = null;
let discordClient = null;

let isScanningDeep = false;
let isScanningEvents = false;
// ponytail: lastProcessedEventId guardado en memoria volatil para escaneo rapido de eventos a 30s; si el bot se reinicia, el escaneo profundo de 5m reconcilia cualquier estado omitido
let lastProcessedEventId = 0;

/**
 * Obtiene token Oauth cliente o del bot para peticiones a la API v2 de osu!
 */
async function getOsuApiToken() {
    try {
        const { getSupabaseClient } = require("../db/database.js");
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
        if (err.response?.status !== 404) {
            console.error(`[MAPPING-TRACKER-SERVICE] Error al consultar beatmapsets de osu_id ${osuId}:`, err.message);
        }
        return [];
    }
}

/**
 * Consulta los eventos globales de beatmapsets desde la API v2 de osu!
 */
async function fetchGlobalBeatmapEvents() {
    const token = await getOsuApiToken();
    if (!token) return [];

    try {
        const res = await axios.get("https://osu.ppy.sh/api/v2/beatmapsets/events", {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'SengoBot/2.0'
            }
        });
        return Array.isArray(res.data?.events) ? res.data.events : [];
    } catch (err) {
        console.error('[MAPPING-TRACKER-SERVICE] Error al consultar eventos globales de beatmapsets:', err.message);
        return [];
    }
}

/**
 * Escaneo rápido (cada 30s): Consulta el feed global de eventos de osu! y notifica al instante cambios mayores.
 */
async function runGlobalEventsScan() {
    if (!discordClient || isScanningEvents) return;
    isScanningEvents = true;

    try {
        const trackedIds = await MappingTrackerModel.getAllTrackedOsuIds();
        if (trackedIds.length === 0) {
            isScanningEvents = false;
            return;
        }

        const trackedSet = new Set(trackedIds.map(id => Number(id)));
        const events = await fetchGlobalBeatmapEvents();
        if (events.length === 0) {
            isScanningEvents = false;
            return;
        }

        // Ordenar eventos de más antiguo a más reciente para notificar en orden cronológico
        events.sort((a, b) => a.id - b.id);

        let maxSeenId = lastProcessedEventId;

        for (const event of events) {
            if (event.id <= lastProcessedEventId) continue;
            if (event.id > maxSeenId) maxSeenId = event.id;

            const mapset = event.beatmapset;
            if (!mapset) continue;

            const mapperOsuId = mapset.user_id || (mapset.user ? mapset.user.id : null);
            if (!mapperOsuId || !trackedSet.has(Number(mapperOsuId))) continue;

            // Determinar tipo de evento relevante para Mapping Tracker
            let eventType = null;
            switch (event.type) {
                case 'nominate':
                    eventType = 'nomination';
                    break;
                case 'qualify':
                    eventType = 'qualified';
                    break;
                case 'disqualify':
                    eventType = 'pending';
                    break;
                case 'approve':
                    eventType = 'approved';
                    break;
                case 'rank':
                    eventType = 'ranked';
                    break;
                case 'love':
                    eventType = 'loved';
                    break;
            }

            if (!eventType) continue;

            const subscriptions = await MappingTrackerModel.getSubscriptionsForOsuId(mapperOsuId);
            if (subscriptions.length > 0) {
                await notifyEvent(mapset, mapperOsuId, eventType, subscriptions);
            }
        }

        if (maxSeenId > lastProcessedEventId) {
            lastProcessedEventId = maxSeenId;
        }
    } catch (err) {
        console.error('[MAPPING-TRACKER-SERVICE] Error en escaneo rápido de eventos:', err.message);
    } finally {
        isScanningEvents = false;
    }
}

/**
 * Escaneo profundo (cada 5m): Ejecuta un ciclo completo para todos los mappers rastreados (WIP/Pending/Updates).
 */
async function runMappingTrackerScan() {
    if (!discordClient || isScanningDeep) return;
    isScanningDeep = true;

    try {
        const trackedIds = await MappingTrackerModel.getAllTrackedOsuIds();
        if (trackedIds.length === 0) {
            isScanningDeep = false;
            return;
        }

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
                const currentUpdated = mapset.last_updated || mapset.submitted_date || null;

                const prevEntry = prevSnapshot[mapsetIdStr];
                const prevStatus = typeof prevEntry === 'object' ? prevEntry.status : prevEntry;
                const prevUpdated = typeof prevEntry === 'object' ? prevEntry.last_updated : null;

                newSnapshot[mapsetIdStr] = {
                    status: currentStatus,
                    last_updated: currentUpdated
                };

                if (!prevStatus) {
                    // Primer registro o nuevo mapa subido
                    if (lastEvents) {
                        await notifyEvent(mapset, osuId, currentStatus, subscriptions);
                    }
                } else if (prevStatus !== currentStatus) {
                    // Cambio de estado (ej: pending -> qualified, qualified -> ranked, graveyard -> revive)
                    let eventType = currentStatus;
                    if (prevStatus === 'graveyard' && currentStatus !== 'graveyard') {
                        eventType = 'revive';
                    }
                    await notifyEvent(mapset, osuId, eventType, subscriptions);
                } else if (prevUpdated && currentUpdated && prevUpdated !== currentUpdated) {
                    // Notificación de actualización de mapa (BSB / Update)
                    await notifyEvent(mapset, osuId, currentStatus, subscriptions);
                }
            }

            const latestMapsetId = mapsets[0]?.id;
            await MappingTrackerModel.saveLastEventsForOsuId(osuId, latestMapsetId, newSnapshot);
        }
    } catch (scanErr) {
        console.error('[MAPPING-TRACKER-SERVICE] Error durante el ciclo de escaneo profundo:', scanErr.message);
    } finally {
        isScanningDeep = false;
    }
}

/**
 * Envía las notificaciones de eventos a los canales de Discord suscritos.
 */
async function notifyEvent(mapset, osuId, eventType, subscriptions) {
    const mapperUser = {
        id: osuId,
        username: mapset.creator || 'Mapper',
        avatar_url: `https://a.ppy.sh/${osuId}`,
        country_code: mapset.user?.country_code || null
    };

    for (const sub of subscriptions) {
        const types = sub.event_types || ['all'];
        const isMatch = types.includes('all') || types.includes(eventType);
        if (!isMatch) continue;

        try {
            const ranksInfo = await MappingTrackerModel.getMapperRankings(osuId, mapperUser.country_code, sub.guild_id);
            const embedResult = doMappingTrackerNotificationEmbed(mapset, mapperUser, eventType, 'es', ranksInfo);

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
    Logger.system("Inicializando servicio de Mapping Tracker (Eventos rápidos: 30s | Escaneo profundo: 5m)...");

    // 1. Escaneo rápido de eventos globales (cada 30s)
    setTimeout(() => {
        runGlobalEventsScan().catch(err => {
            Logger.system(`Error en primera ejecución de eventos globales: ${err.message}`);
        });
    }, 10000);

    eventsInterval = setInterval(() => {
        runGlobalEventsScan().catch(err => {
            Logger.system(`Error en escaneo rápido de eventos: ${err.message}`);
        });
    }, 30 * 1000);

    // 2. Escaneo profundo de mappers individuales (cada 5m)
    setTimeout(() => {
        runMappingTrackerScan().catch(err => {
            Logger.system(`Error en primera ejecución de escaneo profundo: ${err.message}`);
        });
    }, 30000);

    trackerInterval = setInterval(() => {
        runMappingTrackerScan().catch(err => {
            Logger.system(`Error en escaneo profundo de Mapping Tracker: ${err.message}`);
        });
    }, 5 * 60 * 1000);
}

module.exports = {
    initMappingTracker,
    runMappingTrackerScan,
    runGlobalEventsScan,
    fetchUserBeatmapsets,
    fetchGlobalBeatmapEvents
};
