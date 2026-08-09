const { getSupabaseClient } = require("../db/supabase.js");

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

/**
 * Añade o actualiza la suscripción de un mapper para un servidor/canal.
 */
async function addTrackedUser(guildId, channelId, osuId, eventTypes = ['all'], addedBy = null) {
    const supabase = getSupabaseClient();
    if (!supabase) return { success: false, error: 'Supabase no disponible' };

    const payload = {
        guild_id: guildId.toString(),
        channel_id: channelId.toString(),
        osu_id: Number(osuId),
        event_types: Array.isArray(eventTypes) && eventTypes.length > 0 ? eventTypes : ['all'],
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
async function addServerUsersToTracker(guildId, channelId, osuIds, eventTypes = ['all'], addedBy = null) {
    const supabase = getSupabaseClient();
    if (!supabase) return { success: false, count: 0, error: 'Supabase no disponible' };

    if (!Array.isArray(osuIds) || osuIds.length === 0) {
        return { success: true, count: 0 };
    }

    const payload = osuIds.map(id => ({
        guild_id: guildId.toString(),
        channel_id: channelId.toString(),
        osu_id: Number(id),
        event_types: Array.isArray(eventTypes) && eventTypes.length > 0 ? eventTypes : ['all'],
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

    const { data, error } = await supabase
        .from('mapping_tracker_subscriptions')
        .select('*')
        .eq('guild_id', guildId.toString());

    if (error) {
        console.error('[MAPPING-TRACKER] Error al consultar mappers del servidor:', error);
        return [];
    }

    return data || [];
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
    saveLastEventsForOsuId
};
