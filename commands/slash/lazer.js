const { SlashCommandBuilder } = require("discord.js");
const lazerChatCommand = require("../chat/osu/lazer.js");

const data = new SlashCommandBuilder()
    .setName("lazer")
    .setDescription("Muestra la jugada referenciada en formato lazer (Lazer Score)")
    .addStringOption(option => 
        option.setName("mensaje")
            .setDescription("URL o ID del mensaje con el embed a alternar (opcional)")
            .setRequired(false)
    );

async function run(interaction, res) {
    const args = [];
    const messageUrlOrId = interaction.options.getString("mensaje");

    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);
    messages.message.reference = null;

    if (messageUrlOrId) {
        const idMatch = messageUrlOrId.match(/\d+$/);
        if (idMatch) {
            messages.message.reference = {
                messageId: idMatch[0]
            };
        }
    }

    const result = await lazerChatCommand.run(messages, args);
    if (result) {
        if (typeof result === "string") {
            await interaction.editReply({ content: result });
        } else {
            await interaction.editReply(result);
        }
    }
    return true;
}

run.description = "Muestra la jugada referenciada en formato lazer (Lazer Score)";

module.exports = { data, run, description: run.description };
