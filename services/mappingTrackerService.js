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

// Deduplicador de notificaciones para evitar anuncios repetidos entre escaneos rapidos y profundos
const recentlyNotified = new Map();
const NOTIFICATION_DEDUPE_TTL = 30 * 60 * 1000; // 30 minutos

function cleanOldNotifiedEntries() {
    const now = Date.now();
    for (const [key, timestamp] of recentlyNotified.entries()) {
        if (now - timestamp > NOTIFICATION_DEDUPE_TTL) {
            recentlyNotified.delete(key);
        }
    }
}

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
async function fetchUserBeatmapsets(osuId, type = null) {
    const token = await getOsuApiToken();
    if (!token) return [];

    try {
        if (type && ['loved', 'graveyard', 'ranked', 'pending'].includes(type.toLowerCase())) {
            const reqType = type.toLowerCase() === 'pending' ? 'unranked' : type.toLowerCase();
            const url = `https://osu.ppy.sh/api/v2/users/${osuId}/beatmapsets/${reqType}?limit=25`;
            const res = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'SengoBot/2.0'
                }
            });
            return Array.isArray(res.data) ? res.data : [];
        }

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

        // También consultar los graveyard más recientes para registrar su estado y detectar revives correctamente
        const graveyardUrl = `https://osu.ppy.sh/api/v2/users/${osuId}/beatmapsets/graveyard?limit=15`;
        const graveyardRes = await axios.get(graveyardUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'SengoBot/2.0'
            }
        }).catch(() => ({ data: [] }));
        const graveyard = Array.isArray(graveyardRes.data) ? graveyardRes.data : [];

        return [...ranked, ...unranked, ...graveyard];
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
                    eventType = 'disqualified';
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
                const nominatorUser = event.user ? {
                    id: event.user.id || event.user_id,
                    username: event.user.username || `BN #${event.user_id}`,
                    avatar_url: event.user.avatar_url || `https://a.ppy.sh/${event.user_id}`
                } : (event.user_id ? { id: event.user_id, username: `BN #${event.user_id}`, avatar_url: `https://a.ppy.sh/${event.user_id}` } : null);

                const extraInfo = {
                    nominator: nominatorUser,
                    comment: event.comment?.text || (typeof event.comment === 'string' ? event.comment : null)
                };

                await notifyEvent(mapset, mapperOsuId, eventType, subscriptions, extraInfo);

                // Sincronizar el snapshot del mapper en DB para evitar que el escaneo profundo duplique el evento
                try {
                    const lastEvents = await MappingTrackerModel.getLastEventsForOsuId(mapperOsuId);
                    const currentSnapshot = lastEvents?.status_snapshot || {};
                    const mapsetIdStr = mapset.id.toString();
                    currentSnapshot[mapsetIdStr] = {
                        status: eventType === 'nomination' ? (currentSnapshot[mapsetIdStr]?.status || 'pending') : eventType,
                        last_updated: mapset.last_updated || new Date().toISOString()
                    };
                    await MappingTrackerModel.saveLastEventsForOsuId(mapperOsuId, mapset.id, currentSnapshot);
                } catch (snapErr) {
                    // Silenciar errores menores al guardar snapshot
                }
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
                    // Primer registro del mapa en el snapshot
                    if (lastEvents) {
                        // ponytail: Si el mapa está en graveyard o ya está ranked/loved, es un mapa existente que se indexa en el snapshot por primera vez, no un evento
                        if (currentStatus === 'graveyard' || currentStatus === 'ranked' || currentStatus === 'loved') {
                            continue;
                        }

                        const submittedTime = mapset.submitted_date ? new Date(mapset.submitted_date).getTime() : 0;
                        const updatedTime = mapset.last_updated ? new Date(mapset.last_updated).getTime() : 0;
                        const now = Date.now();
                        const isRecentlySubmitted = submittedTime > 0 && (now - submittedTime) < 24 * 60 * 60 * 1000;
                        const isRecentlyUpdated = updatedTime > 0 && (now - updatedTime) < 2 * 60 * 60 * 1000;

                        if (isRecentlySubmitted) {
                            // Subida nueva de mapa en las últimas 24h
                            await notifyEvent(mapset, osuId, 'upload', subscriptions);
                        } else if (isRecentlyUpdated) {
                            // Mapa antiguo revivido/actualizado en las últimas 2h
                            await notifyEvent(mapset, osuId, 'revive', subscriptions);
                        }
                    }
                } else if (prevStatus !== currentStatus) {
                    // Cambio de estado (ej: pending -> qualified, qualified -> ranked, graveyard -> revive, qualified -> disqualified)
                    let eventType = currentStatus;
                    if (prevStatus === 'graveyard' && currentStatus !== 'graveyard') {
                        eventType = 'revive';
                    } else if (prevStatus === 'qualified' && (currentStatus === 'pending' || currentStatus === 'wip')) {
                        eventType = 'disqualified';
                    }
                    await notifyEvent(mapset, osuId, eventType, subscriptions);
                } else if (prevUpdated && currentUpdated && prevUpdated !== currentUpdated) {
                    // Notificación de actualización de mapa (BSB / Update) solo si está en pending/wip
                    if (currentStatus === 'pending' || currentStatus === 'wip') {
                        await notifyEvent(mapset, osuId, 'pending', subscriptions);
                    }
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
 * Detecta el modo de juego principal de un beatmapset analizando las dificultades creadas por el mapper/host.
 * - Discrimina Guest Diffs (GDs) por user_id y por patrones en el nombre de la versión (ej: "TheShadow's Normal").
 * - Si el host mapeó dificultades, toma el modo predominante de sus dificultades.
 * - Si hay empate, desempata con la de mayor Star Rating (SR) o con el playmode del perfil.
 * - Si no hay diffs del host identificadas, desempata con el playmode del perfil o modo de la dificultad más alta.
 */
function detectBeatmapsetGamemode(beatmapset, mapperUser = null, fallbackPlaymode = null) {
    if (!beatmapset) return fallbackPlaymode || 'osu';

    const hostOsuId = Number(mapperUser?.id || beatmapset.user_id || 0);
    const hostUsername = (mapperUser?.username || beatmapset.creator || '').toLowerCase().trim();
    const diffs = Array.isArray(beatmapset.beatmaps) ? beatmapset.beatmaps : [];

    if (diffs.length === 0) {
        return fallbackPlaymode || 'osu';
    }

    const MODE_INT_MAP = { 0: 'osu', 1: 'taiko', 2: 'fruits', 3: 'mania' };

    function normalizeMode(d) {
        if (typeof d.mode === 'string' && d.mode) return d.mode.toLowerCase();
        if (d.mode_int !== undefined && MODE_INT_MAP[d.mode_int]) return MODE_INT_MAP[d.mode_int];
        if (d.ruleset_id !== undefined && MODE_INT_MAP[d.ruleset_id]) return MODE_INT_MAP[d.ruleset_id];
        return 'osu';
    }

    const hostDiffs = [];
    const allDiffs = [];

    for (const d of diffs) {
        const mode = normalizeMode(d);
        const sr = Number(d.difficulty_rating || d.sr || 0);
        const version = String(d.version || d.name || '').trim();
        const diffUserId = Number(d.user_id || 0);

        const diffObj = { mode, sr, version, diffUserId };
        allDiffs.push(diffObj);

        // Comprobación de Guest Diff:
        if (diffUserId > 0 && hostOsuId > 0 && diffUserId !== hostOsuId) {
            continue;
        }

        const possessiveMatch = version.match(/^(.+?)['’]s\s+/i);
        if (possessiveMatch) {
            const ownerInName = possessiveMatch[1].toLowerCase().trim();
            if (hostUsername && ownerInName !== hostUsername) {
                continue;
            }
        }

        const bracketMatch = version.match(/^[\[\(](.+?)[\]\)]\s*/);
        if (bracketMatch) {
            const ownerInName = bracketMatch[1].toLowerCase().trim();
            if (hostUsername && ownerInName !== hostUsername && ownerInName.length > 2) {
                continue;
            }
        }

        hostDiffs.push(diffObj);
    }

    const targetDiffs = hostDiffs.length > 0 ? hostDiffs : allDiffs;

    const modeCounts = { osu: 0, taiko: 0, fruits: 0, mania: 0 };
    const modeMaxSr = { osu: 0, taiko: 0, fruits: 0, mania: 0 };

    for (const d of targetDiffs) {
        modeCounts[d.mode] = (modeCounts[d.mode] || 0) + 1;
        if (d.sr > (modeMaxSr[d.mode] || 0)) {
            modeMaxSr[d.mode] = d.sr;
        }
    }

    let bestMode = null;
    let maxCount = -1;
    let isTied = false;

    for (const [m, count] of Object.entries(modeCounts)) {
        if (count > maxCount) {
            maxCount = count;
            bestMode = m;
            isTied = false;
        } else if (count === maxCount && count > 0) {
            isTied = true;
        }
    }

    if (isTied) {
        let highestSr = -1;
        let modeWithHighestSr = null;
        let srTied = false;

        for (const [m, count] of Object.entries(modeCounts)) {
            if (count === maxCount) {
                if (modeMaxSr[m] > highestSr) {
                    highestSr = modeMaxSr[m];
                    modeWithHighestSr = m;
                    srTied = false;
                } else if (modeMaxSr[m] === highestSr) {
                    srTied = true;
                }
            }
        }

        if (modeWithHighestSr && !srTied) {
            return modeWithHighestSr;
        }

        const preferredMode = fallbackPlaymode || mapperUser?.playmode;
        if (preferredMode && modeCounts[preferredMode] > 0) {
            return preferredMode;
        }
    }

    return bestMode || fallbackPlaymode || 'osu';
}

/**
 * Envía las notificaciones de eventos a los canales de Discord suscritos.
 */
async function notifyEvent(mapset, osuId, eventType, subscriptions, extraInfo = null) {
    const mapperUser = {
        id: osuId,
        username: mapset.creator || 'Mapper',
        avatar_url: `https://a.ppy.sh/${osuId}`,
        country_code: mapset.user?.country_code || null
    };

    cleanOldNotifiedEntries();

    for (const sub of subscriptions) {
        const types = sub.event_types || ['all'];
        const isMatch = types.includes('all') || types.includes(eventType) || (eventType === 'upload' && types.includes('pending')) || (eventType === 'approved' && types.includes('ranked'));
        if (!isMatch) continue;

        const notifKey = `${sub.channel_id}:${mapset.id}:${eventType}`;
        const lastSent = recentlyNotified.get(notifKey);
        if (lastSent && (Date.now() - lastSent) < NOTIFICATION_DEDUPE_TTL) {
            // Ya fue notificado a este canal en los últimos 30 minutos (evita duplicados entre escaneo rápido y profundo)
            continue;
        }
        recentlyNotified.set(notifKey, Date.now());

        try {
            const isRankedEvent = eventType === 'ranked' || eventType === 'approved' || eventType === 'loved';
            const detectedGamemode = detectBeatmapsetGamemode(mapset, mapperUser, mapperUser?.playmode);
            const ranksInfo = isRankedEvent ? await MappingTrackerModel.getMapperRankings(osuId, mapperUser.country_code, sub.guild_id, true, detectedGamemode) : null;
            if (ranksInfo) {
                ranksInfo.linkedGds = await MappingTrackerModel.getLinkedGdMappersInfo(mapset, sub.guild_id, detectedGamemode);
            }
            const embedResult = doMappingTrackerNotificationEmbed(mapset, mapperUser, eventType, 'es', ranksInfo, extraInfo);

            const channel = await discordClient.channels.fetch(sub.channel_id).catch(() => null);
            if (channel && typeof channel.send === 'function') {
                const sentMsg = await channel.send(embedResult);

                // Si alguna dificultad tiene SR 0 (típico cuando osu! aún está procesando el cálculo de dificultad tras la subida)
                const hasZeroSr = Array.isArray(mapset.beatmaps) && mapset.beatmaps.some(d => Number(d.difficulty_rating || d.sr || 0) === 0);
                if (hasZeroSr && sentMsg && typeof sentMsg.edit === 'function') {
                    scheduleSrRecheck(sentMsg, mapset.id, mapperUser, eventType, ranksInfo, extraInfo);
                }
            }
        } catch (sendErr) {
            console.error(`[MAPPING-TRACKER-SERVICE] Error al enviar mensaje a canal ${sub.channel_id}:`, sendErr.message);
        }
    }
}

/**
 * Re-consulta el beatmapset tras 30s (y 60s si aún no ha terminado) para actualizar el mensaje de Discord
 * cuando la API de osu! termine de calcular los Star Ratings de un mapa recién subido.
 */
function scheduleSrRecheck(sentMsg, mapsetId, mapperUser, eventType, ranksInfo, extraInfo, attempt = 1) {
    const delay = 30000; // 30s para el 1er intento (T+30s), y otros 30s si se requiere un 2do intento (T+60s)
    setTimeout(async () => {
        try {
            const token = await getOsuApiToken();
            if (!token) return;

            const res = await axios.get(`https://osu.ppy.sh/api/v2/beatmapsets/${mapsetId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'SengoBot/2.0'
                }
            });

            const updatedMapset = res.data;
            if (updatedMapset && Array.isArray(updatedMapset.beatmaps) && updatedMapset.beatmaps.length > 0) {
                const allHasSr = updatedMapset.beatmaps.every(d => Number(d.difficulty_rating || d.sr || 0) > 0);
                const someHasSr = updatedMapset.beatmaps.some(d => Number(d.difficulty_rating || d.sr || 0) > 0);

                if (someHasSr) {
                    const updatedEmbedResult = doMappingTrackerNotificationEmbed(updatedMapset, mapperUser, eventType, 'es', ranksInfo, extraInfo);
                    await sentMsg.edit(updatedEmbedResult);
                }

                // Si aún quedan dificultades con SR 0 y es el primer intento, reintentar una segunda vez a los 60s
                if (!allHasSr && attempt === 1) {
                    scheduleSrRecheck(sentMsg, mapsetId, mapperUser, eventType, ranksInfo, extraInfo, 2);
                }
            }
        } catch (err) {
            // Silenciar error en reintento en background
        }
    }, delay);
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

/**
 * Consulta los eventos específicos de un beatmapset mediante la API v2 de osu!
 */
async function fetchBeatmapsetEvents(beatmapsetId) {
    const token = await getOsuApiToken();
    if (!token || !beatmapsetId) return [];

    try {
        const url = `https://osu.ppy.sh/api/v2/beatmapsets/events?beatmapset_id=${beatmapsetId}`;
        const res = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'SengoBot/2.0'
            }
        });
        return Array.isArray(res.data?.events) ? res.data.events : [];
    } catch (err) {
        return [];
    }
}

module.exports = {
    initMappingTracker,
    runMappingTrackerScan,
    runGlobalEventsScan,
    fetchUserBeatmapsets,
    fetchGlobalBeatmapEvents,
    fetchBeatmapsetEvents,
    detectBeatmapsetGamemode
};
