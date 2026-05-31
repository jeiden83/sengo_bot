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
    'header': t('es', 'commands.ping.header'),
    'body': t('es', 'commands.ping.body'),
    'usage': t('es', 'commands.ping.usage')
};

module.exports = { run, description: run.description }