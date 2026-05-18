const { SlashCommandBuilder } = require("discord.js");

const data = new SlashCommandBuilder()
    .setName("say")
    .setDescription("Di algo como si fuera el Sengo")
    .addStringOption(option =>
        option
            .setName("texto")
            .setDescription("El mensaje que dirá Sengo")
            .setRequired(true)
    );

async function run(interaction) {
    const texto = interaction.options.getString("texto");

    const authorName = interaction.user.username;
    const currentDate = new Date().toISOString();
    console.log(`[${currentDate}] (${authorName}) (Slash) : /say texto: ${texto}`);

    // Enviar el mensaje del bot directamente en el canal de texto
    await interaction.channel.send(texto);

    // Eliminar el mensaje diferido de "Sengo está pensando..." para emular s.say perfectamente
    try {
        await interaction.deleteReply();
    } catch (e) {
        // Ignorar errores al borrar
    }

    return true; // Auto-gestionado
}

run.description = "Di algo como si fuera el Sengo";

module.exports = { data, run, description: run.description };
