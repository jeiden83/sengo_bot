const { PermissionsBitField } = require('discord.js');
const { updateGuildConfig } = require('../../../models/GuildConfigModel.js');
const { doLanguageChangedEmbed, doLanguageHelpEmbed } = require('../../../views/languageViews.js');

async function run(messages, args) {
    const { message } = messages;

    if (!message.guild) {
        return "Este comando solo se puede usar en un servidor.";
    }

    const locale = message.locale || 'es';
    const prefix = message.content && message.content.startsWith("sd.") ? "sd." : "s.";

    // Verificar si el usuario tiene permisos de Administrador
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return "No tienes permisos de Administrador para cambiar el idioma del servidor.";
    }

    // Aplanar y filtrar argumentos para evitar arreglos anidados (ej. por alias)
    const flatArgs = args.flat(Infinity).filter(arg => arg !== undefined && arg !== null);

    if (!flatArgs[0]) {
        return { embeds: [doLanguageHelpEmbed(locale, prefix)] };
    }

    const inputLang = String(flatArgs[0]).toLowerCase().trim();
    if (inputLang !== 'es' && inputLang !== 'en') {
        return { embeds: [doLanguageHelpEmbed(locale, prefix)] };
    }

    try {
        await updateGuildConfig(message.guild.id, { language: inputLang });
        return { embeds: [doLanguageChangedEmbed(inputLang)] };
    } catch (err) {
        console.error("Error al actualizar idioma del servidor:", err);
        return "Hubo un error al intentar actualizar el idioma en la base de datos.";
    }
}

run.alias = {
    'idioma': { args: null }
};

run.description = {
    'header': "Configuración de idioma del servidor / Server language configuration",
    'body': 'Permite cambiar el idioma preferido del servidor para las respuestas de Sengo.',
    'usage': 's.language [es|en] / s.idioma [es|en]'
};

module.exports = { run, description: run.description };
