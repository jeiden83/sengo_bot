const { Client, GatewayIntentBits, ActivityType, Partials } = require("discord.js");
const { load_listeners } = require("./listeners/commands.js");
const { connectDB } = require("./db/database.js");
const { login } = require("./listeners/login.js");
const config = require("./config.json");
const readline = require('readline');
const mongoose = require('mongoose');
const Logger = require("./utils/logger.js");
const { syncYesterdayLogs } = require("./services/syncLogs.js");

let res;
let client;

async function main(reload) {
    const useSupabase = process.argv.includes('--supabase');
    Logger.system(`Iniciando SengoBot en modo ${useSupabase ? 'SUPABASE' : 'MONGODB'}...`);

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

    if (useSupabase && res.status === 1) {
        syncYesterdayLogs(res.supabaseClient).catch(err => {
            Logger.system(`Error en la tarea de sincronización de logs: ${err.message}`);
        });
    }

    await load_listeners(res, client, config);
    await login(client, config);  

    setupCommandLineInterface(res, client, config, reload); 
}
main();

async function shutdownGracefully() {
    Logger.system("Señal de apagado detectada. Cerrando recursos...");
    
    if (mongoose.connection && mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
        Logger.system("Conexión de MongoDB cerrada.");
    }
    
    if (client && client.user) {
        client.user.setActivity(null);
        client.destroy();
        Logger.system("Cliente Discord desconectado.");
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

            const useSupabase = process.argv.includes('--supabase');
            const activityText = useSupabase ? 'Activo con Supabase (recargado)' : 'Activo de nuevo';
            client.user.setActivity(activityText, { type: ActivityType.Playing });
        } else {
            console.log(`Comando no reconocido: ${input}`);
        }
    });
}