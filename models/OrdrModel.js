const fetch = require('node-fetch');
const FormData = require('form-data');
const { io } = require('socket.io-client');
const { t } = require('../utils/i18n.js');

// Mapa para gestionar los renders activos en seguimiento: renderId -> { callbacks, locale }
const activeRenders = new Map();
let socket = null;
let disconnectTimeout = null;

/**
 * Obtiene y valida la API Key de o!rdr en el entorno.
 * Filtra marcadores de posición comunes (como 'true', 'false', o 'YOUR_API_KEY').
 * @returns {string|null} Retorna la API Key válida o null
 */
function getValidApiKey() {
    const apiKey = process.env.ORDR_API_KEY;
    if (!apiKey || apiKey.trim() === '' || apiKey === 'true' || apiKey === 'false' || apiKey === 'YOUR_API_KEY') {
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
 * Envía una solicitud de renderizado a o!rdr.
 * @param {object} params Parámetros de renderizado
 * @param {Buffer} params.replayBuffer Buffer binario del archivo .osr
 * @param {string} params.fileName Nombre del archivo de replay
 * @param {string} [params.locale] Idioma de preferencia
 * @param {string} [params.skin] Skin seleccionada
 * @param {string} [params.resolution] Resolución
 * @returns {Promise<object>} Retorna la respuesta de la API de o!rdr
 */
async function requestRender({ replayBuffer, fileName, locale = 'es', ...options }) {
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
    form.append('skin', options.skin || 'Default');
    form.append('username', options.username || 'Sengo User');
    form.append('resolution', options.resolution || '1280x720');
    
    if (options.discordId) {
        form.append('discordID', options.discordId);
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

module.exports = {
    requestRender,
    trackProgress,
    obtenerMensajeError
};
