const { SlashCommandBuilder } = require("discord.js");
const lazerChatCommand = require("../chat/osu/lazer.js");

const data = new SlashCommandBuilder()
    .setName("lazer")
    .setDescription("Muestra la jugada referenciada en formato lazer (Lazer Score)")
    .addStringOption(option => 
        option.setName("mensaje")
            .setDescription("URL o ID del mensaje con el embed a alternar (opcional)")
            .setRequired(false)
    );

async function run(interaction, res) {
    const args = [];
    const messageUrlOrId = interaction.options.getString("mensaje");

    const messages = {
        message: {
            author: interaction.user,
            locale: interaction.locale || 'es',
            channel: {
                send: async (options) => {
                    return await interaction.editReply(options);
                },
                messages: interaction.channel.messages,
                guild: interaction.guild
            },
            reference: null
        },
        res
    };

    if (messageUrlOrId) {
        const idMatch = messageUrlOrId.match(/\d+$/);
        if (idMatch) {
            messages.message.reference = {
                messageId: idMatch[0]
            };
        }
    }

    await lazerChatCommand.run(messages, args);
    return true;
}

run.description = "Muestra la jugada referenciada en formato lazer (Lazer Score)";

module.exports = { data, run, description: run.description };
