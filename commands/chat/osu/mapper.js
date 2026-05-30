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
        } else if (lowerArg === '-loved') {
            type = 'loved';
        } else if (lowerArg === '-graveyard') {
            type = 'graveyard';
        } else if (lowerArg === '-mapas') {
            type = 'all';
        } else if (lowerArg === '-gd') {
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
        const osuClient = await getOsuClient();
        if (mapType === 'all') {
            const [ranked, loved, pending, graveyard, guest] = await Promise.all([
                osuClient.users.getUserBeatmaps(osuUserId, 'ranked', { limit: 5 }),
                osuClient.users.getUserBeatmaps(osuUserId, 'loved', { limit: 5 }),
                osuClient.users.getUserBeatmaps(osuUserId, 'pending', { limit: 5 }),
                osuClient.users.getUserBeatmaps(osuUserId, 'graveyard', { limit: 5 }),
                osuClient.users.getUserBeatmaps(osuUserId, 'guest', { limit: 5 })
            ]);
            return { ranked, loved, pending, graveyard, guest };
        } else {
            return await osuClient.users.getUserBeatmaps(osuUserId, mapType, { limit: 100 });
        }
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
                const newType = buttonId.replace("mapper_", "");
                
                const loadingEmbed = new EmbedBuilder()
                    .setColor(getEmbedColor(message))
                    .setDescription(`⏳ *Buscando datos en la API de osu!...*`);
                await i.editReply({ 
                    embeds: [loadingEmbed], 
                    components: buildMapperButtonsRow(osuUser, newType) 
                });
                
                let nextEmbed;
                if (newType === 'profile') {
                    nextEmbed = doOsuMapperEmbed(message, osuUser);
                } else {
                    const mapData = await fetchBeatmapsets(osuUser.id, newType);
                    nextEmbed = doOsuMapperListEmbed(message, osuUser, newType, mapData);
                }
                
                await i.editReply({
                    embeds: [nextEmbed],
                    components: buildMapperButtonsRow(osuUser, newType)
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
    const initialComponents = buildMapperButtonsRow(osuUser, type);

    if (type === 'profile') {
        initialEmbed = doOsuMapperEmbed(message, osuUser);
        const sentMessage = await message.channel.send({
            embeds: [initialEmbed],
            components: initialComponents
        });
        setupCollector(sentMessage);
    } else {
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
            initialEmbed = doOsuMapperListEmbed(message, osuUser, type, mapData);
            
            await statusMessage.edit({
                embeds: [initialEmbed],
                components: initialComponents
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
                components: buildMapperButtonsRow(osuUser, 'profile')
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
