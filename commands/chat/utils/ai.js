const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    const { message, res, reply, logger } = messages;
    const locale = message.locale || 'es';

    const cleanArgs = (args || []).flat(Infinity).filter(arg => arg !== null && arg !== undefined && arg !== '');
    if (cleanArgs.length === 0) {
        return t(locale, 'ai.err_no_prompt');
    }

    const { parseNaturalLanguage } = require("../../../services/typeSafeRouter.js");

    const prompt = cleanArgs.join(' ');
    const parsed = await parseNaturalLanguage(prompt);

    if (!parsed || !parsed.command) {
        return t(locale, 'ai.err_not_understood', { prompt });
    }

    const { chatCommand, loadCommands } = require("../../handler.js");
    const chat_commands = messages.chat_commands || await loadCommands();

    return await chatCommand(chat_commands, {
        command: parsed.command,
        args: parsed.args,
        message,
        res,
        reply,
        logger
    });
}

run.alias = {
    "ia": "ai",
    "?": "ai"
};

run.description = {
    'header': "Ejecutar comandos con lenguaje natural usando TypeSafe Jev / Run commands with natural language",
    'body': "Interpreta y ejecuta cualquier comando de Sengo a partir de lo que pides en lenguaje natural (ej: 'dime mi top en std', 'recomiéndame mapas', 'a cuánto está el bcv').",
    'usage': "s.ai <petición en lenguaje natural>"
};

module.exports = { run, description: run.description };
