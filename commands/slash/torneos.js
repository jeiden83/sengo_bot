const { SlashCommandBuilder } = require("discord.js");
const torneosChatCommand = require("../chat/osu/torneos.js");
const { createSlashMessagesContext } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("torneos")
    .setDescription("Busca y lista torneos activos o pasados de osu!")
    .addStringOption(option =>
        option.setName("modo")
            .setDescription("Filtrar por modo de juego")
            .setRequired(false)
            .addChoices(
                { name: "osu! Standard", value: "osu" },
                { name: "osu!mania", value: "mania" },
                { name: "osu!taiko", value: "taiko" },
                { name: "osu!catch", value: "fruits" }
            )
    )
    .addIntegerOption(option =>
        option.setName("rango")
            .setDescription("Tu rango global para encontrar torneos aptos")
            .setRequired(false)
            .setMinValue(1)
    )
    .addStringOption(option =>
        option.setName("tag")
            .setDescription("Buscar por etiqueta o palabra clave (ej: latam, 1v1, draft, bws)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("estado")
            .setDescription("Filtrar por estado del torneo (por defecto: activos)")
            .setRequired(false)
            .addChoices(
                { name: "Inscripciones Abiertas (open)", value: "open" },
                { name: "En Curso (in_progress)", value: "in_progress" },
                { name: "Finalizados (completed)", value: "completed" },
                { name: "Todos (all)", value: "all" }
            )
    );

async function run(interaction, res, chat_commands) {
    const modo = interaction.options.getString("modo");
    const rango = interaction.options.getInteger("rango");
    const tag = interaction.options.getString("tag");
    const estado = interaction.options.getString("estado");

    const args = [];
    if (modo) {
        args.push("-modo", modo);
    }
    if (rango) {
        args.push("-rango", rango.toString());
    }
    if (tag) {
        args.push("-tag", tag);
    }
    if (estado) {
        if (estado === "completed") {
            args.push("-pasados");
        } else {
            args.push("-estado", estado);
        }
    }

    const messages = createSlashMessagesContext(interaction, res);
    const result = await torneosChatCommand.run(messages, args);
    return result || true;
}

run.description = "Busca y lista torneos activos o pasados de osu!";

module.exports = { data, run, description: run.description };
