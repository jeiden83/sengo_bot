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
    .addStringOption(option =>
        option.setName("server_id")
            .setDescription("ID de un servidor específico")
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
    const server_id = interaction.options.getString("server_id");
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
        if (server_id) {
            args.push(server_id);
        }
    } else if (server_id) {
        args.push("-server", server_id);
    }
    if (wins) {
        args.push("-wins");
    }
    if (pagina) {
        args.push("-p", pagina.toString());
    }

    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);

    const result = await rankedChatCommand.run(messages, args);
    return result || true;
}

run.description = "Muestra las estadísticas de Ranked Play (lazer)";

module.exports = { data, run, description: run.description };
