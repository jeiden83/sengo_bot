const { SlashCommandBuilder } = require("discord.js");
const mapperChatCommand = require("../chat/osu/mapper.js");
const { addUsuarioOption, addModoOption, addServidorOption, parseOsuSlashArgs } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("mapper")
    .setDescription("Muestra las estadísticas de creador/mapper de un usuario en osu!")
    .addStringOption(addUsuarioOption)
    .addStringOption(addModoOption)
    .addStringOption(addServidorOption);

async function run(interaction, res) {
    const { args, messages } = parseOsuSlashArgs(interaction, res);
    return await mapperChatCommand.run(messages, args);
}

run.description = "Muestra las estadísticas de creador/mapper de un usuario en osu!";

module.exports = { data, run, description: run.description };
