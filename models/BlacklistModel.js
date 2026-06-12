const { getSupabaseClient } = require('../db/database.js');

// Caché en memoria para evitar consultas repetidas a la base de datos
const blacklistCache = new Map();
const CACHE_TTL = 300000; // 5 minutos de tiempo de vida (TTL)

/**
 * Normaliza el nombre de un comando eliminando prefijos comunes como '.', 's.', 'sd.'
 * @param {string} cmd Nombre del comando
 * @returns {string} Comando normalizado
 */
function normalizeCommandName(cmd) {
    if (!cmd) return '';
    return cmd.toLowerCase()
        .replace(/^(sd\.|s\.|s\b|\.)/, '')
        .trim();
}

/**
 * Obtiene el registro de blacklist de un usuario desde la base de datos o caché.
 * @param {string} discordId ID de Discord del usuario
 * @returns {Promise<object|null>} Datos de la blacklist o null si no está en la blacklist
 */
async function getUserBlacklistRecord(discordId) {
    if (!discordId) return null;

    const now = Date.now();
    const cached = blacklistCache.get(discordId);
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
        return cached.value;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
        return null;
    }

    try {
        const { data, error } = await supabase
            .from('bot_blacklist')
            .select('*')
            .eq('discord_id', discordId)
            .maybeSingle();

        if (error) throw error;

        blacklistCache.set(discordId, { value: data, timestamp: now });
        return data;
    } catch (err) {
        console.error(`[BLACKLIST-MODEL] Error al obtener registro de blacklist para ${discordId}:`, err);
        return null;
    }
}

/**
 * Comprueba si un usuario está en la lista negra para ejecutar un comando específico o en general.
 * @param {string} discordId ID de Discord del usuario
 * @param {string} commandName Nombre del comando ejecutado
 * @returns {Promise<boolean>} True si el usuario está bloqueado, False en caso contrario
 */
async function isUserBlacklisted(discordId, commandName) {
    const record = await getUserBlacklistRecord(discordId);
    if (!record) return false;

    // Si commands es nulo o vacío, está bloqueado de forma general
    if (!record.commands || record.commands.length === 0) {
        return true;
    }

    const normalizedCmd = normalizeCommandName(commandName);
    
    // Si la lista de comandos contiene el comando ejecutado, está bloqueado
    const normalizedCommands = record.commands.map(cmd => normalizeCommandName(cmd));
    return normalizedCommands.includes(normalizedCmd);
}

/**
 * Agrega o actualiza un usuario en la lista negra.
 * @param {string} discordId ID de Discord del usuario a bloquear
 * @param {string[]|null} commands Lista de comandos bloqueados o null para bloqueo general
 * @param {string} addedBy ID de Discord del administrador que lo bloquea
 * @returns {Promise<boolean>} True si se guardó con éxito
 */
async function addToBlacklist(discordId, commands, addedBy) {
    if (!discordId) {
        throw new Error("Se requiere el ID de Discord del usuario.");
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("El cliente de Supabase no está inicializado.");
    }

    // Asegurarse de guardar comandos normalizados si no es un bloqueo general
    let cleanCommands = null;
    if (commands && commands.length > 0) {
        cleanCommands = commands.map(cmd => normalizeCommandName(cmd)).filter(cmd => cmd.length > 0);
        if (cleanCommands.length === 0) {
            cleanCommands = null;
        }
    }

    try {
        const { error } = await supabase
            .from('bot_blacklist')
            .upsert({
                discord_id: discordId,
                commands: cleanCommands,
                added_by: addedBy,
                created_at: new Date().toISOString()
            }, { onConflict: 'discord_id' });

        if (error) throw error;

        // Limpiar/actualizar caché
        blacklistCache.set(discordId, {
            value: { discord_id: discordId, commands: cleanCommands, added_by: addedBy, created_at: new Date().toISOString() },
            timestamp: Date.now()
        });
        return true;
    } catch (err) {
        console.error(`[BLACKLIST-MODEL] Error al agregar a blacklist:`, err);
        throw err;
    }
}

/**
 * Elimina un usuario de la lista negra.
 * @param {string} discordId ID de Discord del usuario
 * @returns {Promise<boolean>} True si se eliminó con éxito
 */
async function removeFromBlacklist(discordId) {
    if (!discordId) {
        throw new Error("Se requiere el ID de Discord del usuario.");
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("El cliente de Supabase no está inicializado.");
    }

    try {
        const { error } = await supabase
            .from('bot_blacklist')
            .delete()
            .eq('discord_id', discordId);

        if (error) throw error;

        // Actualizar caché
        blacklistCache.delete(discordId);
        return true;
    } catch (err) {
        console.error(`[BLACKLIST-MODEL] Error al eliminar de blacklist:`, err);
        throw err;
    }
}

/**
 * Obtiene la lista completa de usuarios bloqueados en la base de datos.
 * @returns {Promise<array>} Lista de usuarios bloqueados
 */
async function getBlacklist() {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("El cliente de Supabase no está inicializado.");
    }

    try {
        const { data, error } = await supabase
            .from('bot_blacklist')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Actualizar caché para todos los obtenidos
        if (data) {
            const now = Date.now();
            data.forEach(row => {
                blacklistCache.set(row.discord_id, { value: row, timestamp: now });
            });
        }

        return data || [];
    } catch (err) {
        console.error("[BLACKLIST-MODEL] Error al obtener lista de blacklist:", err);
        throw err;
    }
}

module.exports = {
    isUserBlacklisted,
    addToBlacklist,
    removeFromBlacklist,
    getBlacklist,
    normalizeCommandName
};
