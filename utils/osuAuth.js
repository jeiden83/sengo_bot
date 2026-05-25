const fetch = require('node-fetch');
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
    return `https://osu.ppy.sh/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify+public+friends.read&state=${discordId}`;
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

module.exports = {
    getRedirectUri,
    getAuthUrl,
    exchangeCode,
    fetchOsuMe,
    refreshAccessToken
};
