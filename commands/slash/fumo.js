const { SlashCommandBuilder } = require("discord.js");
const fumoChatCommand = require("../chat/meme/fumo.js");

const data = new SlashCommandBuilder()
    .setName("fumo")
    .setDescription("Comando para ver, subir y gestionar fotos de fumo")
    .addSubcommand(subcommand =>
        subcommand.setName("ver")
            .setDescription("Muestra una foto de fumo aleatoria o específica por ID")
            .addIntegerOption(option =>
                option.setName("id")
                    .setDescription("ID del fumo específico")
                    .setRequired(false)
            )
    )
    .addSubcommand(subcommand =>
        subcommand.setName("subir")
            .setDescription("Sube una o varias imágenes de fumo (Soporte batch)")
            .addAttachmentOption(option => option.setName("imagen1").setDescription("Imagen de fumo a subir").setRequired(true))
            .addAttachmentOption(option => option.setName("imagen2").setDescription("Imagen adicional").setRequired(false))
            .addAttachmentOption(option => option.setName("imagen3").setDescription("Imagen adicional").setRequired(false))
            .addAttachmentOption(option => option.setName("imagen4").setDescription("Imagen adicional").setRequired(false))
            .addAttachmentOption(option => option.setName("imagen5").setDescription("Imagen adicional").setRequired(false))
    )
    .addSubcommand(subcommand =>
        subcommand.setName("listar")
            .setDescription("Lista todas las fotos de fumo por páginas (Admins)")
            .addIntegerOption(option =>
                option.setName("pagina")
                    .setDescription("Número de página a visualizar")
                    .setRequired(false)
            )
    )
    .addSubcommand(subcommand =>
        subcommand.setName("borrar")
            .setDescription("Borra una foto de fumo por su ID (Admins)")
            .addIntegerOption(option =>
                option.setName("id")
                    .setDescription("ID del fumo a borrar")
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand.setName("editar")
            .setDescription("Reemplaza la imagen de un fumo existente (Admins)")
            .addIntegerOption(option =>
                option.setName("id")
                    .setDescription("ID del fumo a editar")
                    .setRequired(true)
            )
            .addAttachmentOption(option =>
                option.setName("nueva_imagen")
                    .setDescription("La nueva imagen del fumo")
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand.setName("blacklist")
            .setDescription("Gestiona la lista negra de usuarios que no pueden subir fumos (Admins)")
            .addStringOption(option =>
                option.setName("accion")
                    .setDescription("Acción a realizar")
                    .setRequired(true)
                    .addChoices(
                        { name: "Agregar a Blacklist", value: "add" },
                        { name: "Quitar de Blacklist", value: "remove" },
                        { name: "Listar Blacklist", value: "list" }
                    )
            )
            .addUserOption(option =>
                option.setName("usuario")
                    .setDescription("Usuario a agregar o quitar de la blacklist")
                    .setRequired(false)
            )
    );

// Permitir instalación de usuario y contextos (Guilds, DMs, User apps)
if (typeof data.setIntegrationTypes === 'function') {
    data.setIntegrationTypes([0, 1]);
}
if (typeof data.setContexts === 'function') {
    data.setContexts([0, 1, 2]);
}

async function run(interaction, res, chat_commands) {
    const { getSupabaseClient } = require("../../db/database.js");
    const supabase = getSupabaseClient();

    if (!supabase) {
        return "❌ Error: La base de datos no está disponible.";
    }

    await fumoChatCommand.ensureBucketExists(supabase);

    const sub = interaction.options.getSubcommand();

    if (sub === "ver") {
        const id = interaction.options.getInteger("id");
        return await fumoChatCommand.handleShow(supabase, interaction.user, id);
    }

    if (sub === "subir") {
        const attachments = [];
        for (let i = 1; i <= 5; i++) {
            const att = interaction.options.getAttachment(`imagen${i}`);
            if (att) attachments.push(att);
        }
        return await fumoChatCommand.handleUpload(supabase, interaction.user, interaction.guild, attachments, interaction);
    }

    if (sub === "listar") {
        const page = interaction.options.getInteger("pagina");
        return await fumoChatCommand.handleList(supabase, interaction.user, interaction.member, page);
    }

    if (sub === "borrar") {
        const id = interaction.options.getInteger("id");
        return await fumoChatCommand.handleDelete(supabase, interaction.user, interaction.member, id);
    }

    if (sub === "editar") {
        const id = interaction.options.getInteger("id");
        const attachment = interaction.options.getAttachment("nueva_imagen");
        return await fumoChatCommand.handleEdit(supabase, interaction.user, interaction.member, id, [attachment], interaction);
    }

    if (sub === "blacklist") {
        const action = interaction.options.getString("accion");
        const userOpt = interaction.options.getUser("usuario");
        const targetUserId = userOpt ? userOpt.id : null;
        return await fumoChatCommand.handleBlacklist(supabase, interaction.user, interaction.member, action, targetUserId);
    }

    return "❌ Subcomando desconocido.";
}

module.exports = {
    data,
    run,
    description: "Comando para ver, subir y gestionar fotos de fumo"
};
