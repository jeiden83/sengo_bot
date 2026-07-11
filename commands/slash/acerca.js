const { SlashCommandBuilder } = require("discord.js");
const acercaChatCommand = require("../chat/about/acerca.js");

const data = new SlashCommandBuilder()
    .setName("acerca")
    .setDescription("Muestra información detallada sobre Sengo y qué lo hace sobresalir.");

async function run(interaction, res) {
    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);

    await acercaChatCommand.run(messages, []);

    return true;
}

run.description = "Muestra información detallada sobre Sengo y qué lo hace sobresalir.";

module.exports = { data, run, description: run.description };
