const { PermissionsBitField } = require('discord.js');
const { updateGuildConfig, getGuildLanguage } = require('../../../models/GuildConfigModel.js');
const { getUserLanguage, updateUserLanguage } = require('../../../models/UserConfigModel.js');
const { doLanguageChangedEmbed, doLanguageResetEmbed, doLanguageHelpEmbed, doLanguageListEmbed } = require('../../../views/languageViews.js');
const { t } = require('../../../utils/i18n.js');
const config = require('../../../config.js');

async function run(messages, args) {
    const { message } = messages;
    const locale = message.locale || 'es';
    const prefix = message.content ? message.content.slice(0, config.BOT_PREFIX.length) : config.BOT_PREFIX;

    // Aplanar y filtrar argumentos para evitar arreglos anidados (ej. por alias)
    const flatArgs = args.flat(Infinity).filter(arg => arg !== undefined && arg !== null);

    // Si no se proporcionan argumentos, mostrar lista e información actual
    if (!flatArgs[0]) {
        const userLang = await getUserLanguage(message.author.id);
        const serverLang = message.guild ? await getGuildLanguage(message.guild.id) : null;
        return { embeds: [doLanguageListEmbed(locale, prefix, userLang, serverLang)] };
    }

    const firstArg = String(flatArgs[0]).toLowerCase().trim();

    // 1. Comando de lista: list / -list
    if (firstArg === 'list' || firstArg === '-list') {
        const userLang = await getUserLanguage(message.author.id);
        const serverLang = message.guild ? await getGuildLanguage(message.guild.id) : null;
        return { embeds: [doLanguageListEmbed(locale, prefix, userLang, serverLang)] };
    }

    // 2. Restablecer idioma personal: reset / default / restablecer
    if (firstArg === 'reset' || firstArg === 'default' || firstArg === 'restablecer') {
        try {
            await updateUserLanguage(message.author.id, null);
            return { embeds: [doLanguageResetEmbed(locale)] };
        } catch (err) {
            console.error("Error al restablecer idioma del usuario:", err);
            return t(locale, 'language.db_error');
        }
    }

    // 3. Modificar idioma del servidor: server / servidor / -server / -servidor
    if (firstArg === 'server' || firstArg === 'servidor' || firstArg === '-server' || firstArg === '-servidor') {
        if (!message.guild) {
            return t(locale, 'language.only_guild');
        }

        // Verificar permisos de Administrador
        if (!message.member?.permissions?.has(PermissionsBitField.Flags.Administrator)) {
            return t(locale, 'language.no_admin');
        }

        const serverLangInput = flatArgs[1] ? String(flatArgs[1]).toLowerCase().trim() : null;
        if (serverLangInput !== 'es' && serverLangInput !== 'en') {
            return { embeds: [doLanguageHelpEmbed(locale, prefix)] };
        }

        try {
            await updateGuildConfig(message.guild.id, { language: serverLangInput });
            return { embeds: [doLanguageChangedEmbed(serverLangInput, false)] };
        } catch (err) {
            console.error("Error al actualizar idioma del servidor:", err);
            return t(locale, 'language.db_error');
        }
    }

    // 4. Modificar idioma personal explícito o directo:
    let personalLang = null;
    if (firstArg === 'user' || firstArg === 'me' || firstArg === 'personal') {
        personalLang = flatArgs[1] ? String(flatArgs[1]).toLowerCase().trim() : null;
    } else if (firstArg === 'es' || firstArg === 'en') {
        personalLang = firstArg;
    }

    if (personalLang === 'es' || personalLang === 'en') {
        try {
            await updateUserLanguage(message.author.id, personalLang);
            return { embeds: [doLanguageChangedEmbed(personalLang, true)] };
        } catch (err) {
            console.error("Error al actualizar idioma del usuario:", err);
            return t(locale, 'language.db_error');
        }
    }

    // Si no coincide con ninguna opción válida, mostrar ayuda
    return { embeds: [doLanguageHelpEmbed(locale, prefix)] };
}

run.alias = {
    'idioma': { args: null }
};

run.description = {
    'header': t('es', 'commands.language.header'),
    'body': t('es', 'commands.language.body'),
    'usage': t('es', 'commands.language.usage')
};

module.exports = { run, description: run.description };
