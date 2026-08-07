const { SlashCommandBuilder } = require("discord.js");
const queueChatCommand = require("../chat/osu/queue.js");

const data = new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Muestra o gestiona la queue de solicitudes de mapeo de un usuario de Discord")
    .addUserOption(option =>
        option.setName("usuario")
            .setDescription("Usuario de Discord para consultar su queue de mapper")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("set")
            .setDescription("Establece o actualiza el mensaje personalizado de tu queue")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("link")
            .setDescription("Agrega un enlace de formulario o detalles a tu queue (o 'borrar' para quitarlo)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("estado")
            .setDescription("Cambia el estado de tu queue de mapper")
            .setRequired(false)
            .addChoices(
                { name: "🟢 Abierta (Open)", value: "open" },
                { name: "🔴 Cerrada (Closed)", value: "closed" }
            )
    )
    .addStringOption(option =>
        option.setName("modo")
            .setDescription("Modos de juego que aceptas (ej: STD, MANIA, CTB, TAIKO, ALL)")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("borrar")
            .setDescription("Elimina tu queue de mapper por completo")
            .setRequired(false)
    );

async function run(interaction, res) {
    const usuario = interaction.options.getUser("usuario");
    const setMsg = interaction.options.getString("set");
    const linkUrl = interaction.options.getString("link");
    const estado = interaction.options.getString("estado");
    const modo = interaction.options.getString("modo");
    const borrar = interaction.options.getBoolean("borrar");

    const args = [];

    if (borrar) {
        args.push("-delete");
    }
    if (estado) {
        args.push(estado === "open" ? "-abrir" : "-cerrar");
    }
    if (modo) {
        args.push("-modo", modo);
    }
    if (linkUrl) {
        args.push("-link", linkUrl);
    }
    if (setMsg) {
        args.push("-set", setMsg);
    }
    if (usuario && !borrar && !setMsg && !linkUrl && !estado && !modo) {
        args.push(usuario.id);
    }

    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);

    const result = await queueChatCommand.run(messages, args);
    return result || true;
}

run.description = "Muestra o gestiona la queue de solicitudes de mapeo de un usuario de Discord";

module.exports = { data, run, description: run.description };
