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

async function run(messages, args) {
    const { message, logger } = messages;
    const locale = message.locale || 'es';
    
    try {
        const cleanArgs = (args || []).filter(arg => arg !== null && arg !== undefined && arg !== '');
        
        // 1. Caso de vinculación: -set / colocar
        if (cleanArgs.length > 0 && (cleanArgs[0].toLowerCase() === '-set' || cleanArgs[0].toLowerCase() === 'colocar')) {
            const rawLink = cleanArgs[1];
            if (!rawLink) {
                return t(locale, 'skin.invalid_link');
            }
            
            const sanitizedLink = sanitizeAndValidateLink(rawLink);
            if (!sanitizedLink) {
                return t(locale, 'skin.invalid_link');
            }
            
            if (logger) logger.process(`Guardando skin para el usuario ${message.author.id}`);
            await OsuUserModel.setSkinUrl(message.author.id, sanitizedLink);
            
            return t(locale, 'skin.set_success', { link: sanitizedLink });
        }
        
        // 2. Caso de eliminación: -delete / borrar / -borrar / delete
        if (cleanArgs.length > 0 && (cleanArgs[0].toLowerCase() === '-delete' || cleanArgs[0].toLowerCase() === 'borrar' || cleanArgs[0].toLowerCase() === '-borrar' || cleanArgs[0].toLowerCase() === 'delete')) {
            if (logger) logger.process(`Eliminando skin para el usuario ${message.author.id}`);
            await OsuUserModel.setSkinUrl(message.author.id, null);
            
            return t(locale, 'skin.delete_success');
        }
        
        // 3. Caso de visualizar skin
        let targetUser = message.author;
        if (cleanArgs.length > 0) {
            // Se especificó un usuario a buscar
            const query = cleanArgs.join(' ');
            const resolved = await resolveUser(message, query);
            if (!resolved) {
                return t(locale, 'skin.user_not_found');
            }
            targetUser = resolved;
        }
        
        if (logger) logger.process(`Consultando skin para el usuario ${targetUser.id}`);
        const skinUrl = await OsuUserModel.getSkinUrl(targetUser.id);
        
        if (!skinUrl) {
            if (targetUser.id === message.author.id) {
                return t(locale, 'skin.not_found');
            } else {
                return t(locale, 'skin.not_found_other', { username: targetUser.username });
            }
        }
        
        // Crear el embed de visualización de la skin
        const embed = doSkinEmbed(targetUser, skinUrl, locale, message);
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
