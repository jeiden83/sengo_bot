const { PermissionsBitField } = require('discord.js');
const { updateGuildConfig } = require('../../../models/GuildConfigModel.js');
const { doLanguageChangedEmbed, doLanguageHelpEmbed, doLanguageListEmbed } = require('../../../views/languageViews.js');
const { t } = require('../../../utils/i18n.js');
const config = require('../../../config.js');

async function run(messages, args) {
    const { message } = messages;
    const locale = message.locale || 'es';
    const prefix = message.content ? message.content.slice(0, config.BOT_PREFIX.length) : config.BOT_PREFIX;

    if (!message.guild) {
        return t(locale, 'language.only_guild');
    }

    // Verificar si el usuario tiene permisos de Administrador
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return t(locale, 'language.no_admin');
    }

    // Aplanar y filtrar argumentos para evitar arreglos anidados (ej. por alias)
    const flatArgs = args.flat(Infinity).filter(arg => arg !== undefined && arg !== null);

    if (!flatArgs[0]) {
        return { embeds: [doLanguageHelpEmbed(locale, prefix)] };
    }

    const inputLang = String(flatArgs[0]).toLowerCase().trim();
    
    if (inputLang === 'list' || inputLang === '-list') {
        return { embeds: [doLanguageListEmbed(locale, prefix)] };
    }

    if (inputLang !== 'es' && inputLang !== 'en') {
        return { embeds: [doLanguageHelpEmbed(locale, prefix)] };
    }

    try {
        await updateGuildConfig(message.guild.id, { language: inputLang });
        return { embeds: [doLanguageChangedEmbed(inputLang)] };
    } catch (err) {
        console.error("Error al actualizar idioma del servidor:", err);
        return t(locale, 'language.db_error');
    }
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
