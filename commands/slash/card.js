const { SlashCommandBuilder } = require("discord.js");
const cardChatCommand = require("../chat/osu/card.js");
const { createSlashMessagesContext, addUsuarioOption } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("card")
    .setDescription("Genera una tarjeta de perfil dinámica de osu! con Canvas")
    .addStringOption(addUsuarioOption)
    .addStringOption(option =>
        option.setName("modo")
            .setDescription("Modo de juego de la tarjeta")
            .setRequired(false)
            .addChoices(
                { name: "osu! (Standard)", value: "osu" },
                { name: "osu!taiko", value: "taiko" },
                { name: "osu!catch", value: "fruits" },
                { name: "osu!mania", value: "mania" }
            )
    )
    .addBooleanOption(option =>
        option
            .setName("embed")
            .setDescription("¿Enviar la tarjeta dentro de un embed?")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option
            .setName("userpage")
            .setDescription("¿Obtener el código BBCode seguro por mensaje privado para tu perfil de osu!?")
            .setRequired(false)
    )
    .addStringOption(option =>
        option
            .setName("preset")
            .setDescription("Preset de diseño y dimensiones de la tarjeta")
            .setRequired(false)
            .addChoices(
                { name: "Standard (Completa)", value: "standard" },
                { name: "Compacta (Solo avatar y skills)", value: "compact" },
                { name: "Línea (Fila única de 3 tarjetas)", value: "single_row" },
                { name: "Línea con Pinned Play (4 tarjetas)", value: "single_row_play" },
                { name: "Panorámica Completa (5 tarjetas)", value: "single_row_all" },
                { name: "Ultra Panorámica", value: "ultra" },
                { name: "Mini Card", value: "mini_card" }
            )
    )
    .addBooleanOption(option =>
        option
            .setName("recargar")
            .setDescription("¿Forzar la recarga ignorando la caché de 1 hora?")
            .setRequired(false)
    );

// Permitir instalación de usuario y servidores externos
if (typeof data.setIntegrationTypes === "function") {
    data.setIntegrationTypes([0, 1]);
}
if (typeof data.setContexts === "function") {
    data.setContexts([0, 1, 2]);
}

async function run(interaction, res, chat_commands) {
    const isEmbed = interaction.options.getBoolean("embed");
    const isUserpage = interaction.options.getBoolean("userpage");
    const preset = interaction.options.getString("preset");
    const isForce = interaction.options.getBoolean("recargar");
    const targetUser = interaction.options.getString("usuario");
    const modo = interaction.options.getString("modo");

    const args = [];
    if (targetUser) args.push(targetUser);
    if (modo) args.push(`-${modo}`);
    if (preset) args.push(`-${preset}`);
    if (isEmbed) args.push("-embed");
    if (isUserpage) args.push("-userpage");
    if (isForce) args.push("-refresh");

    const messages = createSlashMessagesContext(interaction, res);

    const result = await cardChatCommand.run(messages, args, chat_commands);
    return result || true;
}

run.description = "Genera una tarjeta de perfil dinámica de osu! con Canvas";

module.exports = { data, run, description: run.description };
