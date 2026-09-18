// models/osuDroidModel.js
// Cliente y modelo de datos para la API v2 de osu!droid (new.osudroid.moe)

const { getSupabaseClient } = require('../db/database.js');

const DROID_API_BASE = 'https://new.osudroid.moe/api2';
const DROID_WEB_BASE = 'https://osudroid.moe';

// Caché en memoria para evitar saturar el rate limit (20 req/min por IP)
const cacheMap = new Map();
const CACHE_TTL_MS = 90 * 1000; // 90 segundos
const MAX_CACHE_ENTRIES = 120;

function getFromCache(key) {
    const entry = cacheMap.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
        cacheMap.delete(key);
        return null;
    }
    return entry.data;
}

function setInCache(key, data) {
    if (cacheMap.size >= MAX_CACHE_ENTRIES) {
        const firstKey = cacheMap.keys().next().value;
        cacheMap.delete(firstKey);
    }
    cacheMap.set(key, { data, expiry: Date.now() + CACHE_TTL_MS });
}

/**
 * Realiza una petición GET segura con timeout y caché a la API de osu!droid
 * @param {string} endpoint 
 * @returns {Promise<any|null>}
 */
async function fetchDroidApi(endpoint) {
    const cacheKey = `droid_${endpoint}`;
    const cached = getFromCache(cacheKey);
    if (cached !== null) return cached;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6500);

    try {
        const url = `${DROID_API_BASE}${endpoint}`;
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (res.status === 404) {
            return null;
        }

        if (!res.ok) {
            console.warn(`[osuDroidModel] Petición fallida (${res.status}): ${url}`);
            return null;
        }

        const data = await res.json();
        setInCache(cacheKey, data);
        return data;
    } catch (err) {
        clearTimeout(timeout);
        console.error(`[osuDroidModel] Error de red en ${endpoint}:`, err.message || err);
        return null;
    }
}

/**
 * Obtiene el perfil completo de un usuario por su nombre de usuario en osu!droid
 * @param {string} username 
 */
async function fetchProfileByUsername(username) {
    if (!username) return null;
    return fetchDroidApi(`/frontend/profile-username/${encodeURIComponent(username.trim())}`);
}

/**
 * Obtiene el perfil completo de un usuario por su UID numérico en osu!droid
 * @param {string|number} uid 
 */
async function fetchProfileByUid(uid) {
    if (!uid) return null;
    return fetchDroidApi(`/frontend/profile-uid/${encodeURIComponent(String(uid).trim())}`);
}

/**
 * Resuelve un usuario de osu!droid mediante username o UID numérico
 * @param {string} identifier 
 */
async function resolveDroidUser(identifier) {
    if (!identifier) return null;
    const cleanId = String(identifier).trim();

    // Si es puramente numérico, intentar buscar primero por UID
    if (/^\d+$/.test(cleanId)) {
        const byUid = await fetchProfileByUid(cleanId);
        if (byUid) return byUid;
    }

    // Buscar por nombre de usuario
    return fetchProfileByUsername(cleanId);
}

/**
 * Obtiene el leaderboard de un beatmap en osu!droid a partir de su hash MD5
 * @param {string} hash MD5 hash del beatmap
 * @param {number} page Página de resultados (por defecto 1)
 */
async function fetchLeaderboardByHash(hash, page = 1) {
    if (!hash) return null;
    return fetchDroidApi(`/game/leaderboard/?hash=${encodeURIComponent(hash.trim())}&page=${page}`);
}

/**
 * Busca las puntuaciones de un jugador en un mapa por UID y hash MD5
 * @param {string|number} uid 
 * @param {string} hash 
 */
async function searchScore(uid, hash) {
    if (!uid || !hash) return null;
    return fetchDroidApi(`/frontend/score-search?uid=${encodeURIComponent(String(uid).trim())}&hash=${encodeURIComponent(hash.trim())}`);
}

/**
 * Formatea los mods de osu!droid en una cadena legible (+HD,DT,PR...)
 * @param {Array<object>|null} mods 
 * @returns {string}
 */
function formatDroidMods(mods) {
    if (!mods || !Array.isArray(mods) || mods.length === 0) {
        return '+NM';
    }

    const parts = mods.map(m => {
        if (!m || !m.acronym) return '';
        const acronym = m.acronym.toUpperCase();
        if (acronym === 'CS' && m.settings && m.settings.rateMultiplier) {
            return `CS(${m.settings.rateMultiplier}x)`;
        }
        return acronym;
    }).filter(Boolean);

    return parts.length > 0 ? `+${parts.join(',')}` : '+NM';
}

/**
 * Obtiene la URL de descarga directa del replay binario (.odr)
 * @param {number|string} scoreId 
 */
function getReplayUrl(scoreId) {
    if (!scoreId) return null;
    return `${DROID_WEB_BASE}/api/upload/${scoreId}.odr`;
}

/**
 * Obtiene la URL del avatar del usuario de osu!droid
 * @param {number|string} userId 
 */
function getAvatarUrl(userId) {
    if (!userId) return null;
    return `${DROID_WEB_BASE}/user/avatar/${userId}.png`;
}

/**
 * Obtiene la URL del banner del usuario de osu!droid
 * @param {number|string} userId 
 */
function getBannerUrl(userId) {
    if (!userId) return null;
    return `${DROID_WEB_BASE}/user/banner/${userId}.png`;
}

/**
 * Obtiene el UID de osu!droid vinculado al Discord ID en Supabase
 * @param {string} discordId 
 */
async function getLinkedDroidUid(discordId) {
    const supabase = getSupabaseClient();
    if (!supabase || !discordId) return null;

    try {
        const { data, error } = await supabase
            .from('users')
            .select('droid_uid')
            .eq('discord_id', discordId)
            .maybeSingle();

        if (error) {
            console.error('[osuDroidModel] Error al buscar droid_uid en Supabase:', error);
            return null;
        }

        return data?.droid_uid || null;
    } catch (err) {
        console.error('[osuDroidModel] Excepción en getLinkedDroidUid:', err);
        return null;
    }
}

/**
 * Vincula una cuenta de osu!droid al usuario de Discord
 * @param {string} discordId 
 * @param {string|number} droidUid 
 */
async function linkDroidUser(discordId, droidUid) {
    const supabase = getSupabaseClient();
    if (!supabase || !discordId) return { success: false, error: 'Database unavailable' };

    try {
        const { data, error } = await supabase
            .from('users')
            .upsert({
                discord_id: discordId,
                droid_uid: String(droidUid)
            }, { onConflict: 'discord_id' })
            .select()
            .single();

        if (error) throw error;
        return { success: true, data };
    } catch (err) {
        console.error('[osuDroidModel] Error al vincular droid_uid:', err);
        return { success: false, error: err.message || err };
    }
}

/**
 * Desvincula la cuenta de osu!droid del usuario de Discord
 * @param {string} discordId 
 */
async function unlinkDroidUser(discordId) {
    const supabase = getSupabaseClient();
    if (!supabase || !discordId) return { success: false, error: 'Database unavailable' };

    try {
        const { data, error } = await supabase
            .from('users')
            .update({ droid_uid: null })
            .eq('discord_id', discordId)
            .select()
            .maybeSingle();

        if (error) throw error;
        return { success: true, data };
    } catch (err) {
        console.error('[osuDroidModel] Error al desvincular droid_uid:', err);
        return { success: false, error: err.message || err };
    }
}

module.exports = {
    fetchProfileByUsername,
    fetchProfileByUid,
    resolveDroidUser,
    fetchLeaderboardByHash,
    searchScore,
    formatDroidMods,
    getReplayUrl,
    getAvatarUrl,
    getBannerUrl,
    getLinkedDroidUid,
    linkDroidUser,
    unlinkDroidUser
};
