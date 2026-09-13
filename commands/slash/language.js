const { SlashCommandBuilder } = require("discord.js");
const languageChatCommand = require("../chat/moderation/language.js");

const data = new SlashCommandBuilder()
    .setName("language")
    .setDescription("Configura tu idioma personal o del servidor / Set personal or server language")
    .addStringOption(option =>
        option.setName("lang")
            .setDescription("Idioma / Language (es | en | reset)")
            .setRequired(true)
            .addChoices(
                { name: "Español", value: "es" },
                { name: "English", value: "en" },
                { name: "Restablecer / Reset", value: "reset" }
            )
    )
    .addStringOption(option =>
        option.setName("scope")
            .setDescription("Ámbito / Scope (Personal o Servidor)")
            .setRequired(false)
            .addChoices(
                { name: "Personal (Solo para ti)", value: "user" },
                { name: "Servidor (Requiere Administrador)", value: "server" }
            )
    );

async function run(interaction, res) {
    const langValue = interaction.options.getString("lang");
    const scopeValue = interaction.options.getString("scope") || "user";

    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);

    const args = scopeValue === "server" ? ["server", langValue] : [langValue];
    const result = await languageChatCommand.run(messages, args);

    if (result) {
        await interaction.editReply(result);
    }

    return true;
}

run.description = "Configura tu idioma personal o del servidor / Set personal or server language";

module.exports = { data, run, description: run.description };
