const { EmbedBuilder } = require('discord.js');
const OsuUserModel = require('../../../models/OsuUserModel.js');
const { doOsuMissingFriendsEmbed, doOsuFriendsListEmbed } = require('../../../views/osuUserViews.js');
const { buildPaginationRow } = require('../../../views/osuViewHelpers.js');
const { t } = require('../../../utils/i18n.js');

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

    // 1. Verificar si está solicitando el flag secreto -sengo
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

        if (!dbUsers || dbUsers.length === 0) {
            return t(locale, 'amigos.err_no_linked_users');
        }

        // Encontrar cuáles de los usuarios vinculados NO están en la lista de amigos del owner
        const friendIds = new Set(friendsList.map(f => f.id.toString()));
        const missingFriends = dbUsers.filter(u => !friendIds.has(u.osu_id.toString()));

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

    // 2. Flujo normal: Listar amigos del autor
    if (logger) logger.process(t(locale, 'amigos.log_check_oauth'));
    const meDetails = await OsuUserModel.fetchMeDetails(authorId);
    if (!meDetails) {
        return t(locale, 'amigos.err_need_oauth_general');
    }

    if (logger) logger.process(t(locale, 'amigos.log_get_friends'));
    let friends = null;
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

    // Obtener usuarios vinculados en la BD
    if (logger) logger.process(t(locale, 'amigos.log_check_bot_linked'));
    const linkedMap = await OsuUserModel.getLinkedUsersMap();

    // Ordenar amigos alfabéticamente por username
    friends.sort((a, b) => (a.username || '').localeCompare(b.username || ''));

    const totalFriends = friends.length;
    const maxPages = Math.ceil(totalFriends / 10);
    let pageNum = 1;
    let startIndex = 0;

    // Función para renderizar el embed de una página utilizando la capa de visualización (View)
    const generateEmbed = (chunk, page, maxP) => {
        return doOsuFriendsListEmbed(message, friends, chunk, page, maxP, startIndex, totalFriends);
    };

    const getButtonsRow = (start, total) => {
        return buildPaginationRow({ prefix: 'amigos', current: start, total, pageSize: 10 });
    };

    // Procesar la página inicial
    if (logger) logger.process(t(locale, 'amigos.log_check_mutuals_page', { page: 1 }));
    const initialChunk = friends.slice(startIndex, startIndex + 10);
    await checkMutualsForChunk(initialChunk, myOsuId, linkedMap);

    const initialEmbed = generateEmbed(initialChunk, pageNum, maxPages);

    let sent_message;
    const sendOptions = {
        embeds: [initialEmbed],
        components: totalFriends > 10 ? [getButtonsRow(startIndex, totalFriends)] : []
    };

    if (reply) {
        sent_message = await reply.reply(sendOptions);
    } else {
        sent_message = await message.channel.send(sendOptions);
    }

    if (totalFriends <= 10) return;

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
                startIndex = Math.floor((totalFriends - 1) / 10) * 10;
            }

            pageNum = Math.floor(startIndex / 10) + 1;
            const currentChunk = friends.slice(startIndex, startIndex + 10);

            // Verificar si este chunk ya tiene los datos de mutualidad cargados, si no, los cargamos
            const needsCheck = currentChunk.some(friend => friend.mutual === undefined);
            if (needsCheck) {
                if (logger) logger.process(t(locale, 'amigos.log_check_mutuals_page', { page: pageNum }));
                await checkMutualsForChunk(currentChunk, myOsuId, linkedMap);
            }

            const updatedEmbed = generateEmbed(currentChunk, pageNum, maxPages);

            await i.editReply({
                embeds: [updatedEmbed],
                components: [getButtonsRow(startIndex, totalFriends)]
            });
        } catch (err) {
            console.error("Error al navegar la lista de amigos:", err);
        }
    });

    collector.on('end', async () => {
        try {
            await sent_message.edit({ components: [] });
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
