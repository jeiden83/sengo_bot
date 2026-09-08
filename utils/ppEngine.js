const sengoNative = require('sengo-pp');
console.log("[PP-ENGINE] Motor nativo 'sengo-pp' (Rust NAPI) cargado exitosamente.");

/**
 * Obtiene el motor de cálculo de PP (sengo-pp).
 * @returns {Object} El módulo del motor nativo sengo-pp.
 */
function getEngine() {
    return sengoNative;
}

/**
 * Devuelve el nombre del motor activo ('sengo').
 */
function getActiveEngineName() {
    return 'sengo';
}

/**
 * Benchmark o telemetría de rendimiento para el motor nativo sengo-pp.
 * @param {Object} score - Objeto de score normalizado.
 * @param {Object|Buffer} mapInput - Instancia del mapa (Beatmap) o Buffer del archivo .osu.
 * @param {Function} calculateFn - Función calculatePP para ejecutar.
 * @returns {Object} Reporte con latencia de sengo-pp.
 */
function benchmarkEngines(score, mapInput, calculateFn) {
    let mapSengo = mapInput;
    if (Buffer.isBuffer(mapInput) || mapInput instanceof Uint8Array) {
        mapSengo = new sengoNative.Beatmap(mapInput);
    }

    const t0 = process.hrtime.bigint();
    const res = calculateFn(score, mapSengo, null, null, 'sengo');
    const t1 = process.hrtime.bigint();
    const durationMs = Number(t1 - t0) / 1e6;

    return {
        available: true,
        sengo: {
            pp: Number(res?.pp || 0),
            durationMs
        },
        speedup: '1.0x',
        faster: 'sengo-pp (Rust)'
    };
}

module.exports = {
    getEngine,
    getActiveEngineName,
    benchmarkEngines,
    sengoNative,
    
    // Exportaciones directas del motor para compatibilidad drop-in 1:1
    Beatmap: sengoNative.Beatmap,
    Difficulty: sengoNative.Difficulty,
    Performance: sengoNative.Performance,
    BeatmapAttributesBuilder: sengoNative.BeatmapAttributesBuilder,
    GradualPerformance: sengoNative.GradualPerformance,
    GradualDifficulty: sengoNative.GradualDifficulty,
    GameMode: sengoNative.GameMode,
    Strains: sengoNative.Strains,
    HitResultPriority: sengoNative.HitResultPriority,
    PerformanceAttributes: sengoNative.PerformanceAttributes,
    DifficultyAttributes: sengoNative.DifficultyAttributes
};

