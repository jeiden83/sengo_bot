/**
 * Cola de peticiones optimizada para la API de osu! v2.
 * Proporciona concurrencia controlada, límite de tasa por ventana deslizante (Rate Limiting),
 * priorización interactiva vs fondo, prevención de inanición (Task Aging) y manejo global de HTTP 429.
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

        this.cooldownUntil = 0;
        this.requestTimestamps = [];
        this.inFlightRequests = new Map();

        this.rateLimitHits = 0;
        this.totalProcessed = 0;
        this.dispatchTimer = null;
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

        // 1. Respetar cooldown por HTTP 429
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
        if (this.queue.length === 0 || this.activeCount >= this.concurrency) {
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
        if (this.queue.length > 0 && this.activeCount < this.concurrency) {
            setTimeout(() => this._dispatch(), this.staggerMs);
        }
    }

    /**
     * Ejecuta una tarea con envoltorio de timeout y manejo resiliente de errores / 429.
     */
    async _executeTask(item) {
        let timer = null;
        try {
            const timeoutPromise = new Promise((_, reject) => {
                timer = setTimeout(() => {
                    reject(new Error("Timeout: La petición a la API de osu! superó el límite de la cola (15s)."));
                }, this.timeoutMs);
            });

            const result = await Promise.race([
                Promise.resolve(item.requestFn()),
                timeoutPromise
            ]);

            if (timer) clearTimeout(timer);
            this.totalProcessed++;
            item.resolve(result);
        } catch (error) {
            if (timer) clearTimeout(timer);

            const status = error.response?.status || error.status;
            if (status === 429) {
                this.rateLimitHits++;
                item.attempts++;

                // ponytail: Respetar Retry-After de Cloudflare/osu! si existe, o enfriar con minCooldownMs
                const retryHeader = error.response?.headers?.['retry-after'];
                const retrySeconds = retryHeader && !isNaN(retryHeader) ? Number(retryHeader) : Math.round(this.minCooldownMs / 1000);
                const cooldownMs = Math.max(retrySeconds * 1000, this.minCooldownMs);

                this.cooldownUntil = Date.now() + cooldownMs;
                console.warn(`[OsuApiQueue] HTTP 429 detectado. Cooldown global activado por ${Math.round(cooldownMs / 1000)}s.`);

                if (item.attempts < 3) {
                    this.queue.unshift(item);
                } else {
                    item.reject(error);
                }
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
        return {
            queueLength: this.queue.length,
            activeCount: this.activeCount,
            concurrency: this.concurrency,
            recentRequestsCount: this.requestTimestamps.length,
            rateLimitHits: this.rateLimitHits,
            totalProcessed: this.totalProcessed,
            inFlightKeysCount: this.inFlightRequests.size
        };
    }
}

const osuApiQueue = new OsuApiQueue();

module.exports = {
    OsuApiQueue,
    osuApiQueue
};
