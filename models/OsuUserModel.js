const { Client, Auth } = require('osu-web.js');
const { auth } = require('osu-api-extended');
const { getSupabaseClient, addUser, deleteUser } = require('../db/database.js');
const { refreshAccessToken, fetchOsuMe } = require('../utils/osuAuth.js');
const { osuApiQueue } = require('../utils/OsuApiQueue.js');
const CONFIG = require('../config.js');
const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');

// Cachés locales en memoria
const userProfileCache = new Map();
const activeProfilePromises = new Map();
const PROFILE_CACHE_TTL = 300000; // 5 minutos de vigencia del perfil en caché

// Helper para limitar el tamaño de los mapas de caché
function setWithLimit(map, key, value, limit = 100) {
    if (map.size >= limit && !map.has(key)) {
        const firstKey = map.keys().next().value;
        map.delete(firstKey);
    }
    map.set(key, value);
}

/**
 * Carga las credenciales públicas generales de la API de osu! y las guarda localmente.
 * Soporta refresco automático.
 */
async function loadToken() {
    const tokenFilePath = path.resolve('osu_token.json');

    try {
        const osu_token = JSON.parse(await fs.readFile(tokenFilePath, 'utf-8'));
        if (Date.now() >= osu_token.expires_at) {
            return await createToken();
        }
        return osu_token;
    } catch (error) {
        return await createToken();
    }

    async function createToken() {
        const authClient = new Auth(CONFIG.OSU_CLIENT_ID, CONFIG.OSU_CLIENT_SECRET, "");
        const osu_token = await authClient.clientCredentialsGrant();

        const accessTokenData = {
            access_token: osu_token.access_token,
            expires_in: osu_token.expires_in,
            token_type: osu_token.token_type,
            expires_at: Date.now() + osu_token.expires_in * 1000
        };

        await fs.writeFile(tokenFilePath, JSON.stringify(accessTokenData, null, 2));
        console.log("# Token recargado");
        return osu_token;
    }
}

/**
 * Login alternativo de osu-api-extended para la sesión global pública.
 */
async function NewloadToken() {
    await auth.login({
        type: 'v2',
        client_id: CONFIG.OSU_CLIENT_ID,
        client_secret: CONFIG.OSU_CLIENT_SECRET,
        scopes: ['public'],
        cachedTokenPath: './osu_token.json'
    });
}

/**
 * Realiza la búsqueda de un perfil de usuario de osu!, aplicando deduplicación y caché en memoria.
 * Soporta servidores Bancho (oficial) y Gatari (privado).
 */
async function getOsuUser(parsed_args) {
    const server = parsed_args.server || 'bancho';
    const look_gamemode = parsed_args.gamemode || 'osu';
    const username = parsed_args.username[0];
    const key = `${username}:${look_gamemode}:${server}`;

    if (activeProfilePromises.has(key)) {
        try {
            await activeProfilePromises.get(key);
        } catch (e) {
            console.error(`[PROFILE-DEDUPLICATOR] La consulta en progreso para ${username} falló:`, e);
        }
        return getOsuUser(parsed_args);
    }

    let resolveActivePromise;
    const p = new Promise(resolve => { resolveActivePromise = resolve; });
    activeProfilePromises.set(key, p);

    try {
        const result = await _getOsuUser(parsed_args);
        return result;
    } finally {
        resolveActivePromise();
        activeProfilePromises.delete(key);
    }
}

/**
 * Función interna de obtención de perfil.
 */
async function _getOsuUser(parsed_args) {
    const server = parsed_args.server || 'bancho';
    const look_gamemode = parsed_args.gamemode || 'osu';
    const username = parsed_args.username[0];
    const cacheKey = `${username}:${look_gamemode}:${server}`;
    const now = Date.now();
    
    let cached = userProfileCache.get(cacheKey);
    if (!cached && typeof username === 'string') {
        const cacheKeyLower = `${username.toLowerCase()}:${look_gamemode}:${server}`;
        cached = userProfileCache.get(cacheKeyLower);
    }

    if (cached && (now - cached.timestamp) < PROFILE_CACHE_TTL) {
        return cached.user;
    }

    const returnAndCache = (user) => {
        if (user && typeof user === 'object' && user.username !== undefined && user.username !== "El usuario no se encuentra en osu!" && user.username !== "El usuario no se encuentra en Gatari!") {
            setWithLimit(userProfileCache, cacheKey, { user, timestamp: now });
            if (user.id) {
                const keyById = `${user.id}:${look_gamemode}:${server}`;
                setWithLimit(userProfileCache, keyById, { user, timestamp: now });
            }
            if (user.username) {
                const keyByName = `${user.username}:${look_gamemode}:${server}`;
                setWithLimit(userProfileCache, keyByName, { user, timestamp: now });
                const keyByNameLower = `${user.username.toLowerCase()}:${look_gamemode}:${server}`;
                setWithLimit(userProfileCache, keyByNameLower, { user, timestamp: now });
            }
        }
        return user;
    };

    if (server === 'gatari') {
        try {
            const response = await fetch(`https://api.gatari.pw/users/get?u=${parsed_args.username[0]}`);
            const data = await response.json();
            
            const modeMap = { 'osu': 0, 'taiko': 1, 'fruits': 2, 'mania': 3 };
            const m = modeMap[look_gamemode];
            const statsRes = await fetch(`https://api.gatari.pw/user/stats?u=${parsed_args.username[0]}&mode=${m}`);
            const statsData = await statsRes.json();

            let achCount = [];
            if (data.users && data.users.length > 0) {
                const u = data.users[0];
                const achRes = await fetch(`https://api.gatari.pw/user/achievements?u=${u.id}`);
                const achText = await achRes.text();
                if (achText) {
                    try {
                        const achData = JSON.parse(achText);
                        if (achData.data) {
                            Object.values(achData.data).forEach(cat => {
                                if (cat.achievements) {
                                    achCount.push(...cat.achievements.filter(a => a !== null));
                                }
                            });
                        }
                    } catch {}
                }
            }

            if (data.users && data.users.length > 0 && statsData.stats) {
                const u = data.users[0];
                const s = statsData.stats;
                return returnAndCache({
                    id: u.id,
                    username: u.username,
                    country_code: u.country,
                    avatar_url: `https://a.gatari.pw/${u.id}`,
                    cover_url: `https://a.gatari.pw/${u.id}`,
                    join_date: new Date(u.registered_on * 1000).toISOString(),
                    rank_highest: null,
                    user_achievements: achCount,
                    statistics: {
                        global_rank: s.rank,
                        pp: s.pp,
                        hit_accuracy: s.avg_accuracy,
                        play_count: s.playcount,
                        play_time: s.playtime,
                        level: { current: s.level, progress: s.level_progress },
                        rank: { country: s.country_rank }
                    },
                    server: 'gatari',
                    is_supporter: u.donor === 1 || u.donor === true || false
                });
            }
            throw new Error("User not found in Gatari");
        } catch (e) {
            if (/^\d+$/.test(parsed_args.username[0])) {
                return `El usuario no se encuentra en Gatari!\n💡 **Consejo:** Si estás usando tu cuenta enlazada, recuerda que las IDs de Bancho y Gatari son diferentes. Prueba buscando con tu nombre de usuario: \`/osu usuario:TuNombre servidor:Gatari\``;
            }
            return `El usuario no se encuentra en Gatari!`;
        }
    }

    const osu_token = await loadToken();
    let res;

    try {
        res = await osuApiQueue.add(() => new Client(osu_token.access_token).users.getUser(parsed_args.username[0], { urlParams: { mode: look_gamemode } }));
        if (res.username === "undefined") throw ("error");
    } catch (error) {
        res = `El usuario no se encuentra en osu!`;
    }
    
    return returnAndCache(res);
}

/**
 * Consulta un usuario vinculado de la base de datos.
 */
async function getLinkedUser(User, discordId) {
    if (User && typeof User.findOne === 'function') {
        try {
            return await User.findOne({ discord_id: discordId });
        } catch (err) {
            console.error(`Error al buscar vinculación para ${discordId} usando User.findOne:`, err);
            return null;
        }
    }

    const supabase = getSupabaseClient();
    if (!supabase) return null;

    try {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('discord_id', discordId)
            .maybeSingle();

        if (error) throw error;
        return data;
    } catch (err) {
        console.error(`Error al buscar vinculación para ${discordId} en OsuUserModel:`, err);
        return null;
    }
}

/**
 * Vincula un usuario de Discord con osu! de forma tradicional en la base de datos.
 * Elimina cualquier credencial de OAuth previa para evitar conflictos.
 */
async function linkUser(User, discordId, osuId, mainGamemode) {
    const supabase = getSupabaseClient();
    if (supabase) {
        try {
            await supabase.from('oauth_tokens').delete().eq('discord_id', discordId);
        } catch (err) {
            console.error(`Error al eliminar token OAuth al vincular tradicionalmente a ${discordId}:`, err);
        }
    }
    return addUser(User, discordId, osuId, mainGamemode);
}

/**
 * Desvincula por completo a un usuario (tabla 'users' y tabla 'oauth_tokens').
 */
async function unlinkUser(User, discordId) {
    const supabase = getSupabaseClient();
    if (supabase) {
        try {
            await supabase.from('oauth_tokens').delete().eq('discord_id', discordId);
        } catch (err) {
            console.error(`Error al eliminar token OAuth de ${discordId}:`, err);
        }
    }
    
    return await deleteUser(User, discordId);
}

/**
 * Consulta el listado de usuarios vinculados de Supabase bajo ciertos criterios (guild, bypass).
 */
async function getLinkedUsers({ guildId = null, bypass = false } = {}) {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    try {
        let query = supabase
            .from('users')
            .select('discord_id, osu_id, main_gamemode')
            .not('osu_id', 'is', null);

        if (guildId) {
            query = query.contains('guilds', [guildId]);
        }

        const { data: linkedUsers, error } = await query;
        if (error) throw error;

        return linkedUsers || [];
    } catch (err) {
        console.error('Error al obtener usuarios vinculados en OsuUserModel:', err);
        return [];
    }
}

/**
 * Construye un mapa estructurado de usuarios vinculados a partir de las tablas 'users' y 'oauth_tokens'.
 * Mapea osu_id (string) -> { discord_id, username }
 */
async function getLinkedUsersMap() {
    const supabase = getSupabaseClient();
    if (!supabase) return new Map();
    
    const linkedMap = new Map();
    try {
        const { data: dbUsers } = await supabase
            .from('users')
            .select('discord_id, osu_id')
            .not('osu_id', 'is', null);

        const { data: dbTokens } = await supabase
            .from('oauth_tokens')
            .select('discord_id, osu_id, username');
        
        if (dbTokens) {
            dbTokens.forEach(t => {
                linkedMap.set(t.osu_id.toString(), { discord_id: t.discord_id, username: t.username });
            });
        }

        if (dbUsers) {
            dbUsers.forEach(u => {
                const osuIdStr = u.osu_id.toString();
                if (!linkedMap.has(osuIdStr)) {
                    linkedMap.set(osuIdStr, { discord_id: u.discord_id, username: null });
                }
            });
        }
    } catch (err) {
        console.error("Error al consultar mapa de vinculados en OsuUserModel:", err);
    }
    return linkedMap;
}

/**
 * Obtiene un token de OAuth válido para un Discord ID.
 */
async function getOAuthTokenRecord(discordId) {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    try {
        const { data, error } = await supabase
            .from('oauth_tokens')
            .select('*')
            .eq('discord_id', discordId)
            .maybeSingle();

        if (error) throw error;
        return data;
    } catch (err) {
        console.error(`Error al obtener oauth_token para ${discordId}:`, err);
        return null;
    }
}

/**
 * Busca un registro de token de OAuth mediante el nombre de usuario de osu! (case insensitive o similar).
 */
async function getOAuthTokenRecordByUsernameOrId(filter) {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    try {
        let query = supabase.from('oauth_tokens').select('*');
        const cleanId = filter.replace(/[<@!>]/g, "");
        
        if (/^\d{17,19}$/.test(cleanId)) {
            query = query.eq('discord_id', cleanId);
        } else {
            query = query.ilike('username', filter);
        }

        const { data, error } = await query.maybeSingle();
        if (error) throw error;
        return data;
    } catch (err) {
        console.error(`Error al obtener oauth_token por filtro ${filter}:`, err);
        return null;
    }
}

/**
 * Obtiene un mapa de osu_id -> username de la tabla oauth_tokens.
 */
async function getOAuthUsernamesMap() {
    const supabase = getSupabaseClient();
    if (!supabase) return new Map();

    try {
        const { data: oauthTokens } = await supabase
            .from('oauth_tokens')
            .select('osu_id, username');

        return new Map(oauthTokens?.map(t => [t.osu_id.toString(), t.username]) || []);
    } catch (err) {
        console.error("Error al obtener usernames de OAuth:", err);
        return new Map();
    }
}

/**
 * Obtiene la lista de amigos en osu! de un usuario enlazado vía OAuth.
 */
async function getFriendsList(discordId) {
    const token = await getValidTokenForUser(discordId);
    if (!token) return null;

    return osuApiQueue.add(async () => {
        const res = await axios.get('https://osu.ppy.sh/api/v2/friends', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });
        return res.data;
    });
}

/**
 * Obtiene los detalles de la propia cuenta enlazada (/me).
 */
async function fetchMeDetails(discordId) {
    const token = await getValidTokenForUser(discordId);
    if (!token) return null;

    return osuApiQueue.add(async () => {
        const res = await axios.get('https://osu.ppy.sh/api/v2/me', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });
        return res.data;
    });
}

/**
 * Obtiene todos los registros de oauth_tokens con campos específicos de contribución.
 */
async function getAllOAuthUsers() {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    try {
        const { data, error } = await supabase
            .from('oauth_tokens')
            .select('discord_id, username, country_code, is_supporter');
        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error("Error al obtener todos los usuarios OAuth:", err);
        return [];
    }
}

/**
 * Guarda o actualiza un token de OAuth en la base de datos de Supabase.
 */
async function saveOAuthToken(discordId, osuUser, tokenData) {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error("Supabase client not initialized");

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    const isSupporter = !!osuUser.is_supporter;

    // Guardar en oauth_tokens
    const { error: oauthError } = await supabase
        .from('oauth_tokens')
        .upsert({
            discord_id: discordId,
            osu_id: osuUser.id.toString(),
            username: osuUser.username,
            country_code: osuUser.country_code,
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_at: expiresAt,
            is_supporter: isSupporter,
            supporter_until: isSupporter ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null, // Si tiene supporter, asumimos 30 días nota orientativa
            created_at: new Date().toISOString()
        }, { onConflict: 'discord_id' });

    if (oauthError) throw oauthError;

    // Sincronizar automáticamente con la tabla 'users' para que quede enlazado en el bot!
    const { error: userError } = await supabase
        .from('users')
        .upsert({
            discord_id: discordId,
            osu_id: osuUser.id.toString(),
            main_gamemode: 'osu'
        }, { onConflict: 'discord_id' });

    if (userError) throw userError;

    return { success: true, username: osuUser.username, is_supporter: isSupporter };
}

/**
 * Obtiene un token válido para un usuario de Discord específico (lo refresca si expiró).
 */
async function getValidTokenForUser(discordId) {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    const { data, error } = await supabase
        .from('oauth_tokens')
        .select('*')
        .eq('discord_id', discordId)
        .maybeSingle();

    if (error || !data) return null;

    const isExpired = new Date(data.expires_at) <= new Date(Date.now() + 60 * 1000); // 1 minuto de margen
    if (isExpired) {
        try {
            const newTokens = await refreshAccessToken(data.refresh_token);
            // Actualizar la base de datos
            const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000).toISOString();

            // Actualizar su perfil de paso
            const userMe = await fetchOsuMe(newTokens.access_token);
            const isSupporter = !!userMe.is_supporter;

            await supabase
                .from('oauth_tokens')
                .update({
                    access_token: newTokens.access_token,
                    refresh_token: newTokens.refresh_token,
                    expires_at: expiresAt,
                    is_supporter: isSupporter,
                    username: userMe.username,
                    country_code: userMe.country_code
                })
                .eq('discord_id', discordId);

            return newTokens.access_token;
        } catch (err) {
            console.error(`Error refreshing OAuth token for user ${discordId}:`, err);
            return null;
        }
    }

    return data.access_token;
}

/**
 * Obtiene un token válido de un usuario que tenga supporter para un país determinado.
 * Si no hay, o falla, intenta obtener cualquier supporter de la pool.
 */
async function getSupporterTokenForCountry(countryCode) {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    const isAny = !countryCode || countryCode.toUpperCase() === 'ANY';

    if (!isAny) {
        // Buscar usuarios con supporter para el país indicado
        const { data: countryUsers, error: err1 } = await supabase
            .from('oauth_tokens')
            .select('*')
            .eq('is_supporter', true)
            .eq('country_code', countryCode.toUpperCase());

        if (err1) {
            console.error("Error fetching country supporters:", err1);
        }

        // Si encontramos uno o más usuarios con supporter en el país
        if (countryUsers && countryUsers.length > 0) {
            // Barajar aleatoriamente para balancear carga
            const shuffled = countryUsers.sort(() => 0.5 - Math.random());
            for (const tokenData of shuffled) {
                const token = await getValidTokenForUser(tokenData.discord_id);
                if (!token) continue;
                // Verificar que el token todavía corresponde a un usuario con supporter activo
                try {
                    const me = await fetchOsuMe(token);
                    if (me && me.is_supporter) {
                        // Actualizar registro en caso de que el flag haya cambiado
                        await supabase.from('oauth_tokens')
                            .update({ is_supporter: true })
                            .eq('discord_id', tokenData.discord_id);
                        return { token, username: tokenData.username, country: countryCode.toUpperCase(), fallback: false };
                    } else {
                        // Marca como no supporter para evitar futuros usos
                        await supabase.from('oauth_tokens')
                            .update({ is_supporter: false })
                            .eq('discord_id', tokenData.discord_id);
                    }
                } catch (_) {
                    // Si falla la verificación, seguir con el siguiente candidato
                }
            }
        }
        // No hacemos fallback si pidieron un país específico, ya que la API de osu! devolvería resultados del país del token de fallback
        return null;
    }

    // Fallback/ANY: Buscar cualquier usuario con supporter en toda la pool
    const { data: allSupporters, error: err2 } = await supabase
        .from('oauth_tokens')
        .select('*')
        .eq('is_supporter', true);

    if (err2) {
        console.error("Error fetching general supporters:", err2);
    }

    if (allSupporters && allSupporters.length > 0) {
        const shuffled = allSupporters.sort(() => 0.5 - Math.random());
        for (const tokenData of shuffled) {
            const token = await getValidTokenForUser(tokenData.discord_id);
            if (token) return { token, username: tokenData.username, fallback: true };
        }
    }

    return null;
}

const OsuUserModel = {
    loadToken,
    NewloadToken,
    getOsuUser,
    getLinkedUser,
    linkUser,
    unlinkUser,
    getLinkedUsers,
    getLinkedUsersMap,
    getOAuthTokenRecord,
    getOAuthTokenRecordByUsernameOrId,
    getOAuthUsernamesMap,
    getFriendsList,
    fetchMeDetails,
    getValidTokenForUser,
    getSupporterTokenForCountry,
    saveOAuthToken,
    getAllOAuthUsers
};

module.exports = OsuUserModel;

