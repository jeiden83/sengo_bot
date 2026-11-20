const { monitorEventLoopDelay } = require('perf_hooks');
const Logger = require('../utils/logger.js');

// Muestrea CPU/RAM/lag del event loop y lo deja en el log diario (persistente en disco),
// para poder reconstruir después qué pasaba antes de que Wispbyte detenga el servidor por CPU.
// ponytail: muestreo fijo cada 30s; si hace falta más resolución, bajar INTERVAL_MS.
const INTERVAL_MS = 30000;
const CPU_ALERT_PCT = 10; // Wispbyte detiene con promedio ~15%; alertamos antes
const CPU_NTFY_PCT = 18;  // 2 muestras seguidas >= 18% dispara alerta push
const NTFY_COOLDOWN_MS = 15 * 60 * 1000;

let started = false;
let lastCpuPct = 0;
let consecutiveHighCpu = 0;
let lastNtfyAlertAt = 0;

function getLastCpuPct() {
    return lastCpuPct;
}

/**
 * Cede tiempo al event loop si la última muestra de CPU supera maxPct.
 * Usado por trabajos en segundo plano para no acumular picos de CPU.
 */
async function waitIfHighCpu(maxPct = CPU_ALERT_PCT, maxWaitMs = 45000) {
    if (lastCpuPct < maxPct) return;
    const deadline = Date.now() + maxWaitMs;
    while (lastCpuPct >= maxPct && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}

function startResourceMonitor() {
    if (started) return;
    started = true;

    const loop = monitorEventLoopDelay({ resolution: 20 });
    loop.enable();
    let lastCpu = process.cpuUsage();
    let lastTime = process.hrtime.bigint();

    const timer = setInterval(() => {
        const nowTime = process.hrtime.bigint();
        const cpu = process.cpuUsage(lastCpu);
        const elapsedUs = Number(nowTime - lastTime) / 1000;
        const cpuPct = elapsedUs > 0 ? ((cpu.user + cpu.system) / elapsedUs) * 100 : 0;
        lastCpuPct = cpuPct;
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

        if (cpuPct >= CPU_NTFY_PCT) {
            consecutiveHighCpu++;
            const now = Date.now();
            if (consecutiveHighCpu >= 2 && (now - lastNtfyAlertAt) >= NTFY_COOLDOWN_MS) {
                lastNtfyAlertAt = now;
                try {
                    const { sendNtfyAlert } = require('./errorNotifier.js');
                    sendNtfyAlert({
                        title: `[SENGO] ⚠️ CPU sostenida alta (${cpuPct.toFixed(1)}%)`,
                        priority: 'high',
                        tags: 'warning,fire',
                        message: `${msg}\nRiesgo de detención automática por límite de CPU en Wispbyte.`
                    }).catch(() => {});
                } catch (_) {}
            }
        } else {
            consecutiveHighCpu = 0;
        }
    }, INTERVAL_MS);
    timer.unref();
}

module.exports = { startResourceMonitor, getLastCpuPct, waitIfHighCpu };
