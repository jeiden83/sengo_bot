let sengoNative = null;
let rosuWasm = null;

// 1. Intentar cargar el motor nativo de Rust (sengo-pp)
try {
    sengoNative = require('sengo-pp');
    console.log("[PP-ENGINE] Motor nativo 'sengo-pp' (Rust NAPI) cargado exitosamente.");
} catch (err) {
    console.warn("[PP-ENGINE] Advertencia: No se pudo cargar el motor nativo 'sengo-pp' (Rust). Motivo:", err.message);
}

// 2. Intentar cargar el motor WebAssembly (rosu-pp-js) como respaldo
try {
    rosuWasm = require('rosu-pp-js');
    if (!sengoNative) {
        console.log("[PP-ENGINE] Usando motor de respaldo 'rosu-pp-js' (WASM).");
    }
} catch (err) {
    if (!sengoNative) {
        console.error("[PP-ENGINE] Error al cargar motor de respaldo 'rosu-pp-js' (WASM):", err.message);
    }
}

if (!sengoNative && !rosuWasm) {
    throw new Error("[PP-ENGINE] Error crítico: No se pudo cargar ni 'sengo-pp' (Rust) ni 'rosu-pp-js' (WASM).");
}

const defaultEngine = sengoNative || rosuWasm;
const defaultEngineName = sengoNative ? 'sengo' : 'rosu';

/**
 * Obtiene el motor de cálculo de PP seleccionado.
 * @param {string|null} requestedEngine - 'sengo' o 'rosu'. Si no se especifica, usa el predeterminado (sengo-pp).
 * @returns {Object} El módulo del motor de PP.
 */
function getEngine(requestedEngine = null) {
    if (requestedEngine) {
        const clean = requestedEngine.toString().toLowerCase().trim();
        if (clean === 'rosu' || clean === 'wasm' || clean === 'legacy') {
            if (rosuWasm) return rosuWasm;
        }
        if (clean === 'sengo' || clean === 'native' || clean === 'rust') {
            if (sengoNative) return sengoNative;
        }
    }
    return defaultEngine;
}

/**
 * Devuelve el nombre del motor activo por defecto ('sengo' o 'rosu').
 */
function getActiveEngineName(requestedEngine = null) {
    if (requestedEngine) {
        const clean = requestedEngine.toString().toLowerCase().trim();
        if ((clean === 'rosu' || clean === 'wasm') && rosuWasm) return 'rosu';
        if ((clean === 'sengo' || clean === 'rust') && sengoNative) return 'sengo';
    }
    return defaultEngineName;
}

/**
 * Ejecuta un benchmark comparativo de latencia y precisión entre ambos motores (sengo vs rosu).
 * @param {Object} score - Objeto de score normalizado.
 * @param {Object|Buffer} mapInput - Instancia del mapa (Beatmap) o Buffer del archivo .osu.
 * @param {Function} calculateFn - Función calculatePP para ejecutar.
 * @param {Object} [mapRosuInput] - Instancia opcional del mapa para rosu-pp-js si mapInput es nativo.
 * @returns {Object} Reporte con latencia de ambos motores, speedup y delta de PP.
 */
function benchmarkEngines(score, mapInput, calculateFn, mapRosuInput = null) {
    if (!sengoNative || !rosuWasm) {
        return {
            available: false,
            message: "Se requieren ambos motores ('sengo-pp' y 'rosu-pp-js') para ejecutar el benchmark."
        };
    }

    let mapSengo = mapInput;
    let mapRosu = mapRosuInput || mapInput;

    if (Buffer.isBuffer(mapInput) || mapInput instanceof Uint8Array) {
        mapSengo = new sengoNative.Beatmap(mapInput);
        mapRosu = new rosuWasm.Beatmap(mapInput);
    }

    // 1. Ejecución con sengo-pp
    const t0_sengo = process.hrtime.bigint();
    const res_sengo = calculateFn(score, mapSengo, null, null, 'sengo');
    const t1_sengo = process.hrtime.bigint();
    const durationSengoMs = Number(t1_sengo - t0_sengo) / 1e6;

    // 2. Ejecución con rosu-pp-js
    let res_rosu = null;
    let durationRosuMs = 0;
    try {
        const t0_rosu = process.hrtime.bigint();
        res_rosu = calculateFn(score, mapRosu, null, null, 'rosu');
        const t1_rosu = process.hrtime.bigint();
        durationRosuMs = Number(t1_rosu - t0_rosu) / 1e6;
    } catch (errRosu) {
        // En caso de que se haya pasado un mapa exclusivo de sengo sin buffer
    }

    const ppSengo = Number(res_sengo?.pp || 0);
    const ppRosu = Number(res_rosu?.pp || 0);
    const ppDelta = Math.abs(ppSengo - ppRosu);
    const speedup = (durationSengoMs > 0 && durationRosuMs > 0) ? (durationRosuMs / durationSengoMs).toFixed(1) : '1.0';

    return {
        available: true,
        sengo: {
            pp: ppSengo,
            durationMs: durationSengoMs
        },
        rosu: {
            pp: ppRosu,
            durationMs: durationRosuMs
        },
        ppDelta,
        speedup: `${speedup}x`,
        faster: durationSengoMs <= durationRosuMs ? 'sengo-pp (Rust)' : 'rosu-pp-js (WASM)'
    };
}

module.exports = {
    getEngine,
    getActiveEngineName,
    benchmarkEngines,
    sengoNative,
    rosuWasm,
    
    // Exportaciones directas del motor por defecto para compatibilidad drop-in 1:1
    Beatmap: defaultEngine.Beatmap,
    Difficulty: defaultEngine.Difficulty,
    Performance: defaultEngine.Performance,
    BeatmapAttributesBuilder: defaultEngine.BeatmapAttributesBuilder,
    GradualPerformance: defaultEngine.GradualPerformance,
    GradualDifficulty: defaultEngine.GradualDifficulty,
    GameMode: defaultEngine.GameMode,
    Strains: defaultEngine.Strains,
    HitResultPriority: defaultEngine.HitResultPriority,
    PerformanceAttributes: defaultEngine.PerformanceAttributes,
    DifficultyAttributes: defaultEngine.DifficultyAttributes
};
