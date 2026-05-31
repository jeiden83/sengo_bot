const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    const { message } = messages;
    const locale = message.locale || 'es';

    const header = t(locale, 'commands.donadores.header');
    const body = t(locale, 'commands.donadores.body');

    return `**${header}**\n*${body}*\n\n- **Blast**`;
}

run.description = {
    'header': 'Donadores a los que quiero mucho',
    'body': 'Quienes contactaron a Jeiden para hablarle en privado y asi darle una forma de apoyo economico por su trabajo con el Sengo.',
    'usage': undefined
};

module.exports = { run };