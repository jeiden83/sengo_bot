const { SlashCommandBuilder, Collection } = require("discord.js");
const topChatCommand = require("../chat/osu/top.js");
const { addUsuarioOption, addModoOption, addServidorOption, parseOsuSlashArgs } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("top")
    .setDescription("Muestra las mejores jugadas de un usuario en osu!")
    .addStringOption(addUsuarioOption)
    .addStringOption(addModoOption)
    .addStringOption(addServidorOption)
    .addIntegerOption(option =>
        option.setName("index")
            .setDescription("Índice de la jugada específica a mostrar (ej: 1 para la mejor)")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(100)
    )
    .addStringOption(option =>
        option.setName("buscar")
            .setDescription("Filtrar por título, artista o dificultad del mapa")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("mods_exactos")
            .setDescription("Filtrar por combinación exacta de mods (ej: HDDT). NM para no mod.")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("mods_contiene")
            .setDescription("Filtrar por jugadas que contengan estos mods (ej: HR)")
            .setRequired(false)
    )
    .addIntegerOption(option =>
        option.setName("umbral_pp")
            .setDescription("Mostrar solo jugadas con esta cantidad o más de PP")
            .setRequired(false)
            .setMinValue(0)
    )
    .addBooleanOption(option =>
        option.setName("ordenar_reciente")
            .setDescription("¿Ordenar el top por jugadas más recientes en lugar de por PP?")
            .setRequired(false)
    );

async function run(interaction, res) {
    const { args, messages } = parseOsuSlashArgs(interaction, res);

    const index = interaction.options.getInteger("index");
    const buscar = interaction.options.getString("buscar");
    const modsExactos = interaction.options.getString("mods_exactos");
    const modsContiene = interaction.options.getString("mods_contiene");
    const umbralPp = interaction.options.getInteger("umbral_pp");
    const ordenarReciente = interaction.options.getBoolean("ordenar_reciente");

    if (index) {
        args.push(`-i${index}`);
    }
    if (buscar) {
        args.push("-?", buscar);
    }
    if (modsExactos) {
        args.push("-m", modsExactos);
    }
    if (modsContiene) {
        args.push("-mx", modsContiene);
    }
    if (umbralPp !== null && umbralPp !== undefined) {
        args.push("-g", umbralPp.toString());
    }
    if (ordenarReciente) {
        args.push("-r");
    }

    // Redirigimos el canal de envío virtual a la interacción deferida
    messages.message.channel = {
        send: async (options) => {
            return await interaction.editReply(options);
        },
        messages: interaction.channel.messages,
        guild: interaction.guild
    };

    const result = await topChatCommand.run(messages, args);

    if (result) {
        // Si el comando devolvió una respuesta simple
        await interaction.editReply(result);
    }

    return true; // Auto-gestionado
}

module.exports = { data, run, description: "Muestra las mejores jugadas de un usuario en osu!" };
