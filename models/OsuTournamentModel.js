const { getSupabaseClient } = require('../db/database.js');

/**
 * Busca torneos en la base de datos aplicando diversos filtros.
 * 
 * @param {Object} filters
 * @param {string|string[]} [filters.status] - Estado(s) del torneo ('open', 'in_progress', 'completed', 'unknown')
 * @param {string} [filters.gameMode] - Modo de juego ('osu', 'mania', 'taiko', 'fruits')
 * @param {number} [filters.rank] - Rango global del jugador para filtrar torneos aptos
 * @param {string} [filters.tag] - Palabra clave/etiqueta para filtrar
 * @param {number} [filters.limit] - Límite de torneos a retornar
 * @returns {Promise<Array>} Lista de torneos encontrados
 */
async function searchTournaments(filters = {}) {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    let query = supabase.from('tournaments').select('*');

    // 1. Filtrar por estado
    if (filters.status) {
        if (Array.isArray(filters.status)) {
            query = query.in('reg_status', filters.status);
        } else {
            query = query.eq('reg_status', filters.status);
        }
    }

    // 2. Filtrar por modo de juego
    if (filters.gameMode) {
        query = query.eq('game_mode', filters.gameMode);
    }

    // 3. Filtrar por rango (torneos donde el rango del jugador sea válido)
    if (filters.rank !== undefined && filters.rank !== null) {
        const rank = parseInt(filters.rank, 10);
        if (!isNaN(rank)) {
            // Un torneo es apto si:
            // - Es rango abierto (is_open_range = true)
            // - O si el rango está entre rank_min y rank_max
            //   (rank_min <= rank AND (rank_max >= rank OR rank_max IS NULL))
            query = query.or(`is_open_range.eq.true,and(rank_min.lte.${rank},or(rank_max.gte.${rank},rank_max.is.null))`);
        }
    }

    // 4. Filtrar por etiqueta/tag
    if (filters.tag) {
        // En PostgreSQL, tags es un array de texto (TEXT[])
        // Usamos overlaps para buscar si contiene el tag (en minúsculas)
        query = query.overlaps('tags', [filters.tag.toLowerCase().trim()]);
    }

    // 5. Ordenar por fecha de creación desc
    query = query.order('created_at', { ascending: false });

    // 6. Límite de resultados
    if (filters.limit) {
        query = query.limit(filters.limit);
    }

    const { data, error } = await query;
    if (error) {
        console.error('[DB] Error al buscar torneos:', error);
        throw error;
    }
    return data || [];
}

module.exports = {
    searchTournaments
};
