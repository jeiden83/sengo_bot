const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    return "https://jeiden83.github.io/";
}

run.description = {
    header: t('es', 'commands.fate.header'),
    body: t('es', 'commands.fate.body'),
    usage: t('es', 'commands.fate.usage')
};

module.exports = { run };
