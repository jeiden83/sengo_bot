const fetch = require("node-fetch");

let cachedPoolId = null;
let cachedPoolIdTimestamp = 0;

/**
 * Obtiene el ID del pool activo de Ranked Play dinámicamente mediante redirección.
 */
async function getActivePoolId() {
    const now = Date.now();
    if (cachedPoolId && (now - cachedPoolIdTimestamp) < 3600000) { // 1 hora de cache
        return cachedPoolId;
    }
    try {
        const res = await fetch("https://osu.ppy.sh/rankings/ranked-play/osu", {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
            }
        });
        const match = res.url.match(/\/ranked-play\/[a-z]+\/(\d+)/);
        if (match) {
            cachedPoolId = parseInt(match[1], 10);
            cachedPoolIdTimestamp = now;
            return cachedPoolId;
        }
    } catch (e) {
        console.error("[MODEL] Error al obtener el ID del pool activo, usando default 38:", e);
    }
    return cachedPoolId || 38;
}

/**
 * Parsea la página de clasificación de Ranked Play de la web de osu!.
 */
function parseRankedPlayLeaderboard(html) {
    const players = [];
    const blocks = html.split('class="ranking-page-grid-item"');
    
    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        
        const rankMatch = block.match(/ranking-page-grid-item__col[^>]*>\s*#(\d+)\s*<\/div>/);
        const rank = rankMatch ? parseInt(rankMatch[1], 10) : null;
        
        const countryMatch = block.match(/country=([A-Z]{2})/);
        const countryCode = countryMatch ? countryMatch[1] : null;
        
        const userMatch = block.match(/data-user-id="(\d+)"\s+href="https:\/\/osu\.ppy\.sh\/users\/\d+\/osu"\s*>\s*<span[^>]*>\s*([^<]+)\s*<\/span>/);
        let userId = null;
        let username = null;
        if (userMatch) {
            userId = userMatch[1];
            username = userMatch[2].trim();
        } else {
            const userMatch2 = block.match(/href="https:\/\/osu\.ppy\.sh\/users\/(\d+)\/osu"\s*>\s*<span[^>]*>\s*([^<]+)\s*<\/span>/);
            if (userMatch2) {
                userId = userMatch2[1];
                username = userMatch2[2].trim();
            }
        }
        
        const numberCols = [...block.matchAll(/ranking-page-grid-item__col--number[^>]*>\s*([0-9,]+)\s*<\/div>/g)];
        const wins = numberCols[0] ? parseInt(numberCols[0][1].replace(/,/g, ''), 10) : 0;
        const plays = numberCols[1] ? parseInt(numberCols[1][1].replace(/,/g, ''), 10) : 0;
        
        const ratingMatch = block.match(/ranking-page-grid-item__col--number-focus[^>]*>[\s\S]*?<span[^>]*>\s*([0-9,]+)(\*?)\s*<\/span>/);
        let rating = 0;
        let isProvisional = false;
        if (ratingMatch) {
            rating = parseInt(ratingMatch[1].replace(/,/g, ''), 10);
            isProvisional = ratingMatch[2] === '*';
        }
        
        if (userId && username) {
            players.push({
                rank,
                countryCode,
                userId,
                username,
                wins,
                plays,
                rating,
                isProvisional
            });
        }
    }
    return players;
}

/**
 * Obtiene el total de páginas de osu! desde el HTML.
 */
function parseMaxOsuPages(html) {
    const pageMatches = [...html.matchAll(/page=(\d+)/g)];
    const pages = pageMatches.map(m => parseInt(m[1], 10));
    return pages.length > 0 ? Math.max(...pages) : 1;
}

const leaderboardCache = new Map();
const CACHE_TTL = 300000; // 5 minutos en milisegundos

/**
 * Obtiene los jugadores y el máximo de páginas de la tabla de clasificación.
 */
async function fetchRankedPlayLeaderboard(page = 1) {
    const poolId = await getActivePoolId();
    const cacheKey = `pool_${poolId}_page_${page}`;
    const now = Date.now();

    if (leaderboardCache.has(cacheKey)) {
        const cached = leaderboardCache.get(cacheKey);
        if (now - cached.timestamp < CACHE_TTL) {
            return cached.data;
        }
    }

    const url = `https://osu.ppy.sh/rankings/ranked-play/osu/${poolId}?page=${page}`;
    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        }
    });
    if (!res.ok) {
        throw new Error(`Error en respuesta de osu! al obtener leaderboard: ${res.statusText}`);
    }
    const html = await res.text();
    const players = parseRankedPlayLeaderboard(html);
    const maxPages = parseMaxOsuPages(html);
    const result = { players, maxPages };

    leaderboardCache.set(cacheKey, {
        timestamp: now,
        data: result
    });

    return result;
}

const { getSupabaseClient } = require('../db/database.js');

async function updateUserRankedStats(osuUser) {
    if (!osuUser || !osuUser.id) return null;
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    const matchmaking = (osuUser.matchmaking_stats || []).find(m => m.pool && m.pool.type === 'ranked_play');
    if (!matchmaking) return null;

    const record = {
        osu_id: osuUser.id.toString(),
        username: osuUser.username,
        country_code: osuUser.country_code,
        rating: matchmaking.rating || 0,
        wins: matchmaking.first_placements || 0,
        plays: matchmaking.plays || 0,
        is_provisional: matchmaking.is_rating_provisional || false,
        updated_at: new Date().toISOString()
    };

    try {
        const { data: userLink } = await supabase
            .from('users')
            .select('discord_id')
            .eq('osu_id', record.osu_id)
            .maybeSingle();

        if (userLink) {
            record.discord_id = userLink.discord_id;
        }
    } catch (err) {
        console.error(`[BACKGROUND-RANKED] Error al buscar discord_id para osu_id ${record.osu_id}:`, err);
    }

    const { data, error } = await supabase
        .from('user_ranked_stats')
        .upsert(record, { onConflict: 'osu_id' })
        .select()
        .maybeSingle();

    if (error) {
        console.error(`[BACKGROUND-RANKED] Error al guardar estadísticas en user_ranked_stats para ${record.username}:`, error);
        throw error;
    }

    console.log(`[BACKGROUND-RANKED] Guardadas estadísticas de Ranked Play para ${record.username} (${record.rating} ELO)`);
    return data;
}

function updateUserRankedStatsInBackground(osuUser) {
    if (!osuUser || !osuUser.id) return;
    updateUserRankedStats(osuUser).catch(err => {
        console.error(`[BACKGROUND-RANKED] Error silencioso al actualizar:`, err.message);
    });
}

async function fetchServerRankedLeaderboard(linkedOsuIds) {
    const supabase = getSupabaseClient();
    if (!supabase) return [];
    if (!linkedOsuIds || linkedOsuIds.length === 0) return [];

    const { data, error } = await supabase
        .from('user_ranked_stats')
        .select('*')
        .in('osu_id', linkedOsuIds);

    if (error) {
        console.error("[DB] Error al obtener ranking del servidor desde la DB:", error);
        throw error;
    }
    return data || [];
}

module.exports = {
    getActivePoolId,
    parseRankedPlayLeaderboard,
    parseMaxOsuPages,
    fetchRankedPlayLeaderboard,
    updateUserRankedStats,
    updateUserRankedStatsInBackground,
    fetchServerRankedLeaderboard
};
