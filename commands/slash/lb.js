const { SlashCommandBuilder } = require("discord.js");
const lbChatCommand = require("../chat/osu/lb.js");
const { addModoOption, parseOsuSlashArgs } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("lb")
    .setDescription("Muestra la tabla de clasificación (leaderboard) global de osu! en el último mapa enviado")
    .addStringOption(addModoOption)
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
    );

async function run(interaction, res) {
    const { args, messages } = parseOsuSlashArgs(interaction, res);

    const pagina = interaction.options.getInteger("pagina");
    const modsExactos = interaction.options.getString("mods_exactos");
    const modsContiene = interaction.options.getString("mods_contiene");

    if (pagina) {
        args.push(`-p${pagina}`);
    }
    if (modsExactos) {
        args.push("-m", modsExactos);
    }
    if (modsContiene) {
        args.push("-mx", modsContiene);
    }

    // Redirigimos el canal de envío virtual a la interacción deferida
    messages.message.channel = {
        send: async (options) => {
            return await interaction.editReply(options);
        },
        messages: interaction.channel.messages,
        guild: interaction.guild
    };

    const result = await lbChatCommand.run(messages, args);

    if (result) {
        // Si el comando devolvió una respuesta simple (como un string con error)
        await interaction.editReply(result);
    }

    return true; // Auto-gestionado
}

run.description = "Muestra la tabla de clasificación (leaderboard) global de osu! en el último mapa enviado";

module.exports = { data, run, description: run.description };
