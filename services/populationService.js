const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const crypto = require('crypto');
const { getSupabaseClient } = require('../db/database.js');
const OsuUserModel = require('../models/OsuUserModel.js');
const TursoDB = require('../db/turso.js');

const activeSessions = new Map(); // countryCode -> { countryCode, isStopped: false, activeWorkers: Set }
const activeWorkerKeys = new Map(); // workerKey -> { discordId, username, countryCode, createdAt }
const allowedCountries = new Set(); // Países expresamente habilitados por el Owner con s.populate -permitir
const countryScrapedCounts = new Map(); // Contador en RAM para evitar consumo de cuota de Turso
const scrapedBeatmapSets = new Map(); // country -> Set<number>
const scrapedSetTTL = new Map(); // country -> timestamp
let lastTursoSyncTime = 0;

class PopulationService {
    /**
     * Habilita un país para su poblamiento (Exclusivo de Owner - Persistente en DB)
     */
    static async allowCountry(countryCode) {
        const country = countryCode.toUpperCase();
        allowedCountries.add(country);

        if (!activeSessions.has(country)) {
            activeSessions.set(country, { countryCode: country, isStopped: false, activeWorkers: new Set() });
        } else {
            const session = activeSessions.get(country);
            session.isStopped = false;
        }

        // Persistir en Supabase
        try {
            const supabase = getSupabaseClient();
            if (supabase) {
                await supabase
                    .from('scraped_countries')
                    .upsert({ country_code: country, is_allowed: true }, { onConflict: 'country_code' });
            }
        } catch (e) {
            console.error(`Error guardando permiso para ${country} en Supabase:`, e.message);
        }

        return true;
    }

    /**
     * Verifica si un país está permitido por el Owner (RAM + DB Fallback)
     */
    static async isCountryAllowed(countryCode) {
        const country = countryCode.toUpperCase();
        if (allowedCountries.has(country)) return true;

        try {
            const supabase = getSupabaseClient();
            if (supabase) {
                const { data } = await supabase
                    .from('scraped_countries')
                    .select('is_allowed')
                    .eq('country_code', country)
                    .maybeSingle();

                if (data && data.is_allowed) {
                    allowedCountries.add(country);
                    return true;
                }
            }
        } catch (e) {
            console.error("Error verificando permiso en Supabase:", e.message);
        }

        return false;
    }

    /**
     * Limpia automáticamente las Worker Keys inactivas por más de maxInactiveMs (por defecto 30 minutos).
     * Preserva intactas las contribuciones acumuladas en population_contributors (puntos e historial de s.populate -top).
     */
    static async cleanupInactiveWorkerKeys(maxInactiveMs = 30 * 60 * 1000) {
        const now = Date.now();
        const cutoffTime = now - maxInactiveMs;
        const cutoffIso = new Date(cutoffTime).toISOString();
        let deletedCount = 0;

        const supabase = getSupabaseClient();
        if (supabase) {
            try {
                const { data: dbDeleted } = await supabase
                    .from('population_workers')
                    .delete()
                    .lt('last_active_at', cutoffIso)
                    .select('worker_key, country_code, username');

                if (dbDeleted && dbDeleted.length > 0) {
                    deletedCount += dbDeleted.length;
                    for (const w of dbDeleted) {
                        activeWorkerKeys.delete(w.worker_key);
                        const session = activeSessions.get(w.country_code);
                        if (session && session.activeWorkers) {
                            session.activeWorkers.delete(w.username);
                        }
                    }
                }
            } catch (e) {
                console.error("Error limpiando worker keys inactivas en Supabase:", e.message);
            }
        }

        // Sincronizar en memoria RAM
        for (const [key, w] of activeWorkerKeys.entries()) {
            const lastActive = w.lastActiveAt || w.createdAt || 0;
            if ((now - lastActive) > maxInactiveMs) {
                activeWorkerKeys.delete(key);
                const session = activeSessions.get(w.countryCode);
                if (session && session.activeWorkers) {
                    session.activeWorkers.delete(w.username);
                }
                deletedCount++;
            }
        }

        return deletedCount;
    }

    /**
     * Elimina manualmente una o varias Worker Keys para liberar espacio (Exclusivo de Owner).
     * Solo remueve la sesión de trabajo activa (population_workers/RAM); no elimina récords ni puntos en population_contributors.
     * @param {string} target Key específica (sengo_wk_...), Código de País (ej: AR), o "inactivos"
     */
    static async deleteWorkerKey(target) {
        if (!target) return { deleted: 0, mode: 'none' };
        const strTarget = String(target).trim();
        const supabase = getSupabaseClient();
        let deletedCount = 0;

        if (strTarget.toLowerCase() === 'inactivos' || strTarget.toLowerCase() === 'inactive') {
            const count = await this.cleanupInactiveWorkerKeys(30 * 60 * 1000);
            return { deleted: count, mode: 'inactivos' };
        }

        // 1. Caso código de país (2 letras)
        if (strTarget.length === 2) {
            const country = strTarget.toUpperCase();
            if (supabase) {
                try {
                    const { data } = await supabase
                        .from('population_workers')
                        .delete()
                        .eq('country_code', country)
                        .select('worker_key, username');

                    if (data && data.length > 0) {
                        deletedCount += data.length;
                        for (const row of data) {
                            activeWorkerKeys.delete(row.worker_key);
                        }
                    }
                } catch (e) {
                    console.error(`Error eliminando keys de ${country} en Supabase:`, e.message);
                }
            }

            for (const [key, w] of activeWorkerKeys.entries()) {
                if (w.countryCode === country) {
                    activeWorkerKeys.delete(key);
                    deletedCount++;
                }
            }

            const session = activeSessions.get(country);
            if (session && session.activeWorkers) {
                session.activeWorkers.clear();
            }

            return { deleted: deletedCount, mode: 'country', country };
        }

        // 2. Caso key específica (sengo_wk_...)
        const key = strTarget;
        let keyCountry = null;
        let keyUsername = null;

        if (activeWorkerKeys.has(key)) {
            const w = activeWorkerKeys.get(key);
            keyCountry = w.countryCode;
            keyUsername = w.username;
            activeWorkerKeys.delete(key);
            deletedCount = 1;
        }

        if (supabase) {
            try {
                const { data } = await supabase
                    .from('population_workers')
                    .delete()
                    .eq('worker_key', key)
                    .select('country_code, username');

                if (data && data.length > 0) {
                    deletedCount = Math.max(deletedCount, data.length);
                    if (!keyCountry) keyCountry = data[0].country_code;
                    if (!keyUsername) keyUsername = data[0].username;
                }
            } catch (e) {
                console.error(`Error eliminando key ${key} en Supabase:`, e.message);
            }
        }

        if (keyCountry && keyUsername) {
            const session = activeSessions.get(keyCountry);
            if (session && session.activeWorkers) {
                session.activeWorkers.delete(keyUsername);
            }
        }

        return { deleted: deletedCount, mode: 'key', key };
    }

    /**
     * Genera o recupera una Worker Key para un colaborador y país
     */
    static async createWorkerSession(discordId, username, countryCode) {
        const country = countryCode.toUpperCase();
        
        // 1. Limpieza de claves inactivas (>30 minutos)
        await this.cleanupInactiveWorkerKeys(30 * 60 * 1000);

        // 2. Verificar si el Owner ha permitido el poblamiento de este país (Persistente en DB)
        if (!await this.isCountryAllowed(country)) {
            return {
                error: 'NOT_ALLOWED',
                message: `🛑 El poblamiento de **${country}** no está permitido actualmente por el Administrador. El propietario debe habilitarlo con \`s.populate -permitir ${country}\`.`
            };
        }

        // 3. Verificar si el país está 100% completado en Supabase
        const isScraped = await OsuUserModel.isCountryScraped(country);
        if (isScraped) {
            return { error: 'COMPLETED', message: `El país **${country}** ya ha sido poblado al 100%.` };
        }

        // 4. Verificar si hay token Supporter disponible para ese país
        const supporterData = await OsuUserModel.getSupporterTokenForCountry(country);
        if (!supporterData || !supporterData.token) {
            return { error: 'NO_SUPPORTER', message: `No hay ningún usuario **Supporter** de ${country} registrado en el pool del bot.` };
        }

        // 5. Reutilizar clave activa del mismo usuario si ya existe para este país (evita consumir varios puestos)
        const strId = String(discordId);
        for (const [existingKey, worker] of activeWorkerKeys.entries()) {
            if ((worker.discordId === strId || worker.username === username) && worker.countryCode === country) {
                worker.lastActiveAt = Date.now();
                return {
                    key: existingKey,
                    countryCode: country,
                    supporterUser: supporterData.username
                };
            }
        }

        // 6. Verificar si los puestos de trabajo para el país están llenos (3 por cada supporter)
        const supabase = getSupabaseClient();
        let supporterCount = 1;
        if (supabase) {
            try {
                const { data: supporters } = await supabase
                    .from('oauth_tokens')
                    .select('country_code')
                    .eq('is_supporter', true)
                    .eq('country_code', country);
                if (supporters && supporters.length > 0) supporterCount = supporters.length;
            } catch (e) {}
        }
        const totalSlots = supporterCount * 3;
        const currentSession = activeSessions.get(country);
        const activeWorkersCount = currentSession ? currentSession.activeWorkers.size : 0;

        if (activeWorkersCount >= totalSlots) {
            return {
                error: 'SLOTS_FULL',
                totalSlots
            };
        }

        // Crear clave única
        const key = `sengo_wk_${crypto.randomBytes(4).toString('hex')}`;
        const nowIso = new Date().toISOString();

        activeWorkerKeys.set(key, {
            discordId: strId,
            username,
            countryCode: country,
            createdAt: Date.now(),
            lastActiveAt: Date.now(),
            batchesRequested: 0,
            scoresSubmitted: 0
        });

        // Persistir la worker key en Supabase
        try {
            if (supabase) {
                await supabase.from('population_workers').upsert({
                    worker_key: key,
                    discord_id: strId,
                    username: username,
                    country_code: country,
                    batches_requested: 0,
                    scores_submitted: 0,
                    created_at: nowIso,
                    last_active_at: nowIso
                }, { onConflict: 'worker_key' });
            }
        } catch (supaErr) {
            console.error(`Error guardando worker key ${key} en Supabase:`, supaErr.message);
        }

        if (!activeSessions.has(country)) {
            activeSessions.set(country, {
                countryCode: country,
                isStopped: false,
                activeWorkers: new Set()
            });
        }
        
        const session = activeSessions.get(country);
        session.isStopped = false; // Resetear stop si inicia nueva sesión
        session.activeWorkers.add(username);

        return {
            key,
            countryCode: country,
            supporterUser: supporterData.username
        };
    }

    /**
     * Valida y recupera (si es necesario desde Supabase) una Worker Key.
     */
    static async isWorkerKeyValid(key) {
        if (!key || typeof key !== 'string' || key.trim() === '') return false;
        const cleanKey = key.trim();

        if (activeWorkerKeys.has(cleanKey)) return true;

        try {
            const supabase = getSupabaseClient();
            if (supabase) {
                const { data: dbWorker } = await supabase
                    .from('population_workers')
                    .select('*')
                    .eq('worker_key', cleanKey)
                    .maybeSingle();

                if (dbWorker) {
                    activeWorkerKeys.set(cleanKey, {
                        discordId: dbWorker.discord_id,
                        username: dbWorker.username,
                        countryCode: dbWorker.country_code,
                        createdAt: new Date(dbWorker.created_at).getTime(),
                        lastActiveAt: new Date(dbWorker.last_active_at).getTime(),
                        batchesRequested: Number(dbWorker.batches_requested || 0),
                        scoresSubmitted: Number(dbWorker.scores_submitted || 0)
                    });

                    if (!activeSessions.has(dbWorker.country_code)) {
                        activeSessions.set(dbWorker.country_code, {
                            countryCode: dbWorker.country_code,
                            isStopped: false,
                            activeWorkers: new Set()
                        });
                    }
                    activeSessions.get(dbWorker.country_code).activeWorkers.add(dbWorker.username);
                    return true;
                }
            }
        } catch (errRecov) {
            console.error(`Error al recuperar worker key ${cleanKey} de Supabase:`, errRecov.message);
        }

        return false;
    }

    /**
     * Entrega el siguiente lote de 100 beatmaps no poblados para el país
     */
    static async getNextBatch(key, countryCode) {
        const country = countryCode ? countryCode.toUpperCase() : 'MX';

        if (!key || !(await this.isWorkerKeyValid(key))) {
            return { error: 'UNAUTHORIZED', message: 'Clave de trabajador inválida o expirada.' };
        }

        if (activeWorkerKeys.has(key)) {
            const worker = activeWorkerKeys.get(key);
            worker.lastActiveAt = Date.now();
            worker.batchesRequested = (worker.batchesRequested || 0) + 1;

            // Sincronizar asíncronamente en Supabase
            try {
                const supabase = getSupabaseClient();
                if (supabase) {
                    supabase.from('population_workers').update({
                        batches_requested: worker.batchesRequested,
                        last_active_at: new Date().toISOString()
                    }).eq('worker_key', key).then(() => {}).catch(() => {});
                }
            } catch (e) {}
        }

        const session = activeSessions.get(country);

        if (session && session.isStopped) {
            return { status: 'stopped', message: 'Poblamiento detenido por el administrador.' };
        }

        const isScraped = await OsuUserModel.isCountryScraped(country);
        if (isScraped) {
            return { status: 'completed', message: 'País completado al 100%.' };
        }

        // Obtener Token Supporter activo del pool
        const supporterData = await OsuUserModel.getSupporterTokenForCountry(country);
        if (!supporterData || !supporterData.token) {
            return { error: 'Sin supporter token disponible para este país.' };
        }

        const supabase = getSupabaseClient();
        if (!supabase) {
            return { error: 'Error de conexión con la base de datos.' };
        }

        // Caché en memoria para los beatmaps ya raspados por país (TTL 1 hora, actualizado en tiempo real con submitBatch)
        const countryKey = country.toUpperCase();
        const now = Date.now();

        let scrapedSet = scrapedBeatmapSets.get(countryKey);
        const lastFetch = scrapedSetTTL.get(countryKey) || 0;

        if (!scrapedSet || (now - lastFetch) > 3600000) {
            scrapedSet = new Set();
            
            // 1. Intentar cargar desde Supabase primero (0 cuota de lecturas consumida en Turso)
            try {
                let from = 0;
                const limit = 1000;
                let hasMore = true;

                while (hasMore) {
                    const { data: scrapedRows, error: supabaseErr } = await supabase
                        .from('scraped_beatmaps')
                        .select('beatmap_id')
                        .eq('country_code', countryKey)
                        .range(from, from + limit - 1);

                    if (supabaseErr) break;

                    if (scrapedRows && scrapedRows.length > 0) {
                        for (const r of scrapedRows) {
                            scrapedSet.add(Number(r.beatmap_id));
                        }
                        if (scrapedRows.length < limit) {
                            hasMore = false;
                        } else {
                            from += limit;
                        }
                    } else {
                        hasMore = false;
                    }
                }
            } catch (eSupabase) {
                console.error(`Error cargando scraped_beatmaps desde Supabase para ${countryKey}:`, eSupabase.message);
            }

            // 2. Si Supabase no devolvió mapas (ej. tabla aún vacía o fallo), respaldo a Turso
            if (scrapedSet.size === 0) {
                try {
                    const dbScraped = await TursoDB.getScrapedBeatmapIds(countryKey);
                    for (const id of dbScraped) {
                        scrapedSet.add(Number(id));
                    }

                    // Sincronizar en segundo plano hacia Supabase si Turso tiene mapas raspados
                    if (scrapedSet.size > 0) {
                        const rowsToInsert = Array.from(scrapedSet).map(id => ({
                            beatmap_id: id,
                            country_code: countryKey
                        }));
                        for (let i = 0; i < rowsToInsert.length; i += 500) {
                            const chunk = rowsToInsert.slice(i, i + 500);
                            supabase.from('scraped_beatmaps').upsert(chunk, { onConflict: 'beatmap_id,country_code' }).then(() => {}).catch(() => {});
                        }
                    }
                } catch (eTurso) {
                    console.error(`Error cargando beatmaps raspados desde Turso para ${countryKey}:`, eTurso.message);
                }
            }

            scrapedBeatmapSets.set(countryKey, scrapedSet);
            scrapedSetTTL.set(countryKey, now);
        }

        // Obtener la lista general de beatmaps aprobados en Supabase
        const { data: allBeatmaps, error: bErr } = await supabase
            .from('beatmaps')
            .select('beatmap_id')
            .order('beatmap_id', { ascending: true });

        if (bErr || !allBeatmaps) {
            return { error: 'Error al consultar la lista general de beatmaps.' };
        }

        // Filtrar aquellos que aún no estén en el conjunto raspado
        const pendingMaps = [];
        for (const b of allBeatmaps) {
            const bId = Number(b.beatmap_id);
            if (!scrapedSet.has(bId)) {
                pendingMaps.push(bId);
                if (pendingMaps.length >= 100) break; // Lote máximo de 100
            }
        }

        if (pendingMaps.length === 0) {
            await OsuUserModel.markCountryAsScraped(country);
            return { status: 'completed', message: 'Poblamiento finalizado al 100% para este país.' };
        }

        return {
            status: 'ok',
            maps: pendingMaps,
            supporterToken: supporterData.token
        };
    }

    /**
     * Recibe e inserta los récords #1 raspados en la base de datos Turso 'sengo-db'
     */
    static async submitBatch(key, countryCode, scores) {
        const country = countryCode ? countryCode.toUpperCase() : 'MX';

        // 1. Validar autenticación por Worker Key previa a cualquier procesamiento
        if (!key || !(await this.isWorkerKeyValid(key))) {
            return { error: 'UNAUTHORIZED', message: 'Clave de trabajador inválida o expirada.', saved: 0 };
        }

        // 2. Validar estructura del arreglo de scores
        if (!Array.isArray(scores)) {
            return { error: 'INVALID_PAYLOAD', message: 'El campo scores debe ser un arreglo.', saved: 0 };
        }

        // 3. Límite estricto de máximo 100 scores por petición
        if (scores.length > 100) {
            return { error: 'PAYLOAD_TOO_LARGE', message: 'Se permite un máximo de 100 scores por petición.', saved: 0 };
        }

        let savedCount = 0;
        for (const s of scores) {
            // Validar que cada score sea un objeto con campos obligatorios numéricos válidos
            if (!s || typeof s !== 'object') continue;

            const bId = Number(s.beatmap_id);
            const uId = Number(s.user_id);

            // beatmap_id debe ser un entero positivo válido
            if (isNaN(bId) || bId <= 0 || !Number.isInteger(bId)) continue;
            // user_id debe ser un entero no negativo (0 representa SYSTEM_NO_SCORE)
            if (isNaN(uId) || uId < 0 || !Number.isInteger(uId)) continue;

            try {
                await TursoDB.saveTopScore({
                    beatmap_id: bId,
                    country_code: country,
                    user_id: uId,
                    username: String(s.username || '').slice(0, 100),
                    score: Number(s.score) || 0,
                    pp: Number(s.pp) || 0,
                    accuracy: Number(s.accuracy) || 0,
                    mods: String(s.mods || 'NM').slice(0, 50),
                    ended_at: s.ended_at || new Date().toISOString(),
                    max_combo: Number(s.max_combo) || 0,
                    perfect: Boolean(s.perfect),
                    rank: String(s.rank || '').slice(0, 10)
                });
                savedCount++;

                const cachedSet = scrapedBeatmapSets.get(country);
                if (cachedSet) {
                    cachedSet.add(bId);
                }

                // Detección de snipe retrospectivo si el #1 es cronológicamente posterior al #2
                const snipedUId = Number(s.sniped_user_id);
                if (snipedUId && uId > 0 && snipedUId > 0 && uId !== snipedUId) {
                    const date1 = new Date(s.ended_at).getTime();
                    const date2 = new Date(s.sniped_ended_at).getTime();
                    if (!isNaN(date1) && !isNaN(date2) && date1 > date2) {
                        await TursoDB.recordSnipe({
                            beatmap_id: bId,
                            sniper_id: uId,
                            sniper_name: s.username,
                            sniped_id: snipedUId,
                            sniped_name: s.sniped_username || 'Jugador',
                            pp: Number(s.pp) || 0,
                            ended_at: s.ended_at,
                            country_code: country
                        });
                    }
                }
            } catch (e) {
                console.error(`Error guardando mapa ${bId} en Turso:`, e.message);
            }
        }

        let discordId = null;
        let username = null;

        if (activeWorkerKeys.has(key)) {
            const worker = activeWorkerKeys.get(key);
            worker.lastActiveAt = Date.now();
            worker.scoresSubmitted = (worker.scoresSubmitted || 0) + savedCount;
            discordId = worker.discordId;
            username = worker.username;
        }

        // Sincronizar recuento de scores_submitted en la tabla population_workers de Supabase
        try {
            const supabase = getSupabaseClient();
            if (supabase) {
                const { data: dbW } = await supabase
                    .from('population_workers')
                    .select('scores_submitted, discord_id, username')
                    .eq('worker_key', key)
                    .maybeSingle();

                if (dbW) {
                    if (!discordId) discordId = dbW.discord_id;
                    if (!username) username = dbW.username;
                    const currentScores = Number(dbW.scores_submitted || 0);

                    await supabase
                        .from('population_workers')
                        .update({
                            scores_submitted: currentScores + savedCount,
                            last_active_at: new Date().toISOString()
                        })
                        .eq('worker_key', key);
                }
            }
        } catch (e) {
            console.error(`Error actualizando scores_submitted en Supabase para key ${key}:`, e.message);
        }

        if (savedCount > 0 && (discordId || username)) {
            await this.recordUserContribution(discordId, username, savedCount, 1);
        }

        if (savedCount > 0) {
            countryScrapedCounts.set(country, (countryScrapedCounts.get(country) || 0) + savedCount);
            // Actualizar conteo liviano en Supabase (scraped_countries) sin tocar la cuota de Turso
            try {
                const supabase = getSupabaseClient();
                if (supabase) {
                    const { data: currentScraped } = await supabase
                        .from('scraped_countries')
                        .select('scraped_count')
                        .eq('country_code', country)
                        .maybeSingle();

                    const currentCount = currentScraped ? Number(currentScraped.scraped_count || 0) : 0;
                    const newCount = currentCount + savedCount;

                    await supabase
                        .from('scraped_countries')
                        .upsert({
                            country_code: country,
                            scraped_count: newCount,
                            last_scraped_at: new Date().toISOString()
                        }, { onConflict: 'country_code' });
                }
            } catch (e) {
                console.error(`Error actualizando conteo en Supabase para ${country}:`, e.message);
            }
        }

        return { saved: savedCount };
    }

    /**
     * Registra o actualiza las contribuciones acumuladas de un usuario en Supabase (population_contributors)
     */
    static async recordUserContribution(discordId, username, scoresCount = 0, batchCount = 1) {
        const idKey = discordId ? String(discordId) : username;
        if (!idKey) return;

        try {
            const supabase = getSupabaseClient();
            if (!supabase) return;

            const { data: existing } = await supabase
                .from('population_contributors')
                .select('scores_submitted, batches_requested')
                .eq('discord_id', idKey)
                .maybeSingle();

            const prevScores = existing ? Number(existing.scores_submitted || 0) : 0;
            const prevBatches = existing ? Number(existing.batches_requested || 0) : 0;

            await supabase
                .from('population_contributors')
                .upsert({
                    discord_id: idKey,
                    username: username || 'Colaborador',
                    scores_submitted: prevScores + scoresCount,
                    batches_requested: prevBatches + batchCount,
                    last_submitted_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }, { onConflict: 'discord_id' });
        } catch (e) {
            console.error(`Error guardando contribución de ${username} en Supabase:`, e.message);
        }
    }

    /**
     * Obtiene el ranking de principales colaboradores de poblamiento desde Supabase
     */
    static async getTopContributors(limit = 10) {
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return [];

            const { data } = await supabase
                .from('population_contributors')
                .select('*')
                .order('scores_submitted', { ascending: false })
                .limit(limit);

            return data || [];
        } catch (e) {
            console.error("Error obteniendo colaboradores de poblamiento:", e.message);
            return [];
        }
    }

    /**
     * Detiene e inhabilita inmediatamente el poblamiento de un país (Kill Switch de Owner - Persistente)
     */
    static async stopCountry(countryCode) {
        const country = countryCode.toUpperCase();
        allowedCountries.delete(country); // Inhabilitar permiso del Owner

        if (!activeSessions.has(country)) {
            activeSessions.set(country, { countryCode: country, isStopped: true, activeWorkers: new Set() });
        } else {
            const session = activeSessions.get(country);
            session.isStopped = true;
            session.activeWorkers.clear();
        }

        // Invalidar Worker Keys de este país
        for (const [k, v] of activeWorkerKeys.entries()) {
            if (v.countryCode === country) {
                activeWorkerKeys.delete(k);
            }
        }

        // Persistir revocación en Supabase y eliminar worker keys de ese país
        try {
            const supabase = getSupabaseClient();
            if (supabase) {
                await supabase
                    .from('scraped_countries')
                    .upsert({ country_code: country, is_allowed: false }, { onConflict: 'country_code' });

                await supabase
                    .from('population_workers')
                    .delete()
                    .eq('country_code', country);
            }
        } catch (e) {
            console.error(`Error revocando permiso para ${country} en Supabase:`, e.message);
        }

        return true;
    }

    /**
     * Carga de forma segura los permisos de países desde Supabase al iniciar
     */
    static async initAllowedCountriesFromDB() {
        try {
            const supabase = getSupabaseClient();
            if (!supabase) return;

            const { data } = await supabase
                .from('scraped_countries')
                .select('country_code, is_allowed')
                .eq('is_allowed', true);

            if (data) {
                for (const row of data) {
                    if (row.country_code) {
                        allowedCountries.add(row.country_code.toUpperCase());
                    }
                }
            }
        } catch (e) {
            console.error("Error inicializando permisos de países desde Supabase:", e.message);
        }
    }

    /**
     * Genera la lista completa de estados de países (Poblado, En Proceso, Disponible, Bloqueado, Sin Supporter)
     */
    static async getCountryStatusList() {
        const supabase = getSupabaseClient();
        if (!supabase) return [];

        // Asegurar que los permisos estén sincronizados con Supabase
        await this.initAllowedCountriesFromDB();

        // 1. Total beatmaps ranked en la base de datos (con caché en memoria de 1 hora)
        if (!this.cachedTotalRanked || (Date.now() - (this.lastTotalRankedTime || 0)) > 3600000) {
            try {
                const { count } = await supabase
                    .from('ranked_beatmaps')
                    .select('*', { count: 'exact', head: true });
                this.cachedTotalRanked = count || 145000;
                this.lastTotalRankedTime = Date.now();
            } catch (e) {
                this.cachedTotalRanked = this.cachedTotalRanked || 145000;
            }
        }
        const totalRanked = this.cachedTotalRanked;

        // 2. Obtener conteo de tokens Supporters por país en Supabase
        const { data: supporters } = await supabase
            .from('oauth_tokens')
            .select('country_code')
            .eq('is_supporter', true);

        const supporterCountMap = new Map();
        if (supporters) {
            for (const s of supporters) {
                if (s.country_code) {
                    const code = s.country_code.toUpperCase();
                    supporterCountMap.set(code, (supporterCountMap.get(code) || 0) + 1);
                }
            }
        }

        // 3. Obtener países y sus conteos de raspado desde la tabla liviana de Supabase (0 lecturas a Turso)
        const { data: scraped } = await supabase
            .from('scraped_countries')
            .select('country_code, is_scraped, scraped_count, is_allowed');

        const scrapedMap = new Map();
        if (scraped) {
            for (const sc of scraped) {
                const code = sc.country_code.toUpperCase();
                scrapedMap.set(code, {
                    is_scraped: sc.is_scraped,
                    scraped_count: Number(sc.scraped_count || 0),
                    is_allowed: Boolean(sc.is_allowed)
                });
                if (sc.is_allowed) {
                    allowedCountries.add(code);
                }
            }
        }

        // Países principales soportados por Sengo
        const defaultCountries = ['MX', 'VE', 'AR', 'CO', 'CL', 'EC', 'PE', 'PR', 'BO', 'CA', 'DO', 'BR', 'ES'];
        const list = [];

        for (const code of defaultCountries) {
            const countryMeta = scrapedMap.get(code);
            const isScraped = countryMeta ? countryMeta.is_scraped : false;
            const supporterCount = supporterCountMap.get(code) || 0;
            const hasSupporter = supporterCount > 0;
            const isAllowed = allowedCountries.has(code);
            const session = activeSessions.get(code);
            const activeWorkers = session ? session.activeWorkers.size : 0;
            const isProcessing = isAllowed && session && !session.isStopped && activeWorkers > 0;

            const scrapedCount = countryMeta ? countryMeta.scraped_count : (countryScrapedCounts.get(code) || 0);
            const rawPercent = totalRanked > 0 ? (scrapedCount / totalRanked) * 100 : 0;
            const progressPercent = Math.min(100.0, rawPercent).toFixed(1);

            // Puestos de trabajo (3 slots por cada supporter token en el pool del país)
            const totalSlots = supporterCount * 3;
            const occupiedSlots = activeWorkers;
            const freeSlots = Math.max(0, totalSlots - occupiedSlots);

            let status = 'NO_SUPPORTER';
            if (isScraped) {
                status = 'COMPLETED';
            } else if (isProcessing) {
                status = 'PROCESSING';
            } else if (isAllowed && hasSupporter) {
                status = 'AVAILABLE';
            } else if (!isAllowed) {
                status = 'LOCKED';
            }

            list.push({
                code,
                countryCode: code,
                status,
                isScraped,
                scrapedCount,
                totalRanked,
                progressPercent,
                supporterCount,
                totalSlots,
                occupiedSlots,
                freeSlots
            });
        }

        return list;
    }

    /**
     * Retorna el script de PowerShell en texto plano desde assets/worker.ps1
     */
    static getPowerShellScript(defaultKey = '', defaultCountry = '') {
        const filePath = path.join(__dirname, '../assets/worker.ps1');
        let content = fs.readFileSync(filePath, 'utf8');
        if (defaultKey) {
            content = content.replace('__WORKER_KEY__', defaultKey);
        }
        if (defaultCountry) {
            content = content.replace('__WORKER_COUNTRY__', defaultCountry);
        }
        return content;
    }

    /**
     * Devuelve la lista detallada de workers activos registrados (Persistente desde Supabase)
     */
    static async getActiveWorkersList() {
        try {
            const supabase = getSupabaseClient();
            if (supabase) {
                const { data: dbWorkers } = await supabase
                    .from('population_workers')
                    .select('*')
                    .order('last_active_at', { ascending: false });

                if (dbWorkers && dbWorkers.length > 0) {
                    return dbWorkers.map(w => {
                        const memWorker = activeWorkerKeys.get(w.worker_key);
                        return {
                            key: w.worker_key,
                            discordId: w.discord_id,
                            username: w.username,
                            countryCode: w.country_code,
                            createdAt: new Date(w.created_at).getTime(),
                            lastActiveAt: memWorker?.lastActiveAt || new Date(w.last_active_at).getTime(),
                            batchesRequested: Math.max(Number(w.batches_requested || 0), memWorker?.batchesRequested || 0),
                            scoresSubmitted: Math.max(Number(w.scores_submitted || 0), memWorker?.scoresSubmitted || 0)
                        };
                    });
                }
            }
        } catch (e) {
            console.error("Error consultando workers en Supabase:", e.message);
        }

        const list = [];
        for (const [key, w] of activeWorkerKeys.entries()) {
            list.push({
                key,
                discordId: w.discordId,
                username: w.username,
                countryCode: w.countryCode,
                createdAt: w.createdAt,
                lastActiveAt: w.lastActiveAt || w.createdAt,
                batchesRequested: w.batchesRequested || 0,
                scoresSubmitted: w.scoresSubmitted || 0
            });
        }
        return list;
    }
}

module.exports = PopulationService;
