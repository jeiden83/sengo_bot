const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const githubChatCommand = require("../chat/webhook/github.js");

const data = new SlashCommandBuilder()
    .setName("github")
    .setDescription("Configura las notificaciones de commits de GitHub en canales")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // Solo admins de forma predeterminada
    .addSubcommand(subcommand =>
        subcommand
            .setName("colocar")
            .setDescription("Registra un canal para recibir actualizaciones de GitHub")
            .addChannelOption(option =>
                option
                    .setName("canal")
                    .setDescription("El canal donde mandar los commits (por defecto el actual)")
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(false)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName("borrar")
            .setDescription("Elimina el registro de actualizaciones de GitHub para un canal")
            .addChannelOption(option =>
                option
                    .setName("canal")
                    .setDescription("El canal a remover (por defecto el actual)")
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(false)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName("listar")
            .setDescription("Muestra la lista de servidores y canales escuchando (Solo Creador)")
    );

async function run(interaction, res) {
    const subcommand = interaction.options.getSubcommand();
    const canal = interaction.options.getChannel("canal") || interaction.channel;

    const args = [];
    if (subcommand === "colocar") {
        args.push("colocar");
        args.push(canal.id);
    } else if (subcommand === "borrar") {
        args.push("borrar");
        args.push(canal.id);
    } else if (subcommand === "listar") {
        args.push("-l");
    }

    const messages = {
        message: {
            author: interaction.user,
            member: interaction.member,
            guild: interaction.guild,
            channel: interaction.channel
        },
        res: res,
        reply: null,
        logger: interaction.logger
    };

    const result = await githubChatCommand.run(messages, args);

    if (result) {
        // Enviar respuesta en formato SlashCommand
        await interaction.editReply(result);
    }

    return true; // Auto-gestionado
}

run.description = "Configura las notificaciones de commits de GitHub en canales";

module.exports = { data, run, description: run.description };
