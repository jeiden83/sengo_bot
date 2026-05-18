const { SlashCommandBuilder } = require("discord.js");
const rsSlash = require("./rs.js");
const { addUsuarioOption, addModoOption, addServidorOption } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("recent")
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
    );

module.exports = { data, run: rsSlash.run, description: rsSlash.description };
