const crypto = require('crypto');
const fetch = globalThis.fetch;
const CONFIG = require('../config.js');

const STATE_TTL_MS = 15 * 60 * 1000; // 15 minutos

function getStateSecret() {
    return process.env.OSU_CLIENT_SECRET || CONFIG.OSU_CLIENT_SECRET || process.env.DISCORD_TOKEN || CONFIG.TOKEN;
}

/**
 * Genera un parámetro state firmado con HMAC-SHA256 para prevenir Login CSRF.
 */
function generateAuthState(discordId) {
    const cleanId = String(discordId || '').trim();
    const secret = getStateSecret();
    if (!secret) {
        throw new Error('No hay secreto configurado para firmar el estado OAuth.');
    }
    const timestamp = Date.now();
    const hmac = crypto
        .createHmac('sha256', secret)
        .update(`${cleanId}:${timestamp}`)
        .digest('hex')
        .slice(0, 16);
    return `${cleanId}_${timestamp}_${hmac}`;
}

/**
 * Verifica un parámetro state firmado y devuelve el discordId si es válido y no ha expirado.
 */
function verifyAuthState(state) {
    if (!state || typeof state !== 'string') return null;
    const parts = state.split('_');
    if (parts.length !== 3) return null;

    const [discordId, timestampStr, hmac] = parts;
    if (!/^\d+$/.test(discordId) || !/^\d+$/.test(timestampStr) || !/^[a-f0-9]{16}$/i.test(hmac)) {
        return null;
    }

    const timestamp = Number(timestampStr);
    const now = Date.now();
    if (isNaN(timestamp) || now - timestamp > STATE_TTL_MS || timestamp - now > 60000) {
        return null;
    }

    const secret = getStateSecret();
    if (!secret) return null;

    const expectedHmac = crypto
        .createHmac('sha256', secret)
        .update(`${discordId}:${timestampStr}`)
        .digest('hex')
        .slice(0, 16);

    const a = Buffer.from(hmac.toLowerCase(), 'utf8');
    const b = Buffer.from(expectedHmac.toLowerCase(), 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return null;
    }

    return discordId;
}

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
    const signedState = verifyAuthState(discordId) ? discordId : generateAuthState(discordId);
    return `https://osu.ppy.sh/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify+public+friends.read&state=${encodeURIComponent(signedState)}`;
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
        if (response.status === 429) {
            throw new Error(`Rate limit exceeded (HTTP 429) en osu.ppy.sh al refrescar token.`);
        }
        let errorText = await response.text();
        if (errorText.includes('<html') || errorText.includes('<!DOCTYPE')) {
            errorText = `[Página de error HTML - HTTP ${response.status}]`;
        }
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
        if (response.status === 429) {
            throw new Error(`Rate limit exceeded (HTTP 429) en osu.ppy.sh al consultar /me.`);
        }
        let errorText = await response.text();
        if (errorText.includes('<html') || errorText.includes('<!DOCTYPE')) {
            errorText = `[Página de error HTML - HTTP ${response.status}]`;
        }
        throw new Error(`Failed to fetch /me: ${response.statusText} - ${errorText}`);
    }

    return response.json();
}

module.exports = {
    generateAuthState,
    verifyAuthState,
    getRedirectUri,
    getAuthUrl,
    exchangeCode,
    fetchOsuMe,
    refreshAccessToken
};
