const { SlashCommandBuilder } = require("discord.js");
const recommendChatCommand = require("../chat/osu/recommend.js");
const { addUsuarioOption, addModoOption, addServidorOption, parseOsuSlashArgs } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("recomendar")
    .setDescription("Recomienda mapas de farm (PP) basados en tu nivel de habilidad")
    .addStringOption(addUsuarioOption)
    .addStringOption(addModoOption)
    .addStringOption(addServidorOption)
    .addStringOption(option =>
        option.setName("pp")
            .setDescription("Rango o valor objetivo de PP (ej: 300 o 250-300)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("mods")
            .setDescription("Filtrar por combinación de mods (ej: HDDT, NM)")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("jugados")
            .setDescription("¿Recomendar mapas que ya has jugado en este rango?")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("force")
            .setDescription("Forzar nuevas recomendaciones ignorando la caché")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("usertag")
            .setDescription("Filtrar por etiqueta de usuario de la comunidad (ej: skillset/jumps)")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("list_tags")
            .setDescription("¿Mostrar la lista de etiquetas de usuario disponibles?")
            .setRequired(false)
    );

async function run(interaction, res) {
    const { args, messages } = parseOsuSlashArgs(interaction, res);

    const pp = interaction.options.getString("pp");
    const mods = interaction.options.getString("mods");
    const jugados = interaction.options.getBoolean("jugados");
    const force = interaction.options.getBoolean("force");
    const usertag = interaction.options.getString("usertag");
    const listTags = interaction.options.getBoolean("list_tags");

    if (pp) {
        args.push("-pp", pp);
    }
    if (mods) {
        args.push("-mods", mods);
    }
    if (jugados) {
        args.push("-jugados");
    }
    if (force) {
        args.push("-force");
    }
    if (usertag) {
        args.push("-usertag", usertag);
    }
    if (listTags) {
        args.push("-usertag");
    }

    // Redirigimos el canal de envío virtual a la interacción deferida
    messages.message.channel.send = async (options) => {
        return await interaction.editReply(options);
    };

    const result = await recommendChatCommand.run(messages, args);

    if (result) {
        await interaction.editReply(result);
    }

    return true; // Auto-gestionado
}

module.exports = { data, run, description: "Recomienda mapas de farm (PP) basados en tu nivel de habilidad" };
