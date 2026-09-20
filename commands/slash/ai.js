const { SlashCommandBuilder } = require("discord.js");
const { createSlashMessagesContext } = require("../utils/slashUtils.js");
const aiChatCommand = require("../chat/utils/ai.js");

const data = new SlashCommandBuilder()
    .setName("ai")
    .setDescription("Ejecuta comandos de Sengo usando lenguaje natural con TypeSafe Jev")
    .addStringOption(option =>
        option.setName("prompt")
            .setDescription("¿Qué deseas consultar o hacer? (ej: dime mi top en std, recomiéndame mapas)")
            .setRequired(true)
    );

async function run(interaction, res) {
    const prompt = interaction.options.getString("prompt");
    const messages = createSlashMessagesContext(interaction, res);
    const result = await aiChatCommand.run(messages, [prompt]);
    return result || true;
}

module.exports = {
    data,
    run,
    description: "Ejecuta comandos de Sengo usando lenguaje natural con TypeSafe Jev"
};
