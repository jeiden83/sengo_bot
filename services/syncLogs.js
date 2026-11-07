const fs = require('fs');
const path = require('path');
const Logger = require('../utils/logger.js');

// Analiza los logs de hoy para ver las estadísticas acumuladas
function analyzeTodayLogs() {
    const todayStr = Logger.getLocalDateString();
    const logPath = path.join(process.cwd(), 'db/local/logs', `${todayStr}.log`);

    if (!fs.existsSync(logPath)) {
        return null;
    }

    try {
        const content = fs.readFileSync(logPath, 'utf8');
        const lines = content.split('\n');
        
        let startsCount = 0;
        let commandsCount = 0;
        const uniqueServers = new Set();

        for (const line of lines) {
            if (line.includes('Iniciando Sengo')) {
                startsCount++;
            }
            if (line.includes('[PASO 1/3: INICIO]')) {
                commandsCount++;
                
                // Parseamos el nombre del servidor entre el primer y segundo corchete después de [TRIGGER]
                // Formato de línea en archivo: [Hora] [TRIGGER] [usuario] [servidor] [comando] ...
                const matches = line.match(/\[TRIGGER\]\s+\[.*?\]\s+\[(.*?)\]/);
                if (matches && matches[1]) {
                    uniqueServers.add(matches[1]);
                }
            }
        }

        return {
            startsCount: startsCount + 1, // Sumamos 1 para el inicio actual
            commandsCount,
            serversCount: uniqueServers.size
        };
    } catch (err) {
        console.error("Error analizando los logs locales de hoy:", err);
        return null;
    }
}

// ponytail: en Wispbyte el almacenamiento en disco es persistente; ya no se suben logs a Supabase Storage para evitar consumo innecesario de cuota.
async function syncOlderLogs(supabaseClient) {
    return;
}

module.exports = { syncOlderLogs, analyzeTodayLogs };
