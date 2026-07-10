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

    return await snipesChatCommand.run(messages, args);
}

run.description = "Muestra estadísticas de tops nacionales (#1) de un usuario";

module.exports = { data, run, description: run.description };
