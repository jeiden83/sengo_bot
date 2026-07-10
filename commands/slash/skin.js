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
    )
    .addSubcommand(sub =>
        sub.setName("borrar")
            .setDescription("Elimina tu skin vinculada de mi base de datos")
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
        args.push("colocar", enlace);
    } else if (subcommand === "borrar") {
        args.push("borrar");
    }

    const messages = {
        message: {
            author: interaction.user,
            member: interaction.member,
            guild: interaction.guild,
            client: interaction.client,
            locale: interaction.resolvedLocale || interaction.locale || 'es'
        },
        res: res,
        logger: interaction.logger
    };

    return await skinChatCommand.run(messages, args);
}

run.description = "Muestra, vincula o borra la skin de osu! de un usuario";

module.exports = { data, run, description: run.description };
