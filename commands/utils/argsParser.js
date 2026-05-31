const OsuUserModel = require("../../models/OsuUserModel.js");

const getGamemodeFromMessage = (msg) => {
    if (!msg) return null;
    
    const clean = (text) => {
        if (!text) return '';
        return text
            .replace(/https?:\/\/\S+/gi, '')
            .replace(/\S*osu\.ppy\.sh\S*/gi, '')
            .replace(/\S*osu\.direct\S*/gi, '');
    };
    
    // 1. Buscar en embeds
    const e = msg.embeds?.[0];
    if (e) {
        const authorText = clean(e.author?.name || '').toLowerCase();
        const footerText = clean(e.footer?.text || '').toLowerCase();
        const titleText = clean(e.title || '').toLowerCase();
        const descText = clean(e.description || '').toLowerCase();

        // Regex para buscar modos como palabras completas o con prefijo/sufijo común
        const maniaRegex = /\bmania\b/i;
        const taikoRegex = /\btaiko\b/i;
        const fruitsRegex = /\b(fruits|ctb|catch)\b/i;
        const stdRegex = /\b(std|standard|osu)\b/i;

        // Primero buscar en Autor y Footer (altísima confianza)
        const metadataCombined = `${authorText} | ${footerText}`;
        if (maniaRegex.test(metadataCombined)) return 'mania';
        if (taikoRegex.test(metadataCombined)) return 'taiko';
        if (fruitsRegex.test(metadataCombined)) return 'fruits';
        if (stdRegex.test(metadataCombined)) return 'osu';

        // Si no se encuentra en autor/footer, buscar en Título y Descripción
        const contentCombined = `${titleText} | ${descText}`;
        if (maniaRegex.test(contentCombined)) return 'mania';
        if (taikoRegex.test(contentCombined)) return 'taiko';
        if (fruitsRegex.test(contentCombined)) return 'fruits';
        if (stdRegex.test(contentCombined)) return 'osu';
    }

    // 2. Buscar en contenido de texto
    const content = clean(msg.content || '').toLowerCase();
    if (/\bmania\b/i.test(content) || content.includes('osu!mania') || content.includes(' en mania')) return 'mania';
    if (/\btaiko\b/i.test(content) || content.includes('osu!taiko') || content.includes(' en taiko')) return 'taiko';
    if (/\b(fruits|ctb|catch)\b/i.test(content) || content.includes('osu!ctb') || content.includes('osu!fruits') || content.includes(' en fruits')) return 'fruits';
    if (/\b(std|standard|osu)\b/i.test(content) || content.includes('osu!std') || content.includes(' en standard') || content.includes(' en osu')) return 'osu';

    return null;
};

const extractUserFromLeaderboardMessage = (msg, targetIndex = 1) => {
    if (!msg) return null;
    const e = msg.embeds?.[0];
    if (!e || !e.description) return null;

    const description = e.description;
    const entryRegex = /(?:#|\*\*#|\*\*#\*\*)\s*(\d+)[\s\S]*?\[([^\]]+)\]\(https:\/\/osu\.ppy\.sh\/users\/(\d+)\)/g;
    
    const entries = [];
    let match;
    while ((match = entryRegex.exec(description)) !== null) {
        entries.push({
            rank: parseInt(match[1]),
            username: match[2],
            userId: match[3]
        });
    }

    if (entries.length === 0) return null;

    // 1. Intentar buscar coincidencia por rango absoluto (ej. rango 3)
    const absoluteMatch = entries.find(entry => entry.rank === targetIndex);
    if (absoluteMatch) {
        return absoluteMatch;
    }

    // 2. Fallback a coincidencia por índice relativo en pantalla (1-indexed)
    if (targetIndex >= 1 && targetIndex <= entries.length) {
        return entries[targetIndex - 1];
    }

    return null;
};

async function findBeatmapInChannel(message, isReply, targetIndex = 1){
    const extractAllIds = str => {
        if (!str) return [];
        const ids = [];
        const regex = /#(?:osu|taiko|fruits|mania)\/(\d+)|osu\.ppy\.sh\/b(?:eatmaps)?\/(\d+)/g;
        let match;
        while ((match = regex.exec(str)) !== null) {
            const id = match[1] || match[2];
            if (id) ids.push(id);
        }
        return ids;
    };

    const getBeatmapIdFromMessage = (msg, index = 1) => {
        if (!msg) return { beatmap_url: null, fromList: false };
        const e = msg.embeds?.[0];

        // 1. Check description
        if (e?.description) {
            const ids = extractAllIds(e.description);
            if (ids.length > 0) {
                if (index >= 1 && index <= ids.length) {
                    return { beatmap_url: ids[index - 1], fromList: ids.length > 1 };
                }
                return { beatmap_url: null, fromList: false };
            }
        }

        // 2. Check fields
        if (e?.fields) {
            let ids = [];
            for (const field of e.fields) {
                ids.push(...extractAllIds(field.value));
                ids.push(...extractAllIds(field.name));
            }
            if (ids.length > 0) {
                if (index >= 1 && index <= ids.length) {
                    return { beatmap_url: ids[index - 1], fromList: ids.length > 1 };
                }
                return { beatmap_url: null, fromList: false };
            }
        }

        // 3. Check other elements
        let otherIds = [];
        if (msg.content) otherIds.push(...extractAllIds(msg.content));
        if (e?.url) otherIds.push(...extractAllIds(e.url));
        if (e?.author?.url) otherIds.push(...extractAllIds(e.author.url));
        if (e?.title) otherIds.push(...extractAllIds(e.title));

        if (otherIds.length > 0) {
            const uniqueOther = [];
            for (const id of otherIds) {
                if (!uniqueOther.includes(id)) {
                    uniqueOther.push(id);
                }
            }
            if (uniqueOther.length > 0) {
                if (index >= 1 && index <= uniqueOther.length) {
                    return { beatmap_url: uniqueOther[index - 1], fromList: uniqueOther.length > 1 };
                }
                return { beatmap_url: null, fromList: false };
            }
        }

        return { beatmap_url: null, fromList: false };
    };

    const discordLinkRegex = /https?:\/\/(?:ptb\.|canary\.)?discord\.com\/(?:channels\/(\d+|@me)\/(\d+)\/(\d+)|messages\/(\d+)\/(\d+))/i;

    const resolveDiscordLink = async (channelId, messageId) => {
        let targetChannel;
        try {
            targetChannel = await message.client.channels.fetch(channelId);
        } catch (err) {
            const errMsg = err.code === 50001 || err.message?.includes('Missing Access')
                ? 'No tengo acceso a ese servidor/canal. Asegúrate de que el bot esté en ese servidor y tenga permisos para ver el canal.'
                : `Error al acceder al canal: ${err.message || err}`;
            return { error: errMsg };
        }

        if (!targetChannel) {
            return { error: 'No se pudo acceder al canal enlazado.' };
        }

        let aroundMessages;
        try {
            aroundMessages = await targetChannel.messages.fetch({ limit: 10, around: messageId });
        } catch (err) {
            // Fallback a solo el mensaje exacto
            try {
                const targetMsg = await targetChannel.messages.fetch(messageId);
                aroundMessages = new Map([[messageId, targetMsg]]);
            } catch (fallbackErr) {
                const errMsg = fallbackErr.code === 50001 || fallbackErr.message?.includes('Missing Access')
                    ? 'No tengo permisos para leer los mensajes de ese canal.'
                    : (fallbackErr.code === 10008 || fallbackErr.message?.includes('Unknown Message')
                        ? 'El mensaje enlazado no existe o fue eliminado.'
                        : `No se pudo obtener el mensaje: ${fallbackErr.message || fallbackErr}`);
                return { error: errMsg };
            }
        }

        if (aroundMessages && aroundMessages.size > 0) {
            // 1. Comprobar el mensaje exacto
            const exactMsg = aroundMessages.get(messageId);
            if (exactMsg) {
                const { beatmap_url, fromList } = getBeatmapIdFromMessage(exactMsg, targetIndex);
                if (beatmap_url) {
                    const gamemode = getGamemodeFromMessage(exactMsg);
                    return { beatmap_url, gamemode, fromList };
                }
                // Si el mensaje exacto es una respuesta, comprobar la referencia
                if (exactMsg.reference?.messageId) {
                    try {
                        const refMsg = await targetChannel.messages.fetch(exactMsg.reference.messageId);
                        if (refMsg) {
                            const { beatmap_url, fromList } = getBeatmapIdFromMessage(refMsg, targetIndex);
                            if (beatmap_url) {
                                const gamemode = getGamemodeFromMessage(refMsg);
                                return { beatmap_url, gamemode, fromList };
                            }
                        }
                    } catch (err) {
                        // Ignorar fallos al obtener la referencia en segundo plano
                    }
                }
            }

            // 2. Comprobar mensajes de alrededor (más cercanos en tiempo primero)
            const sortedMsgs = Array.from(aroundMessages.values()).sort((a, b) => b.createdTimestamp - a.createdTimestamp);
            for (const msg of sortedMsgs) {
                if (msg.id === messageId) continue;
                const { beatmap_url, fromList } = getBeatmapIdFromMessage(msg, targetIndex);
                if (beatmap_url) {
                    const gamemode = getGamemodeFromMessage(msg);
                    return { beatmap_url, gamemode, fromList };
                }
            }
        }

        return { error: 'No se encontró ningún mapa de osu! en el mensaje enlazado ni en los mensajes cercanos.' };
    };

    try {
        if (isReply) {
            // Comprobar si el mensaje al que se responde contiene un enlace de Discord
            const linkMatch = message.content?.match(discordLinkRegex);
            if (linkMatch) {
                const channelId = linkMatch[2] || linkMatch[4];
                const messageId = linkMatch[3] || linkMatch[5];
                if (channelId && messageId) {
                    const resolved = await resolveDiscordLink(channelId, messageId);
                    if (resolved) {
                        if (resolved.error) {
                            return { beatmap_url: null, gamemode: null, fromList: false, bad_response: `❌ Error al acceder al enlace de Discord: ${resolved.error}` };
                        }
                        return { ...resolved, bad_response: 'shh' };
                    }
                }
            }

            const { beatmap_url, fromList } = getBeatmapIdFromMessage(message, targetIndex);
            const gamemode = getGamemodeFromMessage(message);
            return beatmap_url
                ? { beatmap_url, gamemode, fromList, bad_response: 'shh' }
                : { beatmap_url: null, gamemode: null, fromList: false, bad_response: '❌ No se encontró un mapa al cual hacerle c' };
        }

        const fetch_messages = await message.channel.messages.fetch({ limit: 30 });
        for (const msg of fetch_messages.values()) {
            // Comprobar si el mensaje contiene un enlace de Discord a otro mensaje
            const linkMatch = msg.content?.match(discordLinkRegex);
            if (linkMatch) {
                const channelId = linkMatch[2] || linkMatch[4];
                const messageId = linkMatch[3] || linkMatch[5];
                if (channelId && messageId) {
                    const resolved = await resolveDiscordLink(channelId, messageId);
                    if (resolved) {
                        if (resolved.error) {
                            // Si el link proviene del propio comando, abortamos inmediatamente con el error específico
                            if (msg.id === message.id) {
                                return { beatmap_url: null, gamemode: null, fromList: false, bad_response: `❌ Error al acceder al enlace de Discord: ${resolved.error}` };
                            }
                            // Si proviene de otro mensaje del historial, lo ignoramos y seguimos buscando
                            continue;
                        }
                        return { ...resolved, bad_response: 'shh' };
                    }
                }
            }

            // Extracción directa del mensaje
            const { beatmap_url, fromList } = getBeatmapIdFromMessage(msg, targetIndex);
            if (beatmap_url) {
                const gamemode = getGamemodeFromMessage(msg);
                return { beatmap_url, gamemode, fromList, bad_response: 'shh' };
            }
        }

        return { beatmap_url: null, gamemode: null, fromList: false, bad_response: '❌ No se encontró ningún mapa en el historial del canal ni se especificó un ID válido.' };
    } catch (error) {
        console.error("<#> findBeatmapInChannel error:", error);
        return { beatmap_url: null, gamemode: null, fromList: false, bad_response: '❌ Ocurrió un error al buscar un mapa en el canal.' };
    }
}

async function parsingCommandFunction(parsed_args, command_parameters){
    const {message, res, command_function, beatmap_url, gamemode} = command_parameters;
    const discord_id = message.author.id;
    let user_found;
    
    // Buscamos el user linkeado con el bot 
    user_found = await OsuUserModel.getLinkedUser(res.User, discord_id);

    // Si el parámetro resolveUserByIndex está habilitado, el usuario especificó un índice y es una respuesta
    if (command_parameters.resolveUserByIndex && parsed_args.explicitIndex && message.reference?.messageId && (!parsed_args.username || parsed_args.username.length === 0 || parsed_args.username[0] === "")) {
        try {
            const targetChannel = message.channel;
            const refMsg = await targetChannel.messages.fetch(message.reference.messageId);
            const extracted = extractUserFromLeaderboardMessage(refMsg, parsed_args.index || 1);
            if (extracted) {
                if (!parsed_args.username) parsed_args.username = [];
                parsed_args.username[0] = extracted.userId;
                parsed_args.explicitIndex = false; // Limpiar para evitar conflictos con la lógica posterior del comando
            }
        } catch (err) {
            console.error("Error al extraer usuario por índice en parsingCommandFunction:", err);
        }
    }

    const config = require("../../config.js");
    const prefix = config.BOT_PREFIX || "s.";

    // Si no hay args
    const no_args = Object.values(parsed_args).flat().filter(el => el !== '').length == 0;
    if(no_args || parsed_args.override === 'rm' && parsed_args.username[0] == ''){

        // si no hay uno linkeado al bot
        if(!user_found) return {'fn_response': `❌ No se encontró ningún usuario de \`osu!\` vinculado a tu cuenta de Discord (\`${message.author.username}\`).\n- **Vincula** tu cuenta de forma segura usando el comando de chat \`${prefix}link -oauth\` o slash \`/link -oauth\`.`, 'user_found': user_found, 'reparsed_args': parsed_args};

        // Aplicamos el comando con el linkeado al bot
        const defaultMode = (command_parameters.ignore_main_gamemode && gamemode) ? gamemode : user_found.main_gamemode;
        parsed_args.gamemode = defaultMode;
        const fn_response = await command_function({'username' : [user_found.osu_id], 'beatmap_url' : beatmap_url, 'gamemode' : defaultMode});
        return {'fn_response': fn_response, 'user_found': user_found, 'reparsed_args': parsed_args};
    // Si hay args
    } else {

        // Si entre los args hubo uno de username
        if(parsed_args.username.length != 0 && parsed_args.username[0] != "") {
            
            // Para manejar mejor el username
            let arg_user = parsed_args.username[0].split(" ")[0];

            // Si es un enlace de perfil de osu!, extraemos el usuario/ID
            const profileLinkMatch = arg_user.match(/osu\.ppy\.sh\/u(?:sers)?\/([^\/\s\?#]+)/i);
            if (profileLinkMatch) {
                try {
                    arg_user = decodeURIComponent(profileLinkMatch[1]);
                } catch (e) {
                    arg_user = profileLinkMatch[1];
                }
                parsed_args.username[0] = arg_user;
            }

            // Si es una id de discord (de 17 a 20 dígitos), buscamos en la db y actualizamos el parsed_arg con la id de osu vinculada
            const isDiscordId = /^\d{17,20}$/.test(arg_user);
            if(isDiscordId) {
                user_found = await OsuUserModel.getLinkedUser(res.User, arg_user);

                if(!user_found) return {'fn_response': `No se encontro ese usuario de discord linkeado al bot.`, 'user_found': user_found, 'reparsed_args': parsed_args};
                parsed_args.username[0] = user_found.osu_id;

            // Se busca el nombre de osu 
            } else {

                // Se actualiza para cambiarlo a la id
                const osuUser = await OsuUserModel.getOsuUser(parsed_args);
                if (typeof osuUser === 'string') {
                    return {'fn_response': osuUser, 'user_found': user_found, 'reparsed_args': parsed_args};
                }
                parsed_args.username[0] = osuUser.id;
            }

        // Si no hubo un username entre los args
        } else {

            // Se usa el linkeado al bot
            if(!user_found) return { 'fn_response': `❌ No se encontró ningún usuario de \`osu!\` vinculado a tu cuenta de Discord (\`${message.author.username}\`).\n- **Vincula** tu cuenta de forma segura usando el comando de chat \`${prefix}link -oauth\` o slash \`/link -oauth\`.`, 'user_found': user_found, 'reparsed_args': parsed_args };
            parsed_args.username[0] = user_found.osu_id;
        }

        // Se hace la peticion con los args
        parsed_args['beatmap_url'] = beatmap_url;   // agregamos para el >c
        if (!parsed_args.gamemode) {
            if (command_parameters.ignore_main_gamemode && gamemode) {
                parsed_args.gamemode = gamemode;
            } else if (user_found && user_found.main_gamemode) {
                parsed_args.gamemode = user_found.main_gamemode;
            } else if (gamemode) {
                parsed_args.gamemode = gamemode;
            }
        } else if (!parsed_args.gamemode && gamemode) {
            parsed_args.gamemode = gamemode;
        }

        const fn_response = await command_function(parsed_args);

        return {'fn_response': fn_response, 'user_found': user_found, 'reparsed_args': parsed_args};
    }
}

function argsParserNoCommand(args, options = {}) {
    const ignoreBeatmap = options.ignoreBeatmap || false;
    let username = [];
    let gamemode = args.gamemode || "";
    let server = args.server || "bancho";
    let index = 1;
    let explicitIndex = false;
    let page = 1;
    let listMode = false;
    let modFilter = null;
    let modContainFilter = null;
    let invalidModsWarning = false;
    let searchFilter = null;
    let ppThreshold = null;
    let recentSort = false;
    let comboSort = false;
    let accSort = false;
    let bestSort = false;
    let detailed = false;
    let filterPass = false;
    let targetGuildId = null;
    let country = null;
    let friendsFilter = null;
    let beatmap_url = null;
    let discordMessageId = null;
    let discordMessageLink = null;
    let args_aux = new String(args);
    let reworkQuery = null;
    let reworkCompare = false;
    let reworkTop = false;
    let sortByPPChange = false;
    let stableMode = false;
    let lazerMode = false;
    let regional = null;
    let nochoke = false;
    let mapset = false;

    const extractId = str =>
        str?.match(/#(?:osu|taiko|fruits|mania)\/(\d+)/)?.[1] ||
        str?.match(/osu\.ppy\.sh\/b(?:eatmaps)?\/(\d+)/)?.[1] ||
        str?.match(/osu\.ppy\.sh\/beatmapsets\/\d+#(?:osu|taiko|fruits|mania)\/(\d+)/)?.[1] ||
        (!ignoreBeatmap && str?.match(/^\d{5,10}$/) ? str : null);

    const isBeatmapUrlOrId = str => {
        if (!str) return false;
        const clean = str.trim();
        const match = clean.match(/#(?:osu|taiko|fruits|mania)\/(\d+)/) ||
                      clean.match(/osu\.ppy\.sh\/b(?:eatmaps)?\/(\d+)/) ||
                      clean.match(/osu\.ppy\.sh\/beatmapsets\/\d+#(?:osu|taiko|fruits|mania)\/(\d+)/) ||
                      (!ignoreBeatmap && clean.match(/^\d{5,10}$/));
        return !!match;
    };

    const gamemode_set = {
        'mania': 'mania', 'osu': 'osu', 'std': 'osu', 'taiko': 'taiko', 'ctb': 'fruits', 'fruits': 'fruits'
    };
    const server_set = {
        'gatari': 'gatari', 'bancho': 'bancho'
    };

    const args_commands = [

        // Si empieza con un guion
        function (args) {
            if (gamemode_set[args.slice(1)]) {
                gamemode = gamemode_set[args.slice(1)];
                return true;
            }
            if (server_set[args.slice(1)]) {
                server = server_set[args.slice(1)];
                return true;
            }
            return false;
        },

        // Si empieza con el selector de modo
        function (args) {
            if (args.startsWith("m=")) {
                gamemode = gamemode_set[args.split("=")[1]];
                return true;
            }
            if (args.startsWith("mode") || args.startsWith("modo")) {
                gamemode = gamemode_set[args.split("=")[1]];
                return true;
            }
            return false;
        },

        // Si empieza con <@ y termina con > (discord_tag)
        function (args) {
            if (args.startsWith("<@") && args.endsWith(">")) {
                username.push(args.match(/\d+/)[0]);
                return true;
            }
            return false;
        },

        // Si el argumento es un numero de tamaño 18 (discord_id)
        function (args) {
            if (args.length >= 17) {
                username.push(args);
                return true;
            }
            return false;
        }
    ];

    // Separamos por las comas y revisamos cada args_commands por cada args del mensaje
    let args_list = args_aux.split(",");
    
    let grouped_args = [];
    let inside_quotes = false;
    let quote_char = "";
    let temp_quote_arg = "";

    for (let j = 0; j < args_list.length; j++) {
        let current = args_list[j];
        
        // Si empieza y termina con la misma comilla (ya sea " o ')
        if ((current.startsWith('"') && current.endsWith('"') && current.length > 1) ||
            (current.startsWith("'") && current.endsWith("'") && current.length > 1)) {
            grouped_args.push(current.slice(1, -1));
            continue;
        }

        if (!inside_quotes && (current.startsWith('"') || current.startsWith("'"))) {
            inside_quotes = true;
            quote_char = current[0];
            temp_quote_arg = current.slice(1);
            continue;
        }

        if (inside_quotes && current.endsWith(quote_char)) {
            inside_quotes = false;
            temp_quote_arg += " " + current.slice(0, -1);
            grouped_args.push(temp_quote_arg);
            temp_quote_arg = "";
            continue;
        }

        if (inside_quotes) {
            temp_quote_arg += " " + current;
        } else {
            grouped_args.push(current);
        }
    }
    if (inside_quotes && temp_quote_arg) {
        grouped_args.push(temp_quote_arg);
    }
    args_list = grouped_args;

    let skip_next = false;

    for (let i = 0; i < args_list.length; i++) {
        if (skip_next) {
            skip_next = false;
            continue;
        }
        let arg = args_list[i].trim();
        if (!arg) continue;

        // Si es un enlace de mensaje de Discord, lo ignoramos para que no se guarde en username y extraemos la ID y link
        const discordLinkRegex = /https?:\/\/(?:ptb\.|canary\.)?discord\.com\/(?:channels\/(\d+|@me)\/(\d+)\/(\d+)|messages\/(\d+)\/(\d+))/i;
        const linkMatch = arg.match(discordLinkRegex);
        if (linkMatch) {
            discordMessageLink = arg;
            discordMessageId = linkMatch[3] || linkMatch[5];
            continue;
        }

        // Si es una ID de mensaje de Discord cruda (17-20 dígitos), la registramos pero permitimos que siga su curso
        const msgIdMatch = arg.match(/^(\d{17,20})$/);
        if (msgIdMatch) {
            discordMessageId = msgIdMatch[1];
        }

        // Si empieza con '+' (para mods exactos, ej: +HDHR)
        if (arg.startsWith("+")) {
            const possible_mods = arg.slice(1).toUpperCase().trim();
            if (possible_mods.length > 0) {
                modFilter = possible_mods;
                continue;
            }
        }

        // Si es el flag de -pais o -country
        if (arg === "-pais" || arg === "-country") {
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                if (next_arg !== "" && !next_arg.startsWith("-") && !next_arg.startsWith("+") && !isBeatmapUrlOrId(next_arg)) {
                    country = next_arg.toUpperCase();
                    skip_next = true;
                    continue;
                }
            }
            country = "SELF";
            continue;
        }
        if (arg.startsWith("-pais") && arg !== "-pais") {
            let next = arg.slice(5).trim();
            if (isBeatmapUrlOrId(next)) {
                country = "SELF";
                const possible_id = extractId(next);
                if (possible_id) beatmap_url = possible_id;
                continue;
            } else if (next.length === 2 && /^[A-Za-z]{2}$/.test(next)) {
                country = next.toUpperCase();
                continue;
            }
        }
        if (arg.startsWith("-country") && arg !== "-country") {
            let next = arg.slice(8).trim();
            if (isBeatmapUrlOrId(next)) {
                country = "SELF";
                const possible_id = extractId(next);
                if (possible_id) beatmap_url = possible_id;
                continue;
            } else if (next.length === 2 && /^[A-Za-z]{2}$/.test(next)) {
                country = next.toUpperCase();
                continue;
            }
        }

        // Si es el flag de -regional o -region
        if (arg === "-regional" || arg === "-region") {
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                if (next_arg !== "" && !next_arg.startsWith("-") && !next_arg.startsWith("+") && !isBeatmapUrlOrId(next_arg)) {
                    regional = next_arg;
                    skip_next = true;
                    continue;
                }
            }
            regional = "SELF";
            continue;
        }
        if (arg.startsWith("-regional") && arg !== "-regional") {
            let next = arg.slice(9).trim();
            if (isBeatmapUrlOrId(next)) {
                regional = "SELF";
                const possible_id = extractId(next);
                if (possible_id) beatmap_url = possible_id;
                continue;
            } else if (next.length > 0) {
                regional = next;
                continue;
            }
        }
        if (arg.startsWith("-region") && arg !== "-region") {
            let next = arg.slice(7).trim();
            if (isBeatmapUrlOrId(next)) {
                regional = "SELF";
                const possible_id = extractId(next);
                if (possible_id) beatmap_url = possible_id;
                continue;
            } else if (next.length > 0) {
                regional = next;
                continue;
            }
        }

        // Si es el flag de -friends o -amigo o -amigos
        if (arg === "-friends" || arg === "-amigo" || arg === "-amigos") {
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                if (next_arg !== "" && !next_arg.startsWith("-") && !next_arg.startsWith("+") && !isBeatmapUrlOrId(next_arg)) {
                    friendsFilter = next_arg;
                    skip_next = true;
                    continue;
                }
            }
            friendsFilter = "SELF";
            continue;
        }
        if (arg.startsWith("-friends") && arg !== "-friends") {
            let next = arg.slice(8).trim();
            if (isBeatmapUrlOrId(next)) {
                friendsFilter = "SELF";
                const possible_id = extractId(next);
                if (possible_id) beatmap_url = possible_id;
                continue;
            } else if (next.length > 0) {
                friendsFilter = next;
                continue;
            }
        }
        if (arg.startsWith("-amigos") && arg !== "-amigos") {
            let next = arg.slice(7).trim();
            if (isBeatmapUrlOrId(next)) {
                friendsFilter = "SELF";
                const possible_id = extractId(next);
                if (possible_id) beatmap_url = possible_id;
                continue;
            } else if (next.length > 0) {
                friendsFilter = next;
                continue;
            }
        }
        if (arg.startsWith("-amigo") && arg !== "-amigo") {
            let next = arg.slice(6).trim();
            if (isBeatmapUrlOrId(next)) {
                friendsFilter = "SELF";
                const possible_id = extractId(next);
                if (possible_id) beatmap_url = possible_id;
                continue;
            } else if (next.length > 0) {
                friendsFilter = next;
                continue;
            }
        }
        // Si es una URL o ID de beatmap (evitando IDs de discord que son >= 17 digitos)
        const possible_id = extractId(arg);
        if (possible_id) {
            beatmap_url = possible_id;
            continue;
        }

        // Si es un modo de juego o servidor, los capturamos antes de cualquier otra regla (como -m)
        if (arg.startsWith("-")) {
            const possible_val = arg.slice(1).toLowerCase();
            if (gamemode_set[possible_val]) {
                gamemode = gamemode_set[possible_val];
                continue;
            }
            if (server_set[possible_val]) {
                server = server_set[possible_val];
                continue;
            }
        }

        // Si es exactamente "-l", "-list" o "-lista"
        if (arg === "-l" || arg === "-list" || arg === "-lista") {
            listMode = true;
            continue;
        }

        // Si es exactamente "-r"
        if (arg === "-r") {
            recentSort = true;
            continue;
        }

        // Si es exactamente "-c"
        if (arg === "-c") {
            comboSort = true;
            continue;
        }

        // Si es exactamente "-acc"
        if (arg === "-acc") {
            accSort = true;
            continue;
        }

        // Si es exactamente "-nc" o "-nochoke"
        if (arg === "-nc" || arg === "-nochoke") {
            nochoke = true;
            continue;
        }

        // Si es exactamente "-mapset" o "--mapset"
        if (arg === "-mapset" || arg === "--mapset") {
            mapset = true;
            continue;
        }

        // Si es exactamente "-b"
        if (arg === "-b") {
            bestSort = true;
            continue;
        }

        // Si es exactamente "-d"
        if (arg === "-d") {
            detailed = true;
            continue;
        }

        // Si es exactamente "-ps"
        if (arg === "-ps") {
            filterPass = true;
            continue;
        }

        // Si es exactamente "-stable"
        if (arg === "-stable") {
            stableMode = true;
            continue;
        }

        // Si es exactamente "-lazer")
        if (arg === "-lazer") {
            lazerMode = true;
            continue;
        }

        // Si es exactamente "-server" o "-srv"
        if (arg === "-server" || arg === "-srv") {
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                if (!next_arg.startsWith("-") && !next_arg.startsWith("+")) {
                    targetGuildId = next_arg;
                    skip_next = true;
                    continue;
                }
            }
        }
        if (arg.startsWith("-server")) {
            let next = arg.slice(7).trim();
            if (next.length > 0 && !next.startsWith("-") && !next.startsWith("+")) {
                targetGuildId = next;
                continue;
            }
        }
        if (arg.startsWith("-srv")) {
            let next = arg.slice(4).trim();
            if (next.length > 0 && !next.startsWith("-") && !next.startsWith("+")) {
                targetGuildId = next;
                continue;
            }
        }

        // Si es exactamente "-i"
        if (arg === "-i") {
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                let num = parseInt(next_arg);
                if (!isNaN(num)) {
                    index = num;
                    explicitIndex = true;
                    skip_next = true;
                    continue;
                }
            }
        }
        // Si empieza con "-i" seguido de un numero (ej: "-i2")
        if (arg.startsWith("-i")) {
            let num = parseInt(arg.slice(2));
            if (!isNaN(num)) {
                index = num;
                explicitIndex = true;
                continue;
            }
        }

        // Si empieza con "#" seguido de un número (ej: "#2")
        if (arg.startsWith("#")) {
            let num = parseInt(arg.slice(1));
            if (!isNaN(num)) {
                index = num;
                explicitIndex = true;
                continue;
            }
        }

        // Si es exactamente "-p", "-pagina" o "-page"
        if (arg === "-p" || arg === "-pagina" || arg === "-page") {
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                let num = parseInt(next_arg);
                if (!isNaN(num)) {
                    page = num;
                    skip_next = true;
                    continue;
                }
            }
        }
        // Si empieza con "-p", "-pagina" o "-page" seguido de un numero (ej: "-p2", "-pagina2", "-page2")
        if (arg.startsWith("-p")) {
            let num;
            if (arg.startsWith("-pagina")) {
                num = parseInt(arg.slice(7));
            } else if (arg.startsWith("-page")) {
                num = parseInt(arg.slice(5));
            } else {
                num = parseInt(arg.slice(2));
            }
            if (!isNaN(num)) {
                page = num;
                continue;
            }
        }

        // Detectar si el usuario usó por error la sintaxis de mods incorrecta o incompleta
        const lowerArg = arg.toLowerCase();
        if (lowerArg === "mods" || lowerArg === "mod") {
            invalidModsWarning = true;
            continue;
        }

        // Si empieza con "+" (ej: "+HDDT")
        if (arg.startsWith("+")) {
            const possibleMods = arg.slice(1).toUpperCase();
            if (/^[A-Z]{2,}$/.test(possibleMods)) {
                const validModChars = new Set(['H','D','R','F','E','T','S','N','P','C','L','V','K','M','O','Z']);
                const chars = possibleMods.split('');
                if (chars.every(c => validModChars.has(c)) && possibleMods.length % 2 === 0) {
                    modFilter = possibleMods;
                    continue;
                }
            }
        }

        // Si empieza con "-" y coincide con una combinación de mods válidos, pero no es un flag oficial (ej: "-HDDT")
        if (arg.startsWith("-") && !arg.startsWith("-mods") && !arg.startsWith("-mod")) {
            const potentialMods = arg.slice(1).toUpperCase();
            const validModChars = new Set(['H','D','R','F','E','T','S','N','P','C','L','V','K','M','O','Z']);
            const chars = potentialMods.split('');
            const isAllMods = chars.length >= 2 && chars.length % 2 === 0 && chars.every(c => validModChars.has(c));
            
            const knownFlags = new Set([
                'pm', 'mx', 'pp', 'ps', 'server', 'srv', 'regional', 'region', 
                'pais', 'country', 'friends', 'amigo', 'amigos', 'page', 'pagina',
                'wins', 'w', 'wr', 'winrate', 'nc', 'nochoke'
            ]);
            if (isAllMods && !knownFlags.has(potentialMods.toLowerCase())) {
                invalidModsWarning = true;
                continue;
            }
        }

        // Si es exactamente "-mods" o "-mod" (soportar sintaxis alternativa antes de -m genérico)
        if (arg === "-mods" || arg === "-mod") {
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                if (!next_arg.startsWith("-")) {
                    modFilter = next_arg.toUpperCase();
                    skip_next = true;
                    continue;
                }
            }
        }
        if (arg.startsWith("-mods") || arg.startsWith("-mod")) {
            const prefixLen = arg.startsWith("-mods") ? 5 : 4;
            let next = arg.slice(prefixLen).trim();
            if (next.length > 0) {
                const possibleMods = next.toUpperCase();
                const validModChars = new Set(['H','D','R','F','E','T','S','N','P','C','L','V','K','M','O','Z']);
                const chars = possibleMods.split('');
                const isAllValidMods = chars.length >= 2 && chars.length % 2 === 0 && chars.every(c => validModChars.has(c));
                if (isAllValidMods || possibleMods === "NM" || possibleMods === "NONE") {
                    modFilter = possibleMods;
                    continue;
                }
            }
        }

        // Si es exactamente "-mx" (revisar antes de -m para evitar falsos positivos)
        if (arg === "-mx") {
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                if (!next_arg.startsWith("-")) {
                    modContainFilter = next_arg.toUpperCase();
                    skip_next = true;
                    continue;
                }
            }
        }
        if (arg.startsWith("-mx") && arg !== "-mx") {
            let next = arg.slice(3).trim();
            if (next.length > 0) {
                const possibleMods = next.toUpperCase();
                const validModChars = new Set(['H','D','R','F','E','T','S','N','P','C','L','V','K','M','O','Z']);
                const chars = possibleMods.split('');
                const isAllValidMods = chars.length >= 2 && chars.length % 2 === 0 && chars.every(c => validModChars.has(c));
                if (isAllValidMods || possibleMods === "NM" || possibleMods === "NONE") {
                    modContainFilter = possibleMods;
                    continue;
                }
            }
        }

        // Si es exactamente "-m"
        if (arg === "-m") {
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                if (!next_arg.startsWith("-")) {
                    modFilter = next_arg.toUpperCase();
                    skip_next = true;
                    continue;
                }
            }
        }
        if (arg.startsWith("-m") && arg !== "-m") {
            let next = arg.slice(2).trim();
            if (next.length > 0) {
                const possibleMods = next.toUpperCase();
                const validModChars = new Set(['H','D','R','F','E','T','S','N','P','C','L','V','K','M','O','Z']);
                const chars = possibleMods.split('');
                const isAllValidMods = chars.length >= 2 && chars.length % 2 === 0 && chars.every(c => validModChars.has(c));
                if (isAllValidMods || possibleMods === "NM" || possibleMods === "NONE") {
                    modFilter = possibleMods;
                    continue;
                }
            }
        }

        // Si es exactamente "-?"
        if (arg === "-?") {
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                searchFilter = next_arg.toLowerCase();
                skip_next = true;
                continue;
            }
        }
        if (arg.startsWith("-?") && arg !== "-?") {
            let next = arg.slice(2).trim();
            if (next.length > 0) {
                searchFilter = next.toLowerCase();
                continue;
            }
        }

        // Si es exactamente "-g" o "-pp"
        if (arg === "-g" || arg === "-pp") {
            if (arg === "-pp") {
                sortByPPChange = true;
            }
            if (i + 1 < args_list.length) {
                let next_arg = args_list[i + 1].trim();
                if (/^\d{17,20}$/.test(next_arg)) {
                    username.push(next_arg);
                    skip_next = true;
                } else {
                    let num = parseFloat(next_arg);
                    if (!isNaN(num)) {
                        ppThreshold = num;
                        skip_next = true;
                    }
                }
            }
            continue;
        }
        if (arg.startsWith("-g") && arg !== "-g") {
            let val = arg.slice(2).trim();
            if (/^\d{17,20}$/.test(val)) {
                username.push(val);
                continue;
            } else {
                let num = parseFloat(val);
                if (!isNaN(num)) {
                    ppThreshold = num;
                    continue;
                }
            }
        }
        if (arg.startsWith("-pp") && arg !== "-pp") {
            sortByPPChange = true;
            let val = arg.slice(3).trim();
            if (/^\d{17,20}$/.test(val)) {
                username.push(val);
                continue;
            } else {
                let num = parseFloat(val);
                if (!isNaN(num)) {
                    ppThreshold = num;
                    continue;
                }
            }
        }

        // Si es exactamente "-o" o "-osu"
        if (arg === "-o" || arg === "-osu") {
            reworkCompare = true;
            continue;
        }

        // Si es exactamente "-top"
        if (arg === "-top") {
            reworkTop = true;
            continue;
        }

        // Si es exactamente "-rework"
        if (arg === "-rework") {
            if (i + 1 < args_list.length) {
                reworkQuery = args_list[i + 1].trim();
                skip_next = true;
                continue;
            }
        }
        if (arg.startsWith("-rework")) {
            let next = arg.slice(7).trim();
            if (next.length > 0) {
                reworkQuery = next.startsWith("=") ? next.slice(1).trim() : next;
                continue;
            }
        }

        let handled = false;

        args_commands.forEach(fn => {
            if (fn(arg)) {
                handled = true;
            }
        });

        if (!handled) {
            username.push(arg);
        }
    }


    let parsed_args = {
        'username': [username.map(x => x.replace(/"/g, "")).join(" ").trim()],
        'gamemode': gamemode,
        'server': server,
        'index': index,
        'explicitIndex': explicitIndex,
        'page': page,
        'listMode': listMode,
        'modFilter': modFilter,
        'modContainFilter': modContainFilter,
        'searchFilter': searchFilter,
        'ppThreshold': ppThreshold,
        'recentSort': recentSort,
        'comboSort': comboSort,
        'accSort': accSort,
        'bestSort': bestSort,
        'detailed': detailed,
        'filterPass': filterPass,
        'targetGuildId': targetGuildId,
        'country': country,
        'friendsFilter': friendsFilter,
        'regional': regional,
        'beatmap_url': beatmap_url,
        'discordMessageId': discordMessageId,
        'discordMessageLink': discordMessageLink,
        'reworkQuery': reworkQuery,
        'reworkCompare': reworkCompare,
        'reworkTop': reworkTop,
        'sortByPPChange': sortByPPChange,
        'invalidModsWarning': invalidModsWarning,
        'stableMode': stableMode,
        'lazerMode': lazerMode,
        'nochoke': nochoke,
        'mapset': mapset
    };
    return parsed_args;
}

async function argsParser(args, command_parameters = {}){
    const parsed_args = argsParserNoCommand(args, command_parameters);
    const { fn_response, user_found, reparsed_args} = await parsingCommandFunction(parsed_args, command_parameters);

    return {
        'fn_response': fn_response,
        'parsed_args': reparsed_args,
        'user_found': user_found        
    };
}

module.exports = {
    argsParser,
    argsParserNoCommand,
    findBeatmapInChannel,
    parsingCommandFunction
};
