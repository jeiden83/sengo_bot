const Logger = require("../utils/logger.js");
const OsuTournamentModel = require("../models/OsuTournamentModel.js");

let isRunning = false;

/**
 * Realiza una comprobación de los últimos torneos en el foro de osu!
 * y los añade a la base de datos si no existen.
 */
async function checkNewTournaments() {
    if (isRunning) return;
    isRunning = true;

    try {
        Logger.system("[Tournament Crawler] Buscando nuevos torneos en el foro de osu!...");
        const newTournaments = await OsuTournamentModel.syncLatestTournaments(10);
        
        if (newTournaments.length > 0) {
            Logger.system(`[Tournament Crawler] ¡Se detectaron y añadieron ${newTournaments.length} torneos nuevos a la base de datos!`);
        } else {
            Logger.system("[Tournament Crawler] Sincronización finalizada. No se encontraron nuevos torneos.");
        }
    } catch (error) {
        Logger.system(`[Tournament Crawler] Error durante la sincronización de torneos: ${error.message}`);
    } finally {
        isRunning = false;
    }
}

/**
 * Inicializa el worker de torneos para que se ejecute cada 2 minutos.
 */
function initTournamentCrawler() {
    Logger.system("Inicializando worker de torneos (intervalo de 2 minutos)...");

    // Primera ejecución a los 10 segundos del encendido del bot
    setTimeout(() => {
        checkNewTournaments();
    }, 10000);

    // Intervalo de ejecución cada 2 minutos
    setInterval(() => {
        checkNewTournaments();
    }, 2 * 60 * 1000);
}

module.exports = {
    initTournamentCrawler,
    checkNewTournaments
};
