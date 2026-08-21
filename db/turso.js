const { createClient } = require('@libsql/client');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

let tursoClient = null;
let currentDbUrl = null;
let currentAuthToken = null;

function getClient() {
    const rawDbUrl = process.env.TURSO_DATABASE_URL || '';
    const rawAuthToken = process.env.TURSO_AUTH_TOKEN || '';
    const dbUrl = rawDbUrl.replace(/^["']|["']$/g, '').trim();
    const authToken = rawAuthToken.replace(/^["']|["']$/g, '').trim();

    if (!dbUrl || !authToken) return null;

    if (!tursoClient || currentDbUrl !== dbUrl || currentAuthToken !== authToken) {
        currentDbUrl = dbUrl;
        currentAuthToken = authToken;
        tursoClient = createClient({ url: dbUrl, authToken: authToken });
    }
    return tursoClient;
}

function isTursoAvailable() {
    return Boolean(getClient());
}

async function executeTurso(sql, args = []) {
    const client = getClient();
    if (!client) {
        throw new Error("Turso no está configurado (faltan TURSO_DATABASE_URL o TURSO_AUTH_TOKEN)");
    }
    const result = await client.execute({ sql, args });
    return result.rows || [];
}

async function executeTursoBatch(statements) {
    const client = getClient();
    if (!client || !statements || statements.length === 0) return [];

    const stmts = statements.map(s => ({ sql: s.sql, args: s.args || [] }));
    const results = await client.batch(stmts, "write");
    return results || [];
}

const topsCache = new Map();
const countCache = new Map();
const snipesCache = new Map();
const scoreRamDedupeCache = new Map();
const MAX_DEDUPE_CACHE_SIZE = 250000;
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutos

let tursoIndexesEnsured = false;
async function ensureTursoIndexes() {
    if (tursoIndexesEnsured || !isTursoAvailable()) return;
    tursoIndexesEnsured = true;
    try {
        const statements = [
            { sql: `CREATE INDEX IF NOT EXISTS idx_top_scores_country_map ON top_scores(country_code, beatmap_id)` },
            { sql: `CREATE INDEX IF NOT EXISTS idx_top_scores_user_country ON top_scores(user_id, country_code)` },
            { sql: `CREATE INDEX IF NOT EXISTS idx_snipes_sniper ON snipes_history(sniper_id)` },
            { sql: `CREATE INDEX IF NOT EXISTS idx_snipes_sniped ON snipes_history(sniped_id)` },
            { sql: `CREATE INDEX IF NOT EXISTS idx_ranked_beatmaps_mode ON ranked_beatmaps(mode, status)` }
        ];
        await executeTursoBatch(statements);
    } catch (e) {
        console.error('[Turso] Error asegurando índices en Turso DB:', e.message);
    }
}

function getCachedItem(cacheMap, key) {
    const item = cacheMap.get(key);
    if (item && (Date.now() - item.timestamp) < CACHE_TTL_MS) {
        return item.data;
    }
    return null;
}

function setCachedItem(cacheMap, key, data) {
    cacheMap.set(key, { data, timestamp: Date.now() });
    if (cacheMap.size > 100) {
        const firstKey = cacheMap.keys().next().value;
        cacheMap.delete(firstKey);
    }
}

/**
 * Obtiene las puntuaciones nacionales (#1) de un usuario en un modo específico y país desde Turso
 */
async function getUserNationalTops(userId, mode, countryCode = 'VE', detailed = false, onPageLoad = null) {
    const cleanId = userId.toString().replace(/\.0+$/, '');
    const altId = cleanId + '.0';
    const cacheKey = `${cleanId}:${mode}:${countryCode}:${detailed}`;
    const cached = getCachedItem(topsCache, cacheKey);
    if (cached) {
        if (onPageLoad) onPageLoad(cached.length);
        return cached;
    }

    const sql = `
        SELECT 
            t.pp, t.mods, t.ended_at, t.score, t.accuracy, t.beatmap_id, t.max_combo, t.perfect, 
            t.statistics, t.rank, t.build_id, t.mod_settings,
            b.mode, b.title, b.artist, b.version, b.creator, b.stars, b.bpm, b.ar, b.od, b.cs, b.hp, b.beatmapset_id, b.max_combo as b_max_combo, b.status
        FROM top_scores t
        INNER JOIN ranked_beatmaps b ON t.beatmap_id = b.beatmap_id
        WHERE (t.user_id = ? OR t.user_id = ?) AND b.mode = ? AND t.country_code = ?
    `;

    const rows = await executeTurso(sql, [cleanId, altId, mode, countryCode]);

    const formatted = rows.map(r => {
        let statsObj = r.statistics;
        if (typeof statsObj === 'string' && statsObj) {
            try { statsObj = JSON.parse(statsObj); } catch (e) {}
        }
        let modSettingsObj = r.mod_settings;
        if (typeof modSettingsObj === 'string' && modSettingsObj) {
            try { modSettingsObj = JSON.parse(modSettingsObj); } catch (e) {}
        }

        return {
            pp: r.pp,
            mods: r.mods || 'NM',
            ended_at: r.ended_at,
            score: r.score,
            accuracy: r.accuracy,
            beatmap_id: r.beatmap_id,
            max_combo: r.max_combo,
            perfect: Boolean(r.perfect),
            statistics: statsObj,
            rank: r.rank,
            build_id: r.build_id,
            mod_settings: modSettingsObj,
            ranked_beatmaps: {
                mode: r.mode,
                title: r.title,
                artist: r.artist,
                version: r.version,
                creator: r.creator,
                stars: r.stars,
                bpm: r.bpm,
                ar: r.ar,
                od: r.od,
                cs: r.cs,
                hp: r.hp,
                beatmapset_id: r.beatmapset_id,
                max_combo: r.b_max_combo,
                status: r.status,
                ranked_status: r.status === 'loved' ? 4 : (r.status === 'ranked' ? 1 : (r.status === 'approved' ? 2 : (r.status === 'qualified' ? 3 : null)))
            }
        };
    });

    setCachedItem(topsCache, cacheKey, formatted);

    if (onPageLoad) {
        onPageLoad(formatted.length);
    }

    return formatted;
}

/**
 * Conteo de tops nacionales en Turso
 */
async function getUserNationalTopsCount(userId, mode, countryCode = 'VE') {
    const cleanId = userId.toString().replace(/\.0+$/, '');
    const altId = cleanId + '.0';
    const cacheKey = `${cleanId}:${mode}:${countryCode}`;
    const cached = getCachedItem(countCache, cacheKey);
    if (cached !== null) {
        return cached;
    }

    const sql = `
        SELECT COUNT(*) as count
        FROM top_scores t
        INNER JOIN ranked_beatmaps b ON t.beatmap_id = b.beatmap_id
        WHERE (t.user_id = ? OR t.user_id = ?) AND b.mode = ? AND t.country_code = ?
    `;
    const rows = await executeTurso(sql, [cleanId, altId, mode, countryCode]);
    const cnt = rows[0]?.count || 0;
    setCachedItem(countCache, cacheKey, cnt);
    return cnt;
}

/**
 * Historial de snipes hecho y recibido en Turso
 */
async function getUserSnipesHistory(userId) {
    const cleanId = userId.toString().replace(/\.0+$/, '');
    const altId = cleanId + '.0';
    const cacheKey = cleanId;
    const cached = getCachedItem(snipesCache, cacheKey);
    if (cached && cached.made && cached.received) {
        const hasMissing = cached.made.some(m => !m.ranked_beatmaps?.title) || cached.received.some(r => !r.ranked_beatmaps?.title);
        if (!hasMissing) {
            return cached;
        }
    }

    const sqlMade = `
        SELECT s.sniped_name, s.sniped_id, s.beatmap_id, s.pp, s.ended_at, b.title, b.version
        FROM snipes_history s
        LEFT JOIN ranked_beatmaps b ON s.beatmap_id = b.beatmap_id
        WHERE (s.sniper_id = ? OR s.sniper_id = ?) AND s.sniped_id != '0' AND s.sniped_id != '0.0' AND s.sniped_name != 'SYSTEM_NO_SCORE'
        ORDER BY s.ended_at DESC
    `;

    const sqlReceived = `
        SELECT s.sniper_name, s.sniper_id, s.beatmap_id, s.pp, s.ended_at, b.title, b.version
        FROM snipes_history s
        LEFT JOIN ranked_beatmaps b ON s.beatmap_id = b.beatmap_id
        WHERE (s.sniped_id = ? OR s.sniped_id = ?) AND s.sniper_id != '0' AND s.sniper_id != '0.0' AND s.sniper_name != 'SYSTEM_NO_SCORE'
        ORDER BY s.ended_at DESC
    `;

    const [rowsMade, rowsReceived] = await Promise.all([
        executeTurso(sqlMade, [cleanId, altId]),
        executeTurso(sqlReceived, [cleanId, altId])
    ]);

    const made = rowsMade.map(r => ({
        sniped_name: r.sniped_name,
        sniped_id: r.sniped_id,
        beatmap_id: r.beatmap_id,
        pp: r.pp,
        ended_at: r.ended_at,
        ranked_beatmaps: { title: r.title, version: r.version }
    }));

    const received = rowsReceived.map(r => ({
        sniper_name: r.sniper_name,
        sniper_id: r.sniper_id,
        beatmap_id: r.beatmap_id,
        pp: r.pp,
        ended_at: r.ended_at,
        ranked_beatmaps: { title: r.title, version: r.version }
    }));

    // Enriquecer mapas a los que les falte título consultando Supabase y sincronizando a Turso
    const missingIds = Array.from(new Set([
        ...made.filter(m => !m.ranked_beatmaps?.title).map(m => m.beatmap_id),
        ...received.filter(r => !r.ranked_beatmaps?.title).map(r => r.beatmap_id)
    ]));

    if (missingIds.length > 0) {
        try {
            const { getSupabaseClient } = require('./database.js');
            const supabase = getSupabaseClient();
            if (supabase) {
                const { data: supaMaps } = await supabase
                    .from('ranked_beatmaps')
                    .select('beatmap_id, beatmapset_id, mode, title, artist, version, creator, stars, bpm, ar, od, cs, hp, max_combo, status')
                    .in('beatmap_id', missingIds.map(id => Number(id)));

                if (supaMaps && supaMaps.length > 0) {
                    const mapDict = {};
                    await Promise.all(supaMaps.map(async (bm) => {
                        mapDict[String(bm.beatmap_id)] = bm;
                        try {
                            await saveBeatmap(bm);
                        } catch (e) {}
                    }));

                    for (const m of made) {
                        const bm = mapDict[String(m.beatmap_id)];
                        if (bm) {
                            m.ranked_beatmaps = {
                                title: bm.title,
                                version: bm.version
                            };
                        }
                    }
                    for (const r of received) {
                        const bm = mapDict[String(r.beatmap_id)];
                        if (bm) {
                            r.ranked_beatmaps = {
                                title: bm.title,
                                version: bm.version
                            };
                        }
                    }
                }
            }
        } catch (enrichErr) {
            console.error('[Turso] Error enriqueciendo metadata de mapas en getUserSnipesHistory:', enrichErr);
        }
    }

    const res = { made, received };
    setCachedItem(snipesCache, cacheKey, res);
    return res;
}

/**
 * Obtiene la puntuación #1 actual de un mapa específico en Turso
 */
async function getTopScoreForBeatmap(beatmapId, countryCode = 'VE') {
    const sql = `SELECT * FROM top_scores WHERE beatmap_id = ? AND country_code = ? LIMIT 1`;
    const rows = await executeTurso(sql, [beatmapId.toString(), countryCode]);
    return rows[0] || null;
}

/**
 * Obtiene metadata de un mapa ranked en Turso
 */
async function getBeatmapFromTurso(beatmapId) {
    const sql = `SELECT * FROM ranked_beatmaps WHERE beatmap_id = ? LIMIT 1`;
    const rows = await executeTurso(sql, [beatmapId.toString()]);
    return rows[0] || null;
}

/**
 * Guarda un score #1 en top_scores en Turso (optimizado para evitar escrituras si no cambió)
 */
async function saveTopScore(s) {
    const sql = `
        INSERT INTO top_scores 
        (beatmap_id, country_code, user_id, username, score, pp, accuracy, mods, ended_at, updated_at, max_combo, perfect, statistics, rank, build_id, mod_settings) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(beatmap_id, country_code) DO UPDATE SET 
            user_id = excluded.user_id,
            username = excluded.username,
            score = excluded.score,
            pp = excluded.pp,
            accuracy = excluded.accuracy,
            mods = excluded.mods,
            ended_at = excluded.ended_at,
            updated_at = excluded.updated_at,
            max_combo = excluded.max_combo,
            perfect = excluded.perfect,
            statistics = excluded.statistics,
            rank = excluded.rank,
            build_id = excluded.build_id,
            mod_settings = excluded.mod_settings
        WHERE top_scores.score != excluded.score 
           OR top_scores.user_id != excluded.user_id 
           OR top_scores.pp != excluded.pp
    `;
    const cleanUserId = (s.user_id || '0').toString().replace(/\.0+$/, '');
    const args = [
        s.beatmap_id,
        s.country_code || 'VE',
        cleanUserId,
        s.username || '',
        s.score || 0,
        s.pp || 0,
        s.accuracy || 0,
        s.mods || 'NM',
        s.ended_at || new Date().toISOString(),
        new Date().toISOString(),
        s.max_combo || 0,
        s.perfect ? 1 : 0,
        typeof s.statistics === 'object' ? JSON.stringify(s.statistics) : (s.statistics || ''),
        s.rank || '',
        s.build_id || 0,
        typeof s.mod_settings === 'object' ? JSON.stringify(s.mod_settings) : (s.mod_settings || '')
    ];
    await executeTurso(sql, args);

    if (s.user_id) {
        const uStr = cleanUserId;
        for (const k of topsCache.keys()) {
            if (k.startsWith(uStr + ':')) topsCache.delete(k);
        }
        for (const k of countCache.keys()) {
            if (k.startsWith(uStr + ':')) countCache.delete(k);
        }
    }
}

/**
 * Registra un snipe en snipes_history en Turso
 */
async function recordSnipe(sh) {
    if (!sh || !sh.sniped_id || sh.sniped_id.toString() === '0' || sh.sniped_name === 'SYSTEM_NO_SCORE' || !sh.sniper_id || sh.sniper_id.toString() === '0' || sh.sniper_name === 'SYSTEM_NO_SCORE') {
        return;
    }
    const cleanSniperId = sh.sniper_id.toString().replace(/\.0+$/, '');
    const cleanSnipedId = sh.sniped_id.toString().replace(/\.0+$/, '');
    const endedAt = sh.ended_at || new Date().toISOString();
    try {
        const checkSql = `SELECT id FROM snipes_history WHERE beatmap_id = ? AND sniper_id = ? AND sniped_id = ? AND ended_at = ? LIMIT 1`;
        const existing = await executeTurso(checkSql, [
            sh.beatmap_id.toString(),
            cleanSniperId,
            cleanSnipedId,
            endedAt
        ]);
        if (existing && existing.length > 0) return;
    } catch (e) {
        // Si falla la verificación, la restricción UNIQUE de la base de datos lo protegerá
    }

    const sql = `
        INSERT OR IGNORE INTO snipes_history 
        (beatmap_id, sniper_id, sniper_name, sniped_id, sniped_name, pp, ended_at, country_code) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const args = [
        sh.beatmap_id,
        cleanSniperId,
        sh.sniper_name,
        cleanSnipedId,
        sh.sniped_name,
        sh.pp || 0,
        endedAt,
        sh.country_code || 'VE'
    ];
    await executeTurso(sql, args);

    if (sh.sniper_id) snipesCache.delete(sh.sniper_id.toString());
    if (sh.sniped_id) snipesCache.delete(sh.sniped_id.toString());
}

/**
 * Guarda un mapa ranked en ranked_beatmaps en Turso
 */
async function saveBeatmap(b) {
    const sql = `
        INSERT OR REPLACE INTO ranked_beatmaps 
        (beatmap_id, beatmapset_id, mode, title, artist, version, creator, stars, bpm, ar, od, cs, hp, max_combo, status, updated_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const args = [
        b.beatmap_id || b.id,
        b.beatmapset_id || b.set_id || 0,
        b.mode !== undefined ? b.mode : 0,
        b.title || '',
        b.artist || '',
        b.version || '',
        b.creator || '',
        b.stars || b.difficulty_rating || 0,
        b.bpm || 0,
        b.ar || 0,
        b.od !== undefined ? b.od : (b.accuracy || 0),
        b.cs || 0,
        b.hp !== undefined ? b.hp : (b.drain || 0),
        b.max_combo || 0,
        b.status || b.ranked_status || '',
        new Date().toISOString()
    ];
    await executeTurso(sql, args);
}

async function saveBeatmapsBatch(beatmaps = []) {
    if (!isTursoAvailable() || beatmaps.length === 0) return 0;
    const statements = beatmaps.map(b => ({
        sql: `
            INSERT OR REPLACE INTO ranked_beatmaps 
            (beatmap_id, beatmapset_id, mode, title, artist, version, creator, stars, bpm, ar, od, cs, hp, max_combo, status, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
            b.beatmap_id || b.id,
            b.beatmapset_id || b.set_id || 0,
            b.mode !== undefined ? b.mode : 0,
            b.title || '',
            b.artist || '',
            b.version || '',
            b.creator || '',
            b.stars || b.difficulty_rating || 0,
            b.bpm || 0,
            b.ar || 0,
            b.od !== undefined ? b.od : (b.accuracy || 0),
            b.cs || 0,
            b.hp !== undefined ? b.hp : (b.drain || 0),
            b.max_combo || 0,
            b.status || b.ranked_status || '',
            new Date().toISOString()
        ]
    }));

    for (let i = 0; i < statements.length; i += 100) {
        const chunk = statements.slice(i, i + 100);
        await executeTursoBatch(chunk);
    }
    return statements.length;
}

/**
 * Guarda un lote de scores y snipes en una sola llamada masiva HTTP a Turso
 */
async function saveBatchScoresAndSnipes(scoresToSave = [], snipesToRecord = []) {
    if (!isTursoAvailable()) return 0;
    
    await ensureTursoIndexes();

    const statements = [];
    const nowIso = new Date().toISOString();

    for (const s of scoresToSave) {
        const country = s.country_code || 'VE';
        const dedupeKey = `${country}:${s.beatmap_id}`;
        const dedupeSig = `${s.user_id}:${s.score || 0}:${s.pp || 0}:${s.mods || 'NM'}`;

        // Deduplicación en memoria RAM: omitir escrituras SQL si la puntuación es idéntica a la guardada previamente
        if (scoreRamDedupeCache.get(dedupeKey) === dedupeSig) {
            continue;
        }

        scoreRamDedupeCache.set(dedupeKey, dedupeSig);
        if (scoreRamDedupeCache.size > MAX_DEDUPE_CACHE_SIZE) {
            const firstKey = scoreRamDedupeCache.keys().next().value;
            scoreRamDedupeCache.delete(firstKey);
        }

        statements.push({
            sql: `
                INSERT INTO top_scores 
                (beatmap_id, country_code, user_id, username, score, pp, accuracy, mods, ended_at, updated_at, max_combo, perfect, statistics, rank, build_id, mod_settings) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(beatmap_id, country_code) DO UPDATE SET 
                    user_id = excluded.user_id,
                    username = excluded.username,
                    score = excluded.score,
                    pp = excluded.pp,
                    accuracy = excluded.accuracy,
                    mods = excluded.mods,
                    ended_at = excluded.ended_at,
                    updated_at = excluded.updated_at,
                    max_combo = excluded.max_combo,
                    perfect = excluded.perfect,
                    statistics = excluded.statistics,
                    rank = excluded.rank,
                    build_id = excluded.build_id,
                    mod_settings = excluded.mod_settings
                WHERE top_scores.score != excluded.score 
                   OR top_scores.user_id != excluded.user_id 
                   OR top_scores.pp != excluded.pp
            `,
            args: [
                s.beatmap_id,
                country,
                s.user_id,
                s.username || '',
                s.score || 0,
                s.pp || 0,
                s.accuracy || 0,
                s.mods || 'NM',
                s.ended_at || nowIso,
                nowIso,
                s.max_combo || 0,
                s.perfect ? 1 : 0,
                typeof s.statistics === 'object' ? JSON.stringify(s.statistics) : (s.statistics || ''),
                s.rank || '',
                s.build_id || 0,
                typeof s.mod_settings === 'object' ? JSON.stringify(s.mod_settings) : (s.mod_settings || '')
            ]
        });

        if (s.user_id) {
            const uStr = s.user_id.toString();
            for (const k of topsCache.keys()) {
                if (k.startsWith(uStr + ':')) topsCache.delete(k);
            }
            for (const k of countCache.keys()) {
                if (k.startsWith(uStr + ':')) countCache.delete(k);
            }
        }
    }

    for (const sh of snipesToRecord) {
        const endedAt = sh.ended_at || nowIso;
        statements.push({
            sql: `
                INSERT OR IGNORE INTO snipes_history 
                (beatmap_id, sniper_id, sniper_name, sniped_id, sniped_name, pp, ended_at, country_code) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
                sh.beatmap_id,
                sh.sniper_id,
                sh.sniper_name,
                sh.sniped_id,
                sh.sniped_name || 'Jugador',
                sh.pp || 0,
                endedAt,
                sh.country_code || 'VE'
            ]
        });

        if (sh.sniper_id) snipesCache.delete(sh.sniper_id.toString());
        if (sh.sniped_id) snipesCache.delete(sh.sniped_id.toString());
    }

    if (statements.length === 0) return 0;

    for (let i = 0; i < statements.length; i += 100) {
        const chunk = statements.slice(i, i + 100);
        await executeTursoBatch(chunk);
    }

    return scoresToSave.length;
}

module.exports = {
    isTursoAvailable,
    executeTurso,
    executeTursoBatch,
    getUserNationalTops,
    getUserNationalTopsCount,
    getUserSnipesHistory,
    getTopScoreForBeatmap,
    getBeatmapFromTurso,
    saveTopScore,
    recordSnipe,
    saveBeatmap,
    saveBeatmapsBatch,
    saveBatchScoresAndSnipes
};
