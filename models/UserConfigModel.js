const { getSupabaseClient } = require('../db/database.js');

// Caché en memoria para evitar consultas repetitivas a la base de datos
const userLanguageCache = new Map();
const CACHE_TTL = 300000; // 5 minutos de tiempo de vida (TTL)

/**
 * Obtiene el idioma preferido de un usuario de Discord desde la base de datos o caché.
 * Si no tiene idioma configurado o no existe en la base de datos, devuelve null.
 * @param {string} discordId ID de Discord del usuario
 * @returns {Promise<string|null>} Código de idioma ('es', 'en') o null si no tiene preferencia
 */
async function getUserLanguage(discordId) {
    if (!discordId) return null;

    const now = Date.now();
    const cached = userLanguageCache.get(discordId);
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
        return cached.language;
    }

    const supabase = getSupabaseClient();
    if (!supabase) return null;

    try {
        const { data, error } = await supabase
            .from('users')
            .select('language')
            .eq('discord_id', discordId)
            .maybeSingle();

        if (error) throw error;

        const language = (data && data.language) ? data.language : null;
        userLanguageCache.set(discordId, { language, timestamp: now });
        return language;
    } catch (err) {
        console.error(`Error al obtener idioma del usuario ${discordId}:`, err);
        return null;
    }
}

/**
 * Actualiza el idioma preferido de un usuario de Discord en la base de datos y en la caché.
 * Si el usuario no existe en la tabla users, se crea un registro con su discord_id y language.
 * @param {string} discordId ID de Discord del usuario
 * @param {string|null} language Código de idioma ('es', 'en') o null para restablecer al del servidor
 * @returns {Promise<string|null>} Idioma actualizado
 */
async function updateUserLanguage(discordId, language) {
    if (!discordId) {
        throw new Error("Se requiere la ID de Discord para actualizar el idioma del usuario.");
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("El cliente de Supabase no está inicializado.");
    }

    const cleanLang = (language === 'es' || language === 'en') ? language : null;

    try {
        // Intentar actualizar si ya existe el usuario para no alterar otras columnas
        const { data: updated, error: updateError } = await supabase
            .from('users')
            .update({ language: cleanLang })
            .eq('discord_id', discordId)
            .select('language');

        if (updateError) throw updateError;

        if (!updated || updated.length === 0) {
            // Si el usuario aún no existe en la tabla, insertamos un registro base
            const { error: insertError } = await supabase
                .from('users')
                .insert({
                    discord_id: discordId,
                    language: cleanLang
                });

            if (insertError) throw insertError;
        }

        // Actualizar caché
        userLanguageCache.set(discordId, { language: cleanLang, timestamp: Date.now() });
        return cleanLang;
    } catch (err) {
        console.error(`Error al actualizar idioma del usuario ${discordId}:`, err);
        throw err;
    }
}

module.exports = {
    getUserLanguage,
    updateUserLanguage,
    userLanguageCache
};
