const { SlashCommandBuilder } = require("discord.js");
const linkChatCommand = require("../chat/osu/link.js");
const { addModoOption, parseOsuSlashArgs } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("link")
    .setDescription("Vincula o desvincula tu cuenta de discord con un usuario de osu!")
    .addStringOption(option =>
        option.setName("usuario")
            .setDescription("Escribe 'unlink' o 'desvincular' para desvincular tu cuenta")
            .setRequired(false)
    )
    .addStringOption(addModoOption);

async function run(interaction, res) {
    const { args, messages } = parseOsuSlashArgs(interaction, res);
    messages.isSlash = true;
    messages.interaction = interaction;
    return await linkChatCommand.run(messages, args);
}

run.description = "Vincula o desvincula tu cuenta de discord con un usuario de osu!";
run.noDefer = true;

module.exports = { data, run, description: run.description };