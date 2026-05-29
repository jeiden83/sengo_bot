const { getSupabaseClient } = require('../db/database.js');
const { getBeatmapsetTags, isScraperBlocked } = require('../models/BeatmapModel.js');
const Logger = require('../utils/logger.js');

let sessionCount = 0;
let sessionSuccess = 0;

async function startTagEnricherWorker() {
    Logger.system("Inicializando worker silencioso de enriquecimiento de user tags (5 peticiones/min)...");
    
    const supabase = getSupabaseClient();
    if (!supabase) {
        Logger.system("Error: Cliente de Supabase no disponible para el Worker de user tags.");
        return;
    }

    // Esperar un momento antes de la primera petición
    await new Promise(resolve => setTimeout(resolve, 5000));

    while (true) {
        try {
            // Si el scraper está en cooldown por Cloudflare, esperar 15 minutos antes de volver a verificar
            if (isScraperBlocked()) {
                Logger.system("[Worker Tags] Scraper bloqueado. Pausando el worker por 15 minutos...");
                await new Promise(resolve => setTimeout(resolve, 15 * 60 * 1000));
                continue;
            }

            // Obtener un solo beatmapset pendiente de tags (ordenando por más antiguo primero para evitar colisiones con local)
            const { data: rows, error: fetchError } = await supabase
                .from('ranked_beatmaps')
                .select('beatmapset_id')
                .is('user_tags', null)
                .order('created_at', { ascending: true })
                .limit(1);

            if (fetchError) {
                Logger.system(`[Worker Tags] Error al consultar pendientes: ${fetchError.message}`);
                await new Promise(resolve => setTimeout(resolve, 30000)); // Esperar 30s si falla la BD
                continue;
            }

            if (!rows || rows.length === 0) {
                // No hay pendientes, dormir 1 hora
                await new Promise(resolve => setTimeout(resolve, 60 * 60 * 1000));
                continue;
            }

            const setId = rows[0].beatmapset_id;
            sessionCount++;

            const userTags = await getBeatmapsetTags(setId);

            if (userTags !== null) {
                const cleanUserTags = userTags.map(t => t.toLowerCase().trim()).filter(t => t.length > 1);

                // Guardar en base de datos
                const { error: updateError } = await supabase
                    .from('ranked_beatmaps')
                    .update({ user_tags: cleanUserTags })
                    .eq('beatmapset_id', setId);

                if (!updateError) {
                    sessionSuccess++;
                }
            }

            // Cada 5 peticiones (aproximadamente cada minuto), registrar reporte de progreso
            if (sessionCount % 5 === 0) {
                let stats = null;
                try {
                    const { data } = await supabase.rpc('get_user_tags_stats');
                    stats = data;
                } catch (e) {
                    // Silenciar
                }
                let progressStr = "N/A";
                if (stats) {
                    const completed = stats.total_sets - stats.pending_sets;
                    const pct = ((completed / stats.total_sets) * 100).toFixed(2);
                    progressStr = `${completed}/${stats.total_sets} (${pct}%)`;
                }
                Logger.system(`[Worker Tags] Progreso general: ${progressStr} | Procesados sesión: ${sessionCount} (Exitosos: ${sessionSuccess})`);
            }

        } catch (e) {
            Logger.system(`[Worker Tags] Error en el loop: ${e.message}`);
        }

        // Esperar 12 segundos para mantener una tasa de 5 peticiones por minuto
        await new Promise(resolve => setTimeout(resolve, 12000));
    }
}

module.exports = {
    startTagEnricherWorker
};
