const { SlashCommandBuilder } = require("discord.js");
const languageChatCommand = require("../chat/moderation/language.js");

const data = new SlashCommandBuilder()
    .setName("idioma")
    .setDescription("Configura el idioma de Sengo en el servidor / Set Sengo's language in the server")
    .addStringOption(option =>
        option.setName("lang")
            .setDescription("Idioma / Language (es | en)")
            .setRequired(true)
            .addChoices(
                { name: "Español", value: "es" },
                { name: "English", value: "en" }
            )
    );

async function run(interaction, res) {
    let interactionUsed = false;
    const langValue = interaction.options.getString("lang");

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

    const result = await languageChatCommand.run(messages, [langValue]);

    if (result && !interactionUsed) {
        await interaction.editReply(result);
    }

    return true;
}

run.description = "Configura el idioma de Sengo en el servidor / Set Sengo's language in the server";

module.exports = { data, run, description: run.description };
