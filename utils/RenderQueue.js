/**
 * Cola de renderizado para operaciones intensivas de CPU y memoria (Canvas, Sharp).
 * Limita la concurrencia a un máximo de 2 tareas simultáneas para proteger la memoria RAM
 * y evitar bloqueos en el Event Loop de Node.js en entornos con recursos limitados (Render.com).
 */
class RenderQueue {
    constructor(concurrency = 2) {
        this.concurrency = concurrency;
        this.activeCount = 0;
        this.queue = [];
        this.totalRendered = 0;
    }

    /**
     * Encola una función de renderizado.
     * @param {Function} renderFn Función asíncrona o síncrona que genera el Canvas/Buffer
     * @returns {Promise<any>}
     */
    async add(renderFn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ renderFn, resolve, reject });
            this._dispatch();
        });
    }

    async _dispatch() {
        if (this.activeCount >= this.concurrency || this.queue.length === 0) {
            return;
        }

        const task = this.queue.shift();
        if (!task) return;

        this.activeCount++;

        try {
            const result = await Promise.resolve(task.renderFn());
            this.totalRendered++;
            task.resolve(result);
        } catch (err) {
            task.reject(err);
        } finally {
            this.activeCount--;
            this._dispatch();
        }
    }

    getStats() {
        return {
            queueLength: this.queue.length,
            activeCount: this.activeCount,
            concurrency: this.concurrency,
            totalRendered: this.totalRendered
        };
    }
}

const renderQueue = new RenderQueue(2);

module.exports = {
    RenderQueue,
    renderQueue
};
