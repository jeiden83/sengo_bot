const OsuUserModel = require("../models/OsuUserModel.js");
const Logger = require("../utils/logger.js");

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
    } catch (err) {
        console.error("Error en la sincronización diaria de supporter:", err);
    }
}

function initSupporterSync() {
    Logger.system("Inicializando servicio de sincronización diaria de supporter...");
    
    // Ejecutar después de 15 segundos al iniciar
    setTimeout(() => {
        checkSupporterStatuses();
    }, 15000);

    // Ejecutar cada 24 horas (86400000 ms)
    setInterval(() => {
        checkSupporterStatuses();
    }, 24 * 60 * 60 * 1000);
}

module.exports = {
    initSupporterSync,
    checkSupporterStatuses
};
