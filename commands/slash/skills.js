const { SlashCommandBuilder } = require("discord.js");
const skillsChatCommand = require("../chat/osu/skills.js");
const { createSlashMessagesContext, addUsuarioOption } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("skills")
    .setDescription("Desglosa las habilidades de osu! de la tarjeta (.card) con sus mejores jugadas")
    .addStringOption(addUsuarioOption);

// Permitir instalación de usuario y servidores externos
if (typeof data.setIntegrationTypes === "function") {
    data.setIntegrationTypes([0, 1]);
}
if (typeof data.setContexts === "function") {
    data.setContexts([0, 1, 2]);
}

async function run(interaction, res, chat_commands) {
    const targetUser = interaction.options.getString("usuario");

    const args = [];
    if (targetUser) args.push(targetUser);

    const messages = createSlashMessagesContext(interaction, res);

    const result = await skillsChatCommand.run(messages, args, chat_commands);
    if (result && (result.embeds || result.content || typeof result === "string")) {
        await interaction.editReply(result);
    }
    return result || true;
}

run.description = "Desglosa las habilidades de osu! de la tarjeta (.card) con sus mejores jugadas";

module.exports = { data, run, description: run.description };
