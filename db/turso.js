const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const dbUrl = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const dbHostname = dbUrl ? dbUrl.replace(/^libsql:\/\//, '').replace(/\/$/, '') : null;

function isTursoAvailable() {
    return Boolean(dbHostname && authToken);
}

async function executeTurso(sql, args = []) {
    if (!isTursoAvailable()) {
        throw new Error("Turso no está configurado (faltan TURSO_DATABASE_URL o TURSO_AUTH_TOKEN)");
    }

    const formattedArgs = args.map(a => {
        if (a === null || a === undefined) return { type: "null" };
        if (typeof a === 'number') {
            if (Number.isInteger(a)) {
                return { type: "integer", value: String(a) };
            } else {
                return { type: "float", value: a };
            }
        }
        if (typeof a === 'boolean') {
            return { type: "integer", value: a ? "1" : "0" };
        }
        return { type: "text", value: String(a) };
    });

    const response = await axios.post(`https://${dbHostname}/v2/pipeline`, {
        requests: [{ type: "execute", stmt: { sql, args: formattedArgs } }]
    }, {
        headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
        },
        timeout: 10000
    });

    const result = response.data?.results?.[0]?.response?.result;
    if (!result) return [];

    const cols = result.cols.map(c => c.name);
    return result.rows.map(row => {
        const obj = {};
        row.forEach((cell, idx) => {
            const colName = cols[idx];
            if (cell.type === 'null') {
                obj[colName] = null;
            } else if (cell.type === 'integer') {
                obj[colName] = parseInt(cell.value, 10);
            } else if (cell.type === 'float') {
                obj[colName] = parseFloat(cell.value);
            } else {
                obj[colName] = cell.value;
            }
        });
        return obj;
    });
}

const topsCache = new Map();
const countCache = new Map();
const snipesCache = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutos

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
    const cacheKey = `${userId}:${mode}:${countryCode}:${detailed}`;
    const cached = getCachedItem(topsCache, cacheKey);
    if (cached) {
        if (onPageLoad) onPageLoad(cached.length);
        return cached;
    }

    const sql = `
        SELECT 
            t.pp, t.mods, t.ended_at, t.score, t.accuracy, t.beatmap_id, t.max_combo, t.perfect, 
            t.statistics, t.rank, t.build_id, t.mod_settings,
            b.mode, b.title, b.artist, b.version, b.creator, b.stars, b.bpm, b.ar, b.od, b.cs, b.hp, b.beatmapset_id, b.max_combo as b_max_combo
        FROM top_scores t
        INNER JOIN ranked_beatmaps b ON t.beatmap_id = b.beatmap_id
        WHERE t.user_id = ? AND b.mode = ? AND t.country_code = ?
    `;

    const rows = await executeTurso(sql, [userId.toString(), mode, countryCode]);

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
                max_combo: r.b_max_combo
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
    const cacheKey = `${userId}:${mode}:${countryCode}`;
    const cached = getCachedItem(countCache, cacheKey);
    if (cached !== null) {
        return cached;
    }

    const sql = `
        SELECT COUNT(*) as count
        FROM top_scores t
        INNER JOIN ranked_beatmaps b ON t.beatmap_id = b.beatmap_id
        WHERE t.user_id = ? AND b.mode = ? AND t.country_code = ?
    `;
    const rows = await executeTurso(sql, [userId.toString(), mode, countryCode]);
    const cnt = rows[0]?.count || 0;
    setCachedItem(countCache, cacheKey, cnt);
    return cnt;
}

/**
 * Historial de snipes hecho y recibido en Turso
 */
async function getUserSnipesHistory(userId) {
    const cacheKey = userId.toString();
    const cached = getCachedItem(snipesCache, cacheKey);
    if (cached) {
        return cached;
    }

    const sqlMade = `
        SELECT s.sniped_name, s.sniped_id, s.beatmap_id, s.pp, s.ended_at, b.title, b.version
        FROM snipes_history s
        LEFT JOIN ranked_beatmaps b ON s.beatmap_id = b.beatmap_id
        WHERE s.sniper_id = ?
        ORDER BY s.ended_at DESC
    `;

    const sqlReceived = `
        SELECT s.sniper_name, s.sniper_id, s.beatmap_id, s.pp, s.ended_at, b.title, b.version
        FROM snipes_history s
        LEFT JOIN ranked_beatmaps b ON s.beatmap_id = b.beatmap_id
        WHERE s.sniped_id = ?
        ORDER BY s.ended_at DESC
    `;

    const [rowsMade, rowsReceived] = await Promise.all([
        executeTurso(sqlMade, [userId.toString()]),
        executeTurso(sqlReceived, [userId.toString()])
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
 * Guarda o actualiza un score en top_scores en Turso
 */
async function saveTopScore(s) {
    const sql = `
        INSERT OR REPLACE INTO top_scores 
        (beatmap_id, country_code, user_id, username, score, pp, accuracy, mods, ended_at, updated_at, max_combo, perfect, statistics, rank, build_id, mod_settings) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const args = [
        s.beatmap_id,
        s.country_code || 'VE',
        s.user_id,
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
        const uStr = s.user_id.toString();
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
    const endedAt = sh.ended_at || new Date().toISOString();
    try {
        const checkSql = `SELECT id FROM snipes_history WHERE beatmap_id = ? AND sniper_id = ? AND sniped_id = ? AND ended_at = ? LIMIT 1`;
        const existing = await executeTurso(checkSql, [
            sh.beatmap_id.toString(),
            sh.sniper_id.toString(),
            sh.sniped_id.toString(),
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
        sh.sniper_id,
        sh.sniper_name,
        sh.sniped_id,
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
        b.mode || 0,
        b.title || '',
        b.artist || '',
        b.version || '',
        b.creator || '',
        b.stars || b.difficulty_rating || 0,
        b.bpm || 0,
        b.ar || 0,
        b.od || b.accuracy || 0,
        b.cs || 0,
        b.hp || b.drain || 0,
        b.max_combo || 0,
        b.status || '',
        new Date().toISOString()
    ];
    await executeTurso(sql, args);
}

module.exports = {
    isTursoAvailable,
    executeTurso,
    getUserNationalTops,
    getUserNationalTopsCount,
    getUserSnipesHistory,
    getTopScoreForBeatmap,
    getBeatmapFromTurso,
    saveTopScore,
    recordSnipe,
    saveBeatmap
};
