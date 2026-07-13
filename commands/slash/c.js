const { SlashCommandBuilder } = require("discord.js");
const compareChatCommand = require("../chat/osu/c.js");
const { addUsuarioOption, addModoOption, addServidorOption, parseOsuSlashArgs } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("c")
    .setDescription("Compara tus scores (o las de otro usuario) en el último mapa enviado en el canal o en uno específico")
    .addStringOption(addUsuarioOption)
    .addStringOption(option =>
        option.setName("mapa")
            .setDescription("ID o URL del beatmap de osu!")
            .setRequired(false)
    )
    .addStringOption(addModoOption)
    .addStringOption(addServidorOption)
    .addIntegerOption(option =>
        option.setName("index")
            .setDescription("Índice de la score específica a mostrar (ej: 1 para la mejor)")
            .setRequired(false)
            .setMinValue(1)
    )
    .addIntegerOption(option =>
        option.setName("pagina")
            .setDescription("Página de la lista de puntuaciones a mostrar")
            .setRequired(false)
            .setMinValue(1)
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
    );

async function run(interaction, res) {
    const { args, messages } = parseOsuSlashArgs(interaction, res);

    const mapa = interaction.options.getString("mapa");
    const index = interaction.options.getInteger("index");
    const pagina = interaction.options.getInteger("pagina");
    const modsExactos = interaction.options.getString("mods_exactos");
    const modsContiene = interaction.options.getString("mods_contiene");
    const umbralPp = interaction.options.getInteger("umbral_pp");

    if (mapa) {
        args.push(mapa);
    }
    if (index) {
        args.push(`-i${index}`);
    }
    if (pagina) {
        args.push(`-p${pagina}`);
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

    // Redirigimos el canal de envío virtual a la interacción deferida
    messages.message.channel.send = async (options) => {
        return await interaction.editReply(options);
    };

    const result = await compareChatCommand.run(messages, args);

    if (result) {
        // Si el comando devolvió una respuesta simple (como un string con error)
        await interaction.editReply(result);
    }

    return true; // Auto-gestionado
}

run.description = "Compara tus scores (o las de otro usuario) en el último mapa enviado en el canal";

module.exports = { data, run, description: run.description };
