const { SlashCommandBuilder } = require("discord.js");
const helpChatCommand = require("../chat/general/help.js");

const data = new SlashCommandBuilder()
    .setName("help")
    .setDescription("Muestra la lista de comandos de Sengo o ayuda para uno específico")
    .addStringOption(option =>
        option.setName("comando")
            .setDescription("Comando del que quieres ver los detalles y modo de uso")
            .setRequired(false)
    );

// Permitir instalación de usuario y contextos
if (typeof data.setIntegrationTypes === 'function') {
    data.setIntegrationTypes([0, 1]);
}
if (typeof data.setContexts === 'function') {
    data.setContexts([0, 1, 2]);
}

async function run(interaction, res, chat_commands) {
    const comando = interaction.options.getString("comando");

    const args = [];
    if (comando) {
        args.push(comando);
    }

    const messages = {
        message: {
            author: interaction.user,
            member: interaction.member,
            guild: interaction.guild
        },
        res: res,
        reply: null
    };

    // Ejecutar el comando help de chat pasándole la colección chat_commands
    return await helpChatCommand.run(messages, args, chat_commands);
}

module.exports = { data, run, description: "Muestra la lista de comandos de Sengo o ayuda para uno específico" };
