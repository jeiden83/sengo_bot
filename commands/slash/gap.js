const { SlashCommandBuilder } = require("discord.js");
const gapChatCommand = require("../chat/osu/gap.js");

const data = new SlashCommandBuilder()
    .setName("gap")
    .setDescription("Muestra el top de puntuaciones del servidor en el último mapa enviado");

async function run(interaction, res) {
    const messages = {
        message: {
            author: interaction.user,
            member: interaction.member,
            guild: interaction.guild,
            channel: interaction.channel,
        },
        res: res,
        reply: null,
        logger: interaction.logger
    };

    return await gapChatCommand.run(messages, []);
}

run.description = "Muestra el top de puntuaciones del servidor en el último mapa enviado";

module.exports = { data, run, description: run.description };
