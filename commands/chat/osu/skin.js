const OsuUserModel = require("../../../models/OsuUserModel.js");
const { t } = require("../../../utils/i18n.js");
const { doSkinEmbed } = require("../../../views/skinViews.js");

/**
 * Filtra y sanitiza el enlace proporcionado por el usuario.
 * Asegura que sea un enlace HTTP/HTTPS válido y limita su longitud.
 * @param {string} link Enlace a sanitizar
 * @returns {string|null} Enlace sanitizado o null si es inválido
 */
function sanitizeAndValidateLink(link) {
    if (!link || typeof link !== 'string') return null;
    let cleanLink = link.trim();
    
    // Quitar brackets angulares si los hay (p. ej. <http://link.com>)
    if (cleanLink.startsWith('<') && cleanLink.endsWith('>')) {
        cleanLink = cleanLink.slice(1, -1).trim();
    }
    
    try {
        const parsed = new URL(cleanLink);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        
        const sanitized = parsed.toString();
        // Limitar la longitud a 500 caracteres para evitar abusos
        if (sanitized.length > 500) {
            return null;
        }
        
        return sanitized;
    } catch {
        return null;
    }
}

/**
 * Resuelve un usuario de Discord a partir de una mención, ID o nombre.
 * @param {import('discord.js').Message} message Mensaje de origen
 * @param {string} query Búsqueda (mención, ID o nombre)
 * @returns {Promise<import('discord.js').User|null>} Usuario resuelto o null
 */
async function resolveUser(message, query) {
    if (!query) return null;
    
    const mentionMatch = query.match(/^<@!?(\d+)>$/);
    const resolvedId = mentionMatch ? mentionMatch[1] : (query.match(/^\d{17,19}$/) ? query : null);
    
    if (resolvedId) {
        try {
            if (message.guild) {
                const member = await message.guild.members.fetch(resolvedId).catch(() => null);
                if (member) return member.user;
            }
            return await message.client.users.fetch(resolvedId).catch(() => null);
        } catch {
            return null;
        }
    }
    
    if (message.guild) {
        const queryLower = query.toLowerCase();
        // Buscar miembros por query en la API de Discord
        const members = await message.guild.members.fetch({ query, limit: 10 }).catch(() => new Map());
        if (members.size > 0) {
            return members.first().user;
        }
        // Caída al caché manual del servidor
        const cachedMember = message.guild.members.cache.find(m => 
            m.user.username.toLowerCase() === queryLower || 
            (m.nickname && m.nickname.toLowerCase() === queryLower)
        );
        if (cachedMember) return cachedMember.user;
    }
    
    return null;
}

/**
 * Parsea los argumentos para identificar las intenciones de set, borrar, nombre, o consulta.
 * @param {string[]} args Lista de argumentos limpios
 * @returns {Object} Argumentos parseados
 */
function parseSkinArgs(args) {
    const result = {
        isSet: false,
        link: null,
        isDelete: false,
        isName: false,
        name: null,
        userQuery: null
    };

    if (!args || args.length === 0) return result;

    const firstArgLower = args[0].toLowerCase();
    if (['-delete', 'borrar', '-borrar', 'delete'].includes(firstArgLower)) {
        result.isDelete = true;
        return result;
    }

    const setFlags = ['-set', 'colocar'];
    const nameFlags = ['-nombre', '-name', 'nombre', 'name'];

    const setIndex = args.findIndex(arg => setFlags.includes(arg.toLowerCase()));
    const nameIndex = args.findIndex(arg => nameFlags.includes(arg.toLowerCase()));

    // Si se especificó set/colocar
    if (setIndex !== -1) {
        result.isSet = true;
        if (args[setIndex + 1]) {
            result.link = args[setIndex + 1];
        }
    }

    // Si se especificó nombre/name
    if (nameIndex !== -1) {
        result.isName = true;
        const nameParts = [];
        for (let i = nameIndex + 1; i < args.length; i++) {
            const currentArgLower = args[i].toLowerCase();
            if (setFlags.includes(currentArgLower) || nameFlags.includes(currentArgLower)) {
                break;
            }
            nameParts.push(args[i]);
        }
        if (nameParts.length > 0) {
            result.name = nameParts.join(' ');
        }
    }

    // Si no es borrar, y no se está vinculando ni editando nombre en el primer argumento
    if (!result.isDelete && setIndex !== 0 && nameIndex !== 0) {
        const queryParts = [];
        for (let i = 0; i < args.length; i++) {
            const currentArgLower = args[i].toLowerCase();
            if (setFlags.includes(currentArgLower) || nameFlags.includes(currentArgLower)) {
                break;
            }
            queryParts.push(args[i]);
        }
        if (queryParts.length > 0) {
            result.userQuery = queryParts.join(' ');
        }
    }

    return result;
}

async function run(messages, args) {
    const { message, logger } = messages;
    const locale = message.locale || 'es';
    
    try {
        const cleanArgs = (args || []).filter(arg => arg !== null && arg !== undefined && arg !== '');
        const parsed = parseSkinArgs(cleanArgs);

        // 1. Caso de eliminación: -delete / borrar / -borrar / delete
        if (parsed.isDelete) {
            if (logger) logger.process(`Eliminando skin para el usuario ${message.author.id}`);
            await OsuUserModel.setSkin(message.author.id, null, null);
            return t(locale, 'skin.delete_success');
        }

        // 2. Caso de vinculación (con nombre opcional)
        if (parsed.isSet) {
            const rawLink = parsed.link;
            if (!rawLink) {
                return t(locale, 'skin.invalid_link');
            }
            
            const sanitizedLink = sanitizeAndValidateLink(rawLink);
            if (!sanitizedLink) {
                return t(locale, 'skin.invalid_link');
            }
            
            if (logger) logger.process(`Guardando skin y nombre para el usuario ${message.author.id}`);
            await OsuUserModel.setSkin(message.author.id, sanitizedLink, parsed.name || null);
            
            return t(locale, 'skin.set_success', { link: sanitizedLink });
        }

        // 3. Caso de editar solo el nombre
        if (parsed.isName) {
            if (logger) logger.process(`Actualizando nombre de skin para el usuario ${message.author.id}`);
            
            // Verificar si el usuario ya tiene una skin vinculada
            const existingSkin = await OsuUserModel.getSkin(message.author.id);
            if (!existingSkin || !existingSkin.skinUrl) {
                return t(locale, 'skin.name_no_skin');
            }

            await OsuUserModel.setSkin(message.author.id, undefined, parsed.name || null);
            return t(locale, 'skin.name_success', { name: parsed.name });
        }
        
        // 4. Caso de visualizar skin
        let targetUser = message.author;
        if (parsed.userQuery) {
            const resolved = await resolveUser(message, parsed.userQuery);
            if (!resolved) {
                return t(locale, 'skin.user_not_found');
            }
            targetUser = resolved;
        }
        
        if (logger) logger.process(`Consultando skin para el usuario ${targetUser.id}`);
        const skinData = await OsuUserModel.getSkin(targetUser.id);
        
        if (!skinData || !skinData.skinUrl) {
            if (targetUser.id === message.author.id) {
                return t(locale, 'skin.not_found');
            } else {
                return t(locale, 'skin.not_found_other', { username: targetUser.username });
            }
        }
        
        // Crear el embed de visualización de la skin
        const embed = doSkinEmbed(targetUser, skinData.skinUrl, skinData.skinName, locale, message);
        return { embeds: [embed] };
        
    } catch (error) {
        console.error('Error en el comando skin:', error);
        return t(locale, 'general.error_unexpected');
    }
}

run.description = {
    'header': t('es', 'commands.skin.header'),
    'body': t('es', 'commands.skin.body'),
    'usage': t('es', 'commands.skin.usage')
};

module.exports = { run, description: run.description };
