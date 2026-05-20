const fetch = require('node-fetch');
const { getSupabaseClient } = require('../db/database.js');
const CONFIG = require('../config.js');

/**
 * Obtiene la URL de redirección (Callback) de forma dinámica.
 */
function getRedirectUri(req) {
    if (process.env.RENDER_EXTERNAL_URL) {
        return `${process.env.RENDER_EXTERNAL_URL}/oauth/callback`;
    }
    if (req && req.headers && req.headers.host) {
        // En desarrollo local a través de ngrok u otros proxies
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        return `${protocol}://${req.headers.host}/oauth/callback`;
    }
    return 'https://stoppable-passcode-riot.ngrok-free.dev/oauth/callback';
}

/**
 * Genera la URL de autorización para redirigir al usuario.
 */
function getAuthUrl(discordId, redirectUri) {
    const clientId = CONFIG.OSU_CLIENT_ID;
    return `https://osu.ppy.sh/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify+public&state=${discordId}`;
}

/**
 * Intercambia el código de autorización por tokens de acceso y actualización.
 */
async function exchangeCode(code, redirectUri) {
    const params = new URLSearchParams();
    params.append('client_id', CONFIG.OSU_CLIENT_ID);
    params.append('client_secret', CONFIG.OSU_CLIENT_SECRET);
    params.append('code', code);
    params.append('grant_type', 'authorization_code');
    params.append('redirect_uri', redirectUri);

    const response = await fetch('https://osu.ppy.sh/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to exchange code: ${response.statusText} - ${errorText}`);
    }

    return response.json();
}

/**
 * Refresca un token de acceso expirado.
 */
async function refreshAccessToken(refreshToken) {
    const params = new URLSearchParams();
    params.append('client_id', CONFIG.OSU_CLIENT_ID);
    params.append('client_secret', CONFIG.OSU_CLIENT_SECRET);
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);

    const response = await fetch('https://osu.ppy.sh/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to refresh token: ${response.statusText} - ${errorText}`);
    }

    return response.json();
}

/**
 * Obtiene los detalles del usuario a partir del token de acceso.
 */
async function fetchOsuMe(accessToken) {
    const response = await fetch('https://osu.ppy.sh/api/v2/me', {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch /me: ${response.statusText} - ${errorText}`);
    }

    return response.json();
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
                if (token) return { token, username: tokenData.username, country: countryCode.toUpperCase() };
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

module.exports = {
    getRedirectUri,
    getAuthUrl,
    exchangeCode,
    fetchOsuMe,
    saveOAuthToken,
    getValidTokenForUser,
    getSupporterTokenForCountry
};
