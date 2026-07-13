const { SlashCommandBuilder } = require("discord.js");
const lbChatCommand = require("../chat/osu/lb.js");
const { addModoOption, parseOsuSlashArgs } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("lb")
    .setDescription("Muestra la tabla de clasificación (leaderboard) de osu! en el último mapa enviado")
    .addStringOption(addModoOption)
    .addStringOption(option =>
        option.setName("pais")
            .setDescription("Filtrar por código de país (ej: CL, VE). Escribe SELF para autodetectar tu país.")
            .setRequired(false)
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
    .addBooleanOption(option =>
        option.setName("stable")
            .setDescription("Fuerza el leaderboard al estilo classic/stable.")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("lazer")
            .setDescription("Fuerza el leaderboard al estilo lazer (scoring normalizado).")
            .setRequired(false)
    );

async function run(interaction, res) {
    const { args, messages } = parseOsuSlashArgs(interaction, res);

    const pais = interaction.options.getString("pais");
    const pagina = interaction.options.getInteger("pagina");
    const modsExactos = interaction.options.getString("mods_exactos");
    const modsContiene = interaction.options.getString("mods_contiene");
    const stable = interaction.options.getBoolean("stable");
    const lazer = interaction.options.getBoolean("lazer");

    if (pais !== null && pais !== undefined) {
        args.push("-pais", pais);
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
    if (stable) {
        args.push("-stable");
    }
    if (lazer) {
        args.push("-lazer");
    }

    // Redirigimos el canal de envío virtual a la interacción deferida
    messages.message.channel.send = async (options) => {
        return await interaction.editReply(options);
    };

    const result = await lbChatCommand.run(messages, args);

    if (result) {
        // Si el comando devolvió una respuesta simple (como un string con error)
        await interaction.editReply(result);
    }

    return true; // Auto-gestionado
}

run.description = "Muestra la tabla de clasificación (leaderboard) de osu! en el último mapa enviado";

module.exports = { data, run, description: run.description };
