const { SlashCommandBuilder } = require("discord.js");
const rankedChatCommand = require("../chat/osu/ranked.js");

const data = new SlashCommandBuilder()
    .setName("ranked")
    .setDescription("Muestra las estadísticas de Ranked Play (lazer)")
    .addStringOption(option =>
        option.setName("usuario")
            .setDescription("Usuario de osu! a consultar")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("top")
            .setDescription("Mostrar la tabla de clasificación global")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("server")
            .setDescription("Mostrar la tabla de clasificación del servidor")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("wins")
            .setDescription("Ordenar por victorias en lugar de rating (ELO)")
            .setRequired(false)
    )
    .addIntegerOption(option =>
        option.setName("pagina")
            .setDescription("Página de la clasificación a mostrar")
            .setRequired(false)
    );

async function run(interaction, res) {
    const usuario = interaction.options.getString("usuario");
    const top = interaction.options.getBoolean("top");
    const server = interaction.options.getBoolean("server");
    const wins = interaction.options.getBoolean("wins");
    const pagina = interaction.options.getInteger("pagina");

    const args = [];
    if (usuario) {
        args.push(usuario);
    }
    if (top) {
        args.push("-top");
    }
    if (server) {
        args.push("-server");
    }
    if (wins) {
        args.push("-wins");
    }
    if (pagina) {
        args.push("-p", pagina.toString());
    }

    const messages = {
        message: {
            author: interaction.user,
            member: interaction.member,
            guild: interaction.guild,
            channel: interaction.channel,
        },
        res: res,
        reply: null,
        logger: interaction.logger
    };

    return await rankedChatCommand.run(messages, args);
}

run.description = "Muestra las estadísticas de Ranked Play (lazer)";

module.exports = { data, run, description: run.description };
