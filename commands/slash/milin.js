const { SlashCommandBuilder } = require("discord.js");
const milinChatCommand = require("../chat/meme/milin.js");

const data = new SlashCommandBuilder()
    .setName("milin")
    .setDescription("Muestra el gif de Milin");

async function run(interaction, res) {
    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);

    const result = await milinChatCommand.run(messages, []);

    if (result) {
        await interaction.editReply(result);
    }

    return true;
}

run.description = "Muestra el gif de Milin";

module.exports = {
    data,
    run,
    description: run.description
};
