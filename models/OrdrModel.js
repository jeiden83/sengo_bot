const fetch = require('node-fetch');
const FormData = require('form-data');
const { io } = require('socket.io-client');
const { t } = require('../utils/i18n.js');
const { getSupabaseClient } = require('../db/database.js');

// Mapa para gestionar los renders activos en seguimiento: renderId -> { callbacks, locale }
const activeRenders = new Map();
let socket = null;
let disconnectTimeout = null;

// Cola secuencial de peticiones para evitar 429 Rate Limit en o!rdr
let queuePromise = Promise.resolve();

/**
 * Obtiene y valida la API Key de o!rdr en el entorno.
 * Filtra marcadores de posición comunes (como 'true', 'false', o 'YOUR_API_KEY').
 * @returns {string|null} Retorna la API Key válida o null
 */
function getValidApiKey() {
    // Si se activa explicitamente el modo desarrollo o la API key es dummy (true/false)
    if (process.env.ORDR_DEV_MODE === 'true' || process.env.ORDR_API_KEY === 'true' || process.env.ORDR_API_KEY === 'false') {
        return null;
    }
    const apiKey = process.env.ORDR_API_KEY;
    if (!apiKey || apiKey.trim() === '' || apiKey === 'YOUR_API_KEY') {
        return null;
    }
    return apiKey;
}

/**
 * Inicializa y conecta el WebSocket de o!rdr si no está activo.
 */
function initWebSocket() {
    // Si hay un timeout de desconexión pendiente, cancelarlo
    if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
        disconnectTimeout = null;
    }

    if (socket && socket.connected) {
        return;
    }

    console.log("🔌 [OrdrModel] Conectando al WebSocket de o!rdr...");
    socket = io("https://apis.issou.best", {
        path: "/ordr/ws",
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
    });

    socket.on('connect', () => {
        console.log("📡 [OrdrModel] Conectado exitosamente al WebSocket de o!rdr.");
        const apiKey = getValidApiKey();
        if (apiKey) {
            console.log("🔑 [OrdrModel] Autenticando WebSocket con la API Key...");
            socket.emit('bot_auth', apiKey);
        }
    });

    socket.on('connect_error', (error) => {
        console.error("❌ [OrdrModel] Error de conexión en el WebSocket:", error.message);
    });

    socket.on('disconnect', () => {
        console.log("🔌 [OrdrModel] WebSocket desconectado.");
    });

    // Escuchar eventos globales de o!rdr y distribuirlos
    socket.on('render_added_json', (wsData) => {
        const renderId = wsData.renderID;
        const entry = activeRenders.get(renderId);
        if (entry && entry.onAdded) {
            entry.onAdded(wsData);
        }
    });

    socket.on('render_progress_json', (wsData) => {
        const renderId = wsData.renderID;
        const entry = activeRenders.get(renderId);
        if (entry && entry.onProgress) {
            // Deducir el estado si o!rdr no lo incluye directamente en el payload
            if (!wsData.state) {
                const numericProgress = parseInt(wsData.progress);
                wsData.state = !isNaN(numericProgress) ? 'Renderizando' : wsData.progress;
            }
            entry.onProgress(wsData);
        }
    });

    socket.on('render_done_json', (wsData) => {
        const renderId = wsData.renderID;
        const entry = activeRenders.get(renderId);
        if (entry) {
            if (entry.onDone) {
                entry.onDone(wsData);
            }
            removeActiveRender(renderId);
        }
    });

    socket.on('render_failed_json', (wsData) => {
        const renderId = wsData.renderID;
        const entry = activeRenders.get(renderId);
        if (entry) {
            if (entry.onError) {
                const errMsg = obtenerMensajeError(wsData.errorCode, entry.locale);
                entry.onError(errMsg, wsData);
            }
            removeActiveRender(renderId);
        }
    });
}

/**
 * Remueve un render del seguimiento y cierra el socket si no quedan renders activos.
 */
function removeActiveRender(renderId) {
    activeRenders.delete(renderId);
    console.log(`🧹 [OrdrModel] Render ${renderId} finalizado y removido del seguimiento.`);

    // Si ya no quedan renders activos, programar desconexión tras 30 segundos
    if (activeRenders.size === 0 && socket) {
        disconnectTimeout = setTimeout(() => {
            if (activeRenders.size === 0 && socket) {
                console.log("🔌 [OrdrModel] Desconectando WebSocket por inactividad...");
                socket.disconnect();
                socket = null;
            }
        }, 30000);
    }
}

/**
 * Obtiene la traducción del mensaje de error de o!rdr según el idioma indicado.
 * @param {number} errorCode Código de error devuelto por o!rdr
 * @param {string} locale Código de idioma ('es' o 'en')
 * @returns {string} Mensaje de error traducido
 */
function obtenerMensajeError(errorCode, locale = 'es') {
    const translation = t(locale, `render.errors.${errorCode}`);
    if (translation && translation !== `render.errors.${errorCode}`) {
        return translation;
    }
    
    // Si no está definido, usamos la traducción por defecto
    const defaultMsg = t(locale, 'render.errors.default') || 'Error desconocido en el renderizador de o!rdr (Código {code})';
    return defaultMsg.replace('{code}', errorCode);
}

/**
 * Envía una solicitud de renderizado a o!rdr utilizando una cola local para evitar rate limits (429).
 * @param {object} params Parámetros de renderizado
 * @returns {Promise<object>} Retorna la respuesta de la API de o!rdr
 */
async function requestRender({ replayBuffer, fileName, locale = 'es', ...options }) {
    return new Promise((resolve, reject) => {
        queuePromise = queuePromise.then(async () => {
            try {
                const result = await _executeRequestRender({ replayBuffer, fileName, locale, ...options });
                resolve(result);
            } catch (err) {
                reject(err);
            }
            // Retardo de enfriamiento de 1.5 segundos entre peticiones para proteger la API de o!rdr
            await new Promise(r => setTimeout(r, 1500));
        });
    });
}

/**
 * Realiza la peticion real HTTP a la API de o!rdr.
 */
async function _executeRequestRender({ replayBuffer, fileName, locale = 'es', ...options }) {
    const apiKey = getValidApiKey();
    const devMode = process.env.ORDR_DEV_MODE === 'true';
    const form = new FormData();

    // Adjuntar archivo .osr
    form.append('replayFile', replayBuffer, { filename: fileName || 'replay.osr' });

    // Determinar si usamos la API key real o forzamos Developer Mode
    if (apiKey && !devMode) {
        form.append('apiKey', apiKey);
    } else {
        console.log(`⚠️ [OrdrModel] ${devMode ? 'ORDR_DEV_MODE activo' : 'ORDR_API_KEY no configurada o es dummy'}. Activando Developer Mode de o!rdr.`);
        form.append('verificationKey', 'devmode_success');
    }

    // Configurar opciones estéticas por defecto si no se indican
    // Si skin es undefined, NO se envía para que o!rdr aplique el preset del usuario automáticamente
    if (options.skin) {
        form.append('skin', options.skin);
    }
    form.append('username', options.username || 'Sengo User');
    form.append('resolution', options.resolution || '1280x720');
    
    const discordUserId = options.discordUserId || options.discordId;
    if (discordUserId) {
        form.append('discordUserId', discordUserId);
    }

    // Opciones booleanas por defecto
    form.append('showKeyOverlay', (options.showKeyOverlay !== false).toString());
    form.append('showHitCounter', (options.showHitCounter === true).toString());

    console.log("📤 [OrdrModel] Enviando solicitud a la API de o!rdr...");
    const response = await fetch('https://apis.issou.best/ordr/renders', {
        method: 'POST',
        body: form,
        headers: form.getHeaders()
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
        try {
            data = await response.json();
        } catch (err) {
            console.error("[OrdrModel] Error al parsear JSON de o!rdr:", err);
        }
    }

    if (!response.ok) {
        if (response.status === 429) {
            throw new Error(t(locale, 'render.err_too_many_requests') || "Has excedido el límite de peticiones de o!rdr (429 Too Many Requests). Por favor, espera unos minutos o usa una API key válida.");
        }
        
        const msg = (data && data.message) || `Error del servidor o!rdr (Status: ${response.status}).`;
        const code = (data && data.errorCode) || 0;
        const mappedError = obtenerMensajeError(code, locale) || msg;
        throw new Error(mappedError);
    }

    if (!data || !data.renderID) {
        throw new Error("La API de o!rdr no devolvió una respuesta válida en formato JSON.");
    }

    console.log(`✅ [OrdrModel] Render encolado con éxito. ID: ${data.renderID}`);
    return data;
}

/**
 * Registra un render activo en el mapa para realizar su seguimiento a través del WebSocket.
 * @param {number} renderId El ID de render devuelto por la API
 * @param {object} callbacks Objeto con callbacks: onAdded, onProgress, onDone, onError
 * @param {string} locale Idioma del servidor/canal
 */
function trackProgress(renderId, callbacks, locale = 'es') {
    if (!renderId) return;

    activeRenders.set(renderId, { ...callbacks, locale });
    
    // Conectar/asegurar socket activo
    initWebSocket();
}

async function getUserPreset(discordId) {
    const prodApiKey = process.env.ORDR_API_KEY;
    const isDummyKey = !prodApiKey || prodApiKey.trim() === '' || prodApiKey === 'true' || prodApiKey === 'false' || prodApiKey === 'YOUR_API_KEY';

    if (isDummyKey) {
        return {
            isDevSimulated: true,
            presetName: "Preset de Prueba (Modo Dev)",
            skin: "Default Skin",
            resolution: "1280x720",
            lastSavedOn: new Date().toISOString()
        };
    }

    try {
        const response = await fetch(`https://apis.issou.best/ordr/presets/bot?key=${prodApiKey}&discord_id=${discordId}`);
        if (!response.ok) {
            if (response.status === 404) {
                return null;
            }
            throw new Error(`Error al consultar preset en o!rdr (Status: ${response.status})`);
        }
        return await response.json();
    } catch (err) {
        console.error("Error al obtener preset de o!rdr:", err);
        throw err;
    }
}
/**
 * Consulta el cooldown de renderizado de un usuario desde Supabase.
 * @param {string} discordId ID de Discord del usuario
 * @returns {Promise<number|null>} Timestamp en ms del último render, o null si no existe
 */
async function getRenderCooldown(discordId) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('render_cooldowns')
        .select('last_render_at')
        .eq('discord_id', discordId)
        .maybeSingle();

    if (error) {
        console.error(`[OrdrModel] Error al consultar cooldown para ${discordId}:`, error.message);
        return null;
    }

    if (!data) return null;
    return new Date(data.last_render_at).getTime();
}

/**
 * Registra o actualiza el cooldown de renderizado de un usuario en Supabase.
 * @param {string} discordId ID de Discord del usuario
 * @returns {Promise<void>}
 */
async function setRenderCooldown(discordId) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
        .from('render_cooldowns')
        .upsert({
            discord_id: discordId,
            last_render_at: new Date().toISOString()
        }, { onConflict: 'discord_id' });

    if (error) {
        console.error(`[OrdrModel] Error al guardar cooldown para ${discordId}:`, error.message);
    }
}

module.exports = {
    requestRender,
    trackProgress,
    obtenerMensajeError,
    getUserPreset,
    getRenderCooldown,
    setRenderCooldown
};
