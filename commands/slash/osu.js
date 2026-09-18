const { SlashCommandBuilder } = require("discord.js");
const osuChatCommand = require("../chat/osu/osu.js");
const { addUsuarioOption, addModoOption, addServidorOption, parseOsuSlashArgs } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("osu")
    .setDescription("Muestra el perfil de un usuario en osu!")
    .addStringOption(addUsuarioOption)
    .addStringOption(addModoOption)
    .addStringOption(addServidorOption)
    .addBooleanOption(option =>
        option.setName("promedio")
            .setDescription("Muestra las estadísticas y promedios de las 100 mejores jugadas")
    );

if (typeof data.setIntegrationTypes === "function") {
    data.setIntegrationTypes([0, 1]);
}
if (typeof data.setContexts === "function") {
    data.setContexts([0, 1, 2]);
}

async function run(interaction, res) {
    const { args, messages } = parseOsuSlashArgs(interaction, res);
    const result = await osuChatCommand.run(messages, args);
    return result || true;
}

run.description = "Muestra el perfil de un usuario en osu!";

module.exports = { data, run, description: run.description };
