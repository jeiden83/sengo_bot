const Logger = require('./logger.js');

const NETWORK_ERROR_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EPIPE',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ECONNABORTED',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'ERR_NETWORK',
    'ERR_BAD_RESPONSE',
    'ERR_SOCKET_CLOSED'
]);

/**
 * Extrae el código de estado HTTP de un error (Axios, Fetch, osu-api-extended).
 */
function extractHttpStatus(error) {
    if (!error || typeof error !== 'object') return null;

    const directStatus = error.response?.status ?? error.status ?? error.statusCode;
    if (typeof directStatus === 'number' && Number.isFinite(directStatus)) {
        return directStatus;
    }

    const msg = String(error.message || '');
    const leadingMatch = msg.match(/^(?:HTTP\s*)?(403|429|5\d{2})(?:\s*:|\s+|$)/i);
    if (leadingMatch) {
        return Number(leadingMatch[1]);
    }

    const axiosMsgMatch = msg.match(/status code\s+(403|429|5\d{2})\b/i);
    if (axiosMsgMatch) {
        return Number(axiosMsgMatch[1]);
    }

    return null;
}

/**
 * Extrae el código de estado HTTP si el valor resuelto es una respuesta HTTP (Fetch/Axios).
 */
function extractResponseStatus(result) {
    if (!result || typeof result !== 'object') return null;
    if (typeof result.status === 'number' && ('headers' in result || 'ok' in result || 'statusText' in result)) {
        return result.status;
    }
    return null;
}

/**
 * Indica si un error corresponde a un rate-limit (HTTP 429 / Cloudflare 1015 / bloqueo temporal).
 */
function isRateLimitError(error) {
    if (!error) return false;
    const status = extractHttpStatus(error);
    if (status === 429) return true;

    const msg = String(error.message || error || '').toLowerCase();
    return (
        msg.includes('rate limited') ||
        msg.includes('too many requests') ||
        msg.includes('error code: 1106') ||
        msg.includes('cloudflare 1015')
    );
}

/**
 * Indica si un error proviene de una caída, timeout, fallo de red o 5xx de una API externa.
 */
function isExternalApiOutageError(error, { includeOsuExtendedTransport = false } = {}) {
    if (!error) return false;
    if (isRateLimitError(error)) return true;

    const status = extractHttpStatus(error);
    if (status === 403 || (status !== null && status >= 500 && status < 600)) {
        return true;
    }

    const code = error.code || error.cause?.code;
    if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code.toUpperCase())) {
        return true;
    }

    const name = String(error.name || '');
    if (name === 'AbortError' || name === 'TimeoutError') {
        return true;
    }

    const msg = String(error.message || error || '').toLowerCase();
    if (
        /timeout|time out|timed out|superó el límite de la cola|fetch failed|network error|socket hang up|econnreset|etimedout|econnrefused|enotfound|eai_again|connecttimeouterror|und_err_|bad gateway|service unavailable|gateway timeout|cloudflare|unable to connect|socket closed/i.test(msg)
    ) {
        return true;
    }

    const stack = String(error.stack || '');
    if (includeOsuExtendedTransport || stack.includes('osu-api-extended')) {
        if (
            msg === 'error' ||
            msg === 'aggregateerror' ||
            msg === 'fetcherror' ||
            (msg.includes("reading 'startswith')") && stack.includes('osu-api-extended'))
        ) {
            return true;
        }
    }

    return false;
}

function formatErrorReason(error) {
    if (!error) return 'Error desconocido';
    const status = extractHttpStatus(error);
    const code = error.code || error.cause?.code;
    const rawMsg = String(error.message || error || '').split('\n')[0].trim();
    const trimmed = rawMsg.length > 120 ? `${rawMsg.slice(0, 120)}...` : rawMsg;
    if (status && !trimmed.includes(String(status))) {
        return `HTTP ${status}: ${trimmed}`;
    }
    if (code && !trimmed.includes(code)) {
        return `${code}: ${trimmed}`;
    }
    return trimmed || `HTTP ${status}` || 'Error de conexión';
}

/**
 * Controlador reutilizable de backoff exponencial y circuit-breaker para APIs externas.
 */
class ApiBackoff {
    constructor(options = {}) {
        this.name = options.name || 'API';
        this.baseMs = typeof options.baseMs === 'number' ? options.baseMs : 30000;
        this.maxMs = typeof options.maxMs === 'number' ? options.maxMs : 5 * 60 * 1000;
        this.cooldownUntil = 0;
        this.consecutiveFailures = 0;
        this.totalOutages = 0;
        this.lastReason = null;
    }

    isInCooldown(now = Date.now()) {
        return now < this.cooldownUntil;
    }

    getCooldownRemainingMs(now = Date.now()) {
        return Math.max(0, this.cooldownUntil - now);
    }

    /**
     * Registra un fallo de API externa. Solo escala el backoff si no hay ya un cooldown activo
     * (evita escalar varias veces por peticiones concurrentes de la misma ráfaga).
     */
    recordFailure(reason, customCooldownMs = null) {
        const now = Date.now();
        if (now < this.cooldownUntil) {
            if (typeof customCooldownMs === 'number' && now + customCooldownMs > this.cooldownUntil) {
                this.cooldownUntil = now + customCooldownMs;
            }
            return {
                escalated: false,
                cooldownMs: this.cooldownUntil - now,
                consecutiveFailures: this.consecutiveFailures,
                cooldownUntil: this.cooldownUntil
            };
        }

        this.consecutiveFailures++;
        this.totalOutages++;
        this.lastReason = reason || this.lastReason;

        const expDelay = Math.min(this.maxMs, this.baseMs * Math.pow(2, this.consecutiveFailures - 1));
        const cooldownMs = typeof customCooldownMs === 'number' ? Math.max(expDelay, customCooldownMs) : expDelay;
        this.cooldownUntil = now + cooldownMs;

        return {
            escalated: true,
            cooldownMs,
            consecutiveFailures: this.consecutiveFailures,
            cooldownUntil: this.cooldownUntil
        };
    }

    recordSuccess() {
        if (this.consecutiveFailures > 0 || this.cooldownUntil > 0) {
            const previousFailures = this.consecutiveFailures;
            this.consecutiveFailures = 0;
            this.cooldownUntil = 0;
            this.lastReason = null;
            return { recovered: previousFailures > 0, previousFailures };
        }
        return { recovered: false, previousFailures: 0 };
    }

    getStats() {
        return {
            name: this.name,
            inCooldown: this.isInCooldown(),
            cooldownRemainingMs: this.getCooldownRemainingMs(),
            consecutiveFailures: this.consecutiveFailures,
            totalOutages: this.totalOutages,
            lastReason: this.lastReason
        };
    }
}

/**
 * Cola de peticiones optimizada para la API de osu! v2.
 * Proporciona concurrencia controlada, límite de tasa por ventana deslizante (Rate Limiting),
 * priorización interactiva vs fondo, prevención de inanición (Task Aging), manejo global de HTTP 429
 * y backoff exponencial ante caídas de la API.
 */
class OsuApiQueue {
    constructor(options = {}) {
        this.queue = [];
        this.activeCount = 0;
        this.concurrency = options.concurrency || 4;
        this.rateLimit = options.rateLimit || 15; // Máximo 15 peticiones por ventana rodante
        this.rateLimitWindowMs = options.rateLimitWindowMs || 1000;
        this.staggerMs = options.staggerMs || 35; // Micro-escalonamiento para evitar ráfagas instantáneas contra Cloudflare
        this.timeoutMs = options.timeoutMs || 15000;
        this.minCooldownMs = typeof options.minCooldownMs === 'number' ? options.minCooldownMs : 30000;

        this.backoff = new ApiBackoff({
            name: 'osu! API',
            baseMs: typeof options.outageBaseMs === 'number' ? options.outageBaseMs : 30000,
            maxMs: typeof options.outageMaxMs === 'number' ? options.outageMaxMs : 5 * 60 * 1000
        });
        this.requestTimestamps = [];
        this.inFlightRequests = new Map();

        this.rateLimitHits = 0;
        this.totalProcessed = 0;
        this.dispatchTimer = null;
    }

    get cooldownUntil() {
        return this.backoff.cooldownUntil;
    }

    set cooldownUntil(value) {
        this.backoff.cooldownUntil = value;
    }

    isInCooldown() {
        return this.backoff.isInCooldown();
    }

    getCooldownRemainingMs() {
        return this.backoff.getCooldownRemainingMs();
    }

    /**
     * Registra una caída o rate-limit de la API y activa backoff exponencial.
     */
    recordOutage(error, source = 'OsuApiQueue', customCooldownMs = null) {
        const reason = formatErrorReason(error);
        const result = this.backoff.recordFailure(reason, customCooldownMs);
        if (result.escalated) {
            const waitSec = Math.round(result.cooldownMs / 1000);
            Logger.system(`[${source}] API de osu! no disponible (${reason}). Tiempo de espera activado por ${waitSec}s (fallo consecutivo #${result.consecutiveFailures}).`);
            if (!this.dispatchTimer && this.queue.length > 0) {
                this.dispatchTimer = setTimeout(() => {
                    this.dispatchTimer = null;
                    this._dispatch();
                }, result.cooldownMs);
            }
        }
        return result;
    }

    /**
     * Resetea el estado de caída cuando una petición responde correctamente.
     */
    resetOutage() {
        const res = this.backoff.recordSuccess();
        if (res.recovered) {
            Logger.system(`[OsuApiQueue] API de osu! recuperada tras ${res.previousFailures} fallo(s) consecutivo(s).`);
        }
        return res;
    }

    /**
     * Niveles estándar de prioridad.
     */
    static get PRIORITY() {
        return {
            INTERACTIVE: 10, // Comandos de Discord (/rs, /profile, /compare, etc.)
            RECALC: 5,       // Recálculos de PP, -refresh de usuarios
            BACKGROUND: 0    // Trackers continuos de scores y mappers
        };
    }

    /**
     * Encola una petición para la API de osu!.
     * @param {Function} requestFn Función asíncrona a ejecutar
     * @param {number} priority Nivel de prioridad (por defecto 10: Interactivo)
     * @param {string|null} dedupeKey Clave opcional para evitar peticiones idénticas concurrentes (Singleflight)
     * @returns {Promise<any>}
     */
    async add(requestFn, priority = 10, dedupeKey = null) {
        if (dedupeKey && this.inFlightRequests.has(dedupeKey)) {
            return this.inFlightRequests.get(dedupeKey);
        }

        const promise = new Promise((resolve, reject) => {
            this.queue.push({
                requestFn,
                resolve,
                reject,
                attempts: 0,
                priority: typeof priority === 'number' ? priority : 10,
                timestamp: Date.now(),
                dedupeKey
            });

            this._dispatch();
        });

        if (dedupeKey) {
            this.inFlightRequests.set(dedupeKey, promise);
            promise.finally(() => {
                this.inFlightRequests.delete(dedupeKey);
            });
        }

        return promise;
    }

    /**
     * Calcula la prioridad efectiva de una tarea aplicando envejecimiento (Task Aging)
     * para prevenir que tareas de fondo queden congeladas por ráfagas interactivas.
     */
    _getEffectivePriority(item, now) {
        // ponytail: cada 5 segundos de espera añade +1 a la prioridad (tope +8) para evitar inanición (starvation)
        const waitSeconds = Math.max(0, (now - item.timestamp) / 1000);
        const ageBoost = Math.min(8, Math.floor(waitSeconds / 5));
        return item.priority + ageBoost;
    }

    /**
     * Ordena la cola según la prioridad efectiva actual y orden FIFO estable.
     */
    _sortQueue(now) {
        this.queue.sort((a, b) => {
            const prioA = this._getEffectivePriority(a, now);
            const prioB = this._getEffectivePriority(b, now);
            if (prioB !== prioA) {
                return prioB - prioA;
            }
            return a.timestamp - b.timestamp;
        });
    }

    /**
     * Limpia marcas de tiempo fuera de la ventana deslizante actual.
     */
    _cleanTimestamps(now) {
        const threshold = now - this.rateLimitWindowMs;
        this.requestTimestamps = this.requestTimestamps.filter(t => t > threshold);
    }

    /**
     * Despacha tareas disponibles respetando concurrencia, rate-limit y cooldowns.
     */
    async _dispatch() {
        const now = Date.now();

        // 1. Respetar cooldown por HTTP 429 o caída de API
        if (now < this.cooldownUntil) {
            const waitTime = this.cooldownUntil - now;
            if (!this.dispatchTimer) {
                this.dispatchTimer = setTimeout(() => {
                    this.dispatchTimer = null;
                    this._dispatch();
                }, waitTime);
            }
            return;
        }

        // 2. Comprobar si hay trabajadores disponibles y tareas en cola
        // En recuperación tras una caída (half-open), solo permitimos 1 sonda a la vez
        const effectiveConcurrency = this.backoff.consecutiveFailures > 0 ? 1 : this.concurrency;
        if (this.queue.length === 0 || this.activeCount >= effectiveConcurrency) {
            return;
        }

        // 3. Comprobar límite de tasa de ventana deslizante
        this._cleanTimestamps(now);
        if (this.requestTimestamps.length >= this.rateLimit) {
            const oldestInWindow = this.requestTimestamps[0];
            const waitTime = Math.max(10, (oldestInWindow + this.rateLimitWindowMs) - now + 5);
            if (!this.dispatchTimer) {
                this.dispatchTimer = setTimeout(() => {
                    this.dispatchTimer = null;
                    this._dispatch();
                }, waitTime);
            }
            return;
        }

        // 4. Tomar el elemento de mayor prioridad efectiva
        this._sortQueue(now);
        const item = this.queue.shift();
        if (!item) return;

        this.activeCount++;
        this.requestTimestamps.push(Date.now());

        // Ejecutar la tarea de forma asíncrona sin bloquear el despachador
        this._executeTask(item);

        // Si aún hay slots y elementos, programar el siguiente despacho con micro-escalonamiento
        if (this.queue.length > 0 && this.activeCount < effectiveConcurrency) {
            setTimeout(() => this._dispatch(), this.staggerMs);
        }
    }

    /**
     * Ejecuta una tarea con envoltorio de timeout y manejo resiliente de errores / 429 / caídas de API.
     */
    async _executeTask(item) {
        let timer = null;
        try {
            const timeoutPromise = new Promise((_, reject) => {
                timer = setTimeout(() => {
                    reject(new Error(`Timeout: La petición a la API de osu! superó el límite de la cola (${Math.round(this.timeoutMs / 1000)}s).`));
                }, this.timeoutMs);
            });

            const result = await Promise.race([
                Promise.resolve(item.requestFn()),
                timeoutPromise
            ]);

            if (timer) clearTimeout(timer);

            const resStatus = extractResponseStatus(result);
            if (resStatus === 429) {
                this.rateLimitHits++;
                const retryHeader = typeof result.headers?.get === 'function'
                    ? result.headers.get('retry-after')
                    : result.headers?.['retry-after'];
                const retrySeconds = retryHeader && !isNaN(retryHeader) ? Number(retryHeader) : Math.round(this.minCooldownMs / 1000);
                const cooldownMs = Math.max(retrySeconds * 1000, this.minCooldownMs);
                this.recordOutage(new Error('HTTP 429 Too Many Requests'), 'OsuApiQueue', cooldownMs);
            } else if (resStatus === 403 || (resStatus !== null && resStatus >= 500 && resStatus < 600)) {
                this.recordOutage(new Error(`HTTP ${resStatus}`), 'OsuApiQueue');
            } else {
                this.resetOutage();
            }

            this.totalProcessed++;
            item.resolve(result);
        } catch (error) {
            if (timer) clearTimeout(timer);

            if (isRateLimitError(error)) {
                this.rateLimitHits++;
                item.attempts++;

                // ponytail: Respetar Retry-After de Cloudflare/osu! si existe, o enfriar con minCooldownMs
                const retryHeader = error.response?.headers?.['retry-after'];
                const retrySeconds = retryHeader && !isNaN(retryHeader) ? Number(retryHeader) : Math.round(this.minCooldownMs / 1000);
                const cooldownMs = Math.max(retrySeconds * 1000, this.minCooldownMs);

                this.recordOutage(error, 'OsuApiQueue', cooldownMs);

                if (item.attempts < 3) {
                    this.queue.unshift(item);
                } else {
                    item.reject(error);
                }
            } else if (isExternalApiOutageError(error, { includeOsuExtendedTransport: true })) {
                this.recordOutage(error, 'OsuApiQueue');
                item.reject(error);
            } else {
                item.reject(error);
            }
        } finally {
            this.activeCount--;
            this._dispatch();
        }
    }

    /**
     * Pausa temporalmente la cola manualmente si se requiere.
     */
    pauseFor(ms = 5000) {
        this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + ms);
        setTimeout(() => this._dispatch(), ms);
    }

    /**
     * Devuelve métricas de estado de la cola en tiempo real.
     */
    getStats() {
        const backoffStats = this.backoff.getStats();
        return {
            queueLength: this.queue.length,
            activeCount: this.activeCount,
            concurrency: this.concurrency,
            recentRequestsCount: this.requestTimestamps.length,
            rateLimitHits: this.rateLimitHits,
            totalProcessed: this.totalProcessed,
            inFlightKeysCount: this.inFlightRequests.size,
            inCooldown: backoffStats.inCooldown,
            cooldownRemainingMs: backoffStats.cooldownRemainingMs,
            consecutiveOutages: backoffStats.consecutiveFailures,
            outageCount: backoffStats.totalOutages,
            lastOutageReason: backoffStats.lastReason
        };
    }
}

const osuApiQueue = new OsuApiQueue();

module.exports = {
    OsuApiQueue,
    osuApiQueue,
    ApiBackoff,
    isExternalApiOutageError,
    isRateLimitError
};
