const { SlashCommandBuilder } = require("discord.js");
const simChatCommand = require("../chat/osu/sim.js");
const { parseOsuSlashArgs } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("sim")
    .setDescription("Simula una jugada en un mapa para calcular su PP.")
    .addStringOption(option =>
        option.setName("mapa")
            .setDescription("Link o ID del mapa a simular (ej: https://osu.ppy.sh/b/123456)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("acc")
            .setDescription("Precisión deseada (ej: 99%, 98.5)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("mods")
            .setDescription("Mods para la simulación (ej: HDDT, HR, NM)")
            .setRequired(false)
    )
    .addIntegerOption(option =>
        option.setName("misses")
            .setDescription("Cantidad de misses (ej: 0, 2, 5)")
            .setRequired(false)
    )
    .addIntegerOption(option =>
        option.setName("combo")
            .setDescription("Combo máximo alcanzado (ej: 500)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("modo")
            .setDescription("Modo de juego (std, taiko, ctb, mania)")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("fc")
            .setDescription("Simular jugada en Full Combo (0 misses, Max Combo)")
            .setRequired(false)
    );

async function run(interaction, res) {
    const { args, messages } = parseOsuSlashArgs(interaction, res);

    const mapa = interaction.options.getString("mapa");
    if (mapa) args.push(mapa);

    const acc = interaction.options.getString("acc");
    if (acc) args.push("-acc", acc);

    const mods = interaction.options.getString("mods");
    if (mods) args.push("+ " + mods);

    const misses = interaction.options.getInteger("misses");
    if (misses !== null && misses !== undefined) args.push("-misses", String(misses));

    const combo = interaction.options.getInteger("combo");
    if (combo !== null && combo !== undefined) args.push("-combo", String(combo));

    const modo = interaction.options.getString("modo");
    if (modo) args.push("-modo", modo);

    const fc = interaction.options.getBoolean("fc");
    if (fc) args.push("-fc");

    const result = await simChatCommand.run(messages, args);
    return result || true;
}

run.description = "Simula una jugada en un mapa para calcular su PP.";

module.exports = { data, run, description: run.description };
