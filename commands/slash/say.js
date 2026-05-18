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

    // Lógica robusta de envío
    try {
        // 1. Intentar enviar directamente en el canal
        await interaction.channel.send(texto);

        // 2. Si tiene éxito, eliminamos el mensaje diferido para emular s.say perfectamente
        try {
            await interaction.deleteReply();
        } catch (e) {
            // Ignorar errores al borrar
        }
    } catch (err) {
        // 3. Si falla por falta de permisos (Missing Access / Missing Permissions),
        // caemos en el respaldo de editar la respuesta diferida (que siempre tiene acceso)
        try {
            await interaction.editReply(texto);
        } catch (editError) {
            console.error("Error crítico de fallback en /say:", editError);
        }
    }

    return true; // Auto-gestionado
}

run.description = "Di algo como si fuera el Sengo";

module.exports = { data, run, description: run.description };
