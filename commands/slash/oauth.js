const { SlashCommandBuilder } = require("discord.js");
const linkChatCommand = require("../chat/osu/link.js");

const data = new SlashCommandBuilder()
    .setName("oauth")
    .setDescription("Vincula tu cuenta de osu! de forma completamente segura y privada mediante OAuth");

async function run(interaction, res) {
    const messages = {
        message: {
            author: interaction.user,
            member: interaction.member,
            guild: interaction.guild,
        },
        res: res,
        reply: null,
        logger: interaction.logger,
        isSlash: true,
        interaction: interaction
    };
    return await linkChatCommand.run(messages, ['-oauth']);
}

run.description = "Vincula tu cuenta de osu! de forma completamente segura y privada mediante OAuth";
run.noDefer = true;

module.exports = { data, run, description: run.description };
