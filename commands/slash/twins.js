const { SlashCommandBuilder } = require("discord.js");
const twinsChatCommand = require("../chat/osu/twins.js");
const { addUsuarioOption, addModoOption, createSlashMessagesContext } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("twins")
    .setDescription("Encuentra a tu gemelo de juego en osu! según afinidad de mods, PP o habilidades")
    .addStringOption(addUsuarioOption)
    .addStringOption(addModoOption)
    .addStringOption(option =>
        option.setName("mods")
            .setDescription("Filtrar por afinidad en mods específicos (ej: EZ, HDDT, NM)")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("pp")
            .setDescription("Ordenar por cercanía en PP (más cercano primero)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("skills")
            .setDescription("Buscar por cercanía en habilidades cinéticas")
            .setRequired(false)
            .addChoices(
                { name: "Todas las habilidades (Perfil general)", value: "ALL" },
                { name: "Aim (Puntería)", value: "AIM" },
                { name: "Speed (Velocidad)", value: "SPEED" },
                { name: "Acc (Precisión)", value: "ACC" },
                { name: "Reading (Lectura)", value: "READING" },
                { name: "Stamina (Resistencia)", value: "STAMINA" }
            )
    )
    .addStringOption(option =>
        option.setName("pais")
            .setDescription("Filtrar gemelos únicamente de este código de país (ej: CL, VE, ES, AR, US)")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("priorizar_pais")
            .setDescription("Priorizar jugadores de tu país al inicio de la lista")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("lista")
            .setDescription("Mostrar los gemelos en una lista compacta de a 5")
            .setRequired(false)
    )
    .addIntegerOption(option =>
        option.setName("indice")
            .setDescription("Índice de gemelo específico a consultar directamente (1 a 25)")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(25)
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
    const mods = interaction.options.getString("mods");
    const sortByPP = interaction.options.getBoolean("pp");
    const skills = interaction.options.getString("skills");
    const pais = interaction.options.getString("pais");
    const priorizarPais = interaction.options.getBoolean("priorizar_pais");
    const lista = interaction.options.getBoolean("lista");
    const indice = interaction.options.getInteger("indice");
    const closeRank = interaction.options.getBoolean("rank");

    const args = [];
    if (targetUser) args.push(targetUser);
    if (modo) args.push(`-${modo}`);
    if (mods) args.push("-mods", mods);
    if (sortByPP) args.push("-pp");
    if (skills) args.push("-skills", skills);
    if (pais) args.push("-pais", pais);
    else if (priorizarPais) args.push("-pais");
    if (lista) args.push("-l");
    if (indice) args.push("-i", String(indice));
    if (closeRank) args.push("-rank");

    const messages = createSlashMessagesContext(interaction, res);

    const result = await twinsChatCommand.run(messages, args, chat_commands);
    return result || true;
}

run.description = "Encuentra a tu gemelo de juego en osu! según la afinidad y ponderación real de tus mods";

module.exports = { data, run, description: run.description };
