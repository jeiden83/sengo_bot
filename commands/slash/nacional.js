const { SlashCommandBuilder } = require("discord.js");
const nacionalChatCommand = require("../chat/osu/nacional.js");
const { addModoOption, parseOsuSlashArgs } = require("../utils/slashUtils.js");

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
    const { args, messages } = parseOsuSlashArgs(interaction, res);

    const pais = interaction.options.getString("pais");
    const pagina = interaction.options.getInteger("pagina");
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

    // Redirigimos el canal de envío virtual a la interacción deferida
    messages.message.channel.send = async (options) => {
        return await interaction.editReply(options);
    };

    const result = await nacionalChatCommand.run(messages, args);

    if (result) {
        // Si el comando devolvió una respuesta simple (como un string con error)
        await interaction.editReply(result);
    }

    return true; // Auto-gestionado
}

run.description = "Muestra la tabla de clasificación por Performance Points (pp) de un país";

module.exports = { data, run, description: run.description };
