const { SlashCommandBuilder } = require("discord.js");
const antiskillsChatCommand = require("../chat/osu/antiskills.js");
const { createSlashMessagesContext, addUsuarioOption } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("antiskills")
    .setDescription("Diagnostica debilidades, puntos ciegos, kryptonitas de mods y mapa némesis de un jugador")
    .addStringOption(addUsuarioOption)
    .addStringOption(option =>
        option.setName("modo")
            .setDescription("Modo de juego a evaluar")
            .addChoices(
                { name: "osu! (Standard)", value: "osu" },
                { name: "osu!taiko", value: "taiko" },
                { name: "osu!catch", value: "fruits" },
                { name: "osu!mania", value: "mania" }
            )
    )
    .addBooleanOption(option =>
        option.setName("force")
            .setDescription("Forzar recálculo ignorando la caché")
    );

// Permitir instalación de usuario y servidores externos
if (typeof data.setIntegrationTypes === "function") {
    data.setIntegrationTypes([0, 1]);
}
if (typeof data.setContexts === "function") {
    data.setContexts([0, 1, 2]);
}

async function run(interaction, res, chat_commands) {
    const targetUser = interaction.options.getString("usuario");
    const modo = interaction.options.getString("modo");
    const isForce = interaction.options.getBoolean("force");

    const args = [];
    if (targetUser) args.push(targetUser);
    if (modo) args.push(`-${modo}`);
    if (isForce) args.push("-force");

    const messages = createSlashMessagesContext(interaction, res);
    messages.interaction = interaction;

    const result = await antiskillsChatCommand.run(messages, args, chat_commands);
    if (typeof result === "string") {
        await interaction.editReply({ content: result });
    }
    return result || true;
}

run.description = "Diagnostica debilidades, puntos ciegos, kryptonitas de mods y mapa némesis de un jugador";

module.exports = { data, run, description: run.description };
