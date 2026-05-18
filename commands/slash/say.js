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

    // Responder de forma efímera para ocultar la burbuja del comando de barra diagonal
    await interaction.reply({ content: "¡Mensaje enviado con éxito!", ephemeral: true });

    // Enviar el mensaje del bot directamente en el canal
    await interaction.channel.send(texto);

    return true; // Auto-gestionado
}

run.description = "Di algo como si fuera el Sengo";

module.exports = { data, run, description: run.description };
