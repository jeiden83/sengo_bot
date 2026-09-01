const { SlashCommandBuilder } = require("discord.js");
const inviteChatCommand = require("../chat/about/invite.js");

const data = new SlashCommandBuilder()
    .setName("invite")
    .setDescription("Obtén el enlace oficial de invitación para añadir a Sengo a tu servidor.");

async function run(interaction, res) {
    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);

    await inviteChatCommand.run(messages, []);

    return true;
}

run.description = "Obtén el enlace oficial de invitación para añadir a Sengo a tu servidor.";

module.exports = { data, run, description: run.description };
