const { SlashCommandBuilder } = require("discord.js");
const skillsChatCommand = require("../chat/osu/skills.js");
const { createSlashMessagesContext, addUsuarioOption } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("skills")
    .setDescription("Desglosa las habilidades de osu! de la tarjeta (.card) con sus mejores jugadas")
    .addStringOption(addUsuarioOption)
    .addStringOption(option =>
        option.setName("modo")
            .setDescription("Modo de juego")
            .addChoices(
                { name: "osu! (Standard)", value: "osu" },
                { name: "osu!taiko", value: "taiko" },
                { name: "osu!catch", value: "fruits" },
                { name: "osu!mania", value: "mania" }
            )
    )
    .addBooleanOption(option =>
        option.setName("top")
            .setDescription("Desglosar habilidades en formato de lista de mejores jugadas (.top)")
    )
    .addStringOption(option =>
        option.setName("skill")
            .setDescription("Filtrar por habilidad específica")
            .addChoices(
                { name: "Aim (osu!)", value: "aim" },
                { name: "Speed (osu! / catch)", value: "speed" },
                { name: "Accuracy (todos)", value: "acc" },
                { name: "Reading (osu! / catch)", value: "reading" },
                { name: "Stamina (taiko)", value: "stamina" },
                { name: "Color / Switching (taiko)", value: "color" },
                { name: "Rhythm (taiko)", value: "rhythm" },
                { name: "Movement (catch)", value: "movement" },
                { name: "Stream / Speed (mania)", value: "stream" },
                { name: "Jack / Stamina (mania)", value: "jack" },
                { name: "LN / Tech (mania)", value: "tech" }
            )
    )
    .addStringOption(option =>
        option.setName("mods")
            .setDescription("Filtrar por mods (ej: HDHR o NM)")
    )
    .addIntegerOption(option =>
        option.setName("page")
            .setDescription("Número de página de la lista")
            .setMinValue(1)
    )
    .addIntegerOption(option =>
        option.setName("index")
            .setDescription("Mostrar una jugada específica (1-100)")
            .setMinValue(1)
            .setMaxValue(100)
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
    const isTop = interaction.options.getBoolean("top");
    const skill = interaction.options.getString("skill");
    const mods = interaction.options.getString("mods");
    const page = interaction.options.getInteger("page");
    const index = interaction.options.getInteger("index");

    const args = [];
    if (targetUser) args.push(targetUser);
    if (modo) args.push(`-${modo}`);
    if (isTop) args.push("-top");
    if (skill) args.push(`-${skill}`);
    if (mods) args.push("-m", mods);
    if (page) args.push("-p", String(page));
    if (index) args.push("-i", String(index));

    const messages = createSlashMessagesContext(interaction, res);

    const result = await skillsChatCommand.run(messages, args, chat_commands);
    if (result && (result.embeds || result.content || typeof result === "string")) {
        await interaction.editReply(result);
    }
    return result || true;
}

run.description = "Desglosa las habilidades de osu! de la tarjeta (.card) con sus mejores jugadas";

module.exports = { data, run, description: run.description };
