const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const trackChatCommand = require("../chat/osu/track.js");

const data = new SlashCommandBuilder()
    .setName("track")
    .setDescription("Configura el tracking de plays de osu! en este servidor")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
        sub.setName("canal")
            .setDescription("Configura o desactiva el canal de anuncios de plays")
            .addChannelOption(opt =>
                opt.setName("canal")
                    .setDescription("El canal de texto donde anunciar las plays")
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(false)
            )
            .addBooleanOption(opt =>
                opt.setName("desactivar")
                    .setDescription("Establece en True para desactivar los anuncios")
                    .setRequired(false)
            )
    )
    .addSubcommand(sub =>
        sub.setName("limite")
            .setDescription("Configura o consulta el límite de Top Plays por defecto para el servidor")
            .addIntegerOption(opt =>
                opt.setName("limite")
                    .setDescription("Límite de top plays (entre 1 y 100)")
                    .setMinValue(1)
                    .setMaxValue(100)
                    .setRequired(false)
            )
    )
    .addSubcommand(sub =>
        sub.setName("add")
            .setDescription("Añade un usuario de osu! al seguimiento en este servidor")
            .addStringOption(opt =>
                opt.setName("usuario")
                    .setDescription("Nombre de usuario o ID de osu!")
                    .setRequired(true)
            )
            .addIntegerOption(opt =>
                opt.setName("limite")
                    .setDescription("Límite de top plays específico para este usuario (1-100, opcional)")
                    .setMinValue(1)
                    .setMaxValue(100)
                    .setRequired(false)
            )
    )
    .addSubcommand(sub =>
        sub.setName("remove")
            .setDescription("Quita un usuario de osu! del seguimiento en este servidor")
            .addStringOption(opt =>
                opt.setName("usuario")
                    .setDescription("Nombre de usuario o ID de osu!")
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName("list")
            .setDescription("Muestra la lista de usuarios seguidos en este servidor")
    );

async function run(interaction, res) {
    const sub = interaction.options.getSubcommand();
    const args = [sub];

    if (sub === "canal") {
        const channel = interaction.options.getChannel("canal");
        const desactivar = interaction.options.getBoolean("desactivar");
        if (desactivar) {
            args.push("desactivar");
        } else if (channel) {
            args.push(`<#${channel.id}>`);
        }
    } else if (sub === "limite") {
        const limit = interaction.options.getInteger("limite");
        if (limit) {
            args.push(limit.toString());
        }
    } else if (sub === "add") {
        const user = interaction.options.getString("usuario");
        args.push(user);
        const limit = interaction.options.getInteger("limite");
        if (limit) {
            args.push(limit.toString());
        }
    } else if (sub === "remove") {
        const user = interaction.options.getString("usuario");
        args.push(user);
    }

    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);

    const result = await trackChatCommand.run(messages, args);
    return result || true;
}

run.description = "Configura el tracking de plays de osu! en este servidor";
run.noDefer = false; // Queremos que use defer por defecto ya que las búsquedas a la API de osu! toman tiempo.

module.exports = { data, run, description: run.description };
