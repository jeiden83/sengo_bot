const { SlashCommandBuilder } = require("discord.js");
const { t } = require("../../utils/i18n.js");

const data = new SlashCommandBuilder()
    .setName("say")
    .setDescription("Di algo como si fuera el Sengo / Say something as Sengo")
    .addStringOption(option =>
        option
            .setName("texto")
            .setDescription("El mensaje que dirá Sengo / The message that Sengo will say")
            .setRequired(true)
    );

async function run(interaction) {
    const locale = interaction.resolvedLocale || 'es';
    const texto = interaction.options.getString("texto");

    if (!texto || !texto.trim()) {
        return t(locale, 'utils.say_err_empty');
    }

    const authorName = interaction.user.username;
    const currentDate = new Date().toISOString();
    console.log(`[${currentDate}] (${authorName}) (Slash) : /say texto: ${texto}`);

    try {
        await interaction.channel.send(texto);
        try {
            await interaction.deleteReply();
        } catch (e) {
            // Ignorar
        }
    } catch (err) {
        try {
            await interaction.editReply(texto);
        } catch (editError) {
            console.error("Error crítico de fallback en /say:", editError);
        }
    }

    return true;
}

run.description = "Di algo como si fuera el Sengo / Say something as Sengo";

module.exports = { data, run, description: run.description };
