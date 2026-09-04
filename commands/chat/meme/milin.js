const { t } = require("../../../utils/i18n.js");

const MILIN_GIF_URL = "https://jeiden.s-ul.eu/yvTUWlHu.gif";

async function run(messages, args) {
    const { logger } = messages || {};
    if (logger) logger.process("Enviando gif del meme milin");

    return MILIN_GIF_URL;
}

run.description = {
    header: t('es', 'commands.milin.header'),
    body: t('es', 'commands.milin.body'),
    usage: t('es', 'commands.milin.usage')
};

module.exports = { run };
