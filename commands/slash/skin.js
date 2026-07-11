const { SlashCommandBuilder } = require("discord.js");
const skinChatCommand = require("../chat/osu/skin.js");

const data = new SlashCommandBuilder()
    .setName("skin")
    .setDescription("Vincula, borra o muestra la skin de osu! vinculada a un usuario de Discord")
    .addSubcommand(sub =>
        sub.setName("ver")
            .setDescription("Muestra la skin vinculada de un usuario")
            .addStringOption(opt =>
                opt.setName("usuario")
                    .setDescription("Nombre de usuario de Discord, ID o mención a buscar")
                    .setRequired(false)
            )
    )
    .addSubcommand(sub =>
        sub.setName("colocar")
            .setDescription("Vincula tu skin propia de osu! (debe ser un enlace de descarga válido)")
            .addStringOption(opt =>
                opt.setName("enlace")
                    .setDescription("El enlace de descarga directo o público de tu skin")
                    .setRequired(true)
            )
            .addStringOption(opt =>
                opt.setName("nombre")
                    .setDescription("Nombre personalizado para mostrar en tu skin (opcional)")
                    .setRequired(false)
            )
            .addStringOption(opt =>
                opt.setName("modo")
                    .setDescription("Modo de juego para esta skin (por defecto: osu)")
                    .setRequired(false)
                    .addChoices(
                        { name: "osu! Standard", value: "osu" },
                        { name: "osu!catch (CtB)", value: "ctb" },
                        { name: "osu!taiko", value: "taiko" },
                        { name: "osu!mania", value: "mania" }
                    )
            )
    )
    .addSubcommand(sub =>
        sub.setName("nombre")
            .setDescription("Cambia o edita el nombre de tu skin vinculada")
            .addStringOption(opt =>
                opt.setName("nombre")
                    .setDescription("El nuevo nombre personalizado para tu skin")
                    .setRequired(false)
            )
            .addStringOption(opt =>
                opt.setName("modo")
                    .setDescription("Modo de juego de la skin a editar (por defecto: osu)")
                    .setRequired(false)
                    .addChoices(
                        { name: "osu! Standard", value: "osu" },
                        { name: "osu!catch (CtB)", value: "ctb" },
                        { name: "osu!taiko", value: "taiko" },
                        { name: "osu!mania", value: "mania" }
                    )
            )
    )
    .addSubcommand(sub =>
        sub.setName("borrar")
            .setDescription("Elimina tu skin vinculada de mi base de datos")
            .addStringOption(opt =>
                opt.setName("modo")
                    .setDescription("Modo de juego de la skin a borrar (si no se especifica, borra todas)")
                    .setRequired(false)
                    .addChoices(
                        { name: "osu! Standard", value: "osu" },
                        { name: "osu!catch (CtB)", value: "ctb" },
                        { name: "osu!taiko", value: "taiko" },
                        { name: "osu!mania", value: "mania" }
                    )
            )
    );

// Permitir instalación de usuario y contextos
if (typeof data.setIntegrationTypes === 'function') {
    data.setIntegrationTypes([0, 1]);
}
if (typeof data.setContexts === 'function') {
    data.setContexts([0, 1, 2]);
}

async function run(interaction, res) {
    const subcommand = interaction.options.getSubcommand();
    const args = [];

    if (subcommand === "ver") {
        const usuario = interaction.options.getString("usuario");
        if (usuario) {
            args.push(usuario);
        }
    } else if (subcommand === "colocar") {
        const enlace = interaction.options.getString("enlace");
        const nombre = interaction.options.getString("nombre");
        const modo = interaction.options.getString("modo");
        args.push("colocar", enlace);
        if (nombre) {
            args.push("-nombre", nombre);
        }
        if (modo) {
            args.push(`-${modo}`);
        }
    } else if (subcommand === "nombre") {
        const nombre = interaction.options.getString("nombre");
        const modo = interaction.options.getString("modo");
        args.push("-nombre");
        if (nombre) {
            args.push(nombre);
        }
        if (modo) {
            args.push(`-${modo}`);
        }
    } else if (subcommand === "borrar") {
        const modo = interaction.options.getString("modo");
        args.push("borrar");
        if (modo) {
            args.push(`-${modo}`);
        }
    }

    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);

    const result = await skinChatCommand.run(messages, args);

    if (result) {
        // Si el comando devolvió una respuesta simple
        await interaction.editReply(result);
    }

    return true; // Auto-gestionado
}

run.description = "Muestra, vincula o borra la skin de osu! de un usuario";

module.exports = { data, run, description: run.description };
