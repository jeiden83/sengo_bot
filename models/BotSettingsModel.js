const { getSupabaseClient } = require('../db/database.js');

// Caché en memoria para evitar consultas repetitivas a la base de datos
const settingsCache = new Map();
const CACHE_TTL = 300000; // 5 minutos de tiempo de vida (TTL)

/**
 * Obtiene el valor de una configuración del bot desde la base de datos, utilizando caché si está disponible.
 * @param {string} key Clave de la configuración
 * @returns {Promise<string|null>} Valor de la configuración o null si no existe
 */
async function getSetting(key) {
    if (!key) return null;

    const now = Date.now();
    const cached = settingsCache.get(key);
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
        return cached.value;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
        return null;
    }

    try {
        const { data, error } = await supabase
            .from('bot_settings')
            .select('value')
            .eq('key', key)
            .maybeSingle();

        if (error) throw error;

        const value = data ? data.value : null;
        settingsCache.set(key, { value, timestamp: now });
        return value;
    } catch (err) {
        console.error(`Error al obtener configuración para la clave ${key}:`, err);
        return null;
    }
}

/**
 * Guarda o actualiza una configuración del bot en la base de datos y actualiza la caché.
 * @param {string} key Clave de la configuración
 * @param {string} value Valor a guardar
 * @returns {Promise<boolean>} True si se guardó con éxito, False en caso contrario
 */
async function setSetting(key, value) {
    if (!key || value === undefined) {
        throw new Error("Se requiere una clave y un valor para guardar la configuración.");
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("El cliente de Supabase no está inicializado.");
    }

    try {
        const { error } = await supabase
            .from('bot_settings')
            .upsert({
                key,
                value,
                updated_at: new Date().toISOString()
            }, { onConflict: 'key' });

        if (error) throw error;

        // Actualizar caché
        settingsCache.set(key, { value, timestamp: Date.now() });
        return true;
    } catch (err) {
        console.error(`Error al guardar configuración para la clave ${key}:`, err);
        throw err;
    }
}

module.exports = {
    getSetting,
    setSetting,
    settingsCache
};
