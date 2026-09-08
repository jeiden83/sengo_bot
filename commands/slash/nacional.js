const { SlashCommandBuilder } = require("discord.js");
const nacionalChatCommand = require("../chat/osu/nacional.js");
const { addModoOption, parseOsuSlashArgs, createSlashMessagesContext } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("nacional")
    .setDescription("Muestra la tabla de clasificación por Performance Points (pp) de un país")
    .addStringOption(addModoOption)
    .addStringOption(option =>
        option.setName("pais")
            .setDescription("Código de país de 2 letras (ej: MX, CL, VE). Escribe SELF para autodetectar.")
            .setRequired(false)
    )
    .addIntegerOption(option =>
        option.setName("pagina")
            .setDescription("Página del ranking nacional a mostrar")
            .setRequired(false)
            .setMinValue(1)
    )
    .addBooleanOption(option =>
        option.setName("pp")
            .setDescription("Muestra el ranking de mejores jugadas por PP a nivel nacional (-pp)")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("tops")
            .setDescription("Muestra el ranking de tops nacionales (#1s) y snipes (-tops)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("mods")
            .setDescription("Filtra las jugadas por mods exactos (ej: HDDT) en modo -pp")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("buscar")
            .setDescription("Busca jugadas por nombre de mapa, artista o creador en modo -pp")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("sr")
            .setDescription("Filtra por dificultad de estrellas (ej: >7, <=6.5) en modo -pp")
            .setRequired(false)
    )
    .addNumberOption(option =>
        option.setName("minpp")
            .setDescription("Filtra por umbral mínimo de PP (ej: 600) en modo -pp")
            .setRequired(false)
    )
    .addIntegerOption(option =>
        option.setName("index")
            .setDescription("Muestra una jugada individual en la posición indicada (-i)")
            .setRequired(false)
            .setMinValue(1)
    )
    .addBooleanOption(option =>
        option.setName("acc")
            .setDescription("Ordenar por precisión (Acc) en lugar de Performance Points")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("score")
            .setDescription("Ordenar por ranked score en lugar de Performance Points")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("totalscore")
            .setDescription("Ordenar por score total en lugar de Performance Points")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("regional")
            .setDescription("Nombre o código de la región para mostrar, o 'lista' para ver las opciones")
            .setRequired(false)
    );

async function run(interaction, res) {
    const { args } = parseOsuSlashArgs(interaction, res);

    const pais = interaction.options.getString("pais");
    const pagina = interaction.options.getInteger("pagina");
    const pp = interaction.options.getBoolean("pp");
    const tops = interaction.options.getBoolean("tops");
    const mods = interaction.options.getString("mods");
    const buscar = interaction.options.getString("buscar");
    const sr = interaction.options.getString("sr");
    const minpp = interaction.options.getNumber("minpp");
    const index = interaction.options.getInteger("index");
    const acc = interaction.options.getBoolean("acc");
    const score = interaction.options.getBoolean("score");
    const totalscore = interaction.options.getBoolean("totalscore");
    const regional = interaction.options.getString("regional");

    if (pais !== null && pais !== undefined) {
        args.push("-pais", pais);
    }
    if (pagina) {
        args.push(`-p${pagina}`);
    }
    if (pp) {
        args.push("-pp");
    }
    if (tops) {
        args.push("-tops");
    }
    if (mods) {
        args.push("-m", mods);
    }
    if (buscar) {
        args.push("-?", `"${buscar}"`);
    }
    if (sr) {
        const cleanSr = sr.trim().startsWith("-sr") ? sr.trim() : `-sr${sr.trim()}`;
        args.push(cleanSr);
    }
    if (minpp !== null && minpp !== undefined) {
        args.push("-g", minpp.toString());
    }
    if (index) {
        args.push("-i", index.toString());
    }
    if (acc) {
        args.push("-acc");
    }
    if (score) {
        args.push("-score");
    }
    if (totalscore) {
        args.push("-totalscore");
    }
    if (regional !== null && regional !== undefined) {
        args.push("-regional", regional);
    }

    const messages = createSlashMessagesContext(interaction, res);
    const result = await nacionalChatCommand.run(messages, args);

    if (result && typeof result === 'string') {
        await interaction.editReply(result);
    }

    return result || true;
}

run.description = "Muestra la tabla de clasificación por Performance Points (pp) de un país";

module.exports = { data, run, description: run.description };
