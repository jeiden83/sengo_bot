const Logger = require("../utils/logger.js");
const BotSettingsModel = require("../models/BotSettingsModel.js");
const { getSupabaseClient } = require("../db/database.js");
const { getUserTopScores, getOsuUser } = require("../commands/utils/osu.js");
const { analyzeSkills, saveUserSkills } = require("../models/SkillsModel.js");
const { osuApiQueue, isExternalApiOutageError } = require("../utils/OsuApiQueue.js");
const { waitIfHighCpu } = require("./resourceMonitor.js");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// ponytail: procesar en lotes pequeños y pausados para evitar superar el límite de CPU promedio (~15%) en Wispbyte
const MAX_BATCH_PER_RUN = 25;
const USER_PAUSE_MS = 2500;
const BATCH_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 horas entre lotes pendientes
const FULL_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 horas cuando todos están al día
const INITIAL_DELAY_MS = 15 * 60 * 1000;      // 15 minutos tras el arranque (separado de Beatmap Crawler)

/**
 * Realiza la sincronización periódica de habilidades de usuarios en segundo plano
 * en lotes acotados y con pausas de cortesía para no saturar CPU ni la API de osu!.
 * @returns {Promise<{ remaining: number }>}
 */
async function syncUserSkillsBackground() {
    Logger.system("[Skills Sync] Iniciando actualización periódica de habilidades en segundo plano...");

    const supabase = getSupabaseClient();
    if (!supabase) {
        Logger.system("[Skills Sync] Supabase no disponible. Omitiendo sincronización.");
        return { remaining: 0 };
    }

    try {
        // Consultar usuarios vinculados
        const { data: users, error: usersErr } = await supabase.from("users").select("osu_id, discord_id, main_gamemode");
        if (usersErr) throw usersErr;

        if (!users || users.length === 0) {
            Logger.system("[Skills Sync] No hay usuarios registrados para sincronizar.");
            return { remaining: 0 };
        }

        // Consultar fecha de última actualización en user_skills para actualizar solo los que lleven más de 48h
        const { data: existingSkills } = await supabase.from("user_skills").select("osu_id, updated_at");
        const lastUpdatedMap = new Map();
        (existingSkills || []).forEach(s => {
            if (s.osu_id) lastUpdatedMap.set(String(s.osu_id), new Date(s.updated_at).getTime());
        });

        const STALE_THRESHOLD = 48 * 60 * 60 * 1000; // 48 horas
        const now = Date.now();

        // Filtrar y ordenar de más antiguo (o nunca sincronizado) a más reciente
        const candidates = users
            .filter(u => {
                if (!u.osu_id) return false;
                const lastTime = lastUpdatedMap.get(String(u.osu_id));
                return !lastTime || (now - lastTime) > STALE_THRESHOLD;
            })
            .sort((a, b) => (lastUpdatedMap.get(String(a.osu_id)) || 0) - (lastUpdatedMap.get(String(b.osu_id)) || 0));

        const batch = candidates.slice(0, MAX_BATCH_PER_RUN);
        const remaining = Math.max(0, candidates.length - batch.length);

        Logger.system(`[Skills Sync] Candidatos pendientes: ${candidates.length} de ${users.length} vinculados (procesando lote de ${batch.length}).`);

        let successCount = 0;
        let failCount = 0;

        for (const candidate of batch) {
            await waitIfHighCpu(10, 60000);
            if (osuApiQueue.isInCooldown()) {
                Logger.system(`[Skills Sync] Sincronización pausada por cooldown activo de la API de osu! (${Math.round(osuApiQueue.getCooldownRemainingMs() / 1000)}s).`);
                break;
            }
            try {
                const targetMode = candidate.main_gamemode || "osu";
                const scores = await getUserTopScores({
                    username: [String(candidate.osu_id)],
                    gamemode: targetMode,
                    server: "bancho"
                }).catch((err) => {
                    if (isExternalApiOutageError(err, { includeOsuExtendedTransport: true })) {
                        osuApiQueue.recordOutage(err, "Skills Sync");
                    }
                    return [];
                });

                if (osuApiQueue.isInCooldown()) {
                    Logger.system(`[Skills Sync] Abortando lote por caída detectada en la API de osu!.`);
                    break;
                }

                if (!scores || scores.length === 0) {
                    await sleep(USER_PAUSE_MS);
                    continue;
                }

                let osuUser = scores[0]?.user;
                if (!osuUser || !osuUser.country_code || !osuUser.statistics) {
                    osuUser = await getOsuUser({
                        username: [String(candidate.osu_id)],
                        gamemode: targetMode,
                        server: "bancho"
                    }).catch((err) => {
                        if (isExternalApiOutageError(err, { includeOsuExtendedTransport: true })) {
                            osuApiQueue.recordOutage(err, "Skills Sync");
                        }
                        return null;
                    });
                }

                if (osuApiQueue.isInCooldown()) {
                    Logger.system(`[Skills Sync] Abortando lote por caída detectada en la API de osu!.`);
                    break;
                }

                if (!osuUser || typeof osuUser === "string") {
                    await sleep(USER_PAUSE_MS);
                    continue;
                }

                const skillsBreakdown = analyzeSkills(scores, false, targetMode);

                await saveUserSkills({
                    osuUser,
                    skillsBreakdown,
                    gamemode: targetMode,
                    discordId: candidate.discord_id
                });

                successCount++;
            } catch (err) {
                failCount++;
                console.warn(`[Skills Sync] Error al actualizar ${candidate.osu_id}:`, err.message);
                if (isExternalApiOutageError(err, { includeOsuExtendedTransport: true }) || osuApiQueue.isInCooldown()) {
                    osuApiQueue.recordOutage(err, "Skills Sync");
                    break;
                }
            }

            await sleep(USER_PAUSE_MS);
        }

        Logger.system(`[Skills Sync] Lote finalizado: ${successCount} actualizados, ${failCount} fallidos (${remaining} pendientes).`);
        if (remaining === 0) {
            await BotSettingsModel.setSetting("last_skills_sync_time", new Date().toISOString()).catch(() => {});
        }
        return { remaining };
    } catch (err) {
        console.error("[Skills Sync] Error en el ciclo de sincronización:", err.message);
        return { remaining: 0 };
    }
}

/**
 * Inicializa el scheduler del servicio de sincronización de habilidades
 */
async function initUserSkillsSync() {
    Logger.system("Inicializando servicio de sincronización periódica de habilidades...");

    let lastSyncTime = 0;
    try {
        const lastSyncVal = await BotSettingsModel.getSetting("last_skills_sync_time");
        if (lastSyncVal) {
            lastSyncTime = new Date(lastSyncVal).getTime();
        }
    } catch {
        // Silenciar
    }

    const now = Date.now();
    const timeSinceLastSync = now - lastSyncTime;

    let delay = INITIAL_DELAY_MS;
    if (timeSinceLastSync < FULL_INTERVAL_MS) {
        delay = Math.max(INITIAL_DELAY_MS, FULL_INTERVAL_MS - timeSinceLastSync);
        const hoursLeft = (delay / (60 * 60 * 1000)).toFixed(2);
        Logger.system(`[Skills Sync] La sincronización se realizó recientemente. Próxima en ${hoursLeft} horas.`);
    }

    const scheduleNext = async () => {
        const { remaining } = await syncUserSkillsBackground();
        const nextDelay = remaining > 0 ? BATCH_INTERVAL_MS : FULL_INTERVAL_MS;
        setTimeout(scheduleNext, nextDelay);
    };

    setTimeout(scheduleNext, delay);
}

module.exports = {
    initUserSkillsSync,
    syncUserSkillsBackground
};
