const { SlashCommandBuilder } = require("discord.js");
const topChatCommand = require("../chat/osu/top.js");
const { addUsuarioOption, addModoOption, addServidorOption, parseOsuSlashArgs, wrapSlashMessage } = require("../utils/slashUtils.js");

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
    )
    .addStringOption(option =>
        option.setName("ordenar")
            .setDescription("Criterio de ordenamiento alternativo para las jugadas")
            .setRequired(false)
            .addChoices(
                { name: "Más recientes (-r)", value: "reciente" },
                { name: "Mayor Combo (-c)", value: "combo" },
                { name: "Mayor Precisión (-acc)", value: "acc" },
                { name: "Mayor BPM (-bpm)", value: "bpm" },
                { name: "Mayor Circle Size / CS (-cs)", value: "cs" },
                { name: "Mayor Approach Rate / AR (-ar)", value: "ar" },
                { name: "Mayor Overall Difficulty / OD (-od)", value: "od" },
                { name: "Mayor HP Drain (-hp)", value: "hp" },
                { name: "Mayor Duración (-len / -time)", value: "duracion" }
            )
    )
    .addBooleanOption(option =>
        option.setName("nochoke")
            .setDescription("¿Mostrar el top de PP recalculado como si todas las jugadas fueran Full Combo?")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("revertir")
            .setDescription("¿Invertir el orden de la lista? (ej: menor a mayor)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("dificultad")
            .setDescription("Filtra por Star Rating (ej: >5, >=5.5, <7, =5)")
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
    const ordenar = interaction.options.getString("ordenar");
    const nochoke = interaction.options.getBoolean("nochoke");
    const revertir = interaction.options.getBoolean("revertir");
    const dificultad = interaction.options.getString("dificultad");

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
    if (ordenar === "reciente" || ordenarReciente) {
        args.push("-r");
    } else if (ordenar === "combo") {
        args.push("-c");
    } else if (ordenar === "acc") {
        args.push("-acc");
    } else if (ordenar === "bpm") {
        args.push("-bpm");
    } else if (ordenar === "cs") {
        args.push("-cs");
    } else if (ordenar === "ar") {
        args.push("-ar");
    } else if (ordenar === "od") {
        args.push("-od");
    } else if (ordenar === "hp") {
        args.push("-hp");
    } else if (ordenar === "duracion") {
        args.push("-len");
    }
    if (nochoke) {
        args.push("-nc");
    }
    if (revertir) {
        args.push("-rev");
    }
    if (dificultad) {
        args.push("-sr", dificultad);
    }

    messages.interaction = interaction;

    // Redirigimos el canal de envío virtual a la interacción deferida asegurando el proxy envoltorio
    messages.message.channel.send = async (options) => {
        const msg = await interaction.editReply(options);
        return wrapSlashMessage(msg, interaction, false);
    };

    const result = await topChatCommand.run(messages, args);

    if (result) {
        // Si el comando devolvió una respuesta simple
        if (typeof result === "string") {
            await interaction.editReply({ content: result });
        } else {
            await interaction.editReply(result);
        }
    }

    return true; // Auto-gestionado
}

module.exports = { data, run, description: "Muestra las mejores jugadas de un usuario en osu!" };
