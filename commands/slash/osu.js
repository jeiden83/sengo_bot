const { SlashCommandBuilder } = require("discord.js");
const osuChatCommand = require("../chat/osu/osu.js");
const { addUsuarioOption, addModoOption, addServidorOption, parseOsuSlashArgs } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("osu")
    .setDescription("Muestra el perfil de un usuario en osu!")
    .addStringOption(addUsuarioOption)
    .addStringOption(addModoOption)
    .addStringOption(addServidorOption);

async function run(interaction, res) {
    const { args, messages } = parseOsuSlashArgs(interaction, res);
    return await osuChatCommand.run(messages, args);
}

run.description = "Muestra el perfil de un usuario en osu!";

module.exports = { data, run, description: run.description };
