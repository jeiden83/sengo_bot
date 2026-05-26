const { SlashCommandBuilder } = require("discord.js");
const reworkChatCommand = require("../chat/osu/rework.js");

const data = new SlashCommandBuilder()
    .setName("rework")
    .setDescription("Calcula estimaciones de PP de reworks o muestra perfiles de usuario en reworks")
    .addStringOption(option =>
        option.setName("mapa")
            .setDescription("ID o URL del beatmap de osu!")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("mods")
            .setDescription("Mods a aplicar (ej: HDHR, DT, FL)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("rework")
            .setDescription("Nombre o ID del rework (ej: q1-2026, 198)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("usuario")
            .setDescription("Usuario a comparar PP de rework")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("comparar")
            .setDescription("Comparar PP de rework para ti o el usuario indicado")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("lista")
            .setDescription("Ver lista de reworks próximos, propuestos y WIP")
            .setRequired(false)
    );

async function run(interaction, res) {
    const mapa = interaction.options.getString("mapa");
    const mods = interaction.options.getString("mods");
    const rework = interaction.options.getString("rework");
    const usuario = interaction.options.getString("usuario");
    const comparar = interaction.options.getBoolean("comparar");
    const lista = interaction.options.getBoolean("lista");

    const args = [];
    if (lista) {
        args.push("-lista");
    }
    if (comparar || usuario) {
        args.push("-o");
        if (usuario) args.push(usuario);
    }
    if (rework) {
        args.push("-rework", rework);
    }
    if (mapa) {
        args.push(mapa);
    }
    if (mods) {
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

    return await reworkChatCommand.run(messages, args);
}

run.description = "Calcula estimaciones de PP de reworks o muestra perfiles de usuario en reworks";

module.exports = { data, run, description: run.description };
