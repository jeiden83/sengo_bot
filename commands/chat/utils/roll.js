const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    const { message } = messages;
    const locale = message.locale || 'es';

    const cleanArgs = (args || []).flat(Infinity).filter(arg => arg !== null && arg !== undefined && arg !== '');
    
    let bottom = 1;
    let top = 100;

    if (cleanArgs.length > 0) {
        top = parseInt(cleanArgs[0], 10);

        if (isNaN(top)) {
            return t(locale, 'utils.roll_err_max_num');
        }
    }

    if (cleanArgs.length > 1) {
        bottom = parseInt(cleanArgs[1], 10);

        if (isNaN(bottom)) {
            return t(locale, 'utils.roll_err_min_num');
        }
    }

    if (bottom > top) {
        return t(locale, 'utils.roll_err_min_greater', { bottom, top });
    }

    const roll = Math.floor(Math.random() * (top - bottom + 1)) + bottom;

    return t(locale, 'utils.roll_result', { roll, bottom, top });
}

run.description = {
    'header': t('es', 'commands.roll.header'),
    'body': t('es', 'commands.roll.body'),
    'usage': t('es', 'commands.roll.usage')
};

module.exports = { run, description: run.description }