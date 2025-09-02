const { chatCommand, slashCommand, loadCommands, loadSlashCommands } = require("../commands/handler.js");
const { PermissionsBitField } = require('discord.js');


async function chat_command_listener(chat_commands, client, config, res) {
    
    const chatMessageListener = async (message) => {
        if (!message.content.toLowerCase().startsWith(config.BOT_PREFIX)) {
            return;
        }    

        const botMember = message.guild.members.cache.get(client.user.id);
        const botPermissions = message.channel.permissionsFor(botMember);
        if (!botPermissions || !botPermissions.has(PermissionsBitField.Flags.SendMessages)) {
            console.error("El bot no tiene permisos para enviar mensajes en este canal.");
            return;
        }

        await message.channel.sendTyping();

        const message_args = message.content.slice(config.BOT_PREFIX.length).trim().split(/ +/);
        const message_command = message_args.shift().toLowerCase();
        const message_reply = message.reference ? await message.channel.messages.fetch(message.reference.messageId) : null;

        try {
            const command_result = await chatCommand(
                chat_commands, 
                {
                    'command' : message_command,
                    'args' : message_args,
                    'message' : message, 
                    'res': res,
                    'reply' : message_reply
                }
            );
            if(!command_result) return;

            message.channel.send(command_result);
        } catch (error) {
            
            console.error("Error ejecutando el comando:", error);
            message.channel.send("Hubo un error al ejecutar el comando. Ahora <@395623267530047489> lo sabrá.");
        }
    };

    client.on("messageCreate", chatMessageListener);

    return client;
}

async function slash_command_listener(chat_commands, slash_commands, client) {
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isCommand()) return;

        try {
            // Para avisar que se mandara un slash
            await interaction.deferReply();

            await interaction.editReply(
                await slashCommand(chat_commands, slash_commands, interaction)
            );

        } catch (error) {
            
            console.error("Error ejecutando el comando:", error);
            await interaction.editReply(
                "Hubo un error al ejecutar el comando. Ahora <@395623267530047489> lo sabrá."
            );
        }
    });
}

async function load_listeners(res, client, config){
    client.removeAllListeners();

    const chat_commands = await loadCommands();
    const slash_commands = await loadSlashCommands(chat_commands, config);

    slash_command_listener(chat_commands, slash_commands, client); 
    chat_command_listener(chat_commands, client, config, res);
}

module.exports = { load_listeners };