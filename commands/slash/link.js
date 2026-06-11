const { SlashCommandBuilder } = require("discord.js");
const linkChatCommand = require("../chat/osu/link.js");
const { addModoOption, parseOsuSlashArgs } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("link")
    .setDescription("Vincula o desvincula tu cuenta de discord con un usuario de osu!")
    .addStringOption(option =>
        option.setName("usuario")
            .setDescription("Nombre de usuario de osu! a vincular (dejar vacío para desvincular)")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("chat")
            .setDescription("Usa la vinculación tradicional de chat (pública)")
            .setRequired(false)
    )
    .addStringOption(addModoOption);

async function run(interaction, res) {
    const { args, messages } = parseOsuSlashArgs(interaction, res);
    const chat = interaction.options.getBoolean("chat");
    if (chat) {
        args.push("-chat");
    }
    messages.isSlash = true;
    messages.interaction = interaction;
    return await linkChatCommand.run(messages, args);
}

run.description = "Vincula o desvincula tu cuenta de discord con un usuario de osu!";
run.noDefer = true;

module.exports = { data, run, description: run.description };