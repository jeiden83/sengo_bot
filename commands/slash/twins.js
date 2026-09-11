const { SlashCommandBuilder } = require("discord.js");
const twinsChatCommand = require("../chat/osu/twins.js");
const { addUsuarioOption, addModoOption, createSlashMessagesContext } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("twins")
    .setDescription("Encuentra a tu gemelo de juego en osu! según la afinidad y ponderación real de tus mods")
    .addStringOption(addUsuarioOption)
    .addStringOption(addModoOption)
    .addStringOption(option =>
        option.setName("pais")
            .setDescription("Filtrar gemelos por código de país (ej: VE, ES, CL, AR, US)")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("rank")
            .setDescription("Filtrar gemelos con rango/nivel global similar al tuyo")
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
    const targetUser = interaction.options.getString("usuario");
    const modo = interaction.options.getString("modo");
    const pais = interaction.options.getString("pais");
    const closeRank = interaction.options.getBoolean("rank");

    const args = [];
    if (targetUser) args.push(targetUser);
    if (modo) args.push(`-${modo}`);
    if (pais) args.push("-pais", pais);
    if (closeRank) args.push("-rank");

    const messages = createSlashMessagesContext(interaction, res);

    const result = await twinsChatCommand.run(messages, args, chat_commands);
    return result || true;
}

run.description = "Encuentra a tu gemelo de juego en osu! según la afinidad y ponderación real de tus mods";

module.exports = { data, run, description: run.description };
