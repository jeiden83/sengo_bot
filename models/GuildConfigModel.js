const { getSupabaseClient } = require('../db/database.js');

// Caché en memoria para evitar consultas repetitivas a la base de datos
const guildConfigCache = new Map();
const CACHE_TTL = 300000; // 5 minutos de tiempo de vida (TTL)

/**
 * Obtiene la configuración de un servidor de Discord, utilizando caché si está disponible.
 * Si el registro no existe en la base de datos, devuelve la configuración por defecto.
 * @param {string} guildId ID del servidor de Discord
 * @returns {Promise<object>} Objeto de configuración de la guild
 */
async function getGuildConfig(guildId) {
    if (!guildId) {
        return { guild_id: null, language: 'es' };
    }

    const now = Date.now();
    const cached = guildConfigCache.get(guildId);
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
        return cached.config;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
        return { guild_id: guildId, language: 'es' };
    }

    try {
        const { data, error } = await supabase
            .from('guild_configs')
            .select('*')
            .eq('guild_id', guildId)
            .maybeSingle();

        if (error) throw error;

        let config;
        if (data) {
            config = data;
        } else {
            // Configuración por defecto si no existe registro
            config = { guild_id: guildId, language: 'es' };
        }

        guildConfigCache.set(guildId, { config, timestamp: now });
        return config;
    } catch (err) {
        console.error(`Error al obtener configuración de guild ${guildId}:`, err);
        return { guild_id: guildId, language: 'es' };
    }
}

/**
 * Actualiza la configuración de un servidor de Discord en la base de datos y actualiza la caché.
 * @param {string} guildId ID del servidor de Discord
 * @param {object} updates Campos a actualizar (ej: { language: 'en' })
 * @returns {Promise<object>} Configuración actualizada
 */
async function updateGuildConfig(guildId, updates) {
    if (!guildId) {
        throw new Error("Se requiere la ID de guild para actualizar su configuración.");
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("El cliente de Supabase no está inicializado.");
    }

    try {
        const { data, error } = await supabase
            .from('guild_configs')
            .upsert({
                guild_id: guildId,
                ...updates
            }, { onConflict: 'guild_id' })
            .select()
            .single();

        if (error) throw error;

        // Actualizar caché
        guildConfigCache.set(guildId, { config: data, timestamp: Date.now() });
        return data;
    } catch (err) {
        console.error(`Error al actualizar configuración de guild ${guildId}:`, err);
        throw err;
    }
}

/**
 * Helper rápido para obtener únicamente el idioma de un servidor de Discord.
 * @param {string} guildId ID del servidor
 * @returns {Promise<string>} Código de idioma ('es', 'en', etc.)
 */
async function getGuildLanguage(guildId) {
    const config = await getGuildConfig(guildId);
    return config.language || 'es';
}

module.exports = {
    getGuildConfig,
    updateGuildConfig,
    getGuildLanguage,
    guildConfigCache
};
