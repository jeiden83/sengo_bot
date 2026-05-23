const { SlashCommandBuilder, ChannelType } = require("discord.js");
const giveawayChatCommand = require("../chat/moderation/giveaway.js");

const data = new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Gestión de sorteos al estilo Dyno Bot")
    .addSubcommand(sub =>
        sub.setName("crear")
            .setDescription("Crea un nuevo sorteo")
            .addChannelOption(opt =>
                opt.setName("canal")
                    .setDescription("Canal de destino donde se enviará el sorteo")
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true)
            )
            .addIntegerOption(opt =>
                opt.setName("ganadores")
                    .setDescription("Cantidad de ganadores")
                    .setMinValue(1)
                    .setRequired(true)
            )
            .addStringOption(opt =>
                opt.setName("tiempo")
                    .setDescription("Duración del sorteo (ej: 10s, 5m, 2h, 1d)")
                    .setRequired(true)
            )
            .addStringOption(opt =>
                opt.setName("premio")
                    .setDescription("Premio del sorteo")
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName("terminar")
            .setDescription("Termina un sorteo en curso de inmediato")
            .addStringOption(opt =>
                opt.setName("mensaje")
                    .setDescription("ID del mensaje o enlace del sorteo")
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName("reroll")
            .setDescription("Selecciona nuevos ganadores para un sorteo finalizado")
            .addStringOption(opt =>
                opt.setName("mensaje")
                    .setDescription("ID del mensaje o enlace del sorteo")
                    .setRequired(true)
            )
    );

// Permitir instalación de usuario y contextos
if (typeof data.setIntegrationTypes === 'function') {
    data.setIntegrationTypes([0, 1]);
}
if (typeof data.setContexts === 'function') {
    data.setContexts([0, 1, 2]);
}

async function run(interaction, res, chat_commands) {
    const subcommand = interaction.options.getSubcommand();
    const args = [subcommand];

    if (subcommand === "crear") {
        const canal = interaction.options.getChannel("canal");
        const ganadores = interaction.options.getInteger("ganadores");
        const tiempo = interaction.options.getString("tiempo");
        const premio = interaction.options.getString("premio");

        args.push(canal.id, ganadores.toString(), tiempo, premio);
    } else {
        const mensaje = interaction.options.getString("mensaje");
        args.push(mensaje);
    }

    const messages = {
        message: {
            author: interaction.user,
            member: interaction.member,
            guild: interaction.guild,
            client: interaction.client,
            channel: {
                send: async (options) => {
                    if (interaction.deferred || interaction.replied) {
                        return await interaction.editReply(options);
                    }
                    return await interaction.reply(options);
                }
            }
        },
        res: res,
        reply: {
            reply: async (options) => {
                if (interaction.deferred || interaction.replied) {
                    return await interaction.editReply(options);
                }
                return await interaction.reply(options);
            }
        },
        logger: interaction.logger
    };

    return await giveawayChatCommand.run(messages, args, chat_commands);
}

module.exports = { data, run, description: "Gestión de sorteos al estilo Dyno Bot" };
