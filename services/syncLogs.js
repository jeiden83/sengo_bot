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
            if (line.includes('Iniciando SengoBot')) {
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

// Sincroniza y sube todos los archivos de logs de días anteriores a Supabase, eliminándolos luego localmente
async function syncOlderLogs(supabaseClient) {
    if (!supabaseClient) {
        Logger.system("Sincronización con Supabase omitida (Modo MongoDB activo o cliente no disponible).");
        return;
    }

    const logsDir = path.join(process.cwd(), 'db/local/logs');
    if (!fs.existsSync(logsDir)) {
        return;
    }

    const todayStr = Logger.getLocalDateString();
    const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.log') && !f.startsWith(todayStr));

    if (files.length === 0) {
        Logger.system("No se encontraron archivos de logs antiguos para respaldar.");
        return;
    }

    Logger.system(`Detectados ${files.length} archivos de logs de días anteriores. Iniciando subida a Supabase...`);

    // Intentamos crear el bucket 'logs' de forma automática por si acaso
    try {
        await supabaseClient.storage.createBucket('logs', { public: false });
    } catch (e) {
        // Si ya existe o falla por RLS, continuamos sin problema
    }

    for (const file of files) {
        const filePath = path.join(logsDir, file);
        try {
            const fileBuffer = fs.readFileSync(filePath);
            
            // Subir al bucket 'logs' de Supabase
            const { data, error } = await supabaseClient
                .storage
                .from('logs')
                .upload(file, fileBuffer, {
                    contentType: 'text/plain',
                    upsert: true
                });

            if (error) throw error;

            Logger.system(`Sincronización exitosa con Supabase Storage para el archivo: ${file}`);
            
            // Eliminar el log local para ahorrar espacio una vez respaldado
            fs.unlinkSync(filePath);
            Logger.system(`Archivo local eliminado: ${file}`);
            
        } catch (err) {
            Logger.system(`Error al subir el archivo de log ${file} a Supabase: ${err.message}`);
        }
    }
}

module.exports = { syncOlderLogs, analyzeTodayLogs };
