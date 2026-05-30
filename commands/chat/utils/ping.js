const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    const { message } = messages;
    const locale = message.locale || 'es';

    const startTime = Date.now();
    const sentMessage = await message.channel.send(t(locale, 'utils.ping_loading'));
    const latency = Date.now() - startTime;

    await sentMessage.edit(t(locale, 'utils.ping_response', { latency }));
}

run.description = {
    'header': 'Muestra la latencia del bot / Shows the bot\'s latency',
    'body': 'Calcula el tiempo de respuesta en milisegundos desde Discord. / Calculates response time in milliseconds from Discord.',
    'usage': 's.ping'
};

module.exports = { run, description: run.description }