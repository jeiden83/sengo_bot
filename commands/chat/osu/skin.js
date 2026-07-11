const OsuUserModel = require("../../../models/OsuUserModel.js");
const { t } = require("../../../utils/i18n.js");
const { doSkinEmbed, buildSkinButtonsRow } = require("../../../views/skinViews.js");

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
 * Parsea los argumentos para identificar las intenciones de set, borrar, nombre, o consulta, además del modo de juego.
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
        mode: 'osu',
        hasExplicitMode: false,
        userQuery: null
    };

    if (!args || args.length === 0) return result;

    // Detectar y remover flags de modos de juego
    const osuFlags = ['-osu', '-std', '-standard'];
    const ctbFlags = ['-ctb', '-catch', '-fruits', '-fruit'];
    const taikoFlags = ['-taiko', '-tko'];
    const maniaFlags = ['-mania', '-man', '-mna'];

    const modeIndex = args.findIndex(arg => {
        const lower = arg.toLowerCase();
        return osuFlags.includes(lower) || ctbFlags.includes(lower) || taikoFlags.includes(lower) || maniaFlags.includes(lower);
    });

    if (modeIndex !== -1) {
        result.hasExplicitMode = true;
        const modeFlag = args[modeIndex].toLowerCase();
        if (osuFlags.includes(modeFlag)) result.mode = 'osu';
        else if (ctbFlags.includes(modeFlag)) result.mode = 'fruits';
        else if (taikoFlags.includes(modeFlag)) result.mode = 'taiko';
        else if (maniaFlags.includes(modeFlag)) result.mode = 'mania';
        
        args.splice(modeIndex, 1);
    }

    // Volver a comprobar la longitud después de remover el modo
    if (args.length === 0) return result;

    const firstArgLower = args[0].toLowerCase();
    if (['-delete', 'borrar', '-borrar', 'delete'].includes(firstArgLower)) {
        result.isDelete = true;
        return result;
    }

    const setFlags = ['-set', 'colocar'];
    const nameFlags = ['-nombre', '-name', 'nombre', 'name'];

    let setIndex = args.findIndex(arg => setFlags.includes(arg.toLowerCase()));
    let isPlainSet = false;

    // Detección inteligente si se usó "set" (sin guion) seguido de un enlace
    if (setIndex === -1) {
        const plainSetIndex = args.findIndex(arg => arg.toLowerCase() === 'set');
        if (plainSetIndex !== -1) {
            const nextArg = args[plainSetIndex + 1];
            if (nextArg && (nextArg.startsWith('http://') || nextArg.startsWith('https://') || nextArg.includes('.'))) {
                setIndex = plainSetIndex;
                isPlainSet = true;
            }
        }
    }

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
            if (setFlags.includes(currentArgLower) || nameFlags.includes(currentArgLower) || (isPlainSet && currentArgLower === 'set')) {
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
            if (setFlags.includes(currentArgLower) || nameFlags.includes(currentArgLower) || (isPlainSet && currentArgLower === 'set')) {
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
            if (parsed.hasExplicitMode) {
                if (logger) logger.process(`Eliminando skin para el modo ${parsed.mode} del usuario ${message.author.id}`);
                await OsuUserModel.setSkinByMode(message.author.id, parsed.mode, null, null);
                const modeLabel = t(locale, `skin.modes.${parsed.mode}`);
                return t(locale, 'skin.delete_success_mode', { mode: modeLabel });
            } else {
                if (logger) logger.process(`Eliminando todas las skins para el usuario ${message.author.id}`);
                await OsuUserModel.clearAllSkins(message.author.id);
                return t(locale, 'skin.delete_success');
            }
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
            
            if (logger) logger.process(`Guardando skin para el modo ${parsed.mode} del usuario ${message.author.id}`);
            await OsuUserModel.setSkinByMode(message.author.id, parsed.mode, sanitizedLink, parsed.name || null);
            
            const modeLabel = t(locale, `skin.modes.${parsed.mode}`);
            return t(locale, 'skin.set_success_mode', { mode: modeLabel, link: sanitizedLink });
        }

        // 3. Caso de editar solo el nombre
        if (parsed.isName) {
            if (logger) logger.process(`Actualizando nombre de skin para el modo ${parsed.mode} del usuario ${message.author.id}`);
            
            const skins = await OsuUserModel.getSkins(message.author.id) || {};
            const existingSkin = skins[parsed.mode];
            
            if (!existingSkin || !existingSkin.url) {
                const modeLabel = t(locale, `skin.modes.${parsed.mode}`);
                return t(locale, 'skin.name_no_skin_mode', { mode: modeLabel });
            }

            const nameToSet = parsed.name || null;
            await OsuUserModel.setSkinByMode(message.author.id, parsed.mode, undefined, nameToSet);
            const modeLabel = t(locale, `skin.modes.${parsed.mode}`);
            if (nameToSet === null) {
                return t(locale, 'skin.name_delete_success_mode', { mode: modeLabel });
            }
            return t(locale, 'skin.name_success_mode', { mode: modeLabel, name: parsed.name });
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
        
        if (logger) logger.process(`Consultando skins para el usuario ${targetUser.id}`);
        const skins = await OsuUserModel.getSkins(targetUser.id) || {};
        
        const availableModes = Object.keys(skins).filter(m => skins[m] && skins[m].url);
        
        if (availableModes.length === 0) {
            if (targetUser.id === message.author.id) {
                return t(locale, 'skin.not_found');
            } else {
                return t(locale, 'skin.not_found_other', { username: targetUser.username });
            }
        }
        
        if (availableModes.length === 1) {
            const activeMode = availableModes[0];
            const skinInfo = skins[activeMode];
            const embed = doSkinEmbed(targetUser, skinInfo.url, skinInfo.name, activeMode, locale, message);
            return { embeds: [embed] };
        }
        
        // Múltiples skins: Menú interactivo con botones
        let activeMode = 'osu';
        if (!availableModes.includes(activeMode)) {
            activeMode = availableModes[0];
        }
        
        const linkedUser = await OsuUserModel.getLinkedUser(targetUser.id);
        if (linkedUser && linkedUser.main_gamemode && availableModes.includes(linkedUser.main_gamemode)) {
            activeMode = linkedUser.main_gamemode;
        }
        
        const skinInfo = skins[activeMode];
        const embed = doSkinEmbed(targetUser, skinInfo.url, skinInfo.name, activeMode, locale, message);
        const row = buildSkinButtonsRow(availableModes, activeMode, locale);
        
        const sentMessage = await message.channel.send({
            embeds: [embed],
            components: [row]
        });
        
        if (sentMessage) {
            const collector = sentMessage.createMessageComponentCollector({
                idle: 60000
            });
            
            collector.on('collect', async i => {
                if (i.user.id !== message.author.id) {
                    return i.reply({
                        content: t(locale, 'about.only_author'),
                        ephemeral: true
                    }).catch(() => {});
                }
                
                try {
                    await i.deferUpdate();
                    const clickedMode = i.customId.replace('skin_mode_', '');
                    if (!availableModes.includes(clickedMode)) return;
                    
                    const nextSkinInfo = skins[clickedMode];
                    const nextEmbed = doSkinEmbed(targetUser, nextSkinInfo.url, nextSkinInfo.name, clickedMode, locale, message);
                    const nextRow = buildSkinButtonsRow(availableModes, clickedMode, locale);
                    
                    await i.editReply({
                        embeds: [nextEmbed],
                        components: [nextRow]
                    });
                } catch (err) {
                    console.error("Error al navegar skins por botones:", err);
                }
            });
            
            collector.on('end', async () => {
                try {
                    await sentMessage.edit({ components: [] });
                } catch {}
            });
        }
        
        return;
        
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
