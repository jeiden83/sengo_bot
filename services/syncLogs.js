const fs = require('fs');
const path = require('path');
const Logger = require('../utils/logger.js');

async function syncYesterdayLogs(supabaseClient) {
    if (!supabaseClient) {
        Logger.system("Sincronización con Supabase omitida (Modo MongoDB activo o cliente no disponible).");
        return;
    }

    const today = new Date();
    // Obtener la fecha del día anterior
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const yesterdayLogPath = path.join(process.cwd(), 'db/local/logs', `${yesterdayStr}.log`);

    if (!fs.existsSync(yesterdayLogPath)) {
        Logger.system(`No se encontró archivo de log local para el día anterior (${yesterdayStr}.log).`);
        return;
    }

    Logger.system(`Iniciando sincronización de log del día anterior: ${yesterdayStr}.log a Supabase Storage...`);

    try {
        const fileBuffer = fs.readFileSync(yesterdayLogPath);
        
        // Subir al bucket 'logs' de Supabase
        const { data, error } = await supabaseClient
            .storage
            .from('logs')
            .upload(`${yesterdayStr}.log`, fileBuffer, {
                contentType: 'text/plain',
                upsert: true
            });

        if (error) throw error;

        Logger.system(`Sincronización exitosa con Supabase Storage para: ${yesterdayStr}.log`);
        
    } catch (err) {
        Logger.system(`Error al subir el log a Supabase: ${err.message}`);
    }
}

module.exports = { syncYesterdayLogs };
