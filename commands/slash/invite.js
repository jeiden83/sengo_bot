const { SlashCommandBuilder } = require("discord.js");
const inviteChatCommand = require("../chat/about/invite.js");

const data = new SlashCommandBuilder()
    .setName("invite")
    .setDescription("Obtén el enlace oficial de invitación para añadir a Sengo a tu servidor.");

async function run(interaction, res) {
    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);

    const result = await inviteChatCommand.run(messages, []);
    if (result) {
        if (typeof result === "string") {
            await interaction.editReply({ content: result });
        } else {
            await interaction.editReply(result);
        }
    }

    return true;
}

run.description = "Obtén el enlace oficial de invitación para añadir a Sengo a tu servidor.";

module.exports = { data, run, description: run.description };
