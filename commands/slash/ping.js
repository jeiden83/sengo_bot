const { t } = require("../../utils/i18n.js");

async function run(interaction) {
    const locale = interaction.resolvedLocale || 'es';
    const latency = Date.now() - interaction.createdTimestamp;
    return t(locale, 'utils.ping_response', { latency });
}

run.description = "Muestra la latencia del bot / Shows the bot's latency";

module.exports = { run, description: run.description };