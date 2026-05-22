const { SlashCommandBuilder } = require("discord.js");
const amigosChatCommand = require("../chat/osu/amigos.js");

const data = new SlashCommandBuilder()
    .setName("amigos")
    .setDescription("Muestra tu lista de amigos de osu! por páginas")
    .addBooleanOption(option =>
        option.setName("sengo")
            .setDescription("Compara tus amigos contra los vinculados al bot (solo OWNER)")
            .setRequired(false)
    );

async function run(interaction, res) {
    const args = [];
    const sengo = interaction.options.getBoolean("sengo");

    if (sengo) {
        args.push("-sengo");
    }

    const messages = {
        message: {
            author: interaction.user,
            member: interaction.member,
            guild: interaction.guild,
            channel: {
                send: async (options) => {
                    return await interaction.editReply(options);
                },
                messages: interaction.channel.messages,
                guild: interaction.guild
            }
        },
        res: res,
        reply: null,
        logger: interaction.logger
    };

    const result = await amigosChatCommand.run(messages, args);

    if (result) {
        await interaction.editReply(result);
    }

    return true; // Auto-gestionado
}

module.exports = { data, run, description: "Muestra tu lista de amigos de osu! por páginas" };
