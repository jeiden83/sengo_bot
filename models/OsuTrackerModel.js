const { getSupabaseClient } = require('../db/database.js');
const Logger = require('../utils/logger.js');

/**
 * Obtiene el canal de tracking configurado para una guild.
 * @param {string} guildId ID del servidor
 * @returns {Promise<string|null>} ID del canal o null si no está configurado
 */
async function getTrackChannel(guildId) {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    try {
        const { data, error } = await supabase
            .from('guild_configs')
            .select('track_channel_id')
            .eq('guild_id', guildId)
            .maybeSingle();

        if (error) throw error;
        return data ? data.track_channel_id : null;
    } catch (err) {
        console.error(`[TRACKER-MODEL] Error al obtener track_channel_id para guild ${guildId}:`, err);
        return null;
    }
}

/**
 * Guarda o actualiza el canal de tracking de un servidor en guild_configs.
 * @param {string} guildId ID del servidor
 * @param {string|null} channelId ID del canal (o null para desactivar)
 * @returns {Promise<object>} Configuración actualizada
 */
async function setTrackChannel(guildId, channelId) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error("El cliente de Supabase no está inicializado.");

    try {
        const { data, error } = await supabase
            .from('guild_configs')
            .upsert({
                guild_id: guildId,
                track_channel_id: channelId
            }, { onConflict: 'guild_id' })
            .select()
            .single();

        if (error) throw error;

        // Limpiar caché de guild config si existe para evitar datos obsoletos
        const { guildConfigCache } = require('./GuildConfigModel.js');
        guildConfigCache.delete(guildId);

        return data;
    } catch (err) {
        console.error(`[TRACKER-MODEL] Error al guardar track_channel_id para guild ${guildId}:`, err);
        throw err;
    }
}

/**
 * Obtiene todos los usuarios que están siendo trackeados.
 * @returns {Promise<Array>} Lista de registros de tracking
 */
async function getTrackedUsers() {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    try {
        const { data, error } = await supabase
            .from('osu_tracker')
            .select('*');

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('[TRACKER-MODEL] Error al obtener usuarios trackeados:', err);
        return [];
    }
}

/**
 * Añade un usuario a la lista de tracking de un servidor.
 * @param {string} guildId ID del servidor
 * @param {string} channelId ID del canal
 * @param {string} osuId ID de osu!
 * @param {string} osuUsername Nombre de usuario de osu!
 * @param {string|null} discordId ID de Discord si está vinculado
 * @returns {Promise<object>} Registro creado
 */
async function addTrackedUser(guildId, channelId, osuId, osuUsername, discordId = null) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error("El cliente de Supabase no está inicializado.");

    try {
        // Verificar si ya existe para este servidor y usuario
        const { data: existing, error: findError } = await supabase
            .from('osu_tracker')
            .select('*')
            .eq('guild_id', guildId)
            .eq('osu_id', osuId.toString())
            .maybeSingle();

        if (findError) throw findError;

        if (existing) {
            // Si ya está pero en otro canal, actualizamos el canal
            if (existing.channel_id !== channelId) {
                const { data, error } = await supabase
                    .from('osu_tracker')
                    .update({ channel_id: channelId })
                    .eq('id', existing.id)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            }
            return existing;
        }

        // Crear nuevo registro
        const { data, error } = await supabase
            .from('osu_tracker')
            .insert({
                osu_id: osuId.toString(),
                osu_username: osuUsername,
                discord_id: discordId,
                guild_id: guildId,
                channel_id: channelId,
                is_active: false
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (err) {
        console.error(`[TRACKER-MODEL] Error al añadir usuario ${osuUsername} al tracking:`, err);
        throw err;
    }
}

/**
 * Remueve un usuario de la lista de tracking de un servidor.
 * @param {string} guildId ID del servidor
 * @param {string} osuId ID de osu!
 * @returns {Promise<boolean>} True si fue eliminado
 */
async function removeTrackedUser(guildId, osuId) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error("El cliente de Supabase no está inicializado.");

    try {
        const { error, count } = await supabase
            .from('osu_tracker')
            .delete({ count: 'exact' })
            .eq('guild_id', guildId)
            .eq('osu_id', osuId.toString());

        if (error) throw error;
        return count > 0;
    } catch (err) {
        console.error(`[TRACKER-MODEL] Error al remover usuario ${osuId} del tracking:`, err);
        throw err;
    }
}

/**
 * Obtiene la lista de usuarios trackeados en una guild.
 * @param {string} guildId ID del servidor
 * @returns {Promise<Array>} Lista de registros
 */
async function getTrackedUsersInGuild(guildId) {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    try {
        const { data, error } = await supabase
            .from('osu_tracker')
            .select('*')
            .eq('guild_id', guildId);

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error(`[TRACKER-MODEL] Error al obtener tracking de guild ${guildId}:`, err);
        return [];
    }
}

/**
 * Actualiza el registro de tracking (ej: last_score_id, is_active, last_active_at).
 * @param {number} id ID del registro en osu_tracker
 * @param {object} updates Campos a actualizar
 */
async function updateTrackedUser(id, updates) {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    try {
        const { error } = await supabase
            .from('osu_tracker')
            .update(updates)
            .eq('id', id);

        if (error) throw error;
    } catch (err) {
        console.error(`[TRACKER-MODEL] Error al actualizar registro de tracking ${id}:`, err);
    }
}

/**
 * Sincroniza automáticamente a un usuario vinculado por OAuth agregándolo al tracking.
 * Se añade a todas las guilds donde esté presente el usuario y que tengan canal de tracking configurado.
 * @param {string} discordId ID de Discord
 * @param {string} osuId ID de osu!
 * @param {string} osuUsername Nombre de usuario de osu!
 */
async function syncOAuthUserToTracking(discordId, osuId, osuUsername) {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    try {
        // 1. Obtener el registro de vinculación para saber las guilds asociadas
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('guilds')
            .eq('discord_id', discordId)
            .maybeSingle();

        if (userError) throw userError;
        if (!user || !user.guilds || user.guilds.length === 0) {
            // ponytail: Si el usuario no tiene guilds mapeadas en la DB todavía, esperamos a que guildsSync lo haga
            return;
        }

        // 2. Obtener las guilds que tienen canal de tracking configurado
        const { data: configs, error: configError } = await supabase
            .from('guild_configs')
            .select('guild_id, track_channel_id')
            .in('guild_id', user.guilds)
            .not('track_channel_id', 'is', null);

        if (configError) throw configError;
        if (!configs || configs.length === 0) return;

        // 3. Agregar el usuario a la tabla de tracking en cada una de esas guilds
        for (const config of configs) {
            await addTrackedUser(
                config.guild_id,
                config.track_channel_id,
                osuId,
                osuUsername,
                discordId
            );
        }
        Logger.system(`[TRACKER-MODEL] Usuario OAuth ${osuUsername} sincronizado a tracking en ${configs.length} servidor(es).`);
    } catch (err) {
        console.error(`[TRACKER-MODEL] Error al sincronizar usuario OAuth ${discordId} en tracking:`, err);
    }
}

module.exports = {
    getTrackChannel,
    setTrackChannel,
    getTrackedUsers,
    addTrackedUser,
    removeTrackedUser,
    getTrackedUsersInGuild,
    updateTrackedUser,
    syncOAuthUserToTracking
};
