const { SlashCommandBuilder } = require("discord.js");
const entreChatCommand = require("../chat/osu/entre.js");
const { addModoOption, addServidorOption } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("entre")
    .setDescription("Compara estadísticas generales entre dos jugadores")
    .addStringOption(option =>
        option.setName("jugador1")
            .setDescription("Nombre de usuario de osu! o mención de Discord del primer jugador")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("jugador2")
            .setDescription("Nombre de usuario de osu! o mención de Discord del segundo jugador")
            .setRequired(false)
    )
    .addStringOption(addModoOption)
    .addStringOption(addServidorOption);

async function run(interaction, res) {
    const jugador1 = interaction.options.getString("jugador1");
    const jugador2 = interaction.options.getString("jugador2");
    const modo = interaction.options.getString("modo");
    const servidor = interaction.options.getString("servidor");

    const args = [];
    if (jugador1) {
        const mentionMatch1 = jugador1.match(/^<@!?(\d+)>$/);
        args.push(mentionMatch1 ? mentionMatch1[1] : jugador1);
    }
    if (jugador2) {
        const mentionMatch2 = jugador2.match(/^<@!?(\d+)>$/);
        args.push(mentionMatch2 ? mentionMatch2[1] : jugador2);
    }
    if (modo) args.push(`-${modo}`);
    if (servidor) args.push(`-${servidor}`);

    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);
    messages.interaction = interaction;

    const result = await entreChatCommand.run(messages, args);
    if (result) {
        await interaction.editReply(result);
    }
    return true;
}

run.description = "Compara estadísticas generales entre dos jugadores";

module.exports = { data, run, description: run.description };
