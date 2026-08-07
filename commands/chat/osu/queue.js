const OsuUserModel = require("../../../models/OsuUserModel.js");
const { t } = require("../../../utils/i18n.js");
const { doQueueEmbed } = require("../../../views/queueViews.js");

/**
 * Sanitiza y valida un enlace HTTP/HTTPS.
 * @param {string} link Enlace a sanitizar
 * @returns {string|null} Enlace sanitizado o null si es inválido
 */
function sanitizeAndValidateLink(link) {
    if (!link || typeof link !== 'string') return null;
    let cleanLink = link.trim();
    
    if (cleanLink.startsWith('<') && cleanLink.endsWith('>')) {
        cleanLink = cleanLink.slice(1, -1).trim();
    }
    
    try {
        const parsed = new URL(cleanLink);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        
        const sanitized = parsed.toString();
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
        const members = await message.guild.members.fetch({ query, limit: 10 }).catch(() => new Map());
        if (members.size > 0) {
            return members.first().user;
        }
        const cachedMember = message.guild.members.cache.find(m => 
            m.user.username.toLowerCase() === queryLower || 
            (m.nickname && m.nickname.toLowerCase() === queryLower)
        );
        if (cachedMember) return cachedMember.user;
    }
    
    return null;
}

/**
 * Parsea una cadena de modos de juego (ej: "STD/MANIA", "std, taiko", "all")
 * @param {string} modeStr Cadena de modos
 * @returns {string[]} Lista de modos válidos en formato interno ('osu', 'taiko', 'fruits', 'mania')
 */
function parseModesString(modeStr) {
    if (!modeStr || typeof modeStr !== 'string') return ['osu'];

    const clean = modeStr.toLowerCase().trim();
    if (clean === 'all' || clean === 'todos' || clean === 'todas') {
        return ['osu', 'taiko', 'fruits', 'mania'];
    }

    const tokens = clean.split(/[\/\s,]+/);
    const modeSet = new Set();

    for (const token of tokens) {
        if (['std', 'osu', 'standard', '0'].includes(token)) modeSet.add('osu');
        else if (['taiko', 'tko', '1'].includes(token)) modeSet.add('taiko');
        else if (['ctb', 'catch', 'fruits', 'fruit', '2'].includes(token)) modeSet.add('fruits');
        else if (['mania', 'man', 'mna', '3'].includes(token)) modeSet.add('mania');
    }

    return modeSet.size > 0 ? Array.from(modeSet) : ['osu'];
}

/**
 * Parsea los argumentos para identificar las intenciones de set, link, abrir, cerrar, modo o borrar.
 * @param {string[]} args Lista de argumentos
 * @returns {Object} Datos parseados
 */
function parseQueueArgs(args) {
    const result = {
        isDelete: false,
        isSet: false,
        messageText: null,
        isLink: false,
        linkUrl: null,
        removeLink: false,
        status: null, // 'open' | 'closed' | null
        modes: null, // string[] | null
        userQuery: null
    };

    if (!args || args.length === 0) return result;

    const setFlags = ['-set', 'colocar', '-colocar'];
    const linkFlags = ['-link', 'link'];
    const openFlags = ['-abrir', 'aceptar', '-aceptar', 'open', '-open', 'abrir'];
    const closeFlags = ['-cerrar', 'negar', '-negar', 'close', '-close', 'cerrar'];
    const deleteFlags = ['-delete', 'borrar', '-borrar', 'delete'];
    const modeFlags = ['-modo', '-mode', 'modo', 'mode'];

    let i = 0;
    const userQueryParts = [];

    while (i < args.length) {
        const arg = args[i];
        const lowerArg = arg.toLowerCase().trim();

        if (deleteFlags.includes(lowerArg)) {
            result.isDelete = true;
            i++;
            continue;
        }

        if (openFlags.includes(lowerArg)) {
            result.status = 'open';
            i++;
            continue;
        }

        if (closeFlags.includes(lowerArg)) {
            result.status = 'closed';
            i++;
            continue;
        }

        if (modeFlags.includes(lowerArg)) {
            if (i + 1 < args.length) {
                result.modes = parseModesString(args[i + 1]);
                i += 2;
            } else {
                i++;
            }
            continue;
        }

        if (linkFlags.includes(lowerArg)) {
            result.isLink = true;
            const nextArg = args[i + 1];
            if (nextArg && (nextArg.startsWith('http://') || nextArg.startsWith('https://') || nextArg.includes('.'))) {
                result.linkUrl = nextArg;
                i += 2;
            } else if (nextArg && ['borrar', 'none', '-borrar', 'quitar', 'delete'].includes(nextArg.toLowerCase())) {
                result.removeLink = true;
                i += 2;
            } else {
                result.removeLink = true;
                i++;
            }
            continue;
        }

        if (setFlags.includes(lowerArg)) {
            result.isSet = true;
            const msgTokens = [];
            i++;
            while (i < args.length) {
                const peekLower = args[i].toLowerCase().trim();
                if (
                    setFlags.includes(peekLower) ||
                    linkFlags.includes(peekLower) ||
                    openFlags.includes(peekLower) ||
                    closeFlags.includes(peekLower) ||
                    deleteFlags.includes(peekLower) ||
                    modeFlags.includes(peekLower)
                ) {
                    break;
                }
                msgTokens.push(args[i]);
                i++;
            }
            result.messageText = msgTokens.join(' ');
            continue;
        }

        userQueryParts.push(arg);
        i++;
    }

    if (userQueryParts.length > 0) {
        result.userQuery = userQueryParts.join(' ');
    }

    return result;
}

async function run(messages, args) {
    const { message, logger } = messages;
    const locale = message.locale || 'es';

    try {
        const cleanArgs = (args || []).filter(arg => arg !== null && arg !== undefined && arg !== '');
        const parsed = parseQueueArgs(cleanArgs);

        // 1. Caso de eliminación: -delete / borrar
        if (parsed.isDelete) {
            if (logger) logger.process(`Eliminando queue de mapper del usuario ${message.author.id}`);
            await OsuUserModel.setQueue(message.author.id, null);
            return t(locale, 'queue.delete_success');
        }

        // 2. Verificar si se especificaron cambios/configuraciones en la queue
        const hasManagementFlags = parsed.isSet || parsed.isLink || parsed.removeLink || parsed.status !== null || parsed.modes !== null;

        if (hasManagementFlags) {
            if (logger) logger.process(`Actualizando queue de mapper para el usuario ${message.author.id}`);

            let currentQueue = await OsuUserModel.getQueue(message.author.id) || {
                message: null,
                link: null,
                status: 'open',
                modes: ['osu'],
                updatedAt: Date.now()
            };

            if (parsed.isSet) {
                let textToSet = parsed.messageText || "";
                if (textToSet.startsWith('"') && textToSet.endsWith('"') && textToSet.length >= 2) {
                    textToSet = textToSet.slice(1, -1);
                }
                if (textToSet.length > 2000) {
                    textToSet = textToSet.slice(0, 2000);
                }
                currentQueue.message = textToSet.trim() || null;
            }

            if (parsed.isLink) {
                if (parsed.removeLink || !parsed.linkUrl) {
                    currentQueue.link = null;
                } else {
                    const sanitized = sanitizeAndValidateLink(parsed.linkUrl);
                    if (!sanitized) {
                        return t(locale, 'queue.invalid_link');
                    }
                    currentQueue.link = sanitized;
                }
            }

            if (parsed.status) {
                currentQueue.status = parsed.status;
            }

            if (parsed.modes) {
                currentQueue.modes = parsed.modes;
            }

            currentQueue.updatedAt = Date.now();

            await OsuUserModel.setQueue(message.author.id, currentQueue);

            const embed = doQueueEmbed(message.author, currentQueue, locale, message);
            return {
                content: t(locale, 'queue.update_success'),
                embeds: [embed]
            };
        }

        // 3. Visualizar la queue de un usuario (propia o de otro)
        let targetUser = message.author;
        if (parsed.userQuery) {
            const resolved = await resolveUser(message, parsed.userQuery);
            if (!resolved) {
                return t(locale, 'queue.user_not_found');
            }
            targetUser = resolved;
        }

        if (logger) logger.process(`Consultando queue de mapper para el usuario ${targetUser.id}`);
        const queueData = await OsuUserModel.getQueue(targetUser.id);

        if (!queueData) {
            if (targetUser.id === message.author.id) {
                return t(locale, 'queue.not_found');
            } else {
                return t(locale, 'queue.not_found_other', { username: targetUser.username });
            }
        }

        const embed = doQueueEmbed(targetUser, queueData, locale, message);
        return { embeds: [embed] };

    } catch (error) {
        console.error('Error en el comando queue:', error);
        return t(locale, 'general.error_unexpected');
    }
}

run.description = {
    'header': t('es', 'commands.queue.header'),
    'body': t('es', 'commands.queue.body'),
    'usage': t('es', 'commands.queue.usage')
};

module.exports = { run, description: run.description };
