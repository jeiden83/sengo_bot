const { SlashCommandBuilder } = require("discord.js");
const blacklistChatCommand = require("../chat/admin/blacklist.js");

const data = new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Gestiona la lista negra de Sengo / Manage Sengo's blacklist")
    .addSubcommand(subcommand =>
        subcommand
            .setName("lista")
            .setDescription("Muestra la lista de usuarios bloqueados / Shows the list of blacklisted users")
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName("add")
            .setDescription("Bloquea a un usuario / Blocks a user")
            .addUserOption(option =>
                option.setName("usuario")
                    .setDescription("Usuario a bloquear / User to block")
                    .setRequired(true)
            )
            .addStringOption(option =>
                option.setName("comandos")
                    .setDescription("Comandos específicos a bloquear (ej: help fumo) / Specific commands to block")
                    .setRequired(false)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName("remove")
            .setDescription("Desbloquea a un usuario / Unblocks a user")
            .addUserOption(option =>
                option.setName("usuario")
                    .setDescription("Usuario a desbloquear / User to unblock")
                    .setRequired(true)
            )
    );

async function run(interaction, res) {
    const sub = interaction.options.getSubcommand();
    let interactionUsed = false;

    const messages = {
        message: {
            author: interaction.user,
            member: interaction.member || (interaction.guild ? interaction.guild.members.cache.get(interaction.user.id) : null),
            guild: interaction.guild,
            locale: interaction.resolvedLocale,
            channel: {
                send: async (options) => {
                    interactionUsed = true;
                    return await interaction.editReply(options);
                }
            }
        },
        res: res,
        reply: {
            reply: async (options) => {
                interactionUsed = true;
                return await interaction.editReply(options);
            }
        },
        logger: interaction.logger
    };

    let args = [];
    if (sub === "lista") {
        args = ["lista"];
    } else if (sub === "add") {
        const user = interaction.options.getUser("usuario");
        const cmds = interaction.options.getString("comandos");
        args = ["add", user.id];
        if (cmds) {
            const splitCmds = cmds.split(/\s+/).filter(c => c.trim().length > 0);
            args = args.concat(splitCmds);
        }
    } else if (sub === "remove") {
        const user = interaction.options.getUser("usuario");
        args = ["remove", user.id];
    }

    const result = await blacklistChatCommand.run(messages, args);

    if (result && !interactionUsed) {
        await interaction.editReply(result);
    }

    return true;
}

module.exports = {
    data,
    run,
    description: "Gestiona la lista negra de Sengo / Manage Sengo's blacklist"
};
