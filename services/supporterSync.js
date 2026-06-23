const OsuUserModel = require("../models/OsuUserModel.js");
const Logger = require("../utils/logger.js");
const BotSettingsModel = require("../models/BotSettingsModel.js");

async function checkSupporterStatuses() {
    Logger.system("Iniciando verificación diaria de estatus de osu! supporter...");
    try {
        const result = await OsuUserModel.syncAllSupporterStatuses();
        Logger.system(`Sincronización de supporter completada: ${result.successCount} procesados con éxito, ${result.failCount} fallidos.`);
        if (result.changes.length > 0) {
            result.changes.forEach(c => {
                Logger.system(`Estatus de ${c.username} cambiado: ${c.oldStatus ? 'Supporter' : 'No Supporter'} -> ${c.newStatus ? 'Supporter' : 'No Supporter'}`);
            });
        }
        try {
            await BotSettingsModel.setSetting("last_supporter_sync_time", new Date().toISOString());
        } catch (writeErr) {
            console.error("Error al escribir el status del supporter sync en Supabase:", writeErr);
        }
    } catch (err) {
        console.error("Error en la sincronización diaria de supporter:", err);
    }
}

async function initSupporterSync() {
    Logger.system("Inicializando servicio de sincronización diaria de supporter...");
    
    let lastSyncTime = 0;
    try {
        const lastSyncVal = await BotSettingsModel.getSetting("last_supporter_sync_time");
        if (lastSyncVal) {
            lastSyncTime = new Date(lastSyncVal).getTime();
        }
    } catch (e) {
        // Silenciar
    }

    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const timeSinceLastSync = now - lastSyncTime;

    let delayBeforeNextSync = 0;
    if (timeSinceLastSync < oneDay) {
        delayBeforeNextSync = oneDay - timeSinceLastSync;
        const hoursLeft = (delayBeforeNextSync / (60 * 60 * 1000)).toFixed(2);
        Logger.system(`[Supporter Sync] La sincronización ya se realizó recientemente. Próxima en ${hoursLeft} horas.`);
    } else {
        // Ejecutar después de 3 minutos si ha pasado más de 24 horas
        delayBeforeNextSync = 180000;
    }

    // Programar la primera ejecución
    setTimeout(async () => {
        await checkSupporterStatuses();
        
        // Y programar para ejecutarse cada 24 horas de ahí en adelante
        setInterval(() => {
            checkSupporterStatuses();
        }, oneDay);
    }, delayBeforeNextSync);
}

module.exports = {
    initSupporterSync,
    checkSupporterStatuses
};
