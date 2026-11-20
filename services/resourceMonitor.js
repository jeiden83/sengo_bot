const { monitorEventLoopDelay } = require('perf_hooks');
const Logger = require('../utils/logger.js');

// Muestrea CPU/RAM/lag del event loop y lo deja en el log diario (persistente en disco),
// para poder reconstruir después qué pasaba antes de que Wispbyte detenga el servidor por CPU.
// ponytail: muestreo fijo cada 30s; si hace falta más resolución, bajar INTERVAL_MS.
const INTERVAL_MS = 30000;
const CPU_ALERT_PCT = 10; // Wispbyte detiene con promedio ~15%; alertamos antes

function startResourceMonitor() {
    const loop = monitorEventLoopDelay({ resolution: 20 });
    loop.enable();
    let lastCpu = process.cpuUsage();
    let lastTime = process.hrtime.bigint();

    const timer = setInterval(() => {
        const nowTime = process.hrtime.bigint();
        const cpu = process.cpuUsage(lastCpu);
        const elapsedUs = Number(nowTime - lastTime) / 1000;
        const cpuPct = ((cpu.user + cpu.system) / elapsedUs) * 100;
        lastCpu = process.cpuUsage();
        lastTime = nowTime;

        const mem = process.memoryUsage();
        const mb = (n) => (n / 1048576).toFixed(0);
        const lagP99 = (loop.percentile(99) / 1e6).toFixed(0);
        const lagMax = (loop.max / 1e6).toFixed(0);
        loop.reset();

        let msg = `[RECURSOS] cpu=${cpuPct.toFixed(1)}% rss=${mb(mem.rss)}MB heap=${mb(mem.heapUsed)}/${mb(mem.heapTotal)}MB lagP99=${lagP99}ms lagMax=${lagMax}ms`;
        if (cpuPct >= CPU_ALERT_PCT) {
            const now = Date.now();
            const active = [...Logger.active.values()]
                .map(a => `s.${a.command}(${a.user}, ${Math.round((now - a.startTime) / 1000)}s)`)
                .join(', ') || 'ninguno';
            msg = `[ALERTA-CPU] ${msg.slice(11)} | comandos activos: ${active}`;
        }
        Logger.system(msg);
    }, INTERVAL_MS);
    timer.unref();
}

module.exports = { startResourceMonitor };
