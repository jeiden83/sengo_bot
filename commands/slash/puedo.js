const { SlashCommandBuilder } = require("discord.js");
const puedoChatCommand = require("../chat/osu/puedo.js");
const { parseOsuSlashArgs } = require("../utils/slashUtils.js");

const data = new SlashCommandBuilder()
    .setName("puedo")
    .setDescription("Determina si te puedes pasar o fcear un mapa analizando tus habilidades e historial.")
    .addStringOption(option =>
        option.setName("mapa")
            .setDescription("Link o ID del mapa (ej: https://osu.ppy.sh/b/123456)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("mods")
            .setDescription("Mods opcionales (ej: HDDT, HR, EZ)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("usuario")
            .setDescription("Usuario de osu! a evaluar (por defecto tu cuenta vinculada)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("modo")
            .setDescription("Modo de juego (std, taiko, ctb, mania)")
            .setRequired(false)
    );

async function run(interaction, res) {
    const { args, messages } = parseOsuSlashArgs(interaction, res);

    const mapa = interaction.options.getString("mapa");
    if (mapa) args.push(mapa);

    const mods = interaction.options.getString("mods");
    if (mods) {
        const cleanMods = mods.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (cleanMods) args.push(`+${cleanMods}`);
    }

    const usuario = interaction.options.getString("usuario");
    if (usuario) args.push(usuario);

    const modo = interaction.options.getString("modo");
    if (modo) args.push("-modo", modo);

    const result = await puedoChatCommand.run(messages, args);
    return result || true;
}

run.description = "Determina si te puedes pasar o fcear un beatmap analizando tus skills, historial y cinemática.";

module.exports = { data, run, description: run.description };
