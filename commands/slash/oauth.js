const { SlashCommandBuilder } = require("discord.js");
const linkChatCommand = require("../chat/osu/link.js");

const { createSlashMessagesContext } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("oauth")
    .setDescription("Vincula tu cuenta de osu! de forma completamente segura y privada mediante OAuth");

async function run(interaction, res) {
    const messages = createSlashMessagesContext(interaction, res);
    messages.interaction = interaction;
    const result = await linkChatCommand.run(messages, ['-oauth']);
    return result || true;
}

run.description = "Vincula tu cuenta de osu! de forma completamente segura y privada mediante OAuth";
run.noDefer = true;

module.exports = { data, run, description: run.description };
