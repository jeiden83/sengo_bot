const { SlashCommandBuilder } = require("discord.js");
const bgChatCommand = require("../chat/osu/bg.js");

const data = new SlashCommandBuilder()
    .setName("bg")
    .setDescription("Muestra el fondo (background) de un beatmap")
    .addStringOption(option =>
        option.setName("mapa")
            .setDescription("ID o URL del beatmap de osu!")
            .setRequired(false)
    );

async function run(interaction, res) {
    const mapa = interaction.options.getString("mapa");

    const args = [];
    if (mapa) args.push(mapa);

    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);

    const result = await bgChatCommand.run(messages, args);
    return result || true;
}

run.description = "Muestra el fondo (background) de un beatmap";

module.exports = { data, run, description: run.description };
