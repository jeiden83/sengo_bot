const { SlashCommandBuilder, ChannelType } = require("discord.js");
const cumpleChatCommand = require("../chat/moderation/cumple.js");

const data = new SlashCommandBuilder()
    .setName("cumple")
    .setDescription("Gestión de cumpleaños del servidor")
    .addSubcommand(sub =>
        sub.setName("set")
            .setDescription("Registra o edita tu fecha de cumpleaños")
            .addStringOption(opt =>
                opt.setName("fecha")
                    .setDescription("Tu cumpleaños en formato DD/MM (ej: 15/08) o DD/MM/YYYY (ej: 15/08/2000)")
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName("quitar")
            .setDescription("Elimina tu cumpleaños de mi base de datos")
    )
    .addSubcommand(sub =>
        sub.setName("lista")
            .setDescription("Muestra todos los cumpleaños del servidor agrupados por mes")
    )
    .addSubcommand(sub =>
        sub.setName("proximo")
            .setDescription("Muestra el cumpleaños más cercano en el futuro")
    )
    .addSubcommand(sub =>
        sub.setName("anterior")
            .setDescription("Muestra el cumpleaños más reciente en el pasado")
    )
    .addSubcommand(sub =>
        sub.setName("canal")
            .setDescription("Configura el canal de anuncios de cumpleaños (Mods/Admins)")
            .addChannelOption(opt =>
                opt.setName("canal")
                    .setDescription("El canal donde se enviarán las felicitaciones diarias")
                    .addChannelTypes(ChannelType.GuildText)
            )
            .addBooleanOption(opt =>
                opt.setName("desactivar")
                    .setDescription("Establece en True para desactivar los anuncios")
            )
    )
    .addSubcommand(sub =>
        sub.setName("rol")
            .setDescription("Configura el rol temporal de cumpleaños (Mods/Admins)")
            .addRoleOption(opt =>
                opt.setName("rol")
                    .setDescription("El rol que se asignará temporalmente al cumpleañero")
            )
            .addBooleanOption(opt =>
                opt.setName("desactivar")
                    .setDescription("Establece en True para desactivar la asignación del rol")
            )
    )
    .addSubcommand(sub =>
        sub.setName("actualizar")
            .setDescription("Fuerza la comprobación de cumpleaños del día y felicita a los que falten")
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
    const args = [subcommand];

    if (subcommand === "set") {
        const fecha = interaction.options.getString("fecha");
        args.push(fecha);
    } else if (subcommand === "canal") {
        const canal = interaction.options.getChannel("canal");
        const desactivar = interaction.options.getBoolean("desactivar");
        
        if (desactivar) {
            args.push("desactivar");
        } else if (canal) {
            args.push(canal.id);
        }
    } else if (subcommand === "rol") {
        const rol = interaction.options.getRole("rol");
        const desactivar = interaction.options.getBoolean("desactivar");
        
        if (desactivar) {
            args.push("desactivar");
        } else if (rol) {
            args.push(rol.id);
        }
    }

    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);

    const result = await cumpleChatCommand.run(messages, args);

    if (result) {
        await interaction.editReply(result);
    }

    return true;
}

run.description = "Gestión de cumpleaños del servidor";

module.exports = { data, run, description: run.description };
