const { SlashCommandBuilder } = require("discord.js");
const mapChatCommand = require("../chat/osu/m.js");

const data = new SlashCommandBuilder()
    .setName("m")
    .setDescription("Muestra detalles, estadísticas y valores de PP de un beatmap")
    .addStringOption(option =>
        option.setName("mapa")
            .setDescription("ID o URL del beatmap de osu!")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("mods")
            .setDescription("Mods a aplicar (ej: HDHR, DT, FL)")
            .setRequired(false)
    );

async function run(interaction, res) {
    const mapa = interaction.options.getString("mapa");
    const mods = interaction.options.getString("mods");

    const args = [];
    if (mapa) args.push(mapa);
    if (mods) {
        // En los comandos de chat, los mods suelen pasarse con un "+" al principio (ej: +HDHR).
        // Agregamos "+" si no está presente para máxima compatibilidad con el parser.
        args.push(mods.startsWith("+") ? mods : `+${mods}`);
    }

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

    return await mapChatCommand.run(messages, args);
}

run.description = "Muestra detalles, estadísticas y valores de PP de un beatmap";

module.exports = { data, run, description: run.description };
