class OsuApiQueue {
    constructor() {
        this.queue = [];
        this.running = false;
        this.lastRequestTime = 0;
        this.delayBetweenRequests = 100; // 100ms mínimo base para evitar ráfagas excesivas
        this.cooldownUntil = 0;
    }

    async add(requestFn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ requestFn, resolve, reject, attempts: 0 });
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
                const result = await item.requestFn();
                item.resolve(result);
                
                // Si la petición fue exitosa, reducir gradualmente el delay de vuelta al mínimo (100ms)
                if (this.delayBetweenRequests > 100) {
                    this.delayBetweenRequests = Math.max(100, this.delayBetweenRequests - 2);
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
                    // Activar el pare general: pausar 3 segundos
                    this.cooldownUntil = Date.now() + 3000;
                    this.delayBetweenRequests = Math.min(this.delayBetweenRequests + 50, 500);
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
