const { getSupabaseClient } = require("../db/database.js");

/**
 * Modelo de datos para el módulo Mapping Tracker
 */

/**
 * Configura o actualiza el canal de notificaciones de Mapping Tracker para un servidor.
 */
async function setTrackerChannel(guildId, channelId, configuredBy) {
    const supabase = getSupabaseClient();
    if (!supabase) return { success: false, error: 'Supabase no disponible' };

    const payload = {
        guild_id: guildId.toString(),
        channel_id: channelId.toString(),
        configured_by: configuredBy ? configuredBy.toString() : null,
        updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
        .from('mapping_tracker_channels')
        .upsert(payload, { onConflict: 'guild_id' })
        .select()
        .single();

    if (error) {
        console.error('[MAPPING-TRACKER] Error al guardar canal de tracking:', error);
        return { success: false, error: error.message };
    }

    return { success: true, data };
}

/**
 * Elimina la configuración de canal de un servidor Y borra en cascada todas las suscripciones de mappers asociadas.
 */
async function deleteTrackerChannel(guildId) {
    const supabase = getSupabaseClient();
    if (!supabase) return { success: false, error: 'Supabase no disponible' };

    const gId = guildId.toString();

    // 1. Borrar todas las suscripciones del servidor
    const { error: subErr } = await supabase
        .from('mapping_tracker_subscriptions')
        .delete()
        .eq('guild_id', gId);

    if (subErr) {
        console.error('[MAPPING-TRACKER] Error al eliminar suscripciones en cascada:', subErr);
    }

    // 2. Borrar la configuración de canal
    const { error: chanErr } = await supabase
        .from('mapping_tracker_channels')
        .delete()
        .eq('guild_id', gId);

    if (chanErr) {
        console.error('[MAPPING-TRACKER] Error al eliminar canal de tracking:', chanErr);
        return { success: false, error: chanErr.message };
    }

    return { success: true };
}

/**
 * Obtiene la configuración de canal de tracking de un servidor.
 */
async function getTrackerChannel(guildId) {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    const { data, error } = await supabase
        .from('mapping_tracker_channels')
        .select('*')
        .eq('guild_id', guildId.toString())
        .maybeSingle();

    if (error) {
        console.error('[MAPPING-TRACKER] Error al obtener canal de tracking:', error);
        return null;
    }

    return data;
}

// ponytail: eventos de tracking por defecto recomendados
const DEFAULT_TRACK_EVENTS = ['ranked', 'qualified', 'loved', 'upload', 'disqualified', 'nomination'];

/**
 * Añade o actualiza la suscripción de un mapper para un servidor/canal.
 */
async function addTrackedUser(guildId, channelId, osuId, eventTypes = DEFAULT_TRACK_EVENTS, addedBy = null) {
    const supabase = getSupabaseClient();
    if (!supabase) return { success: false, error: 'Supabase no disponible' };

    const payload = {
        guild_id: guildId.toString(),
        channel_id: channelId.toString(),
        osu_id: Number(osuId),
        event_types: Array.isArray(eventTypes) && eventTypes.length > 0 ? eventTypes : DEFAULT_TRACK_EVENTS,
        added_by: addedBy ? addedBy.toString() : null
    };

    const { data, error } = await supabase
        .from('mapping_tracker_subscriptions')
        .upsert(payload, { onConflict: 'guild_id,osu_id' })
        .select()
        .single();

    if (error) {
        console.error('[MAPPING-TRACKER] Error al agregar usuario al tracking:', error);
        return { success: false, error: error.message };
    }

    return { success: true, data };
}

/**
 * Agrega masivamente usuarios vinculados del servidor al tracking.
 */
async function addServerUsersToTracker(guildId, channelId, osuIds, eventTypes = DEFAULT_TRACK_EVENTS, addedBy = null) {
    const supabase = getSupabaseClient();
    if (!supabase) return { success: false, count: 0, error: 'Supabase no disponible' };

    if (!Array.isArray(osuIds) || osuIds.length === 0) {
        return { success: true, count: 0 };
    }

    const payload = osuIds.map(id => ({
        guild_id: guildId.toString(),
        channel_id: channelId.toString(),
        osu_id: Number(id),
        event_types: Array.isArray(eventTypes) && eventTypes.length > 0 ? eventTypes : DEFAULT_TRACK_EVENTS,
        added_by: addedBy ? addedBy.toString() : null
    }));

    const { data, error } = await supabase
        .from('mapping_tracker_subscriptions')
        .upsert(payload, { onConflict: 'guild_id,osu_id' })
        .select();

    if (error) {
        console.error('[MAPPING-TRACKER] Error al agregar usuarios masivos del servidor:', error);
        return { success: false, count: 0, error: error.message };
    }

    return { success: true, count: data ? data.length : 0 };
}

/**
 * Elimina la suscripción de un mapper específico en un servidor.
 */
async function removeTrackedUser(guildId, osuId) {
    const supabase = getSupabaseClient();
    if (!supabase) return { success: false, error: 'Supabase no disponible' };

    const { error } = await supabase
        .from('mapping_tracker_subscriptions')
        .delete()
        .eq('guild_id', guildId.toString())
        .eq('osu_id', Number(osuId));

    if (error) {
        console.error('[MAPPING-TRACKER] Error al eliminar usuario del tracking:', error);
        return { success: false, error: error.message };
    }

    return { success: true };
}

/**
 * Obtiene la lista de usuarios rastreados en un servidor.
 */
async function getTrackedUsersForGuild(guildId) {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    const { data: subs, error } = await supabase
        .from('mapping_tracker_subscriptions')
        .select('*')
        .eq('guild_id', guildId.toString());

    if (error || !subs || subs.length === 0) {
        if (error) console.error('[MAPPING-TRACKER] Error al consultar mappers del servidor:', error);
        return [];
    }

    const osuIds = subs.map(s => Number(s.osu_id));
    const userMetaMap = new Map();

    try {
        const { data: dbTokens } = await supabase
            .from('oauth_tokens')
            .select('osu_id, username')
            .in('osu_id', osuIds);

        if (dbTokens) {
            dbTokens.forEach(t => {
                if (t.osu_id) userMetaMap.set(Number(t.osu_id), { username: t.username, country_code: null });
            });
        }

        const { data: dbStats } = await supabase
            .from('mapper_statistics')
            .select('osu_id, username, country_code')
            .in('osu_id', osuIds);

        if (dbStats) {
            dbStats.forEach(m => {
                if (m.osu_id) {
                    const existing = userMetaMap.get(Number(m.osu_id)) || {};
                    userMetaMap.set(Number(m.osu_id), {
                        username: m.username || existing.username,
                        country_code: m.country_code || existing.country_code
                    });
                }
            });
        }

        const { data: dbUsers } = await supabase
            .from('users')
            .select('osu_id, country_code')
            .in('osu_id', osuIds);

        if (dbUsers) {
            dbUsers.forEach(u => {
                if (u.osu_id) {
                    const existing = userMetaMap.get(Number(u.osu_id)) || {};
                    userMetaMap.set(Number(u.osu_id), {
                        username: existing.username,
                        country_code: u.country_code || existing.country_code
                    });
                }
            });
        }
    } catch (e) {
        console.error('[MAPPING-TRACKER] Error al obtener metadatos de mappers:', e);
    }

    return subs.map(sub => {
        const meta = userMetaMap.get(Number(sub.osu_id)) || {};
        return {
            ...sub,
            username: meta.username || `Mapper #${sub.osu_id}`,
            country_code: meta.country_code || null
        };
    });
}

/**
 * Obtiene todos los osu_ids únicos suscritos globalmente para el worker en segundo plano.
 */
async function getAllTrackedOsuIds() {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    const { data, error } = await supabase
        .from('mapping_tracker_subscriptions')
        .select('osu_id');

    if (error) {
        console.error('[MAPPING-TRACKER] Error al obtener lista global de mappers:', error);
        return [];
    }

    const uniqueIds = [...new Set((data || []).map(row => Number(row.osu_id)))];
    return uniqueIds;
}

/**
 * Obtiene las suscripciones activas para un osu_id específico.
 */
async function getSubscriptionsForOsuId(osuId) {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    const { data, error } = await supabase
        .from('mapping_tracker_subscriptions')
        .select('*')
        .eq('osu_id', Number(osuId));

    if (error) {
        console.error('[MAPPING-TRACKER] Error al obtener suscripciones por osu_id:', error);
        return [];
    }

    return data || [];
}

/**
 * Obtiene el último registro conocido de eventos/snapshot de un mapper.
 */
async function getLastEventsForOsuId(osuId) {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    const { data, error } = await supabase
        .from('mapping_tracker_last_events')
        .select('*')
        .eq('osu_id', Number(osuId))
        .maybeSingle();

    if (error) {
        console.error('[MAPPING-TRACKER] Error al obtener last events:', error);
        return null;
    }

    return data;
}

/**
 * Guarda o actualiza el registro de último evento/snapshot para un mapper.
 */
async function saveLastEventsForOsuId(osuId, lastBeatmapsetId, statusSnapshot = {}) {
    const supabase = getSupabaseClient();
    if (!supabase) return false;

    const payload = {
        osu_id: Number(osuId),
        last_beatmapset_id: lastBeatmapsetId ? Number(lastBeatmapsetId) : null,
        status_snapshot: statusSnapshot || {},
        updated_at: new Date().toISOString()
    };

    const { error } = await supabase
        .from('mapping_tracker_last_events')
        .upsert(payload, { onConflict: 'osu_id' });

    if (error) {
        console.error('[MAPPING-TRACKER] Error al guardar last events:', error);
        return false;
    }

    return true;
}

/**
 * Obtiene la posición del mapper en los rankings de Mapper Top (País, Servidor y Global).
 */
async function getMapperRankings(osuId, countryCode = null, guildId = null, isRankedEvent = false) {
    const supabase = getSupabaseClient();
    if (!supabase || !osuId) return { nationalRank: null, oldNationalRank: null, serverRank: null, oldServerRank: null, countryCode: null };

    const targetOsuId = Number(osuId);
    let nationalRank = null;
    let oldNationalRank = null;
    let serverRank = null;
    let oldServerRank = null;
    let resolvedCountryCode = countryCode ? countryCode.toUpperCase() : null;

    try {
        // 1. Obtener datos del mapper objetivo si no tenemos el país
        if (!resolvedCountryCode) {
            const { data: targetStat } = await supabase
                .from('mapper_statistics')
                .select('country_code')
                .eq('osu_id', targetOsuId)
                .maybeSingle();

            if (targetStat && targetStat.country_code) {
                resolvedCountryCode = targetStat.country_code.toUpperCase();
            }
        }

        // 2. Ranking Nacional (País)
        if (resolvedCountryCode) {
            const { data: natMappers } = await supabase
                .from('mapper_statistics')
                .select('osu_id, ranked_count, guest_count, loved_count')
                .ilike('country_code', resolvedCountryCode);

            if (natMappers && natMappers.length > 0) {
                natMappers.sort((a, b) => 
                    (b.ranked_count || 0) - (a.ranked_count || 0) ||
                    (b.guest_count || 0) - (a.guest_count || 0) ||
                    (b.loved_count || 0) - (a.loved_count || 0)
                );

                const idx = natMappers.findIndex(m => Number(m.osu_id) === targetOsuId);
                if (idx !== -1) {
                    nationalRank = idx + 1;

                    // Si es evento ranked/loved, calcular su puesto previo restando 1 al mapa rankeado
                    if (isRankedEvent) {
                        const oldList = natMappers.map(m => {
                            if (Number(m.osu_id) === targetOsuId) {
                                return { ...m, ranked_count: Math.max(0, (m.ranked_count || 0) - 1) };
                            }
                            return m;
                        });
                        oldList.sort((a, b) => 
                            (b.ranked_count || 0) - (a.ranked_count || 0) ||
                            (b.guest_count || 0) - (a.guest_count || 0) ||
                            (b.loved_count || 0) - (a.loved_count || 0)
                        );
                        const oldIdx = oldList.findIndex(m => Number(m.osu_id) === targetOsuId);
                        if (oldIdx !== -1) {
                            oldNationalRank = oldIdx + 1;
                        }
                    }
                }
            }
        }

        // 3. Ranking del Servidor
        if (guildId) {
            const { data: guildSubs } = await supabase
                .from('mapping_tracker_subscriptions')
                .select('osu_id')
                .eq('guild_id', guildId.toString());

            if (guildSubs && guildSubs.length > 0) {
                const sOsuIds = guildSubs.map(s => Number(s.osu_id));
                const { data: sMappers } = await supabase
                    .from('mapper_statistics')
                    .select('osu_id, ranked_count, guest_count, loved_count')
                    .in('osu_id', sOsuIds);

                if (sMappers && sMappers.length > 0) {
                    sMappers.sort((a, b) => 
                        (b.ranked_count || 0) - (a.ranked_count || 0) ||
                        (b.guest_count || 0) - (a.guest_count || 0) ||
                        (b.loved_count || 0) - (a.loved_count || 0)
                    );

                    const idx = sMappers.findIndex(m => Number(m.osu_id) === targetOsuId);
                    if (idx !== -1) {
                        serverRank = idx + 1;

                        if (isRankedEvent) {
                            const oldList = sMappers.map(m => {
                                if (Number(m.osu_id) === targetOsuId) {
                                    return { ...m, ranked_count: Math.max(0, (m.ranked_count || 0) - 1) };
                                }
                                return m;
                            });
                            oldList.sort((a, b) => 
                                (b.ranked_count || 0) - (a.ranked_count || 0) ||
                                (b.guest_count || 0) - (a.guest_count || 0) ||
                                (b.loved_count || 0) - (a.loved_count || 0)
                            );
                            const oldIdx = oldList.findIndex(m => Number(m.osu_id) === targetOsuId);
                            if (oldIdx !== -1) {
                                oldServerRank = oldIdx + 1;
                            }
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.error('[MAPPING-TRACKER] Error al calcular posiciones de mapper ranking:', err);
    }

    return { nationalRank, oldNationalRank, serverRank, oldServerRank, countryCode: resolvedCountryCode };
}

module.exports = {
    setTrackerChannel,
    deleteTrackerChannel,
    getTrackerChannel,
    addTrackedUser,
    addServerUsersToTracker,
    removeTrackedUser,
    getTrackedUsersForGuild,
    getAllTrackedOsuIds,
    getSubscriptionsForOsuId,
    getLastEventsForOsuId,
    saveLastEventsForOsuId,
    getMapperRankings
};
