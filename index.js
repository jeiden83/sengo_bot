const { Client, GatewayIntentBits, ActivityType, Partials } = require("discord.js");
const { load_listeners } = require("./listeners/commands.js");
const { connectDB } = require("./db/database.js");
const { login } = require("./listeners/login.js");
const config = require("./config.js");
const readline = require('readline');

const Logger = require("./utils/logger.js");
const { syncOlderLogs, analyzeTodayLogs } = require("./services/syncLogs.js");
const fs = require('fs');
const path = require('path');

let res;
let client;

async function main(reload) {

    
    // 1. Verificar si ya existe el log de hoy para extraer analíticas antes de registrar el nuevo inicio
    const todayStr = Logger.getLocalDateString();
    const logPath = path.join(process.cwd(), 'db/local/logs', `${todayStr}.log`);
    const todayLogExists = fs.existsSync(logPath);

    if (todayLogExists) {
        const stats = analyzeTodayLogs();
        if (stats) {
            Logger.system(`Reinicio detectado hoy. Este bot ha iniciado ${stats.startsCount} veces hoy.`);
            Logger.system(`Resumen acumulado del día: ${stats.commandsCount} comandos ejecutados a lo largo de ${stats.serversCount} servidor(es).`);
        }
    }

    // 2. Registrar el inicio actual del bot en el log diario de hoy
    Logger.system("Iniciando SengoBot en modo SUPABASE...");

    // Notificar apagado a la instancia anterior si estamos en Render
    const externalUrl = process.env.RENDER_EXTERNAL_URL;
    if (externalUrl) {
        Logger.system(`Entorno de Render detectado. Notificando apagado a la instancia anterior en: ${externalUrl}`);
        try {
            const response = await fetch(`${externalUrl}/shutdown`, {
                method: 'POST',
                headers: {
                    'Authorization': process.env.SHUTDOWN_TOKEN || config.OSU_CLIENT_SECRET,
                    'Content-Type': 'application/json'
                }
            });
            if (response.ok) {
                Logger.system("Instancia anterior notificada exitosamente. Esperando liberación de recursos (4s)...");
                await new Promise(resolve => setTimeout(resolve, 4000));
            } else {
                Logger.system(`Intento de apagado de la instancia anterior respondió con estado: ${response.status}`);
            }
        } catch (err) {
            Logger.system(`No se pudo notificar a la instancia anterior (es posible que no esté activa): ${err.message}`);
        }
    }

    client = new Client({ 
        intents: [
            GatewayIntentBits.Guilds, 
            GatewayIntentBits.GuildMessages, 
            GatewayIntentBits.MessageContent, 
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.DirectMessages,
            GatewayIntentBits.DirectMessageReactions
        ],
        partials: [Partials.Channel, Partials.Message, Partials.Reaction]
    });
    
    res = await connectDB(config);

    if (res.status === 1) {
        const { syncYuriImages } = require("./commands/utils/yuriSync.js");
        syncYuriImages(res.supabaseClient).catch(err => {
            Logger.system(`Error en la tarea de sincronización de imágenes yuri: ${err.message}`);
        });
    }

    // 3. Si es el primer encendido del día (no existía el archivo log de hoy) y está en Supabase, subir logs de días anteriores
    if (!todayLogExists && res.status === 1) {
        syncOlderLogs(res.supabaseClient).catch(err => {
            Logger.system(`Error en la tarea de sincronización de logs antiguos: ${err.message}`);
        });
    }

    await load_listeners(res, client, config);

    // Inicializar el servidor HTTP de webhook de GitHub (para asegurar el puerto de Render)
    const { initWebhookServer } = require("./commands/utils/webhook.js");
    initWebhookServer(client, res, config);

    await login(client, config);  

    if (process.stdin.isTTY) {
        setupCommandLineInterface(res, client, config, reload); 
    } else {
        Logger.system("Entorno no interactivo detectado. Consola interactiva desactivada.");
    }
}
main();

async function shutdownGracefully() {
    Logger.system("Señal de apagado detectada. Cerrando recursos...");
    

    
    if (client && client.user) {
        client.user.setActivity(null);
        client.destroy();
        Logger.system("Cliente Discord desconectado.");
    }

    try {
        const { serverInstance, killNgrok } = require("./commands/utils/webhook.js");
        if (serverInstance) {
            serverInstance.close();
            Logger.system("Servidor de webhook de GitHub cerrado.");
        }
        killNgrok();
    } catch (e) {
        // Ignorar errores al cerrar si no existiera
    }
    
    Logger.system("Apagado seguro completado. ¡Hasta luego!");
    process.exit(0);
}

process.on('SIGINT', shutdownGracefully);
process.on('SIGTERM', shutdownGracefully);

async function setupCommandLineInterface(res, client, config, reload) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.on('line', async (input) => {
        input = input.trim().toLowerCase();
        if (input === 'exit') {
            await shutdownGracefully();
        } else if(input === "r"){

            Logger.system("Recargando comandos y listeners...");
            await load_listeners(res, client, config);

            // Reinicializar el servidor HTTP de webhook de GitHub en la recarga
            const { initWebhookServer } = require("./commands/utils/webhook.js");
            initWebhookServer(client, res, config);

            const { version } = require('./package.json');
            const activityText = `v${version} - Activo (recargado)`;
            client.user.setActivity(activityText, { type: ActivityType.Playing });
        } else {
            console.log(`Comando no reconocido: ${input}`);
        }
    });
}