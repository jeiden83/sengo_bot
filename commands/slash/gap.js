const { SlashCommandBuilder } = require("discord.js");
const gapChatCommand = require("../chat/osu/gap.js");

const data = new SlashCommandBuilder()
    .setName("gap")
    .setDescription("Muestra el top de puntuaciones del servidor en el último mapa enviado")
    .addBooleanOption(option => 
        option.setName("bypass")
            .setDescription("Bypassea la restricción de servidor (solo Owner)")
            .setRequired(false)
    );

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

    const bypassOpt = interaction.options.getBoolean("bypass");
    const args = bypassOpt ? ["-bypass"] : [];

    return await gapChatCommand.run(messages, args);
}

run.description = "Muestra el top de puntuaciones del servidor en el último mapa enviado";

module.exports = { data, run, description: run.description };
