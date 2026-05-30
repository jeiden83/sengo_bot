const { SlashCommandBuilder } = require("discord.js");
const { t } = require("../../utils/i18n.js");

const data = new SlashCommandBuilder()
    .setName("roll")
    .setDescription("Lanza un número aleatorio / Rolls a random number")
    .addIntegerOption(option =>
        option
            .setName("max")
            .setDescription("El valor máximo (por defecto 100) / The maximum value (default 100)")
            .setRequired(false)
    )
    .addIntegerOption(option =>
        option
            .setName("min")
            .setDescription("El valor mínimo (por defecto 1) / The minimum value (default 1)")
            .setRequired(false)
    );

async function run(interaction) {
    const locale = interaction.resolvedLocale || 'es';
    
    let top = interaction.options.getInteger("max");
    let bottom = interaction.options.getInteger("min");

    if (top === null) top = 100;
    if (bottom === null) bottom = 1;

    if (bottom > top) {
        return t(locale, 'utils.roll_err_min_greater', { bottom, top });
    }

    const roll = Math.floor(Math.random() * (top - bottom + 1)) + bottom;

    return t(locale, 'utils.roll_result', { roll, bottom, top });
}

module.exports = { data, run, description: "Lanza un número aleatorio / Rolls a random number" };
