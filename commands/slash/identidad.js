const { SlashCommandBuilder } = require("discord.js");
const identidadChatCommand = require("../chat/osu/identidad.js");

const data = new SlashCommandBuilder()
    .setName("identidad")
    .setDescription("Asigna automáticamente tus roles de país y dígitos");

async function run(interaction, res) {
    const args = [];

    const messages = {
        message: {
            author: interaction.user,
            member: interaction.member,
            guild: interaction.guild,
            locale: interaction.resolvedLocale,
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

    const result = await identidadChatCommand.run(messages, args);

    if (result) {
        await interaction.editReply(result);
    }

    return true; // Auto-gestionado
}

module.exports = { data, run, description: "Asigna automáticamente tus roles de país y dígitos" };
