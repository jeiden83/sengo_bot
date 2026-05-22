const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getSupabaseClient } = require('../../../db/database.js');
const { getValidTokenForUser } = require('../../../utils/osuAuth.js');
const { doOsuMissingFriendsEmbed, doOsuFriendsListEmbed } = require('../../../views/osuUserViews.js');
const axios = require('axios');

// Bandera emoji helper
const getFlagEmoji = (countryCode) => {
    if (!countryCode) return "🏳️";
    return countryCode
        .toUpperCase()
        .replace(/./g, char => String.fromCodePoint(0x1F1E6 - 65 + char.charCodeAt()));
};

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
                const friendToken = await getValidTokenForUser(dbInfo.discord_id);
                if (!friendToken) {
                    friend.mutual = 'unknown'; // Sin token válido o sin scope friends.read
                    return;
                }

                const res = await axios.get('https://osu.ppy.sh/api/v2/friends', {
                    headers: {
                        'Authorization': `Bearer ${friendToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 2000
                });

                const friendFriendsList = res.data;
                const isMutual = friendFriendsList.some(f => f.id.toString() === myOsuId.toString());
                friend.mutual = isMutual ? 'yes' : 'no';
            } catch (err) {
                // Si da 403 u otro error de red, marcamos como desconocido/falta-scope
                friend.mutual = 'unknown';
            }
        })
    );
}

async function run(messages, args) {
    const { message, res, reply, logger } = messages;
    const supabase = getSupabaseClient() || res?.supabaseClient;
    const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#ff66aa';

    const authorId = message.author.id;

    // 1. Verificar si está solicitando el flag secreto -sengo
    const isSengoFlag = args && args.some(arg => typeof arg === 'string' && arg.toLowerCase() === '-sengo');
    if (isSengoFlag) {
        if (logger) logger.process("Procesando flag secreto -sengo...");
        const ownerId = process.env.OWNER_ID;
        if (authorId !== ownerId) {
            return `❌ Este flag es de uso exclusivo para el creador del Sengo Bot.`;
        }

        // Obtener token del owner
        const ownerToken = await getValidTokenForUser(authorId);
        if (!ownerToken) {
            return `❌ Debes vincular tu cuenta con OAuth primero usando \`s.link -oauth\` para poder realizar esta consulta.`;
        }

        if (logger) logger.process("Obteniendo amigos del creador desde la API de osu!...");
        let friendsList = [];
        try {
            const friendsRes = await axios.get('https://osu.ppy.sh/api/v2/friends', {
                headers: {
                    'Authorization': `Bearer ${ownerToken}`,
                    'Content-Type': 'application/json'
                }
            });
            friendsList = friendsRes.data;
        } catch (err) {
            console.error("Error al obtener amigos del owner:", err.message);
            return `❌ Error al obtener tus amigos de osu!. Asegúrate de que tu vinculación no haya expirado.`;
        }

        if (logger) logger.process("Obteniendo usuarios vinculados de la base de datos...");
        if (!supabase) {
            return `❌ La base de datos no está disponible en este momento.`;
        }

        const { data: dbUsers, error: dbUsersError } = await supabase
            .from('users')
            .select('discord_id, osu_id')
            .not('osu_id', 'is', null);

        if (dbUsersError) {
            console.error("Error al obtener usuarios vinculados:", dbUsersError.message);
            return `❌ Error al obtener usuarios vinculados de la base de datos.`;
        }

        // Encontrar cuáles de los usuarios vinculados NO están en la lista de amigos del owner
        const friendIds = new Set(friendsList.map(f => f.id.toString()));
        const missingFriends = dbUsers.filter(u => !friendIds.has(u.osu_id.toString()));

        // Obtener los nombres de usuario de osu! para los usuarios faltantes
        if (logger) logger.process("Obteniendo nombres de los usuarios faltantes...");
        const { data: oauthTokens } = await supabase.from('oauth_tokens').select('osu_id, username');
        const oauthUsernames = new Map(oauthTokens?.map(t => [t.osu_id.toString(), t.username]) || []);

        const { getOsuUser } = require("../../utils/osu.js");

        await Promise.all(
            missingFriends.map(async (user) => {
                const osuIdStr = user.osu_id.toString();
                if (oauthUsernames.has(osuIdStr)) {
                    user.username = oauthUsernames.get(osuIdStr);
                } else {
                    try {
                        const osuUser = await getOsuUser({ username: [osuIdStr], gamemode: 'osu' });
                        user.username = osuUser?.username || `User ${osuIdStr}`;
                    } catch (e) {
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
    if (logger) logger.process("Verificando token de OAuth...");
    const userToken = await getValidTokenForUser(authorId);
    if (!userToken) {
        return `❌ Debes vincular tu cuenta con OAuth primero usando \`s.link -oauth\` para poder utilizar este comando.`;
    }

    if (logger) logger.process("Obteniendo amigos desde la API de osu!...");
    let friends = [];
    let myOsuId = null;

    try {
        // Obtener el ID de osu del propio usuario ejecutor
        const meRes = await axios.get('https://osu.ppy.sh/api/v2/me', {
            headers: {
                'Authorization': `Bearer ${userToken}`,
                'Content-Type': 'application/json'
            }
        });
        myOsuId = meRes.data.id;

        const friendsRes = await axios.get('https://osu.ppy.sh/api/v2/friends', {
            headers: {
                'Authorization': `Bearer ${userToken}`,
                'Content-Type': 'application/json'
            }
        });
        friends = friendsRes.data;
    } catch (err) {
        console.error("Error al obtener amigos en flujo normal:", err.message);
        return `❌ Error al consultar la API de osu!. Es posible que necesites re-vincular tu cuenta con \`s.link -oauth\`.`;
    }

    if (friends.length === 0) {
        const emptyEmbed = new EmbedBuilder()
            .setTitle("👥 Lista de Amigos en osu!")
            .setColor(embedColor)
            .setDescription("Aún no tienes amigos agregados en tu cuenta de osu!.")
            .setTimestamp();
        return { embeds: [emptyEmbed] };
    }

    // Obtener usuarios vinculados en la BD
    if (logger) logger.process("Consultando usuarios vinculados al bot...");
    let linkedMap = new Map();
    if (supabase) {
        try {
            const { data: dbUsers } = await supabase
                .from('users')
                .select('discord_id, osu_id')
                .not('osu_id', 'is', null);

            const { data: dbTokens } = await supabase
                .from('oauth_tokens')
                .select('discord_id, osu_id, username');
            
            if (dbTokens) {
                dbTokens.forEach(t => {
                    linkedMap.set(t.osu_id.toString(), { discord_id: t.discord_id, username: t.username });
                });
            }

            if (dbUsers) {
                dbUsers.forEach(u => {
                    const osuIdStr = u.osu_id.toString();
                    if (!linkedMap.has(osuIdStr)) {
                        linkedMap.set(osuIdStr, { discord_id: u.discord_id, username: null });
                    }
                });
            }
        } catch (err) {
            console.error("Error al consultar vinculados:", err);
        }
    }

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
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('amigos_first')
                .setLabel('<<')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start <= 0),
            new ButtonBuilder()
                .setCustomId('amigos_prev')
                .setLabel('<')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start <= 0),
            new ButtonBuilder()
                .setCustomId('amigos_next')
                .setLabel('>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start + 10 >= total),
            new ButtonBuilder()
                .setCustomId('amigos_last')
                .setLabel('>>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start + 10 >= total)
        );
    };

    // Procesar la página inicial
    if (logger) logger.process(`Comprobando mutualidades para la página 1...`);
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
                if (logger) logger.process(`Comprobando mutualidades para la página ${pageNum}...`);
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
        } catch (e) {}
    });
}

run.description = {
    'header': 'Lista de amigos en osu!',
    'body': 'Muestra la lista de amigos del jugador por páginas, detallando su supporter, vinculación al Sengo y estado de mutual.',
    'usage': `s.amigos : Muestra tus amigos por páginas.\ns.amigos -sengo : Compara tus amigos contra los vinculados al bot (solo OWNER).`
};

module.exports = { run };
