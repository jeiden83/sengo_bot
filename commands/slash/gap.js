const { SlashCommandBuilder } = require("discord.js");
const gapChatCommand = require("../chat/osu/gap.js");
const { addModoOption, parseOsuSlashArgs } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("gap")
    .setDescription("Muestra el top de puntuaciones del servidor en el último mapa enviado")
    .addStringOption(addModoOption)
    .addStringOption(option =>
        option.setName("mapa")
            .setDescription("ID o URL del beatmap de osu!")
            .setRequired(false)
    )
    .addBooleanOption(option => 
        option.setName("bypass")
            .setDescription("Bypassea la restricción de servidor (solo Owner)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("server")
            .setDescription("ID del servidor para hacer el gap (solo Owner)")
            .setRequired(false)
    );

async function run(interaction, res) {
    const { args, messages } = parseOsuSlashArgs(interaction, res);

    const bypassOpt = interaction.options.getBoolean("bypass");
    const serverOpt = interaction.options.getString("server");
    const mapa = interaction.options.getString("mapa");

    if (mapa) args.push(mapa);
    if (bypassOpt) args.push("-bypass");
    if (serverOpt) {
        args.push("-server");
        args.push(serverOpt);
    }

    const result = await gapChatCommand.run(messages, args);
    return result || true;
}

run.description = "Muestra el top de puntuaciones del servidor en el último mapa enviado";

module.exports = { data, run, description: run.description };
