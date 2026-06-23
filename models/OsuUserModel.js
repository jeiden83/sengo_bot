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
const activeRefreshPromises = new Map();
const PROFILE_CACHE_TTL = 300000; // 5 minutos de vigencia del perfil en caché

// Helper para limitar el tamaño de los mapas de caché
function setWithLimit(map, key, value, limit = 100) {
    if (map.size >= limit && !map.has(key)) {
        const firstKey = map.keys().next().value;
        map.delete(firstKey);
    }
    map.set(key, value);
}

let apiExtendedInitialized = null;
let webTokenPromise = null;

/**
 * Carga las credenciales públicas generales de la API de osu! para Sengo y las guarda localmente.
 * Soporta refresco automático y evita colisiones de peticiones.
 */
async function loadToken() {
    const tokenFilePath = path.resolve('osu_web_token.json');

    try {
        const fileContent = await fs.readFile(tokenFilePath, 'utf-8');
        const osu_token = JSON.parse(fileContent);
        if (osu_token && osu_token.expires_at && Date.now() < osu_token.expires_at) {
            return osu_token;
        }
    } catch (error) {
        // Ignorar error al leer y continuar a crear
    }

    if (webTokenPromise) {
        return webTokenPromise;
    }

    webTokenPromise = (async () => {
        try {
            const authClient = new Auth(CONFIG.OSU_CLIENT_ID, CONFIG.OSU_CLIENT_SECRET, "");
            const osu_token = await authClient.clientCredentialsGrant();

            const accessTokenData = {
                access_token: osu_token.access_token,
                expires_in: osu_token.expires_in,
                token_type: osu_token.token_type,
                expires_at: Date.now() + osu_token.expires_in * 1000
            };

            await fs.writeFile(tokenFilePath, JSON.stringify(accessTokenData, null, 2));
            console.log("# Token de Sengo (osu-web.js) recargado");
            return accessTokenData;
        } finally {
            webTokenPromise = null;
        }
    })();

    return webTokenPromise;
}

/**
 * Login alternativo de osu-api-extended para la sesión global pública de Sengo.
 * Utiliza una promesa singleton para evitar accesos concurrentes al archivo e iniciar sesión repetidamente.
 */
async function NewloadToken() {
    if (apiExtendedInitialized) {
        return apiExtendedInitialized;
    }

    apiExtendedInitialized = (async () => {
        try {
            await auth.login({
                type: 'v2',
                client_id: CONFIG.OSU_CLIENT_ID,
                client_secret: CONFIG.OSU_CLIENT_SECRET,
                scopes: ['public'],
                cachedTokenPath: './osu_api_extended_token.json'
            });
            console.log("# Login de osu-api-extended para Sengo inicializado con éxito");
        } catch (err) {
            console.error("# Error al inicializar login de osu-api-extended para Sengo:", err);
            apiExtendedInitialized = null; // Permitir reintento
            throw err;
        }
    })();

    return apiExtendedInitialized;
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
        if (!res || res.username === "undefined") throw new Error("Usuario indefinido");
    } catch (error) {
        // En caso de error, verificamos si es un 404 real (usuario inexistente).
        // Si no lo es (p. ej., error de conexión 5xx, timeout, Cloudflare 403/522), propagamos el error.
        const status = error.status || error.statusCode || error.response?.status || error.response?.statusCode || (error.message && error.message.includes("404") ? 404 : null);
        if (status === 404 || (error.message && error.message.includes("404"))) {
            res = `El usuario no se encuentra en osu!`;
        } else {
            console.error("Error en getOsuUser (no-404):", error);
            throw error;
        }
    }
    
    return returnAndCache(res);
}

/**
 * Consulta un usuario vinculado de la base de datos.
 */
async function getLinkedUser(User, discordId) {
    if (User && typeof User.findOne === 'function') {
        try {
            const user = await User.findOne({ discord_id: discordId });
            if (user) {
                const oauthRecord = await getOAuthTokenRecord(discordId);
                if (oauthRecord) {
                    user.is_supporter = !!oauthRecord.is_supporter;
                }
            }
            return user;
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
        
        if (data) {
            const oauthRecord = await getOAuthTokenRecord(discordId);
            if (oauthRecord) {
                data.is_supporter = !!oauthRecord.is_supporter;
            }
        }
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
    const res = await addUser(User, discordId, osuId, mainGamemode);
    if (res && res.status === 1) {
        try {
            const { syncUserGuilds } = require("../services/guildsSync.js");
            syncUserGuilds(discordId).catch(() => {});
        } catch (syncErr) {
            console.error(`[OsuUserModel] Error al invocar syncUserGuilds en linkUser:`, syncErr);
        }
    }
    return res;
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

async function getLinkedUsers(options = {}) {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    let guildId = null;
    let bypass = false;

    // Detectar si nos pasaron directamente el objeto Guild de Discord (tiene id y members)
    if (options && options.id && options.members) {
        guildId = options.id;
    } else if (options) {
        guildId = options.guildId || null;
        bypass = options.bypass || false;
    }

    try {
        let query = supabase
            .from('users')
            .select('discord_id, osu_id, main_gamemode')
            .not('osu_id', 'is', null);

        if (guildId && !bypass) {
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

    try {
        const { syncUserGuilds } = require("../services/guildsSync.js");
        const OsuTrackerModel = require("./OsuTrackerModel.js");
        syncUserGuilds(discordId).then(() => {
            return OsuTrackerModel.syncOAuthUserToTracking(discordId, osuUser.id.toString(), osuUser.username);
        }).catch((err) => {
            console.error(`[OsuUserModel] Error al sincronizar guilds o tracker para OAuth:`, err);
        });
    } catch (syncErr) {
        console.error(`[OsuUserModel] Error al invocar syncUserGuilds en saveOAuthToken:`, syncErr);
    }

    return { success: true, username: osuUser.username, is_supporter: isSupporter };
}

/**
 * Obtiene un token válido para un usuario de Discord específico (lo refresca si expiró).
 * Deduplica llamadas concurrentes y actualiza la base de datos de manera atómica para evitar
 * perder credenciales por fallos de red en llamadas secundarias (como /me).
 */
async function getValidTokenForUser(discordId, priority = 2, existingToken = null) {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    if (activeRefreshPromises.has(discordId)) {
        return activeRefreshPromises.get(discordId);
    }

    let data = existingToken;
    if (!data) {
        const { data: dbData, error } = await supabase
            .from('oauth_tokens')
            .select('*')
            .eq('discord_id', discordId)
            .maybeSingle();

        if (error || !dbData) return null;
        data = dbData;
    }

    const isExpired = new Date(data.expires_at) <= new Date(Date.now() + 60 * 1000); // 1 minuto de margen
    if (isExpired) {
        const refreshPromise = (async () => {
            try {
                // 1. Refrescar tokens
                const newTokens = await osuApiQueue.add(() => refreshAccessToken(data.refresh_token), priority);
                const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000).toISOString();

                // 2. Guardar inmediatamente los nuevos tokens en base de datos.
                // Esto previene que si fallan los pasos siguientes (/me, etc), nos quedemos con un refresh_token viejo e inválido.
                await supabase
                    .from('oauth_tokens')
                    .update({
                        access_token: newTokens.access_token,
                        refresh_token: newTokens.refresh_token,
                        expires_at: expiresAt
                    })
                    .eq('discord_id', discordId);

                // 3. Opcional: Actualizar el perfil del usuario de paso, pero de forma no bloqueante/segura
                let isSupporter = data.is_supporter;
                let username = data.username;
                let countryCode = data.country_code;
                try {
                    const userMe = await osuApiQueue.add(() => fetchOsuMe(newTokens.access_token), priority);
                    if (userMe) {
                        isSupporter = !!userMe.is_supporter;
                        username = userMe.username;
                        countryCode = userMe.country_code;

                        // Actualizar detalles del perfil en la base de datos
                        await supabase
                            .from('oauth_tokens')
                            .update({
                                is_supporter: isSupporter,
                                username: username,
                                country_code: countryCode
                            })
                            .eq('discord_id', discordId);
                    }
                } catch (meErr) {
                    // Si falla obtener /me (ej: timeout, red), no invalidamos todo el flujo de refresco de token exitoso
                    console.error(`[OAuth] Error no crítico al obtener /me para ${discordId} después de refrescar:`, meErr);
                }

                return newTokens.access_token;
            } catch (err) {
                console.error(`Error refreshing OAuth token for user ${discordId}:`, err);
                const errMsg = err.message || '';
                
                // Determinar si es un error real de revocación o token inválido de osu!.
                // En la API de osu!, si el refresh_token es inválido o revocado, el endpoint /oauth/token responde
                // con un status 400 Bad Request y un JSON conteniendo {"error": "invalid_grant"}.
                const isInvalidGrant = errMsg.includes('invalid_grant');
                
                // Solo si estamos 100% seguros de que el token fue revocado o es inválido,
                // eliminamos el registro. Evitamos eliminarlo por errores genéricos de red o JSON inválido de Cloudflare.
                if (isInvalidGrant) {
                    console.log(`[OAuth] Token inválido o revocado (invalid_grant) para usuario Discord ${discordId}. Eliminando registro de la base de datos.`);
                    try {
                        await supabase
                            .from('oauth_tokens')
                            .delete()
                            .eq('discord_id', discordId)
                            .eq('refresh_token', data.refresh_token);
                    } catch (dbErr) {
                        console.error(`[OAuth] Error al intentar eliminar token de ${discordId}:`, dbErr);
                    }
                }
                
                return null;
            } finally {
                activeRefreshPromises.delete(discordId);
            }
        })();

        activeRefreshPromises.set(discordId, refreshPromise);
        return refreshPromise;
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
                    const me = await osuApiQueue.add(() => fetchOsuMe(token));
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

/**
 * Actualiza el estado de supporter de un usuario en segundo plano (no bloqueante).
 */
async function updateSupporterStatusInBackground(osuId, isSupporter) {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    try {
        const isSupp = !!isSupporter;
        // 1. Actualizar en oauth_tokens
        const { error: tokenError } = await supabase
            .from('oauth_tokens')
            .update({ 
                is_supporter: isSupp,
                supporter_until: isSupp ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null 
            })
            .eq('osu_id', osuId.toString());

        if (tokenError) {
            console.error(`[BACKGROUND-SUPPORTER] Error al actualizar oauth_tokens para osu_id ${osuId}:`, tokenError);
        }
    } catch (err) {
        console.error(`[BACKGROUND-SUPPORTER] Error inesperado actualizando estatus de supporter para osu_id ${osuId}:`, err);
    }
}

/**
 * Sincroniza forzosamente el estatus de supporter de todos los usuarios vinculados por oAuth.
 */
async function syncAllSupporterStatuses() {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Cliente de Supabase no inicializado");
    }

    const oauthUsers = await getAllOAuthUsers();
    let successCount = 0;
    let failCount = 0;
    const changes = [];

    for (const user of oauthUsers) {
        try {
            const token = await getValidTokenForUser(user.discord_id, 0);
            if (!token) {
                failCount++;
                continue;
            }

            const me = await osuApiQueue.add(() => fetchOsuMe(token), 0);
            if (me) {
                const newSuppStatus = !!me.is_supporter;
                const oldSuppStatus = !!user.is_supporter;

                if (newSuppStatus !== oldSuppStatus) {
                    changes.push({
                        username: user.username,
                        oldStatus: oldSuppStatus,
                        newStatus: newSuppStatus
                    });
                }

                // Actualizar oauth_tokens
                await supabase
                    .from('oauth_tokens')
                    .update({
                        is_supporter: newSuppStatus,
                        username: me.username,
                        country_code: me.country_code,
                        supporter_until: newSuppStatus ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null
                    })
                    .eq('discord_id', user.discord_id);

                successCount++;
            } else {
                failCount++;
            }
        } catch (err) {
            console.error(`Error al sincronizar estatus de supporter para ${user.username}:`, err);
            failCount++;
        }

        // Delay de 4000ms para no saturar la API
        await new Promise(resolve => setTimeout(resolve, 4000));
    }

    return { successCount, failCount, changes };
}

const rankingPageCache = new Map();
const RANKING_CACHE_TTL = 300000; // 5 minutos en ms

/**
 * Obtiene una página del ranking nacional para un modo y país específico,
 * combinando resultados si es necesario para retornar un chunk de 25 elementos.
 */
async function fetchRankingPage(countryFilter, gamemode, startIndex) {
    const embedPageSize = 10;
    const apiPageSize = 50;

    const apiPage1 = Math.floor(startIndex / apiPageSize) + 1;
    const apiPage2 = Math.floor((startIndex + embedPageSize - 1) / apiPageSize) + 1;

    const tokenData = await loadToken();
    const accessToken = tokenData.access_token;

    const fetchPage = async (page) => {
        const cacheKey = `${gamemode.toLowerCase()}_${countryFilter.toUpperCase()}_page_${page}`;
        const now = Date.now();
        if (rankingPageCache.has(cacheKey)) {
            const cached = rankingPageCache.get(cacheKey);
            if (now - cached.timestamp < RANKING_CACHE_TTL) {
                return cached.data;
            }
        }

        const data = await osuApiQueue.add(async () => {
            const url = `https://osu.ppy.sh/api/v2/rankings/${gamemode}/performance?country=${countryFilter}&page=${page}`;
            const res = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'x-api-version': '20240728'
                },
                timeout: 5000
            });
            return res.data;
        });

        rankingPageCache.set(cacheKey, { data, timestamp: now });
        return data;
    };

    let rankings = [];
    let total = 0;

    const data1 = await fetchPage(apiPage1);
    rankings = data1.ranking || [];
    total = Math.min(data1.total || 0, 10000);

    if (apiPage1 !== apiPage2) {
        try {
            const data2 = await fetchPage(apiPage2);
            rankings = rankings.concat(data2.ranking || []);
        } catch (e) {
            console.error("Error al obtener la segunda página de ranking:", e);
        }
    }

    const offset = startIndex % apiPageSize;
    const chunk = rankings.slice(offset, offset + embedPageSize);

    return { chunk, total };
}

/**
 * Obtiene los primeros 1000 jugadores de un país y modo de juego,
 * ordenándolos por precisión (acc) de forma descendente, con caché persistente de 2 horas.
 */
async function fetchRankingAcc(countryFilter, gamemode, onProgress) {
    const cacheKey = `${countryFilter.toUpperCase()}_${gamemode.toLowerCase()}`;
    const cacheFile = path.join(__dirname, "../data/nacional_acc_cache.json");

    let cache = {};
    try {
        const data = await fs.readFile(cacheFile, "utf-8");
        cache = JSON.parse(data);
    } catch (e) {}

    const now = Date.now();
    const TTL = 7200000; // 2 horas

    if (cache[cacheKey] && (now - cache[cacheKey].timestamp < TTL)) {
        console.log(`[CACHE]: Utilizando ranking nacional de Acc en caché para ${cacheKey}`);
        return cache[cacheKey].players;
    }

    const totalPages = 20;
    const tokenData = await loadToken();
    const accessToken = tokenData.access_token;

    const fetchPage = async (page) => {
        return osuApiQueue.add(async () => {
            const url = `https://osu.ppy.sh/api/v2/rankings/${gamemode}/performance?country=${countryFilter}&page=${page}`;
            const res = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'x-api-version': '20240728'
                },
                timeout: 5000
            });
            return res.data;
        });
    };

    let allPlayers = [];

    for (let p = 1; p <= totalPages; p++) {
        try {
            const data = await fetchPage(p);
            if (data.ranking && data.ranking.length > 0) {
                allPlayers = allPlayers.concat(data.ranking);
                if (data.ranking.length < 50) {
                    break;
                }
            } else {
                break;
            }
        } catch (err) {
            console.error(`Error al obtener página ${p} de ranking para Acc:`, err);
            if (p === 1) throw err;
            break;
        }

        if (onProgress) {
            await onProgress(allPlayers.length, 1000);
        }
    }

    allPlayers.sort((a, b) => b.hit_accuracy - a.hit_accuracy);

    cache[cacheKey] = {
        timestamp: now,
        players: allPlayers
    };

    try {
        await fs.mkdir(path.dirname(cacheFile), { recursive: true });
        await fs.writeFile(cacheFile, JSON.stringify(cache, null, 2), "utf-8");
    } catch (e) {
        console.error("Error al escribir caché de ranking nacional de Acc:", e);
    }

    return allPlayers;
}

/**
 * Obtiene los primeros 1000 jugadores de un país y modo de juego,
 * ordenándolos por ranked score de forma descendente, con caché persistente de 2 horas.
 */
async function fetchRankingScore(countryFilter, gamemode, onProgress) {
    const cacheKey = `${countryFilter.toUpperCase()}_${gamemode.toLowerCase()}`;
    const cacheFile = path.join(__dirname, "../data/nacional_score_cache.json");

    let cache = {};
    try {
        const data = await fs.readFile(cacheFile, "utf-8");
        cache = JSON.parse(data);
    } catch (e) {}

    const now = Date.now();
    const TTL = 7200000; // 2 horas

    if (cache[cacheKey] && (now - cache[cacheKey].timestamp < TTL)) {
        console.log(`[CACHE]: Utilizando ranking nacional de Score en caché para ${cacheKey}`);
        return cache[cacheKey].players;
    }

    const totalPages = 20;
    const tokenData = await loadToken();
    const accessToken = tokenData.access_token;

    const fetchPage = async (page) => {
        return osuApiQueue.add(async () => {
            const url = `https://osu.ppy.sh/api/v2/rankings/${gamemode}/performance?country=${countryFilter}&page=${page}`;
            const res = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'x-api-version': '20240728'
                },
                timeout: 5000
            });
            return res.data;
        });
    };

    let allPlayers = [];

    for (let p = 1; p <= totalPages; p++) {
        try {
            const data = await fetchPage(p);
            if (data.ranking && data.ranking.length > 0) {
                allPlayers = allPlayers.concat(data.ranking);
                if (data.ranking.length < 50) {
                    break;
                }
            } else {
                break;
            }
        } catch (err) {
            console.error(`Error al obtener página ${p} de ranking para Score:`, err);
            if (p === 1) throw err;
            break;
        }

        if (onProgress) {
            await onProgress(allPlayers.length, 1000);
        }
    }

    allPlayers.sort((a, b) => (b.ranked_score || 0) - (a.ranked_score || 0));

    cache[cacheKey] = {
        timestamp: now,
        players: allPlayers
    };

    try {
        await fs.mkdir(path.dirname(cacheFile), { recursive: true });
        await fs.writeFile(cacheFile, JSON.stringify(cache, null, 2), "utf-8");
    } catch (e) {
        console.error("Error al escribir caché de ranking nacional de Score:", e);
    }

    return allPlayers;
}

/**
 * Obtiene los primeros 1000 jugadores de un país y modo de juego,
 * ordenándolos por score total de forma descendente, con caché persistente de 2 horas.
 */
async function fetchRankingTotalScore(countryFilter, gamemode, onProgress) {
    const cacheKey = `${countryFilter.toUpperCase()}_${gamemode.toLowerCase()}`;
    const cacheFile = path.join(__dirname, "../data/nacional_totalscore_cache.json");

    let cache = {};
    try {
        const data = await fs.readFile(cacheFile, "utf-8");
        cache = JSON.parse(data);
    } catch (e) {}

    const now = Date.now();
    const TTL = 7200000; // 2 horas

    if (cache[cacheKey] && (now - cache[cacheKey].timestamp < TTL)) {
        console.log(`[CACHE]: Utilizando ranking nacional de Score Total en caché para ${cacheKey}`);
        return cache[cacheKey].players;
    }

    const totalPages = 20;
    const tokenData = await loadToken();
    const accessToken = tokenData.access_token;

    const fetchPage = async (page) => {
        return osuApiQueue.add(async () => {
            const url = `https://osu.ppy.sh/api/v2/rankings/${gamemode}/performance?country=${countryFilter}&page=${page}`;
            const res = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'x-api-version': '20240728'
                },
                timeout: 5000
            });
            return res.data;
        });
    };

    let allPlayers = [];

    for (let p = 1; p <= totalPages; p++) {
        try {
            const data = await fetchPage(p);
            if (data.ranking && data.ranking.length > 0) {
                allPlayers = allPlayers.concat(data.ranking);
                if (data.ranking.length < 50) {
                    break;
                }
            } else {
                break;
            }
        } catch (err) {
            console.error(`Error al obtener página ${p} de ranking para Score Total:`, err);
            if (p === 1) throw err;
            break;
        }

        if (onProgress) {
            await onProgress(allPlayers.length, 1000);
        }
    }

    allPlayers.sort((a, b) => (b.total_score || 0) - (a.total_score || 0));

    cache[cacheKey] = {
        timestamp: now,
        players: allPlayers
    };

    try {
        await fs.mkdir(path.dirname(cacheFile), { recursive: true });
        await fs.writeFile(cacheFile, JSON.stringify(cache, null, 2), "utf-8");
    } catch (e) {
        console.error("Error al escribir caché de ranking nacional de Score Total:", e);
    }

    return allPlayers;
}

const regionalRankingCacheFile = path.join(__dirname, "../data/regional_rankings_cache.json");
let regionalRankingCache = {};
let regionalRankingCacheLoaded = false;

const REGIONAL_CACHE_TTL = 300000; // 5 minutos en ms

async function loadRegionalRankingCache() {
    if (regionalRankingCacheLoaded) return;
    try {
        const data = await fs.readFile(regionalRankingCacheFile, "utf-8");
        regionalRankingCache = JSON.parse(data);
    } catch {}
    regionalRankingCacheLoaded = true;
}

const osuWorldUserCacheFile = path.join(__dirname, "../data/osuworld_users_cache.json");
let osuWorldUserCache = {};
let osuWorldUserCacheLoaded = false;

async function loadOsuWorldUserCache() {
    if (osuWorldUserCacheLoaded) return;
    try {
        const data = await fs.readFile(osuWorldUserCacheFile, "utf-8");
        osuWorldUserCache = JSON.parse(data);
    } catch {}
    osuWorldUserCacheLoaded = true;
}

/**
 * Obtiene los detalles de un usuario en osu!World con caché persistente y fallback en caso de error.
 */
async function getOsuWorldUser(osuId) {
    await loadOsuWorldUserCache();
    const now = Date.now();
    const cacheKey = String(osuId);
    const TTL = 86400000; // 24 horas

    if (osuWorldUserCache[cacheKey]) {
        const cached = osuWorldUserCache[cacheKey];
        if (now - cached.timestamp < TTL) {
            return cached.data;
        }
    }

    const fetch = require('node-fetch');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
        const response = await fetch(`https://osuworld.octo.moe/api/users/${osuId}`, {
            signal: controller.signal
        });
        clearTimeout(timeout);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        osuWorldUserCache[cacheKey] = { data, timestamp: now };
        
        try {
            await fs.mkdir(path.dirname(osuWorldUserCacheFile), { recursive: true });
            await fs.writeFile(osuWorldUserCacheFile, JSON.stringify(osuWorldUserCache, null, 2), "utf-8");
        } catch (e) {
            console.error("Error al escribir caché de osu!World:", e);
        }
        return data;
    } catch (err) {
        clearTimeout(timeout);
        console.error(`Error al obtener usuario ${osuId} de osu!World:`, err);
        if (osuWorldUserCache[cacheKey]) {
            return osuWorldUserCache[cacheKey].data;
        }
        return null;
    }
}

/**
 * Obtiene una página de ranking regional desde osu!World.
 */
async function fetchRegionalRankingPage(countryFilter, regionFilter, gamemode, page = 1) {
    await loadRegionalRankingCache();
    const cacheKey = `${gamemode.toLowerCase()}_${countryFilter.toUpperCase()}_${regionFilter.toUpperCase()}_page_${page}`;
    const now = Date.now();
    if (regionalRankingCache[cacheKey]) {
        const cached = regionalRankingCache[cacheKey];
        if (now - cached.timestamp < REGIONAL_CACHE_TTL) {
            return cached.data;
        }
    }

    // Convert catch/fruits mode name correctly
    let osuWorldMode = gamemode.toLowerCase();
    if (osuWorldMode === 'fruits' || osuWorldMode === 'ctb') {
        osuWorldMode = 'fruits';
    }

    const url = `https://osuworld.octo.moe/api/${countryFilter.toUpperCase()}/${regionFilter.toUpperCase()}/top/${osuWorldMode}?page=${page}`;
    
    const fetch = require('node-fetch');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        const chunk = (data.top || []).map(item => ({
            pp: item.pp,
            global_rank: item.rank,
            user: {
                username: item.username,
                id: item.id,
                country_code: countryFilter
            }
        }));

        const result = {
            chunk,
            pages: data.pages || 1,
            total: (data.pages || 1) * 10
        };

        regionalRankingCache[cacheKey] = { data: result, timestamp: now };
        
        try {
            await fs.mkdir(path.dirname(regionalRankingCacheFile), { recursive: true });
            await fs.writeFile(regionalRankingCacheFile, JSON.stringify(regionalRankingCache, null, 2), "utf-8");
        } catch (e) {
            console.error("Error al escribir caché de ranking regional:", e);
        }
        
        return result;
    } catch (err) {
        clearTimeout(timeout);
        if (regionalRankingCache[cacheKey]) {
            return regionalRankingCache[cacheKey].data;
        }
        throw err;
    }
}

const mapperTopCacheFile = path.join(__dirname, "../data/mapper_top_cache.json");
let mapperTopCache = null;

async function getMapperTop(forceUpdate = false, onProgress = null) {
    const supabase = getSupabaseClient();
    if (!supabase) return [];
    
    // Obtener todos los usuarios vinculados
    const { data: users, error } = await supabase
        .from('users')
        .select('*');
        
    if (error) {
        console.error("Error al obtener usuarios para ranking de mappers:", error);
        return [];
    }

    const linkedOsuIds = users.filter(u => u.osu_id).map(u => String(u.osu_id));

    if (!forceUpdate && linkedOsuIds.length > 0) {
        const { data: dbMappers } = await supabase
            .from('mapper_statistics')
            .select('*')
            .in('osu_id', linkedOsuIds);

        if (dbMappers && dbMappers.length > 0) {
            return dbMappers
                .map(m => ({
                    ...m,
                    kudosu: { total: m.kudosu_total, available: m.kudosu_available }
                }))
                .filter(m => {
                    const total = (m.ranked_count || 0) + (m.loved_count || 0) + (m.pending_count || 0) + (m.graveyard_count || 0) + (m.guest_count || 0);
                    return total > 0 || (m.kudosu_total || 0) > 0;
                });
        }
    }

    const token = await loadToken();
    const client = new Client(token.access_token);
    
    let dbMappersMap = new Map();
    if (linkedOsuIds.length > 0) {
        const { data: dbMappers } = await supabase
            .from('mapper_statistics')
            .select('*')
            .in('osu_id', linkedOsuIds);
        if (dbMappers) {
            dbMappers.forEach(m => dbMappersMap.set(String(m.osu_id), m));
        }
    }

    const mappersToUpsert = [];
    const totalUsers = users.length;
    const now = Date.now();
    
    for (let idx = 0; idx < totalUsers; idx++) {
        const u = users[idx];
        if (!u.osu_id) continue;
        
        if (onProgress && typeof onProgress === 'function') {
            await onProgress(idx + 1, totalUsers, u.username || u.osu_id);
        }
        
        const osuIdStr = String(u.osu_id);
        const existing = dbMappersMap.get(osuIdStr);
        
        if (existing && existing.playmode) {
            mappersToUpsert.push({
                osu_id: existing.osu_id,
                username: existing.username,
                country_code: existing.country_code,
                kudosu_total: existing.kudosu_total,
                kudosu_available: existing.kudosu_available,
                ranked_count: existing.ranked_count,
                loved_count: existing.loved_count,
                pending_count: existing.pending_count,
                graveyard_count: existing.graveyard_count,
                guest_count: existing.guest_count,
                followers: existing.followers,
                last_updated: existing.last_updated,
                playmode: existing.playmode
            });
            continue;
        }
        
        try {
            const profile = await client.users.getUser(u.osu_id, { urlParams: { mode: 'osu' } });
            
            let last_updated = null;
            const totalMaps = (profile.ranked_and_approved_beatmapset_count || 0) +
                              (profile.loved_beatmapset_count || 0) +
                              (profile.pending_beatmapset_count || 0) +
                              (profile.graveyard_beatmapset_count || 0) +
                              (profile.guest_beatmapset_count || 0);
            
            if (totalMaps > 0) {
                const typesToCheck = [];
                if (profile.pending_beatmapset_count > 0) typesToCheck.push('pending');
                if (profile.graveyard_beatmapset_count > 0) typesToCheck.push('graveyard');
                if (profile.ranked_and_approved_beatmapset_count > 0) typesToCheck.push('ranked');
                if (profile.loved_beatmapset_count > 0) typesToCheck.push('loved');
                if (profile.guest_beatmapset_count > 0) typesToCheck.push('guest');
                
                const dates = [];
                for (const t of typesToCheck) {
                    try {
                        const sets = await client.users.getUserBeatmaps(profile.id, t, { query: { limit: 1 } });
                        if (sets && sets.length > 0) {
                            dates.push(new Date(sets[0].last_updated || sets[0].submitted_date).getTime());
                        }
                    } catch (err) {
                        console.error(`Error al obtener beatmaps tipo ${t} de ${profile.username}:`, err.message);
                    }
                }
                
                if (dates.length > 0) {
                    last_updated = new Date(Math.max(...dates)).toISOString();
                }
            }
            
            mappersToUpsert.push({
                osu_id: String(profile.id),
                username: profile.username,
                country_code: profile.country_code,
                kudosu_total: profile.kudosu.total,
                kudosu_available: profile.kudosu.available,
                ranked_count: profile.ranked_and_approved_beatmapset_count,
                loved_count: profile.loved_beatmapset_count,
                pending_count: profile.pending_beatmapset_count,
                graveyard_count: profile.graveyard_beatmapset_count,
                guest_count: profile.guest_beatmapset_count,
                followers: profile.mapping_follower_count,
                last_updated,
                playmode: profile.playmode
            });
        } catch (err) {
            console.error(`Error al consultar mapper ${u.osu_id}:`, err.message);
        }

        // Upsert parcial cada 25 mappers para robustez
        if (mappersToUpsert.length > 0 && mappersToUpsert.length % 25 === 0) {
            try {
                await supabase
                    .from('mapper_statistics')
                    .upsert(mappersToUpsert.map(m => ({
                        ...m,
                        updated_at: new Date().toISOString()
                    })), { onConflict: 'osu_id' });
            } catch (e) {
                console.error("Error en upsert parcial:", e);
            }
        }
    }

    if (mappersToUpsert.length > 0) {
        try {
            await supabase
                .from('mapper_statistics')
                .upsert(mappersToUpsert.map(m => ({
                    ...m,
                    updated_at: new Date().toISOString()
                })), { onConflict: 'osu_id' });
        } catch (e) {
            console.error("Error al guardar mappers vinculados en BD:", e);
        }
    }
    
    return mappersToUpsert
        .map(m => ({
            ...m,
            kudosu: { total: m.kudosu_total, available: m.kudosu_available }
        }))
        .filter(m => {
            const total = (m.ranked_count || 0) + (m.loved_count || 0) + (m.pending_count || 0) + (m.graveyard_count || 0) + (m.guest_count || 0);
            return total > 0 || (m.kudosu_total || 0) > 0;
        });
}

async function getNationalMapperTop(countryFilter, forceUpdate = false, onProgress = null) {
    const supabase = getSupabaseClient();
    if (!supabase) return [];
    
    if (!forceUpdate) {
        const { data: dbMappers } = await supabase
            .from('mapper_statistics')
            .select('*')
            .eq('country_code', countryFilter.toUpperCase());
            
        if (dbMappers && dbMappers.length > 0) {
            return dbMappers
                .map(m => ({
                    ...m,
                    kudosu: { total: m.kudosu_total, available: m.kudosu_available }
                }))
                .filter(m => {
                    const total = (m.ranked_count || 0) + (m.loved_count || 0) + (m.pending_count || 0) + (m.graveyard_count || 0) + (m.guest_count || 0);
                    return total > 0 || (m.kudosu_total || 0) > 0;
                });
        }
    }
    
    const token = await loadToken();
    const client = new Client(token.access_token);
    
    const totalPages = 20;
    let allPlayers = [];
    
    const fetchPage = async (page) => {
        return osuApiQueue.add(async () => {
            const url = `https://osu.ppy.sh/api/v2/rankings/osu/performance?country=${countryFilter.toUpperCase()}&page=${page}`;
            const res = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${token.access_token}`,
                    'Content-Type': 'application/json',
                    'x-api-version': '20240728'
                },
                timeout: 5000
            });
            return res.data;
        });
    };
    
    for (let p = 1; p <= totalPages; p++) {
        if (onProgress && typeof onProgress === 'function') {
            await onProgress(p, totalPages + 1, `Obteniendo ranking nacional pág ${p}...`);
        }
        try {
            const data = await fetchPage(p);
            if (data.ranking && data.ranking.length > 0) {
                allPlayers = allPlayers.concat(data.ranking);
            } else {
                break;
            }
        } catch (err) {
            console.error(`Error al obtener pág ${p} de ranking de ${countryFilter}:`, err.message);
            break;
        }
    }
    
    const playerIds = allPlayers.filter(p => p.user && p.user.id).map(p => String(p.user.id));
    let dbMappersMap = new Map();
    if (playerIds.length > 0) {
        const { data: dbMappers } = await supabase
            .from('mapper_statistics')
            .select('*')
            .in('osu_id', playerIds);
        if (dbMappers) {
            dbMappers.forEach(m => dbMappersMap.set(String(m.osu_id), m));
        }
    }

    const mappersToUpsert = [];
    const totalPlayers = allPlayers.length;
    const now = Date.now();
    
    for (let idx = 0; idx < totalPlayers; idx++) {
        const player = allPlayers[idx];
        if (!player.user || !player.user.id) continue;
        
        if (onProgress && typeof onProgress === 'function') {
            await onProgress(totalPages + idx + 1, totalPages + totalPlayers, player.user.username);
        }
        
        const playerOsuId = String(player.user.id);
        const existing = dbMappersMap.get(playerOsuId);
        
        if (existing && existing.playmode) {
            mappersToUpsert.push({
                osu_id: existing.osu_id,
                username: existing.username,
                country_code: existing.country_code,
                kudosu_total: existing.kudosu_total,
                kudosu_available: existing.kudosu_available,
                ranked_count: existing.ranked_count,
                loved_count: existing.loved_count,
                pending_count: existing.pending_count,
                graveyard_count: existing.graveyard_count,
                guest_count: existing.guest_count,
                followers: existing.followers,
                last_updated: existing.last_updated,
                playmode: existing.playmode
            });
            continue;
        }
        
        try {
            const profile = await osuApiQueue.add(async () => {
                return client.users.getUser(player.user.id, { urlParams: { mode: 'osu' } });
            });
            
            let last_updated = null;
            const totalMaps = (profile.ranked_and_approved_beatmapset_count || 0) +
                              (profile.loved_beatmapset_count || 0) +
                              (profile.pending_beatmapset_count || 0) +
                              (profile.graveyard_beatmapset_count || 0) +
                              (profile.guest_beatmapset_count || 0);
            
            if (totalMaps > 0) {
                const typesToCheck = [];
                if (profile.pending_beatmapset_count > 0) typesToCheck.push('pending');
                if (profile.graveyard_beatmapset_count > 0) typesToCheck.push('graveyard');
                if (profile.ranked_and_approved_beatmapset_count > 0) typesToCheck.push('ranked');
                if (profile.loved_beatmapset_count > 0) typesToCheck.push('loved');
                if (profile.guest_beatmapset_count > 0) typesToCheck.push('guest');
                
                const dates = [];
                for (const t of typesToCheck) {
                    try {
                        const sets = await osuApiQueue.add(async () => {
                            return client.users.getUserBeatmaps(profile.id, t, { query: { limit: 1 } });
                        });
                        if (sets && sets.length > 0) {
                            dates.push(new Date(sets[0].last_updated || sets[0].submitted_date).getTime());
                        }
                    } catch (err) {
                        // ignorar
                    }
                }
                
                if (dates.length > 0) {
                    last_updated = new Date(Math.max(...dates)).toISOString();
                }
            }
            
            mappersToUpsert.push({
                osu_id: String(profile.id),
                username: profile.username,
                country_code: profile.country_code,
                kudosu_total: profile.kudosu.total,
                kudosu_available: profile.kudosu.available,
                ranked_count: profile.ranked_and_approved_beatmapset_count,
                loved_count: profile.loved_beatmapset_count,
                pending_count: profile.pending_beatmapset_count,
                graveyard_count: profile.graveyard_beatmapset_count,
                guest_count: profile.guest_beatmapset_count,
                followers: profile.mapping_follower_count,
                last_updated,
                playmode: profile.playmode
            });
        } catch (err) {
            console.error(`Error al consultar mapper nacional ${player.user.id}:`, err.message);
        }

        // Upsert parcial cada 25 mappers para robustez
        if (mappersToUpsert.length > 0 && mappersToUpsert.length % 25 === 0) {
            try {
                await supabase
                    .from('mapper_statistics')
                    .upsert(mappersToUpsert.map(m => ({
                        ...m,
                        updated_at: new Date().toISOString()
                    })), { onConflict: 'osu_id' });
            } catch (e) {
                console.error("Error en upsert parcial nacional:", e);
            }
        }
    }
    
    if (mappersToUpsert.length > 0) {
        try {
            await supabase
                .from('mapper_statistics')
                .upsert(mappersToUpsert.map(m => ({
                    ...m,
                    updated_at: new Date().toISOString()
                })), { onConflict: 'osu_id' });
        } catch (e) {
            console.error("Error al guardar mappers nacionales en BD:", e);
        }
    }
    
    return mappersToUpsert
        .map(m => ({
            ...m,
            kudosu: { total: m.kudosu_total, available: m.kudosu_available }
        }))
        .filter(m => {
            const total = (m.ranked_count || 0) + (m.loved_count || 0) + (m.pending_count || 0) + (m.graveyard_count || 0) + (m.guest_count || 0);
            return total > 0 || (m.kudosu_total || 0) > 0;
        });
}

async function getGlobalKudosuMapperTop(forceUpdate = false, onProgress = null) {
    const supabase = getSupabaseClient();
    if (!supabase) return [];
    
    if (!forceUpdate) {
        const { data: dbMappers } = await supabase
            .from('mapper_statistics')
            .select('*')
            .order('kudosu_total', { ascending: false })
            .limit(250);
            
        if (dbMappers && dbMappers.length > 200) {
            return dbMappers
                .map(m => ({
                    ...m,
                    kudosu: { total: m.kudosu_total, available: m.kudosu_available }
                }))
                .filter(m => {
                    const total = (m.ranked_count || 0) + (m.loved_count || 0) + (m.pending_count || 0) + (m.graveyard_count || 0) + (m.guest_count || 0);
                    return total > 0 || (m.kudosu_total || 0) > 0;
                });
        }
    }
    
    const token = await loadToken();
    const client = new Client(token.access_token);
    
    const totalPages = 5;
    let allPlayers = [];
    
    const fetchPage = async (page) => {
        return osuApiQueue.add(async () => {
            const url = `https://osu.ppy.sh/api/v2/rankings/kudosu?page=${page}`;
            const res = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${token.access_token}`,
                    'Content-Type': 'application/json',
                    'x-api-version': '20240728'
                },
                timeout: 5000
            });
            return res.data;
        });
    };
    
    for (let p = 1; p <= totalPages; p++) {
        if (onProgress && typeof onProgress === 'function') {
            await onProgress(p, totalPages + 1, `Obteniendo ranking Kudosu global pág ${p}...`);
        }
        try {
            const data = await fetchPage(p);
            if (data.ranking && data.ranking.length > 0) {
                allPlayers = allPlayers.concat(data.ranking);
            } else {
                break;
            }
        } catch (err) {
            console.error(`Error al obtener pág ${p} de ranking Kudosu global:`, err.message);
            break;
        }
    }
    
    const playerIds = allPlayers.filter(p => p && p.id).map(p => String(p.id));
    let dbMappersMap = new Map();
    if (playerIds.length > 0) {
        const { data: dbMappers } = await supabase
            .from('mapper_statistics')
            .select('*')
            .in('osu_id', playerIds);
        if (dbMappers) {
            dbMappers.forEach(m => dbMappersMap.set(String(m.osu_id), m));
        }
    }

    const mappersToUpsert = [];
    const totalPlayers = allPlayers.length;
    const now = Date.now();
    
    for (let idx = 0; idx < totalPlayers; idx++) {
        const player = allPlayers[idx];
        if (!player || !player.id) continue;
        
        if (onProgress && typeof onProgress === 'function') {
            await onProgress(totalPages + idx + 1, totalPages + totalPlayers, player.username);
        }
        
        const playerOsuId = String(player.id);
        const existing = dbMappersMap.get(playerOsuId);
        
        if (existing && existing.playmode) {
            mappersToUpsert.push({
                osu_id: existing.osu_id,
                username: existing.username,
                country_code: existing.country_code,
                kudosu_total: existing.kudosu_total,
                kudosu_available: existing.kudosu_available,
                ranked_count: existing.ranked_count,
                loved_count: existing.loved_count,
                pending_count: existing.pending_count,
                graveyard_count: existing.graveyard_count,
                guest_count: existing.guest_count,
                followers: existing.followers,
                last_updated: existing.last_updated,
                playmode: existing.playmode
            });
            continue;
        }
        
        try {
            const profile = await osuApiQueue.add(async () => {
                return client.users.getUser(player.id, { urlParams: { mode: 'osu' } });
            });
            
            let last_updated = null;
            const totalMaps = (profile.ranked_and_approved_beatmapset_count || 0) +
                              (profile.loved_beatmapset_count || 0) +
                              (profile.pending_beatmapset_count || 0) +
                              (profile.graveyard_beatmapset_count || 0) +
                              (profile.guest_beatmapset_count || 0);
            
            if (totalMaps > 0) {
                const typesToCheck = [];
                if (profile.pending_beatmapset_count > 0) typesToCheck.push('pending');
                if (profile.graveyard_beatmapset_count > 0) typesToCheck.push('graveyard');
                if (profile.ranked_and_approved_beatmapset_count > 0) typesToCheck.push('ranked');
                if (profile.loved_beatmapset_count > 0) typesToCheck.push('loved');
                if (profile.guest_beatmapset_count > 0) typesToCheck.push('guest');
                
                const dates = [];
                for (const t of typesToCheck) {
                    try {
                        const sets = await osuApiQueue.add(async () => {
                            return client.users.getUserBeatmaps(profile.id, t, { query: { limit: 1 } });
                        });
                        if (sets && sets.length > 0) {
                            dates.push(new Date(sets[0].last_updated || sets[0].submitted_date).getTime());
                        }
                    } catch (err) {
                        // ignorar
                    }
                }
                
                if (dates.length > 0) {
                    last_updated = new Date(Math.max(...dates)).toISOString();
                }
            }
            
            mappersToUpsert.push({
                osu_id: String(profile.id),
                username: profile.username,
                country_code: profile.country_code,
                kudosu_total: profile.kudosu.total,
                kudosu_available: profile.kudosu.available,
                ranked_count: profile.ranked_and_approved_beatmapset_count,
                loved_count: profile.loved_beatmapset_count,
                pending_count: profile.pending_beatmapset_count,
                graveyard_count: profile.graveyard_beatmapset_count,
                guest_count: profile.guest_beatmapset_count,
                followers: profile.mapping_follower_count,
                last_updated,
                playmode: profile.playmode
            });
        } catch (err) {
            console.error(`Error al consultar mapper Kudosu global ${player.id}:`, err.message);
        }

        // Upsert parcial cada 25 mappers para robustez
        if (mappersToUpsert.length > 0 && mappersToUpsert.length % 25 === 0) {
            try {
                await supabase
                    .from('mapper_statistics')
                    .upsert(mappersToUpsert.map(m => ({
                        ...m,
                        updated_at: new Date().toISOString()
                    })), { onConflict: 'osu_id' });
            } catch (e) {
                console.error("Error en upsert parcial global:", e);
            }
        }
    }
    
    if (mappersToUpsert.length > 0) {
        try {
            await supabase
                .from('mapper_statistics')
                .upsert(mappersToUpsert.map(m => ({
                    ...m,
                    updated_at: new Date().toISOString()
                })), { onConflict: 'osu_id' });
        } catch (e) {
            console.error("Error al guardar mappers Kudosu en BD:", e);
        }
    }
    
    return mappersToUpsert
        .map(m => ({
            ...m,
            kudosu: { total: m.kudosu_total, available: m.kudosu_available }
        }))
        .filter(m => {
            const total = (m.ranked_count || 0) + (m.loved_count || 0) + (m.pending_count || 0) + (m.graveyard_count || 0) + (m.guest_count || 0);
            return total > 0 || (m.kudosu_total || 0) > 0;
        });
}

async function upsertMapperFromProfile(profile, client) {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    
    let last_updated = null;
    const totalMaps = (profile.ranked_and_approved_beatmapset_count || 0) +
                      (profile.loved_beatmapset_count || 0) +
                      (profile.pending_beatmapset_count || 0) +
                      (profile.graveyard_beatmapset_count || 0) +
                      (profile.guest_beatmapset_count || 0);
    
    if (totalMaps > 0) {
        const typesToCheck = [];
        if (profile.pending_beatmapset_count > 0) typesToCheck.push('pending');
        if (profile.graveyard_beatmapset_count > 0) typesToCheck.push('graveyard');
        if (profile.ranked_and_approved_beatmapset_count > 0) typesToCheck.push('ranked');
        if (profile.loved_beatmapset_count > 0) typesToCheck.push('loved');
        if (profile.guest_beatmapset_count > 0) typesToCheck.push('guest');
        
        const dates = [];
        for (const t of typesToCheck) {
            try {
                const sets = await osuApiQueue.add(async () => {
                    return client.users.getUserBeatmaps(profile.id, t, { query: { limit: 1 } });
                });
                if (sets && sets.length > 0) {
                    dates.push(new Date(sets[0].last_updated || sets[0].submitted_date).getTime());
                }
            } catch (err) {
                // ignorar
            }
        }
        
        if (dates.length > 0) {
            last_updated = new Date(Math.max(...dates)).toISOString();
        }
    }
    
    const mapperData = {
        osu_id: String(profile.id),
        username: profile.username,
        country_code: profile.country_code,
        kudosu_total: profile.kudosu.total,
        kudosu_available: profile.kudosu.available,
        ranked_count: profile.ranked_and_approved_beatmapset_count,
        loved_count: profile.loved_beatmapset_count,
        pending_count: profile.pending_beatmapset_count,
        graveyard_count: profile.graveyard_beatmapset_count,
        guest_count: profile.guest_beatmapset_count,
        followers: profile.mapping_follower_count,
        last_updated,
        playmode: profile.playmode,
        updated_at: new Date().toISOString()
    };
    
    await supabase
        .from('mapper_statistics')
        .upsert(mapperData, { onConflict: 'osu_id' });
}

async function backgroundUpdateMappers(mappersList) {
    if (!mappersList || mappersList.length === 0) return;
    
    // Ejecutar de forma totalmente asíncrona (en segundo plano)
    (async () => {
        try {
            const token = await loadToken();
            const client = new Client(token.access_token);
            for (const mapper of mappersList) {
                if (!mapper.osu_id) continue;
                try {
                    // Esperar 2 segundos entre consultas para respetar límites de la API
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    const profile = await osuApiQueue.add(() => client.users.getUser(mapper.osu_id, { urlParams: { mode: 'osu' } }));
                    if (profile) {
                        await upsertMapperFromProfile(profile, client);
                    }
                } catch (e) {
                    // Fallo silencioso en segundo plano
                }
            }
        } catch (err) {
            console.error("Error en backgroundUpdateMappers:", err);
        }
    })();
}

async function isCountryScraped(countryCode) {
    const supabase = getSupabaseClient();
    if (!supabase) return false;
    try {
        const { data } = await supabase
            .from('scraped_countries')
            .select('is_scraped')
            .eq('country_code', countryCode.toUpperCase())
            .maybeSingle();
        return data ? data.is_scraped : false;
    } catch (err) {
        console.error(`Error al verificar estado de scrapeo para ${countryCode}:`, err);
        return false;
    }
}

async function setCountryScraped(countryCode, isScraped = true) {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
        await supabase
            .from('scraped_countries')
            .upsert({
                country_code: countryCode.toUpperCase(),
                is_scraped: isScraped,
                last_scraped_at: new Date().toISOString()
            }, { onConflict: 'country_code' });
    } catch (err) {
        console.error(`Error al establecer estado de scrapeo para ${countryCode}:`, err);
    }
}

async function setPreferredScoreMode(discordId, scoreMode) {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
        await supabase
            .from('users')
            .upsert({
                discord_id: discordId,
                preferred_score_mode: scoreMode
            }, { onConflict: 'discord_id' });
    } catch (err) {
        console.error(`Error al guardar modo de score preferido para ${discordId}:`, err);
    }
}

const OsuUserModel = {
    loadToken,
    NewloadToken,
    getOsuUser,
    getLinkedUser,
    setPreferredScoreMode,
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
    getAllOAuthUsers,
    updateSupporterStatusInBackground,
    syncAllSupporterStatuses,
    fetchRankingPage,
    fetchRankingAcc,
    fetchRankingScore,
    fetchRankingTotalScore,
    fetchRegionalRankingPage,
    getOsuWorldUser,
    getMapperTop,
    getNationalMapperTop,
    getGlobalKudosuMapperTop,
    upsertMapperFromProfile,
    backgroundUpdateMappers,
    isCountryScraped,
    setCountryScraped
};

module.exports = OsuUserModel;

