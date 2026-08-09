const { SlashCommandBuilder } = require("discord.js");
const amigosChatCommand = require("../chat/osu/amigos.js");

const data = new SlashCommandBuilder()
    .setName("amigos")
    .setDescription("Muestra tu lista de amigos de osu! por páginas")
    .addStringOption(option =>
        option.setName("pais")
            .setDescription("Filtra amigos por código de país (ej. CL, AR) o 'self'")
            .setRequired(false)
    );

async function run(interaction, res) {
    const args = [];
    const pais = interaction.options.getString("pais");

    if (pais) {
        args.push("-pais", pais);
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
