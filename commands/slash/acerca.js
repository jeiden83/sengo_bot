const { SlashCommandBuilder } = require("discord.js");
const acercaChatCommand = require("../chat/about/acerca.js");

const data = new SlashCommandBuilder()
    .setName("acerca")
    .setDescription("Muestra información detallada sobre Sengo y qué lo hace sobresalir.");

async function run(interaction, res) {
    let interactionUsed = false;

    const messages = {
        message: {
            author: interaction.user,
            member: interaction.member || (interaction.guild ? interaction.guild.members.cache.get(interaction.user.id) : null),
            guild: interaction.guild,
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

    const result = await acercaChatCommand.run(messages, []);

    if (result && !interactionUsed) {
        await interaction.editReply(result);
    }

    return true;
}

run.description = "Muestra información detallada sobre Sengo y qué lo hace sobresalir.";

module.exports = { data, run, description: run.description };
