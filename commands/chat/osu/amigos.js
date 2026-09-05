const { EmbedBuilder } = require('discord.js');
const OsuUserModel = require('../../../models/OsuUserModel.js');
const { doOsuMissingFriendsEmbed, doOsuFriendsListEmbed } = require('../../../views/osuUserViews.js');
const { buildPaginationRow } = require('../../../views/osuViewHelpers.js');
const { t } = require('../../../utils/i18n.js');
const { argsParserNoCommand } = require('../../utils/argsParser.js');

// Función para comprobar mutualidad de los amigos vinculados en la página actual
async function checkMutualsForChunk(chunk, myOsuId, linkedMap) {
    await Promise.all(
        chunk.map(async (friend) => {
            const isLinked = linkedMap.has(friend.id.toString());
            if (!isLinked) {
                friend.sengo = false;
                friend.mutual = 'no_applicable';
                return;
            }

            friend.sengo = true;
            const dbInfo = linkedMap.get(friend.id.toString());
            
            try {
                const friendFriendsList = await OsuUserModel.getFriendsList(dbInfo.discord_id);
                if (!friendFriendsList) {
                    friend.mutual = 'unknown'; // Sin token válido o sin scope friends.read
                    return;
                }

                const isMutual = friendFriendsList.some(f => f.id.toString() === myOsuId.toString());
                friend.mutual = isMutual ? 'yes' : 'no';
            } catch {
                // Si da 403 u otro error de red, marcamos como desconocido/falta-scope
                friend.mutual = 'unknown';
            }
        })
    );
}

async function run(messages, args) {
    const { message, reply, logger } = messages;
    const authorId = message.author.id;
    const locale = message.locale || 'es';

    // 1. Verificar si está solicitando el flag -track (exclusivo para el creador)
    const isTrackFlag = args && args.some(arg => typeof arg === 'string' && (arg.toLowerCase() === '-track' || arg.toLowerCase() === '-untrack'));
    if (isTrackFlag) {
        const ownerId = process.env.OWNER_ID;
        if (authorId !== ownerId) {
            return t(locale, 'amigos.err_owner_only');
        }

        const trackIdx = args.findIndex(arg => typeof arg === 'string' && (arg.toLowerCase() === '-track' || arg.toLowerCase() === '-untrack'));
        const trackArg = args[trackIdx].toLowerCase();
        const nextArg = (args[trackIdx + 1] && typeof args[trackIdx + 1] === 'string') ? args[trackIdx + 1].toLowerCase() : '';

        const BotSettingsModel = require('../../../models/BotSettingsModel.js');

        if (trackArg === '-untrack' || nextArg === 'off' || nextArg === 'disable') {
            await BotSettingsModel.setSetting('owner_friends_tracker_channel', '');
            return t(locale, 'amigos.track_disabled');
        }

        if (nextArg === 'check') {
            if (logger) logger.process('Ejecutando comprobación inmediata de amigos y mutuales...');
            const { runOwnerFriendsCheck } = require('../../../services/ownerFriendsTrackerService.js');
            const checkResult = await runOwnerFriendsCheck(message.client, { force: true, targetChannelId: message.channel.id });
            if (checkResult && checkResult.changed) {
                return;
            }
            return t(locale, 'amigos.track_check_no_changes', { followers: checkResult?.followers ?? 'N/A' });
        }

        if (logger) logger.process('Configurando canal de tracking para el creador...');
        await BotSettingsModel.setSetting('owner_friends_tracker_channel', message.channel.id);

        const OsuWebSessionModel = require('../../../models/OsuWebSessionModel.js');
        const webData = await OsuWebSessionModel.fetchWebFriends({ bypassCache: true });

        let followers = 0;
        let friendsCount = 0;
        let mutualsCount = 0;

        if (webData) {
            friendsCount = webData.totalFriends;
            mutualsCount = webData.totalMutuals;
            const ownerOsuId = String(webData.currentUser.id);
            const ownerProfile = await OsuUserModel.getOsuUser({ username: [ownerOsuId], gamemode: 'osu' }).catch(() => null);
            followers = ownerProfile?.follower_count ?? 0;
            await BotSettingsModel.setSetting('owner_friends_tracker_osu_id', ownerOsuId);
            await BotSettingsModel.setSetting('owner_friends_tracker_followers', followers.toString());
            await BotSettingsModel.setSetting('owner_friends_tracker_snapshot', JSON.stringify(webData.friends));
            await BotSettingsModel.setSetting('owner_friends_tracker_last_check', new Date().toISOString());
        }

        return t(locale, 'amigos.track_enabled', {
            channelId: message.channel.id,
            followers,
            friends: friendsCount,
            mutuals: mutualsCount
        });
    }

    // 2. Verificar si está solicitando el flag secreto -sengo
    const isSengoFlag = args && args.some(arg => typeof arg === 'string' && arg.toLowerCase() === '-sengo');
    if (isSengoFlag) {
        if (logger) logger.process(t(locale, 'amigos.log_flag_sengo'));
        const ownerId = process.env.OWNER_ID;
        if (authorId !== ownerId) {
            return t(locale, 'amigos.err_owner_only');
        }

        if (logger) logger.process(t(locale, 'amigos.log_get_creator_friends'));
        let friendsList = null;
        try {
            friendsList = await OsuUserModel.getFriendsList(authorId);
        } catch (err) {
            if (err.response && err.response.status === 403) {
                return t(locale, 'amigos.err_auth_403');
            }
            throw err;
        }
        if (!friendsList) {
            return t(locale, 'amigos.err_need_oauth');
        }

        if (logger) logger.process(t(locale, 'amigos.log_get_db_users'));
        const dbUsers = await OsuUserModel.getLinkedUsers({ bypass: true });

        const validDbUsers = dbUsers.filter(u => u && u.osu_id);
        if (validDbUsers.length === 0) {
            return t(locale, 'amigos.err_no_linked_users');
        }

        // Encontrar cuáles de los usuarios vinculados NO están en la lista de amigos del owner
        const friendIds = new Set(friendsList.map(f => f.id.toString()));
        const missingFriends = validDbUsers.filter(u => !friendIds.has(u.osu_id.toString()));

        // Obtener los nombres de usuario de osu! para los usuarios faltantes
        if (logger) logger.process(t(locale, 'amigos.log_get_missing_names'));
        const oauthUsernames = await OsuUserModel.getOAuthUsernamesMap();

        await Promise.all(
            missingFriends.map(async (user) => {
                const osuIdStr = user.osu_id.toString();
                if (oauthUsernames.has(osuIdStr)) {
                    user.username = oauthUsernames.get(osuIdStr);
                } else {
                    try {
                        const osuUser = await OsuUserModel.getOsuUser({ username: [osuIdStr], gamemode: 'osu' });
                        user.username = osuUser?.username || `User ${osuIdStr}`;
                    } catch {
                        user.username = `User ${osuIdStr}`;
                    }
                }
            })
        );

        // Construir Embed utilizando la capa de visualización (View)
        const missingEmbed = doOsuMissingFriendsEmbed(message, missingFriends);

        return { embeds: [missingEmbed] };
    }

    // 3. Flujo principal: Listar amigos del usuario
    let friends = null;
    let meDetails = null;
    let isSessionUser = false;

    // Verificar si el autor es el dueño y tiene sesión web configurada
    const isOwner = authorId === process.env.OWNER_ID;
    if (isOwner && process.env.OSU_SESSION) {
        if (logger) logger.process('Obteniendo lista de amigos y mutuales con sesión web...');
        const OsuWebSessionModel = require('../../../models/OsuWebSessionModel.js');
        const webData = await OsuWebSessionModel.fetchWebFriends();
        if (webData && Array.isArray(webData.friends)) {
            friends = [...webData.friends];
            meDetails = webData.currentUser;
            isSessionUser = true;
        }
    }

    // Si no es el dueño o falló la sesión web, recurrir al flujo tradicional OAuth
    if (!friends) {
        if (logger) logger.process(t(locale, 'amigos.log_check_oauth'));
        meDetails = await OsuUserModel.fetchMeDetails(authorId);
        if (!meDetails) {
            return t(locale, 'amigos.err_need_oauth_general');
        }

        if (logger) logger.process(t(locale, 'amigos.log_get_friends'));
        try {
            friends = await OsuUserModel.getFriendsList(authorId);
        } catch (err) {
            if (err.response && err.response.status === 403) {
                return t(locale, 'amigos.err_auth_403');
            }
            throw err;
        }
        if (!friends) {
            return t(locale, 'amigos.err_fetch_failed');
        }
    }

    const myOsuId = meDetails.id;

    if (friends.length === 0) {
        const embedColor = message.member?.roles?.highest?.color || '#ff66aa';
        const emptyEmbed = new EmbedBuilder()
            .setTitle(t(locale, 'amigos.empty_title'))
            .setColor(embedColor)
            .setDescription(t(locale, 'amigos.empty_desc'))
            .setTimestamp();
        return { embeds: [emptyEmbed] };
    }

    // Parse -pais flag
    const parsed_args = argsParserNoCommand(args);
    let countryFilter = parsed_args.country;
    let filterCountryCode = null;
    if (countryFilter) {
        if (countryFilter === "SELF") {
            filterCountryCode = meDetails.country_code ? meDetails.country_code.toUpperCase() : null;
        } else {
            filterCountryCode = countryFilter.toUpperCase();
        }
    }

    // Detectar filtros -mutuals y -nomutuals
    let mutualFilter = null;
    if (args && args.some(a => typeof a === 'string' && ['-mutual', '-mutuals', '-mutuales'].includes(a.toLowerCase()))) {
        mutualFilter = 'mutuals';
    } else if (args && args.some(a => typeof a === 'string' && ['-nomutual', '-nomutuals', '-nomutuales'].includes(a.toLowerCase()))) {
        mutualFilter = 'nomutuals';
    }

    // Obtener usuarios vinculados en la BD solo si no es usuario con sesión web
    let linkedMap = new Map();
    if (!isSessionUser) {
        if (logger) logger.process(t(locale, 'amigos.log_check_bot_linked'));
        linkedMap = await OsuUserModel.getLinkedUsersMap();
    }

    // Ordenar amigos: 1. Conectado (is_online), 2. Supporter (is_supporter), 3. Mutual (mutual), 4. Username alfabético
    friends.sort((a, b) => {
        if (!!a.is_online !== !!b.is_online) return b.is_online ? 1 : -1;
        if (!!a.is_supporter !== !!b.is_supporter) return b.is_supporter ? 1 : -1;
        const mutualA = (a.mutual === 'yes' || a.is_mutual) ? 1 : 0;
        const mutualB = (b.mutual === 'yes' || b.is_mutual) ? 1 : 0;
        if (mutualA !== mutualB) return mutualB - mutualA;
        return (a.username || '').localeCompare(b.username || '');
    });

    const totalFriends = friends.length;

    // Filtrar por país si se ha especificado
    let filteredFriends = friends;
    if (filterCountryCode) {
        filteredFriends = filteredFriends.filter(f => f.country_code && f.country_code.toUpperCase() === filterCountryCode);
    }

    // Filtrar por mutual / no-mutual
    if (mutualFilter === 'mutuals') {
        filteredFriends = filteredFriends.filter(f => f.mutual === 'yes' || f.is_mutual);
    } else if (mutualFilter === 'nomutuals') {
        filteredFriends = filteredFriends.filter(f => f.mutual === 'no' || (!f.is_mutual && f.mutual !== 'yes'));
    }

    if (filteredFriends.length === 0) {
        const embedColor = message.member?.roles?.highest?.color || '#ff66aa';
        let emptyDesc = t(locale, 'amigos.empty_desc');
        if (mutualFilter === 'mutuals') {
            emptyDesc = t(locale, 'amigos.empty_desc_mutuals');
        } else if (mutualFilter === 'nomutuals') {
            emptyDesc = t(locale, 'amigos.empty_desc_nomutuals');
        } else if (filterCountryCode) {
            emptyDesc = t(locale, 'amigos.empty_desc_country', { country: filterCountryCode });
        }

        let emptyTitle = t(locale, 'amigos.empty_title');
        if (mutualFilter === 'mutuals') {
            emptyTitle = filterCountryCode ? `${t(locale, 'amigos.list_title_mutuals')} - ${filterCountryCode}` : t(locale, 'amigos.list_title_mutuals');
        } else if (mutualFilter === 'nomutuals') {
            emptyTitle = filterCountryCode ? `${t(locale, 'amigos.list_title_nomutuals')} - ${filterCountryCode}` : t(locale, 'amigos.list_title_nomutuals');
        } else if (filterCountryCode) {
            emptyTitle = t(locale, 'amigos.list_title_country', { country: filterCountryCode });
        }

        const emptyEmbed = new EmbedBuilder()
            .setTitle(emptyTitle)
            .setColor(embedColor)
            .setDescription(emptyDesc)
            .setTimestamp();
        return { embeds: [emptyEmbed] };
    }

    const maxPages = Math.ceil(filteredFriends.length / 10);
    let pageNum = 1;
    let startIndex = 0;
    const hasButtons = filteredFriends.length > 10;

    // Función para renderizar el embed de una página utilizando la capa de visualización (View)
    const generateEmbed = (chunk, page, maxP, showLegend = hasButtons) => {
        return doOsuFriendsListEmbed(message, filteredFriends, chunk, page, maxP, startIndex, totalFriends, filterCountryCode, meDetails, showLegend, {
            mutualFilter,
            isSessionUser
        });
    };

    const getButtonsRow = (start, total) => {
        return buildPaginationRow({ prefix: 'amigos', current: start, total, pageSize: 10 });
    };

    // Procesar la página inicial
    const initialChunk = filteredFriends.slice(startIndex, startIndex + 10);
    if (!isSessionUser) {
        if (logger) logger.process(t(locale, 'amigos.log_check_mutuals_page', { page: 1 }));
        await checkMutualsForChunk(initialChunk, myOsuId, linkedMap);
    }

    const initialEmbed = generateEmbed(initialChunk, pageNum, maxPages, hasButtons);

    let sent_message;
    const sendOptions = {
        embeds: [initialEmbed],
        components: hasButtons ? [getButtonsRow(startIndex, filteredFriends.length)] : []
    };

    if (reply) {
        sent_message = await reply.reply(sendOptions);
    } else {
        sent_message = await message.channel.send(sendOptions);
    }

    if (!hasButtons) return;

    const btnFilter = btnInt => btnInt.user.id === message.author.id;
    const collector = sent_message.createMessageComponentCollector({
        filter: btnFilter,
        idle: 45000
    });

    collector.on('collect', async i => {
        try {
            await i.deferUpdate();

            if (i.customId === 'amigos_first') {
                startIndex = 0;
            } else if (i.customId === 'amigos_prev') {
                startIndex = Math.max(0, startIndex - 10);
            } else if (i.customId === 'amigos_next') {
                startIndex = startIndex + 10;
            } else if (i.customId === 'amigos_last') {
                startIndex = Math.floor((filteredFriends.length - 1) / 10) * 10;
            }

            pageNum = Math.floor(startIndex / 10) + 1;
            const currentChunk = filteredFriends.slice(startIndex, startIndex + 10);

            // Verificar si este chunk ya tiene los datos de mutualidad cargados (solo si no es sesión web)
            if (!isSessionUser) {
                const needsCheck = currentChunk.some(friend => friend.mutual === undefined);
                if (needsCheck) {
                    if (logger) logger.process(t(locale, 'amigos.log_check_mutuals_page', { page: pageNum }));
                    await checkMutualsForChunk(currentChunk, myOsuId, linkedMap);
                }
            }

            const updatedEmbed = generateEmbed(currentChunk, pageNum, maxPages, true);

            await i.editReply({
                embeds: [updatedEmbed],
                components: [getButtonsRow(startIndex, filteredFriends.length)]
            });
        } catch (err) {
            console.error("Error al navegar la lista de amigos:", err);
        }
    });

    collector.on('end', async () => {
        try {
            const currentChunk = filteredFriends.slice(startIndex, startIndex + 10);
            const expiredEmbed = generateEmbed(currentChunk, pageNum, maxPages, false);
            await sent_message.edit({ embeds: [expiredEmbed], components: [] });
        } catch {}
    });
}

run.description = {
    'header': t('es', 'commands.amigos.header'),
    'body': t('es', 'commands.amigos.body'),
    'usage': t('es', 'commands.amigos.usage')
};

run.requireOAuth = true;

module.exports = { run, description: run.description };
