const fs = require('fs');
const path = require('path');
const OsuUserModel = require("../models/OsuUserModel.js");
const Logger = require("../utils/logger.js");

const STATUS_FILE = path.join(__dirname, "../db/local/supporter_sync_status.json");

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
            fs.writeFileSync(STATUS_FILE, JSON.stringify({ lastSyncTime: Date.now() }, null, 2));
        } catch (writeErr) {
            console.error("Error al escribir el status del supporter sync:", writeErr);
        }
    } catch (err) {
        console.error("Error en la sincronización diaria de supporter:", err);
    }
}

function initSupporterSync() {
    Logger.system("Inicializando servicio de sincronización diaria de supporter...");
    
    let lastSyncTime = 0;
    try {
        if (fs.existsSync(STATUS_FILE)) {
            const data = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
            lastSyncTime = data.lastSyncTime || 0;
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
        // Ejecutar después de 30 segundos si ha pasado más de 24 horas
        delayBeforeNextSync = 30000;
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
