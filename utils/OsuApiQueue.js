class OsuApiQueue {
    constructor() {
        this.queue = [];
        this.running = false;
        this.lastRequestTime = 0;
        this.delayBetweenRequests = 250; // 250ms mínimo base (~4 req/s) para evitar ráfagas excesivas contra Cloudflare/API v2
        this.cooldownUntil = 0;
    }

    async add(requestFn, priority = 2) {
        return new Promise((resolve, reject) => {
            this.queue.push({ requestFn, resolve, reject, attempts: 0, priority, timestamp: Date.now() });
            
            // Ordenar por prioridad descendente; a igual prioridad, mantener el orden FIFO estable
            this.queue.sort((a, b) => {
                if (b.priority !== a.priority) {
                    return b.priority - a.priority;
                }
                return a.timestamp - b.timestamp;
            });
            this.process();
        });
    }

    async process() {
        if (this.running) return;
        this.running = true;

        while (this.queue.length > 0) {
            const now = Date.now();
            if (now < this.cooldownUntil) {
                const sleepTime = this.cooldownUntil - now;
                await new Promise(resolve => setTimeout(resolve, sleepTime));
                continue;
            }

            const timeSinceLast = Date.now() - this.lastRequestTime;
            if (timeSinceLast < this.delayBetweenRequests) {
                await new Promise(resolve => setTimeout(resolve, this.delayBetweenRequests - timeSinceLast));
            }

            const item = this.queue.shift();
            if (!item) continue;

            this.lastRequestTime = Date.now();

            try {
                // Wrapper de timeout para evitar bloqueos permanentes de la cola ante API muerta/colgada
                const runWithTimeout = (fn, timeoutMs = 15000) => {
                    return new Promise((resolve, reject) => {
                        const timer = setTimeout(() => {
                            reject(new Error("Timeout: La petición a la API de osu! superó el límite de la cola (15s)."));
                        }, timeoutMs);

                        Promise.resolve(fn())
                            .then(res => {
                                clearTimeout(timer);
                                resolve(res);
                            })
                            .catch(err => {
                                clearTimeout(timer);
                                reject(err);
                            });
                    });
                };

                const result = await runWithTimeout(item.requestFn, 15000);
                item.resolve(result);
                
                // Si la petición fue exitosa, reducir gradualmente el delay de vuelta al mínimo (250ms)
                if (this.delayBetweenRequests > 250) {
                    this.delayBetweenRequests = Math.max(250, this.delayBetweenRequests - 5);
                }
            } catch (error) {
                const status = error.response?.status || error.status;
                if (status === 429) {
                    item.attempts++;
                    if (item.attempts < 3) {
                        // Si no ha superado los intentos de reintento en la cola, lo ponemos de vuelta
                        this.queue.unshift(item);
                    } else {
                        item.reject(error);
                    }
                    // ponytail: Respetar Retry-After de Cloudflare/osu! si existe, o enfriar 30s por defecto
                    const retryHeader = error.response?.headers?.['retry-after'];
                    const retrySeconds = retryHeader && !isNaN(retryHeader) ? Number(retryHeader) : 30;
                    const cooldownMs = Math.max(retrySeconds * 1000, 30000);

                    this.cooldownUntil = Date.now() + cooldownMs;
                    this.delayBetweenRequests = Math.min(this.delayBetweenRequests + 100, 1000);
                    console.warn(`[OsuApiQueue] HTTP 429 detectado. Cooldown activado por ${Math.round(cooldownMs / 1000)}s.`);
                } else {
                    item.reject(error);
                }
            }
        }

        this.running = false;
    }
}

const osuApiQueue = new OsuApiQueue();

module.exports = {
    OsuApiQueue,
    osuApiQueue
};
