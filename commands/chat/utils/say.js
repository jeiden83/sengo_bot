const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    const { message, reply } = messages;
    const locale = message.locale || 'es';

    const textToSay = (args || []).flat(Infinity).filter(arg => arg !== null && arg !== undefined).join(' ').trim();
    if (!textToSay) {
        return t(locale, 'utils.say_err_empty');
    }

    const authorName = message.author?.username || "Unknown";
    const messageContent = message.content || ""; 
    const currentDate = new Date().toISOString();

    console.log(`[${currentDate}] (${authorName}) : ${messageContent}`);

    try {
        await message.delete();
    } catch (e) {
        // Ignorar si faltan permisos de borrado
    }

    if (reply) {
        reply.reply(textToSay);
        return;
    }

    return textToSay;
}

run.alias = {
    "decir" : {
        "args" : ""
    },
    "impersonar" : {
        "args" : ""
    } 
};

run.description = {
    'header': t('es', 'commands.say.header'),
    'body': t('es', 'commands.say.body'),
    'usage': t('es', 'commands.say.usage')
};

module.exports = { run }