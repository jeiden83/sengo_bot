const { Client, GatewayIntentBits } = require("discord.js");
const { load_listeners } = require("./listeners/commands.js");
const { connectDB } = require("./db/database.js");
const { login } = require("./listeners/login.js");
const config = require("./config.json");
const readline = require('readline');

let res;
let client;

async function main(reload) {
    client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] });
    res = await connectDB(config);

    await load_listeners(res, client, config);
    await login(client, config);  

    setupCommandLineInterface(res, client, config, reload); 
}
main();

async function setupCommandLineInterface(res, client, config, reload) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.on('line', async (input) => {
        input = input.trim().toLowerCase();
        if (input === 'exit') {

            console.log('Saliendo...');
            client.user.setActivity(null);
            process.exit(0);
        } else if(input === "r"){

            console.log('# Recargando...');
            client.user.setActivity(null);

            await load_listeners(res, client, config);
        } else {
            console.log(`Comando no reconocido: ${input}`);
        }
    });
}