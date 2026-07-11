const { SlashCommandBuilder } = require("discord.js");
const snipesChatCommand = require("../chat/osu/snipes.js");
const { addUsuarioOption, addModoOption, addServidorOption, parseOsuSlashArgs } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("snipes")
    .setDescription("Muestra estadísticas de tops nacionales (#1) de un usuario")
    .addStringOption(addUsuarioOption)
    .addStringOption(addModoOption)
    .addStringOption(addServidorOption)
    .addBooleanOption(option =>
        option.setName("detallado")
            .setDescription("Muestra estadísticas y perfil de habilidad detallado (-d)")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("nemesis")
            .setDescription("Muestra estadísticas de némesis y rivales del usuario (-nemesis)")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("top")
            .setDescription("Muestra las mejores jugadas de tops nacionales del usuario (-top)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("dificultad")
            .setDescription("Filtra por Star Rating (ej: >5, >=5.5, <7, =5)")
            .setRequired(false)
    );

async function run(interaction, res) {
    const { args, messages } = parseOsuSlashArgs(interaction, res);
    
    const detallado = interaction.options.getBoolean("detallado");
    if (detallado) {
        args.push("-d");
    }

    const nemesis = interaction.options.getBoolean("nemesis");
    if (nemesis) {
        args.push("-nemesis");
    }

    const top = interaction.options.getBoolean("top");
    if (top) {
        args.push("-top");
    }

    const dificultad = interaction.options.getString("dificultad");
    if (dificultad) {
        args.push("-sr", dificultad);
    }

    return await snipesChatCommand.run(messages, args);
}

run.description = "Muestra estadísticas de tops nacionales (#1) de un usuario";

module.exports = { data, run, description: run.description };
