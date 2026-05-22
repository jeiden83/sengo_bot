const { findBeatmapInChannel, getBeatmap, argsParserNoCommand, NewloadToken } = require("../../utils/osu.js");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { v2 } = require('osu-api-extended');
const fetch = require('node-fetch');
const { getSupporterTokenForCountry, getOAuthTokenRecord, getOAuthTokenRecordByUsernameOrId } = require("../../../models/OsuUserModel.js");

const leaderboardCache = new Map();
const CACHE_TTL = 30000; // 30 segundos de caché para tablas de clasificación

async function fetchLeaderboardCached(url, headers, logger = null) {
    const now = Date.now();
    const isFriendQuery = url.includes('type=friend');
    const authHeader = isFriendQuery && headers && headers['Authorization'] ? headers['Authorization'] : '';
    const cacheKey = isFriendQuery ? `${url}|${authHeader}` : url;
    const cached = leaderboardCache.get(cacheKey);

    if (cached && (now - cached.timestamp) < CACHE_TTL) {
        if (logger) logger.process(`Caché: Usando leaderboard desde la caché para ${url.substring(url.indexOf('/beatmaps/'))}`);
        return cached.data;
    }

    const apiRes = await fetch(url, { headers });
    if (!apiRes.ok) {
        throw new Error(`Status ${apiRes.status}`);
    }

    const resJson = await apiRes.json();
    const scores = resJson.scores || resJson || [];

    leaderboardCache.set(cacheKey, { data: scores, timestamp: now });
    return scores;
}

const { doOsuLbEmbed, doOsuLbContent } = require("../../../views/osuLeaderboardViews.js");

async function run(messages, args) {
    const { message, res, reply, logger } = messages;

    const parsed_args = argsParserNoCommand(args);
    let beatmap_url = parsed_args.beatmap_url;
    let countryFilter = parsed_args.country;
    let friendsFilter = parsed_args.friendsFilter;
    let friendsUsername = null;
    let detected_gamemode = null;

    if (!beatmap_url) {
        if (logger) logger.process("Buscando beatmap reciente en el canal");
        const result = reply ? await findBeatmapInChannel(reply, true, parsed_args.index) : await findBeatmapInChannel(message, false, parsed_args.index);
        beatmap_url = result.beatmap_url;
        detected_gamemode = result.gamemode;
        if (!beatmap_url) return result.bad_response;
    }

    if (logger) logger.process("Obteniendo metadatos del beatmap");
    const beatmap_metadata = await getBeatmap(beatmap_url);

    const unranked_statuses = new Set(['pending', 'graveyard', 'wip']);
    if (unranked_statuses.has(beatmap_metadata.status)) {
        return `❌ Este mapa no tiene tabla de clasificación (leaderboard) online porque está en estado **${beatmap_metadata.status}**.`;
    }

    // Resolver país si es "SELF"
    if (countryFilter === "SELF") {
        let dbCountry = null;
        try {
            const userToken = await getOAuthTokenRecord(message.author.id);
            if (userToken && userToken.country_code) {
                dbCountry = userToken.country_code.toUpperCase();
            }
        } catch (err) {
            console.error("Error al buscar país del usuario:", err);
        }
        countryFilter = dbCountry || "VE";
    }

    const targetGamemode = parsed_args.gamemode || detected_gamemode || beatmap_metadata.mode;

    // APLICAR FILTROS DE MODS
    const modsStr = parsed_args.modFilter || "";
    const modsArray = [];
    if (modsStr) {
        if (modsStr === "NM" || modsStr === "NONE") {
            modsArray.push("NM");
        } else {
            for (let j = 0; j < modsStr.length; j += 2) {
                modsArray.push(modsStr.slice(j, j + 2).toUpperCase());
            }
        }
    }

    let scores = null;
    let usedSupporter = null;

    const hasFilters = (friendsFilter !== null && friendsFilter !== undefined) || 
                        (countryFilter !== null && countryFilter !== undefined) || 
                        (modsArray.length > 0) || 
                        (parsed_args.modFilter !== null && parsed_args.modFilter !== undefined) || 
                        (parsed_args.modContainFilter !== null && parsed_args.modContainFilter !== undefined);

    let globalScoresPromise = null;
    if (hasFilters) {
        globalScoresPromise = (async () => {
            try {
                const fs = require('fs');
                let globalToken = null;
                try {
                    const tokenData = JSON.parse(fs.readFileSync('./osu_token.json', 'utf8'));
                    globalToken = tokenData.access_token;
                } catch (e) {}

                if (!globalToken) return [];

                const globalUrl = `https://osu.ppy.sh/api/v2/beatmaps/${beatmap_metadata.id}/scores?mode=${targetGamemode}`;
                return await fetchLeaderboardCached(globalUrl, {
                    'Authorization': `Bearer ${globalToken}`,
                    'Content-Type': 'application/json',
                    'x-api-version': '20240728'
                }, logger);
            } catch (err) {
                console.error("Error al obtener global scores en paralelo:", err);
            }
            return [];
        })();
    }

    // 0. Caso leaderboard de amigos
    if (friendsFilter) {
        const searchFilter = friendsFilter === "SELF" ? message.author.id : friendsFilter;
        const userToken = await getOAuthTokenRecordByUsernameOrId(searchFilter);
        if (!userToken) {
            return `❌ No se encontró ningún usuario vinculado con el nombre o Discord ID **${friendsFilter === "SELF" ? message.author.username : friendsFilter}** en la base de datos.`;
        }

        if (!userToken.is_supporter) {
            return `❌ El usuario **${userToken.username}** no tiene osu! supporter activo en su cuenta vinculada, lo cual es requerido por la API de osu! para consultar el ranking de amigos.`;
        }

        friendsUsername = userToken.username;
        usedSupporter = {
            username: userToken.username,
            fallback: false
        };

        if (logger) logger.process(`Obteniendo ranking de amigos de ${friendsUsername}`);
        try {
            const urlObj = new URL(`https://osu.ppy.sh/api/v2/beatmaps/${beatmap_metadata.id}/scores`);
            urlObj.searchParams.append('mode', targetGamemode);
            urlObj.searchParams.append('type', 'friend');
            if (modsArray.length > 0) {
                modsArray.forEach(mod => urlObj.searchParams.append('mods[]', mod));
            }

            scores = await fetchLeaderboardCached(urlObj.toString(), {
                'Authorization': `Bearer ${userToken.access_token}`,
                'Content-Type': 'application/json',
                'x-api-version': '20240728'
            }, logger);
        } catch (e) {
            console.error("Error al obtener friends ranking:", e);
            return `❌ Error al consultar la API de osu! usando el token de amigos de **${friendsUsername}**.`;
        }
    }
    // 1. Caso leaderboard nacional
    else if (countryFilter) {
        if (logger) logger.process(`Buscando supporter de ${countryFilter} en la pool`);
        const supporterRes = await getSupporterTokenForCountry(countryFilter);
        if (!supporterRes) {
            return `❌ No hay ningún usuario de **${countryFilter}** con osu! supporter vinculado al bot en la base de datos por oAuth para poder realizar esta consulta.`;
        }
        usedSupporter = supporterRes;
        
        if (logger) logger.process(`Obteniendo ranking nacional de ${countryFilter} con el token de ${supporterRes.username}`);
        
        try {
            const urlObj = new URL(`https://osu.ppy.sh/api/v2/beatmaps/${beatmap_metadata.id}/scores`);
            urlObj.searchParams.append('mode', targetGamemode);
            urlObj.searchParams.append('type', 'country');
            if (modsArray.length > 0) {
                modsArray.forEach(mod => urlObj.searchParams.append('mods[]', mod));
            }

            scores = await fetchLeaderboardCached(urlObj.toString(), {
                'Authorization': `Bearer ${supporterRes.token}`,
                'Content-Type': 'application/json',
                'x-api-version': '20240728'
            }, logger);
        } catch (e) {
            console.error("Error al obtener country ranking:", e);
            return `❌ Error al consultar la API de osu! usando las credenciales del supporter de la pool.`;
        }
    }
    // 2. Caso leaderboard con mods exactos (Dedicated mods)
    else if (modsArray.length > 0) {
        if (logger) logger.process(`Buscando algún supporter en la pool para filtrar mods`);
        const supporterRes = await getSupporterTokenForCountry("ANY");
        if (supporterRes) {
            usedSupporter = supporterRes;
            if (logger) logger.process(`Obteniendo leaderboard con mods exactos usando el token de ${supporterRes.username}`);
            try {
                const urlObj = new URL(`https://osu.ppy.sh/api/v2/beatmaps/${beatmap_metadata.id}/scores`);
                urlObj.searchParams.append('mode', targetGamemode);
                modsArray.forEach(mod => urlObj.searchParams.append('mods[]', mod));

                scores = await fetchLeaderboardCached(urlObj.toString(), {
                    'Authorization': `Bearer ${supporterRes.token}`,
                    'Content-Type': 'application/json',
                    'x-api-version': '20240728'
                }, logger);
            } catch (e) {
                console.error("Error al obtener mod leaderboard con supporter:", e);
            }
        }
    }

    // 3. Fallback a consulta estándar global
    if (!scores) {
        await NewloadToken();
        if (logger) logger.process("Obteniendo leaderboard global estándar");
        try {
            const fs = require('fs');
            let globalToken = null;
            try {
                const tokenData = JSON.parse(fs.readFileSync('./osu_token.json', 'utf8'));
                globalToken = tokenData.access_token;
            } catch (err) {
                console.error("Error al leer osu_token.json:", err);
            }

            if (!globalToken) {
                throw new Error("No global token available");
            }

            const urlObj = new URL(`https://osu.ppy.sh/api/v2/beatmaps/${beatmap_metadata.id}/scores`);
            urlObj.searchParams.append('mode', targetGamemode);
            if (modsArray.length > 0) {
                modsArray.forEach(mod => urlObj.searchParams.append('mods[]', mod));
            }

            scores = await fetchLeaderboardCached(urlObj.toString(), {
                'Authorization': `Bearer ${globalToken}`,
                'Content-Type': 'application/json',
                'x-api-version': '20240728'
            }, logger);
        } catch (e) {
            console.error("Error al obtener leaderboard:", e);
            return `❌ Ocurrió un error al obtener la tabla de clasificación desde la API de osu!.`;
        }
    }

    if (!scores || !Array.isArray(scores) || scores.length === 0) {
        return `No se encontraron puntuaciones en la tabla de clasificación de este mapa.`;
    }

    let globalScores = [];
    if (globalScoresPromise) {
        if (logger) logger.process("Esperando cruce de posiciones globales...");
        globalScores = await globalScoresPromise;
    }

    const globalMap = new Map();
    globalScores.forEach((s, idx) => {
        globalMap.set(s.id.toString(), idx + 1);
    });

    // Asignamos la posición global si existe cruce, sino usamos el índice local
    scores.forEach((score, idx) => {
        if (hasFilters && globalScores.length > 0) {
            const globalPos = globalMap.get(score.id.toString());
            score.leaderboardRank = globalPos !== undefined ? globalPos : "50+";
        } else {
            score.leaderboardRank = idx + 1;
        }
    });

    // APLICAR FILTROS DE MODS (Si no se hicieron a nivel de API o para el filtrado -mx de contención)
    let filtered_scores = scores;

    if (parsed_args.modFilter !== null && parsed_args.modFilter !== undefined) {
        const filterStr = parsed_args.modFilter;
        const hasExplicitCL = filterStr.includes("CL");

        filtered_scores = filtered_scores.filter(score => {
            const scoreAcronyms = score.mods.map(m => m.acronym || m);
            const filteredScoreAcronyms = hasExplicitCL ? scoreAcronyms : scoreAcronyms.filter(mod => mod !== 'CL');

            if (filterStr === "NM" || filterStr === "NONE") {
                return filteredScoreAcronyms.length === 0;
            }

            const getModChunks = (str) => {
                const chunks = [];
                for (let j = 0; j < str.length; j += 2) {
                    chunks.push(str.slice(j, j + 2));
                }
                return chunks.sort().join("").toUpperCase();
            };
            const filterNormalized = getModChunks(filterStr);
            const scoreNormalized = filteredScoreAcronyms.sort().join("").toUpperCase();
            return scoreNormalized === filterNormalized;
        });
    }

    // 2. Filtrar por mods contenidos (-mx) - Siempre en memoria
    if (parsed_args.modContainFilter !== null && parsed_args.modContainFilter !== undefined) {
        const filterStr = parsed_args.modContainFilter;
        const hasExplicitCL = filterStr.includes("CL");

        const filterChunks = [];
        for (let j = 0; j < filterStr.length; j += 2) {
            filterChunks.push(filterStr.slice(j, j + 2));
        }

        filtered_scores = filtered_scores.filter(score => {
            const scoreAcronyms = score.mods.map(m => m.acronym || m);
            const filteredScoreAcronyms = hasExplicitCL ? scoreAcronyms : scoreAcronyms.filter(mod => mod !== 'CL');

            if (filterStr === "NM" || filterStr === "NONE") {
                return filteredScoreAcronyms.length === 0;
            }

            return filterChunks.every(mod => filteredScoreAcronyms.includes(mod));
        });
    }

    if (filtered_scores.length === 0) {
        let errorMsg = `No se encontraron puntuaciones en la tabla de clasificación con los filtros aplicados:`;
        if (parsed_args.modFilter !== null) errorMsg += `\n ▸ Mods exactos: \`${parsed_args.modFilter}\``;
        if (parsed_args.modContainFilter !== null) errorMsg += `\n ▸ Contiene mods: \`${parsed_args.modContainFilter}\``;
        return errorMsg;
    }

    // Simular PP para los scores que no tengan (por ejemplo, si el mapa es loved)
    let needsPP = filtered_scores.some(s => !s.pp);
    if (needsPP) {
        if (logger) logger.process("Simulando PP en el beatmap para puntuaciones sin PP");
        const { getBeatmap_osu, calculatePP } = require("../../utils/osu.js");
        let map;
        try {
            map = await getBeatmap_osu(beatmap_metadata.beatmapset_id, beatmap_metadata.id, beatmap_metadata);
            for (let score of filtered_scores) {
                if (!score.pp) {
                    try {
                        const ppResult = calculatePP(score, map);
                        score.pp = ppResult.pp;
                    } catch (e) {
                        score.pp = 0;
                    }
                }
            }
            map.free();
        } catch (e) {
            console.error("Error al cargar beatmap para simulación de PP:", e);
        }
    }

    // Paginación
    const total_plays = filtered_scores.length;
    const max_pages = Math.ceil(total_plays / 5);
    const requestedPage = parsed_args.page || 1;

    if (parsed_args.page && (requestedPage > max_pages || requestedPage < 1)) {
        const warningMsg = `⚠️ La página **${requestedPage}** no existe. La lista tiene **${max_pages}** ${max_pages === 1 ? 'página' : 'páginas'} de puntuaciones.`;
        if (reply) {
            reply.reply({ content: warningMsg });
            return;
        }
        return { content: warningMsg };
    }

    let page = requestedPage;
    let startIndex = (page - 1) * 5;

    const content = await doOsuLbContent(beatmap_metadata, targetGamemode, countryFilter, friendsUsername);
    const initialEmbed = await doOsuLbEmbed(message, filtered_scores.slice(startIndex, startIndex + 5), beatmap_metadata, startIndex, total_plays, page, max_pages, parsed_args, usedSupporter);

    const getLbButtonsRow = (start, total) => {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('lb_first')
                .setLabel('<<')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start <= 0),
            new ButtonBuilder()
                .setCustomId('lb_prev')
                .setLabel('<')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start <= 0),
            new ButtonBuilder()
                .setCustomId('lb_next')
                .setLabel('>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start + 5 >= total),
            new ButtonBuilder()
                .setCustomId('lb_last')
                .setLabel('>>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(start + 5 >= total)
        );
    };

    let sent_message;
    if (reply) {
        sent_message = await reply.reply({
            content: content,
            embeds: [initialEmbed],
            components: total_plays > 5 ? [getLbButtonsRow(startIndex, total_plays)] : []
        });
    } else {
        sent_message = await message.channel.send({
            content: content,
            embeds: [initialEmbed],
            components: total_plays > 5 ? [getLbButtonsRow(startIndex, total_plays)] : []
        });
    }

    if (total_plays <= 5) return;

    const btnFilter = btnInt => btnInt.user.id === message.author.id;
    const collector = sent_message.createMessageComponentCollector({
        filter: btnFilter,
        idle: 30000
    });

    collector.on('collect', async i => {
        try {
            await i.deferUpdate();

            if (i.customId === 'lb_first') {
                startIndex = 0;
            } else if (i.customId === 'lb_prev') {
                startIndex = Math.max(0, startIndex - 5);
            } else if (i.customId === 'lb_next') {
                startIndex = startIndex + 5;
            } else if (i.customId === 'lb_last') {
                startIndex = Math.floor((total_plays - 1) / 5) * 5;
            }

            const currentPage = Math.floor(startIndex / 5) + 1;
            const chunk = filtered_scores.slice(startIndex, startIndex + 5);
            const embed = await doOsuLbEmbed(message, chunk, beatmap_metadata, startIndex, total_plays, currentPage, max_pages, parsed_args, usedSupporter);

            await i.editReply({
                embeds: [embed],
                components: [getLbButtonsRow(startIndex, total_plays)]
            });
        } catch (err) {
            console.error("Error al navegar la lista de leaderboard:", err);
        }
    });

    collector.on('end', async () => {
        try {
            await sent_message.edit({ components: [] });
        } catch (e) {}
    });

    return;
}

run.alias = {
    "leaderboard": {
        "args": ""
    },
    "lbm": {
        "args": "-mania"
    },
    "lbc": {
        "args": "-ctb"
    },
    "lbt": {
        "args": "-taiko"
    }
}

run.description = {
    'header': 'Tabla de clasificación global y nacional',
    'body': 'Muestra las mejores puntuaciones del último mapa en el canal. Soporta el flag `-pais [código]` para rankings nacionales y filtro de mods dedicados a través de la pool de supporter.',
    'usage': `s.lb : Muestra el leaderboard global.\ns.lb -pais CL : Muestra el leaderboard nacional de Chile.\ns.lb -pais : Autodetecta tu país y muestra su leaderboard.\ns.lb -m HDHR : Muestra leaderboard filtrado por mods exactos (HDHR).\ns.lb -pais VE -m HD : Muestra leaderboard de Venezuela con mod HD.`
}

module.exports = { run, "description": run.description }
