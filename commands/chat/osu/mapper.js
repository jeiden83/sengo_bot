const { getOsuUser, argsParser } = require("../../utils/osu.js");
const { doOsuMapperEmbed, buildMapperButtonsRow, doOsuMapperListEmbed } = require("../../../views/osuUserViews.js");
const { getEmbedColor } = require("../../../views/osuViewHelpers.js");
const { Client } = require("osu-web.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");
const { EmbedBuilder } = require("discord.js");

async function run(messages, args) {
    const { message, res, logger } = messages;

    if (logger) logger.process("Consultando perfil de osu! y estadísticas de creador...");

    // Pre-procesar argumentos para detectar flags de tipo de mapa
    let type = 'profile';
    const cleanArgs = [];
    for (const arg of args) {
        const lowerArg = arg.toLowerCase();
        if (lowerArg === '-rankeados' || lowerArg === '-rankeds') {
            type = 'ranked';
        } else if (lowerArg === '-pending' || lowerArg === '-wip') {
            type = 'pending';
        } else if (lowerArg === '-loved' || lowerArg === '-amados') {
            type = 'loved';
        } else if (lowerArg === '-graveyard' || lowerArg === '-abandonados') {
            type = 'graveyard';
        } else if (lowerArg === '-mapas' || lowerArg === '-todos') {
            type = 'all';
        } else if (lowerArg === '-gd' || lowerArg === '-gds') {
            type = 'guest';
        } else {
            cleanArgs.push(arg);
        }
    }

    const osu_userdata = await argsParser(cleanArgs, {
        "message": message,
        "res": res,
        "command_function": getOsuUser,
        "resolveUserByIndex": true,
        "ignoreBeatmap": true
    });

    if (!osu_userdata.fn_response || typeof osu_userdata.fn_response === 'string') {
        return osu_userdata.fn_response;
    }

    const osuUser = osu_userdata.fn_response;

    let currentType = type;
    let currentPage = 1;
    const cachedMaps = {};

    // Inicializar cliente osu! de forma diferida
    let client;
    async function getOsuClient() {
        if (!client) {
            const token = await OsuUserModel.loadToken();
            client = new Client(token.access_token);
        }
        return client;
    }

    async function fetchBeatmapsets(osuUserId, mapType) {
        if (cachedMaps[mapType]) {
            return cachedMaps[mapType];
        }

        const osuClient = await getOsuClient();
        let data;
        if (mapType === 'all') {
            const [ranked, loved, pending, graveyard, guest] = await Promise.all([
                osuClient.users.getUserBeatmaps(osuUserId, 'ranked', { query: { limit: 5 } }),
                osuClient.users.getUserBeatmaps(osuUserId, 'loved', { query: { limit: 5 } }),
                osuClient.users.getUserBeatmaps(osuUserId, 'pending', { query: { limit: 5 } }),
                osuClient.users.getUserBeatmaps(osuUserId, 'graveyard', { query: { limit: 5 } }),
                osuClient.users.getUserBeatmaps(osuUserId, 'guest', { query: { limit: 5 } })
            ]);
            data = { ranked, loved, pending, graveyard, guest };
        } else {
            data = await osuClient.users.getUserBeatmaps(osuUserId, mapType, { query: { limit: 100 } });
        }

        cachedMaps[mapType] = data;
        return data;
    }

    function getItemsCountForType(mapType) {
        if (mapType === 'profile' || mapType === 'all') return 0;
        const data = cachedMaps[mapType];
        return data ? data.length : 0;
    }

    function getTotalPagesForType(mapType) {
        const count = getItemsCountForType(mapType);
        return Math.max(1, Math.ceil(count / 5));
    }

    function setupCollector(sentMessage) {
        const collector = sentMessage.createMessageComponentCollector({
            filter: btnInt => btnInt.user.id === message.author.id,
            idle: 120000
        });

        collector.on('collect', async i => {
            try {
                await i.deferUpdate();
                
                const buttonId = i.customId;
                let newType = currentType;
                let newPage = currentPage;

                if (buttonId === 'mapper_first') {
                    newPage = 1;
                } else if (buttonId === 'mapper_last') {
                    newPage = getTotalPagesForType(currentType);
                } else if (buttonId === 'mapper_prev') {
                    newPage = Math.max(1, currentPage - 1);
                } else if (buttonId === 'mapper_next') {
                    const totalPages = getTotalPagesForType(currentType);
                    newPage = Math.min(totalPages, currentPage + 1);
                } else if (buttonId.startsWith('mapper_')) {
                    newType = buttonId.replace("mapper_", "");
                    newPage = 1; // Reiniciar página al cambiar de categoría
                }

                // Mostrar embed de carga únicamente si cambiamos de pestaña y no tenemos caché
                if (newType !== currentType && newType !== 'profile' && !cachedMaps[newType]) {
                    const loadingEmbed = new EmbedBuilder()
                        .setColor(getEmbedColor(message))
                        .setDescription(`⏳ *Buscando datos en la API de osu!...*`);
                    await i.editReply({ 
                        embeds: [loadingEmbed], 
                        components: buildMapperButtonsRow(osuUser, newType, newPage, 1) 
                    });
                }
                
                let nextEmbed;
                if (newType === 'profile') {
                    nextEmbed = doOsuMapperEmbed(message, osuUser);
                } else {
                    const mapData = await fetchBeatmapsets(osuUser.id, newType);
                    nextEmbed = doOsuMapperListEmbed(message, osuUser, newType, mapData, newPage);
                }

                currentType = newType;
                currentPage = newPage;

                const totalPages = getTotalPagesForType(currentType);
                await i.editReply({
                    embeds: [nextEmbed],
                    components: buildMapperButtonsRow(osuUser, currentType, currentPage, totalPages)
                });
            } catch (err) {
                console.error("Error al procesar interacción en mapper:", err);
            }
        });

        collector.on('end', async () => {
            try {
                await sentMessage.edit({ components: [] });
            } catch {}
        });
    }

    let initialEmbed;
    
    if (type === 'profile') {
        initialEmbed = doOsuMapperEmbed(message, osuUser);
        const initialComponents = buildMapperButtonsRow(osuUser, 'profile', 1, 1);
        const sentMessage = await message.channel.send({
            embeds: [initialEmbed],
            components: initialComponents
        });
        setupCollector(sentMessage);
    } else {
        const initialComponents = buildMapperButtonsRow(osuUser, type, 1, 1);
        const statusMessage = await message.channel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(getEmbedColor(message))
                    .setDescription(`⏳ *Buscando mapas de ${osuUser.username}...*`)
            ],
            components: initialComponents
        });

        try {
            const mapData = await fetchBeatmapsets(osuUser.id, type);
            const totalPages = getTotalPagesForType(type);
            initialEmbed = doOsuMapperListEmbed(message, osuUser, type, mapData, currentPage);
            
            await statusMessage.edit({
                embeds: [initialEmbed],
                components: buildMapperButtonsRow(osuUser, type, currentPage, totalPages)
            });
            
            setupCollector(statusMessage);
        } catch (err) {
            console.error("Error al cargar mapas en comando mapper inicial:", err);
            await statusMessage.edit({
                embeds: [
                    new EmbedBuilder()
                        .setColor("#ff3333")
                        .setDescription(`❌ *Error al cargar los mapas de la API de osu!.*`)
                ],
                components: buildMapperButtonsRow(osuUser, 'profile', 1, 1)
            });
            setupCollector(statusMessage);
        }
    }
}

run.alias = {
    "mapper": {
        "args": ""
    },
    "mapcreator": {
        "args": ""
    },
    "creator": {
        "args": ""
    }
};

run.description = {
    'header': 'Estadísticas de creador/mapper de un usuario',
    'body': 'Muestra estadísticas detalladas del mapper en osu! (seguidores, Kudosu, mapas rankeados, amados, graveyard, guest diffs y nominaciones).',
    'usage': `s.mapper : Muestra tus estadísticas como mapper.\ns.mapper 'usuario_osu' : Muestra las estadísticas de mapper del usuario especificado.`
};

module.exports = { run };
