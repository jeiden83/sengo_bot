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
    'header': "Lanza un número aleatorio / Rolls a random number",
    'body': 'Genera un número entero pseudoaleatorio entre un rango mínimo y máximo. / Generates a pseudo-random integer between a minimum and maximum range.',
    'usage': 's.roll [max] [min] : Por defecto entre 1 y 100.'
};

module.exports = { run, description: run.description }