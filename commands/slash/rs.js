const { SlashCommandBuilder } = require("discord.js");
const rsChatCommand = require("../chat/osu/rs.js");
const { addUsuarioOption, addModoOption, addServidorOption, parseOsuSlashArgs } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("rs")
    .setDescription("Muestra la jugada reciente de un usuario")
    .addStringOption(addUsuarioOption)
    .addStringOption(addModoOption)
    .addStringOption(addServidorOption)
    .addIntegerOption(option =>
        option.setName("index")
            .setDescription("Índice de la jugada reciente a mostrar (ej: 1 para la última, 2 para la penúltima)")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(100)
    )
    .addBooleanOption(option =>
        option.setName("lista")
            .setDescription("¿Mostrar una lista paginada de las jugadas más recientes?")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("mejor")
            .setDescription("¿Ordenar las jugadas recientes por PP y mostrar la mejor?")
            .setRequired(false)
    );

async function run(interaction, res) {
    const { args, messages } = parseOsuSlashArgs(interaction, res);

    const index = interaction.options.getInteger("index");
    const lista = interaction.options.getBoolean("lista");
    const mejor = interaction.options.getBoolean("mejor");

    if (index) {
        args.push(`-i${index}`);
    }
    if (lista) {
        args.push("-l");
    }
    if (mejor) {
        args.push("-b");
    }

    // Redirigimos el canal de envío virtual a la interacción deferida
    messages.message.channel.send = async (options) => {
        return await interaction.editReply(options);
    };

    await rsChatCommand.run(messages, args);
    return true;
}

run.description = "Muestra la jugada reciente de un usuario";

module.exports = { data, run, description: run.description };
