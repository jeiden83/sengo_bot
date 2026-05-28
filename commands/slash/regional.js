const { SlashCommandBuilder } = require("discord.js");
const regionalChatCommand = require("../chat/osu/regional.js");
const { addModoOption, parseOsuSlashArgs } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("regional")
    .setDescription("Muestra la tabla de clasificación por Performance Points (pp) de una región/subdivisión")
    .addStringOption(addModoOption)
    .addStringOption(option =>
        option.setName("region")
            .setDescription("Nombre o código de la región para mostrar, o 'lista' para ver las opciones")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("pais")
            .setDescription("Código de país de 2 letras (ej: MX, CL, VE) si deseas ver regiones de otro país")
            .setRequired(false)
    )
    .addIntegerOption(option =>
        option.setName("pagina")
            .setDescription("Página del ranking regional a mostrar")
            .setRequired(false)
            .setMinValue(1)
    );

async function run(interaction, res) {
    const { args, messages } = parseOsuSlashArgs(interaction, res);

    const region = interaction.options.getString("region");
    const pais = interaction.options.getString("pais");
    const pagina = interaction.options.getInteger("pagina");

    if (region !== null && region !== undefined) {
        args.push(region);
    }
    if (pais !== null && pais !== undefined) {
        args.push("-pais", pais);
    }
    if (pagina) {
        args.push(`-p${pagina}`);
    }

    messages.message.channel = {
        send: async (options) => {
            return await interaction.editReply(options);
        },
        messages: interaction.channel.messages,
        guild: interaction.guild
    };

    const result = await regionalChatCommand.run(messages, args);

    if (result) {
        await interaction.editReply(result);
    }

    return true;
}

run.description = "Muestra la tabla de clasificación por Performance Points (pp) de una región/subdivisión";

module.exports = { data, run, description: run.description };
