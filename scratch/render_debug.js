const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Parseador simple de .env para obtener RENDER_KEY
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const match = envContent.match(/^RENDER_KEY=(.*)$/m);
if (!match) {
    console.error("No se encontró RENDER_KEY en el archivo .env");
    process.exit(1);
}
const RENDER_KEY = match[1].trim();

const client = axios.create({
    baseURL: 'https://api.render.com/v1',
    headers: {
        'Authorization': `Bearer ${RENDER_KEY}`,
        'Accept': 'application/json'
    }
});

async function main() {
    try {
        console.log("Conectando con la API de Render para listar servicios...");
        const servicesRes = await client.get('/services?limit=20');
        const services = servicesRes.data;
        
        if (!services || services.length === 0) {
            console.log("No se encontraron servicios en esta cuenta de Render.");
            return;
        }

        console.log(`\nServicios encontrados (${services.length}):`);
        services.forEach(s => {
            console.log(`- Nombre: ${s.service.name}`);
            console.log(`  ID: ${s.service.id}`);
            console.log(`  Tipo: ${s.service.type}`);
            console.log(`  Estado: ${s.service.suspended === 'suspended' ? 'Suspendido' : 'Activo'}`);
            console.log(`  URL: ${s.service.repo}`);
            console.log(`------------------------------------------------`);
        });

        // Buscar servicio del bot
        const botService = services.find(s => s.service.name.toLowerCase().includes('sengo'));
        if (!botService) {
            console.log("\n[!] No se encontró ningún servicio con 'sengo' en el nombre.");
            return;
        }

        const serviceId = botService.service.id;
        console.log(`\n[+] Consultando despliegues del bot: ${botService.service.name} (${serviceId})...`);
        const deploysRes = await client.get(`/services/${serviceId}/deploys?limit=5`);
        const deploys = deploysRes.data;

        if (!deploys || deploys.length === 0) {
            console.log("No hay despliegues registrados para este servicio.");
            return;
        }

        console.log(`\nÚltimos despliegues (${deploys.length}):`);
        deploys.forEach((d, idx) => {
            const dep = d.deploy;
            console.log(`${idx + 1}. ID: ${dep.id}`);
            console.log(`   Estado: ${dep.status.toUpperCase()}`);
            console.log(`   Creado: ${dep.createdAt}`);
            console.log(`   Finalizado: ${dep.finishedAt || 'En proceso...'}`);
            if (dep.commit) {
                console.log(`   Commit: ${dep.commit.id.substring(0, 7)} - ${dep.commit.message.trim()}`);
            }
            console.log(`------------------------------------------------`);
        });

        // Consultar el detalle del deploy más reciente
        const latestDeployId = deploys[0].deploy.id;
        console.log(`\n[+] Consultando detalles completos de la última deploy: ${latestDeployId}...`);
        const deployDetailRes = await client.get(`/services/${serviceId}/deploys/${latestDeployId}`);
        console.log("Detalles completos del Deploy:");
        console.log(JSON.stringify(deployDetailRes.data, null, 2));

        console.log(`\n[+] Consultando logs de ejecución del servicio...`);
        try {
            // Probamos consultar los logs del servicio (pueden ser de tipo 'app' o general)
            const logsRes = await client.get(`/services/${serviceId}/logs?limit=50`);
            console.log("\n--- LOGS DE RENDER ---");
            if (Array.isArray(logsRes.data)) {
                logsRes.data.forEach(log => {
                    console.log(`[${log.timestamp}] [${log.type}] ${log.message}`);
                });
            } else {
                console.log(JSON.stringify(logsRes.data, null, 2));
            }
            console.log("----------------------");
        } catch (logErr) {
            console.log("No se pudo obtener logs a través del endpoint de logs directos de servicios:", logErr.message);
            // Intentar con el endpoint general de logs si es necesario
            try {
                const generalLogsRes = await client.get(`/logs?resourceId=${serviceId}&limit=50`);
                console.log("\n--- LOGS DE RENDER (GENERAL) ---");
                console.log(JSON.stringify(generalLogsRes.data, null, 2));
                console.log("--------------------------------");
            } catch (genErr) {
                console.log("No se pudo obtener logs a través del endpoint /logs:", genErr.message);
            }
        }

    } catch (error) {
        console.error("Error al consultar la API de Render:");
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error("Data:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message);
        }
    }
}

main();
