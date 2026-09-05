const axios = require('axios');
const Logger = require('../utils/logger.js');

// Caché en memoria para evitar consultas web repetitivas durante la navegación de páginas
let cachedFriendsData = null;
let cacheTimestamp = 0;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutos

/**
 * Consulta la lista completa de amigos y relaciones mutuales desde la web de osu!
 * utilizando la cookie de sesión del propietario (OSU_SESSION).
 *
 * @param {Object} options
 * @param {boolean} [options.bypassCache=false] Si es true, ignora la caché y consulta la web.
 * @returns {Promise<{ currentUser: Object, friends: Array, totalFriends: number, totalMutuals: number }|null>}
 */
async function fetchWebFriends({ bypassCache = false } = {}) {
    const now = Date.now();
    if (!bypassCache && cachedFriendsData && (now - cacheTimestamp) < CACHE_TTL) {
        return cachedFriendsData;
    }

    let session = process.env.OSU_SESSION;
    if (!session) {
        return null;
    }

    session = session.trim();
    const cookieHeader = session.startsWith('osu_session=') ? session : `osu_session=${session}`;
    const userAgent = process.env.OSU_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    try {
        const res = await axios.get('https://osu.ppy.sh/home/friends', {
            headers: {
                'Cookie': cookieHeader,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'User-Agent': userAgent
            },
            timeout: 12000,
            validateStatus: () => true
        });

        if (res.status === 401) {
            Logger.system('Error 401 en sesión de osu!: la cookie osu_session es inválida o ha expirado.');
            return null;
        }

        if (res.status !== 200 || typeof res.data !== 'string') {
            Logger.system(`Error inesperado al consultar /home/friends: status ${res.status}`);
            return null;
        }

        const html = res.data;
        const currentUserMatch = html.match(/<script[^>]*id="json-current-user"[^>]*>([\s\S]*?)<\/script>/i);
        const usersMatch = html.match(/<script[^>]*id="json-users"[^>]*>([\s\S]*?)<\/script>/i);

        if (!currentUserMatch || !usersMatch) {
            Logger.system('No se pudieron extraer los bloques JSON de /home/friends.');
            return null;
        }

        const currentUser = JSON.parse(currentUserMatch[1]);
        const users = JSON.parse(usersMatch[1]);

        const usersMap = new Map();
        if (Array.isArray(users)) {
            users.forEach(u => usersMap.set(u.id, u));
        }

        const rawFriends = Array.isArray(currentUser.friends) ? currentUser.friends : [];
        let totalMutuals = 0;

        const friends = rawFriends.map(f => {
            const u = usersMap.get(f.target_id) || {};
            const isMutual = Boolean(f.mutual);
            if (isMutual) totalMutuals++;

            return {
                id: f.target_id,
                username: u.username || `User_${f.target_id}`,
                country_code: u.country_code || (u.country ? u.country.code : null),
                country: u.country?.name || u.country_code || '??',
                avatar_url: u.avatar_url || `https://a.ppy.sh/${f.target_id}`,
                is_online: Boolean(u.is_online),
                is_supporter: Boolean(u.is_supporter),
                mutual: isMutual ? 'yes' : 'no',
                is_mutual: isMutual,
                last_visit: u.last_visit || null
            };
        });

        const result = {
            currentUser: {
                id: currentUser.id,
                username: currentUser.username,
                avatar_url: currentUser.avatar_url,
                follower_count: currentUser.follower_count
            },
            friends,
            totalFriends: friends.length,
            totalMutuals
        };

        cachedFriendsData = result;
        cacheTimestamp = now;

        return result;
    } catch (err) {
        Logger.system(`Error al conectar con /home/friends de osu!: ${err.message}`);
        return null;
    }
}

/**
 * Limpia la caché en memoria de amigos web.
 */
function clearCache() {
    cachedFriendsData = null;
    cacheTimestamp = 0;
}

module.exports = {
    fetchWebFriends,
    clearCache
};
