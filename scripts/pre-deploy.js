const config = require('../config.js');

async function main() {
    const externalUrl = process.env.RENDER_EXTERNAL_URL;
    if (!externalUrl) {
        console.log("No se detectó RENDER_EXTERNAL_URL. Omitiendo notificación de apagado.");
        process.exit(0);
    }

    console.log(`Intentando notificar apagado a la instancia anterior en: ${externalUrl}`);
    try {
        const response = await fetch(`${externalUrl}/shutdown`, {
            method: 'POST',
            headers: {
                'Authorization': process.env.SHUTDOWN_TOKEN || config.OSU_CLIENT_SECRET,
                'Content-Type': 'application/json',
                'User-Agent': 'SengoBot-Deploy-Agent'
            }
        });
        if (response.ok) {
            console.log("Instancia anterior notificada exitosamente. Esperando liberación de recursos (5s)...");
            await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
            console.log(`El intento de apagado respondió con estado: ${response.status}`);
        }
    } catch (err) {
        console.log(`No se pudo notificar a la instancia anterior (es probable que no estuviera activa o respondiendo): ${err.message}`);
    }
    process.exit(0);
}

main();
