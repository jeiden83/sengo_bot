const Logger = require("../utils/logger.js");
const BotSettingsModel = require("../models/BotSettingsModel.js");
const { getSupabaseClient } = require("../db/database.js");
const { getUserTopScores, getOsuUser } = require("../commands/utils/osu.js");
const { analyzeSkills, saveUserSkills } = require("../models/SkillsModel.js");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Realiza la sincronización periódica de habilidades de usuarios en segundo plano
 * con la menor prioridad posible y pausas de cortesía para no saturar la API de osu!.
 */
async function syncUserSkillsBackground() {
    Logger.system("[Skills Sync] Iniciando actualización periódica de habilidades en segundo plano...");

    const supabase = getSupabaseClient();
    if (!supabase) {
        Logger.system("[Skills Sync] Supabase no disponible. Omitiendo sincronización.");
        return;
    }

    try {
        // Consultar usuarios vinculados
        const { data: users, error: usersErr } = await supabase.from("users").select("osu_id, discord_id, main_gamemode");
        if (usersErr) throw usersErr;

        if (!users || users.length === 0) {
            Logger.system("[Skills Sync] No hay usuarios registrados para sincronizar.");
            return;
        }

        // Consultar fecha de última actualización en user_skills para actualizar solo los que lleven más de 48h
        const { data: existingSkills } = await supabase.from("user_skills").select("osu_id, updated_at");
        const lastUpdatedMap = new Map();
        (existingSkills || []).forEach(s => {
            if (s.osu_id) lastUpdatedMap.set(String(s.osu_id), new Date(s.updated_at).getTime());
        });

        const STALE_THRESHOLD = 48 * 60 * 60 * 1000; // 48 horas
        const now = Date.now();

        // Filtrar usuarios que requieran actualización (o no tengan registro)
        const candidates = users.filter(u => {
            if (!u.osu_id) return false;
            const lastTime = lastUpdatedMap.get(String(u.osu_id));
            return !lastTime || (now - lastTime) > STALE_THRESHOLD;
        });

        Logger.system(`[Skills Sync] Candidatos a actualizar: ${candidates.length} de ${users.length} vinculados.`);

        let successCount = 0;
        let failCount = 0;

        for (const candidate of candidates) {
            try {
                const targetMode = candidate.main_gamemode || "osu";
                const scores = await getUserTopScores({
                    username: [String(candidate.osu_id)],
                    gamemode: targetMode,
                    server: "bancho"
                }).catch(() => []);

                if (!scores || scores.length === 0) {
                    await sleep(600);
                    continue;
                }

                let osuUser = scores[0]?.user;
                if (!osuUser || !osuUser.country_code || !osuUser.statistics) {
                    osuUser = await getOsuUser({
                        username: [String(candidate.osu_id)],
                        gamemode: targetMode,
                        server: "bancho"
                    }).catch(() => null);
                }

                if (!osuUser || typeof osuUser === "string") {
                    await sleep(600);
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
            }

            // Pausa de cortesía generosa (600ms) para prioridad mínima
            await sleep(600);
        }

        Logger.system(`[Skills Sync] Sincronización finalizada: ${successCount} actualizados, ${failCount} fallidos.`);
        await BotSettingsModel.setSetting("last_skills_sync_time", new Date().toISOString()).catch(() => {});
    } catch (err) {
        console.error("[Skills Sync] Error en el ciclo de sincronización:", err.message);
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
    const interval = 24 * 60 * 60 * 1000; // 24 horas
    const timeSinceLastSync = now - lastSyncTime;

    let delay = 300000; // 5 minutos por defecto
    if (timeSinceLastSync < interval) {
        delay = interval - timeSinceLastSync;
        const hoursLeft = (delay / (60 * 60 * 1000)).toFixed(2);
        Logger.system(`[Skills Sync] La sincronización se realizó recientemente. Próxima en ${hoursLeft} horas.`);
    }

    setTimeout(async () => {
        await syncUserSkillsBackground();
        setInterval(syncUserSkillsBackground, interval);
    }, delay);
}

module.exports = {
    initUserSkillsSync,
    syncUserSkillsBackground
};
