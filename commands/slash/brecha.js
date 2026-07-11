const { SlashCommandBuilder } = require("discord.js");
const brechaChatCommand = require("../chat/utils/brecha.js");

const data = new SlashCommandBuilder()
    .setName("brecha")
    .setDescription("Calcula la brecha cambiaria en Venezuela (BCV vs Binance P2P)");

async function run(interaction, res) {
    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);

    const result = await brechaChatCommand.run(messages, []);

    if (result) {
        await interaction.editReply(result);
    }
    return true;
}

run.description = "Calcula la brecha cambiaria en Venezuela (BCV vs Binance P2P)";

module.exports = { data, run, description: run.description };
