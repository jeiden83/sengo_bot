const { SlashCommandBuilder } = require("discord.js");
const amigosChatCommand = require("../chat/osu/amigos.js");

const data = new SlashCommandBuilder()
    .setName("amigos")
    .setDescription("Muestra tu lista de amigos de osu! por páginas")
    .addStringOption(option =>
        option.setName("pais")
            .setDescription("Filtra amigos por código de país (ej. CL, AR) o 'self'")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("mutuals")
            .setDescription("Filtra solo amigos que son mutuales (💕)")
            .setRequired(false)
    )
    .addBooleanOption(option =>
        option.setName("nomutuals")
            .setDescription("Filtra solo amigos que no te siguen de vuelta (❌)")
            .setRequired(false)
    )
    .addStringOption(option =>
        option.setName("track")
            .setDescription("Configura el canal para tracking de mutuales cada 8h (Solo Creador)")
            .setRequired(false)
            .addChoices(
                { name: "Activar en este canal", value: "on" },
                { name: "Desactivar", value: "off" },
                { name: "Comprobar ahora", value: "check" }
            )
    );

async function run(interaction, res) {
    const args = [];
    const pais = interaction.options.getString("pais");
    const mutuals = interaction.options.getBoolean("mutuals");
    const nomutuals = interaction.options.getBoolean("nomutuals");
    const track = interaction.options.getString("track");

    if (pais) {
        args.push("-pais", pais);
    }
    if (mutuals) {
        args.push("-mutuals");
    }
    if (nomutuals) {
        args.push("-nomutuals");
    }
    if (track) {
        args.push("-track");
        if (track === "off" || track === "check") {
            args.push(track);
        }
    }

    const { createSlashMessagesContext } = require("../utils/slashUtils.js");
    const messages = createSlashMessagesContext(interaction, res);

    const result = await amigosChatCommand.run(messages, args);

    if (result) {
        await interaction.editReply(result);
    }

    return true; // Auto-gestionado
}

module.exports = { data, run, description: "Muestra tu lista de amigos de osu! por páginas" };
