const { SlashCommandBuilder } = require("discord.js");
const compareChatCommand = require("../chat/osu/c.js");
const { addUsuarioOption, addModoOption, addServidorOption, parseOsuSlashArgs } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("c")
    .setDescription("Compara tus scores (o las de otro usuario) en el último mapa enviado en el canal")
    .addStringOption(addUsuarioOption)
    .addStringOption(addModoOption)
    .addStringOption(addServidorOption);

async function run(interaction, res) {
    const { args, messages } = parseOsuSlashArgs(interaction, res);
    
    // Agregamos la propiedad 'channel' al mensaje virtual
    messages.message.channel = interaction.channel;

    return await compareChatCommand.run(messages, args);
}

run.description = "Compara tus scores (o las de otro usuario) en el último mapa enviado en el canal";

module.exports = { data, run, description: run.description };
