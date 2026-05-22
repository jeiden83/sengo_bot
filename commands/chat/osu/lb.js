const { findBeatmapInChannel, getBeatmap, argsParserNoCommand, NewloadToken } = require("../../utils/osu.js");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { v2 } = require('osu-api-extended');
const fetch = require('node-fetch');
const { getSupporterTokenForCountry } = require("../../../utils/osuAuth.js");

async function doEmbed(message, scores_chunk, beatmap_metadata, startIndex = 0, total_plays = 0, page = 1, max_pages = 1, parsed_args = {}, usedSupporter = null) {
    let embed_description = '';

    const emoji_mods = require("../../../src/emoji_mods.json");
    const emoji_grades = require("../../../src/emoji_grades.json");

    const getFlagEmoji = (countryCode) => {
        if (!countryCode) return "🏳️";
        return countryCode
            .toUpperCase()
            .replace(/./g, char => String.fromCodePoint(0x1F1E6 - 65 + char.charCodeAt()));
    };

    const isFiltered = parsed_args.modFilter !== null || parsed_args.modContainFilter !== null;

    scores_chunk.forEach((score, i) => {
        const globalIndex = startIndex + i + 1;
        const flag = getFlagEmoji(score.user ? score.user.country_code : "");
        const username = score.user ? score.user.username : 'Usuario';
        const userId = score.user ? score.user.id : score.user_id;
        const userUrl = `https://osu.ppy.sh/users/${userId}`;
        const userLink = `[${username}](${userUrl})`;

        // Asegurar que si no es en lazer (!isLazer), se le agregue el mod CL si no lo tiene
        const isLazer = score.build_id !== null && score.build_id !== undefined;
        if (!isLazer) {
            const hasCL = score.mods.some(m => (m.acronym || m) === 'CL');
            if (!hasCL) {
                const isObjectMod = score.mods.length > 0 && typeof score.mods[0] === 'object';
                if (isObjectMod) {
                    score.mods.push({ acronym: 'CL' });
                } else {
                    score.mods.push('CL');
                }
            }
        }

        const raw_legacy_score = (score.legacy_total_score && score.legacy_total_score > 0) ? score.legacy_total_score :
                                 (score.classic_total_score && score.classic_total_score > 0) ? score.classic_total_score :
                                 score.total_score || score.score || 0;
        const legacy_score = raw_legacy_score.toLocaleString('es-ES');
        const accuracy = (score.accuracy * 100).toFixed(2);
        const max_combo = score.max_combo;
        const beatmap_max_combo = beatmap_metadata.max_combo;

        const stats = score.statistics || {};
        const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
        const ok = stats.ok !== undefined ? stats.ok : (stats.count_100 || 0);
        const meh = stats.meh !== undefined ? stats.meh : (stats.count_50 || 0);
        const miss = stats.miss !== undefined ? stats.miss : (stats.count_miss || 0);
        const perfect = stats.perfect !== undefined ? stats.perfect : (stats.count_geki || 0);
        const good = stats.good !== undefined ? stats.good : (stats.count_katu || 0);

        let stats_str = "";
        let ratio_str = "";
        if (beatmap_metadata.mode === 'mania') {
            stats_str = `[${perfect}/${great}/${good}/${ok}/${meh}/${miss}]`;
            const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
            ratio_str = ` ▸ **${ratio}:1**`;
        } else if (beatmap_metadata.mode === 'taiko') {
            stats_str = `[${great}/${ok}/${miss}]`;
        } else {
            stats_str = `[${great}/${ok}/${meh}/${miss}]`;
        }

        const pp = score.pp ? score.pp.toFixed(2) : "0.00";
        const time_set = `<t:${Math.floor((new Date(score.ended_at || score.created_at)).getTime() / 1000)}:R>`;

        let grade_emoji = emoji_grades[!score.passed ? "F" : score.rank];
        grade_emoji = grade_emoji ? (grade_emoji[0] == "grade_f" ? `:${grade_emoji[1]}:` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`) : '❓';

        const mods_used = score.mods.length > 0 ? score.mods.reduce((acc, mod) => {
            let settings_str = '';
            if (mod.settings) {
                if (mod.acronym === 'DT' || mod.acronym === 'NC' || mod.acronym === 'HT') {
                    if (mod.settings.speed_change) settings_str = `(${mod.settings.speed_change}x)`;
                } else if (mod.acronym === 'DA') {
                    let da_changes = [];
                    if (mod.settings.circle_size !== undefined) da_changes.push(`CS${mod.settings.circle_size}`);
                    if (mod.settings.approach_rate !== undefined) da_changes.push(`AR${mod.settings.approach_rate}`);
                    if (mod.settings.overall_difficulty !== undefined) da_changes.push(`OD${mod.settings.overall_difficulty}`);
                    if (mod.settings.drain_rate !== undefined) da_changes.push(`HP${mod.settings.drain_rate}`);
                    if (da_changes.length > 0) settings_str = `(${da_changes.join(' ')})`;
                }
            }
            const modAcronym = mod.acronym || mod;
            return `${acc}<:${modAcronym}:${emoji_mods[modAcronym] || '123'}>${settings_str}`;
        }, '') : `<:NM:${emoji_mods["NM"]}>`;

        const isFirst = globalIndex === 1;
        const rank_pos = isFirst ? `**#${globalIndex}**` : `#${globalIndex}`;
        const global_rank = isFiltered ? ` (🌐 #${score.leaderboardRank})` : "";

        const formatted_score = isFirst ? `**${legacy_score}**` : `${legacy_score}`;
        const formatted_accuracy = isFirst ? `**${accuracy}%**` : `${accuracy}%`;
        const formatted_pp = isFirst ? `__**${pp}pp**__` : `__${pp}pp__`;
        const formatted_combo = isFirst ? `**x${max_combo}**` : `x${max_combo}`;

        const score_line = `${rank_pos}${global_rank} ▸ ${flag} ${userLink} ▸ ${formatted_score} ▸ ${formatted_accuracy}${ratio_str} ▸ ${formatted_pp} ▸ ${formatted_combo}/${beatmap_max_combo} ▸ +${mods_used}\n ▸ ${time_set} ▸ ${stats_str}\n\n`;

        embed_description = embed_description.concat(score_line);
    });

    const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#ffffff';

    const beatmap_cover = beatmap_metadata.beatmapset.covers["list@2x"] || beatmap_metadata.beatmapset.covers.cover;

    let footerText = `SengoBot • Mostrando posiciones ${startIndex + 1}-${startIndex + scores_chunk.length} de ${total_plays} (Página ${page}/${max_pages})`;
    if (usedSupporter) {
        footerText += ` • Pool: ${usedSupporter.username}${usedSupporter.fallback ? ' (global)' : ''}`;
    }

    const embed = new EmbedBuilder()
        .setDescription(embed_description)
        .setColor(embedColor)
        .setThumbnail(beatmap_cover)
        .setFooter({
            text: footerText,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

async function doContent(beatmap_metadata, targetGamemode, countryCode = null, friendsUsername = null) {
    const { title } = beatmap_metadata.beatmapset;
    const { difficulty_rating, version, url } = beatmap_metadata;
    const displayMode = targetGamemode === 'osu' ? 'std' : (targetGamemode === 'fruits' ? 'ctb' : targetGamemode);

    let mapa = `[${title} [${version}] - ${difficulty_rating + '★'} ](${url})`;
    let titleText = `**Tabla de clasificación (leaderboard) en osu!${displayMode} para:**`;
    if (countryCode) {
        titleText = `**Tabla de clasificación nacional (${countryCode.toUpperCase()}) en osu!${displayMode} para:**`;
    } else if (friendsUsername) {
        titleText = `**Tabla de clasificación de amigos de ${friendsUsername} en osu!${displayMode} para:**`;
    }
    return `${titleText}\n${mapa}`;
}

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
        const supabase = res.supabaseClient;
        let dbCountry = null;
        if (supabase) {
            try {
                const { data: userToken } = await supabase
                    .from('oauth_tokens')
                    .select('country_code')
                    .eq('discord_id', message.author.id)
                    .maybeSingle();
                if (userToken && userToken.country_code) {
                    dbCountry = userToken.country_code.toUpperCase();
                }
            } catch (err) {
                console.error("Error al buscar país del usuario:", err);
            }
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

    // 0. Caso leaderboard de amigos
    if (friendsFilter) {
        const supabase = res.supabaseClient;
        if (!supabase) {
            return `❌ No se pudo conectar a la base de datos de Supabase.`;
        }

        let query = supabase.from('oauth_tokens').select('*');
        if (friendsFilter === "SELF") {
            query = query.eq('discord_id', message.author.id);
        } else {
            const cleanId = friendsFilter.replace(/[<@!>]/g, "");
            if (/^\d{17,19}$/.test(cleanId)) {
                query = query.eq('discord_id', cleanId);
            } else {
                query = query.ilike('username', friendsFilter);
            }
        }

        const { data: userToken, error } = await query.maybeSingle();
        if (error || !userToken) {
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
            urlObj.searchParams.append('type', 'friends');
            if (modsArray.length > 0) {
                modsArray.forEach(mod => urlObj.searchParams.append('mods[]', mod));
            }

            const apiRes = await fetch(urlObj.toString(), {
                headers: {
                    'Authorization': `Bearer ${userToken.access_token}`,
                    'Content-Type': 'application/json',
                    'x-api-version': '20240728'
                }
            });

            if (!apiRes.ok) {
                throw new Error(`Status ${apiRes.status}`);
            }

            const resJson = await apiRes.json();
            scores = resJson.scores || resJson;
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

            const apiRes = await fetch(urlObj.toString(), {
                headers: {
                    'Authorization': `Bearer ${supporterRes.token}`,
                    'Content-Type': 'application/json',
                    'x-api-version': '20240728'
                }
            });

            if (!apiRes.ok) {
                throw new Error(`Status ${apiRes.status}`);
            }

            const resJson = await apiRes.json();
            scores = resJson.scores || resJson;
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

                const apiRes = await fetch(urlObj.toString(), {
                    headers: {
                        'Authorization': `Bearer ${supporterRes.token}`,
                        'Content-Type': 'application/json',
                        'x-api-version': '20240728'
                    }
                });

                if (apiRes.ok) {
                    const resJson = await apiRes.json();
                    scores = resJson.scores || resJson;
                }
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

            const apiRes = await fetch(urlObj.toString(), {
                headers: {
                    'Authorization': `Bearer ${globalToken}`,
                    'Content-Type': 'application/json',
                    'x-api-version': '20240728'
                }
            });

            if (apiRes.ok) {
                const resJson = await apiRes.json();
                scores = resJson.scores || resJson;
            } else {
                throw new Error(`Status ${apiRes.status}`);
            }
        } catch (e) {
            console.error("Error al obtener leaderboard:", e);
            return `❌ Ocurrió un error al obtener la tabla de clasificación desde la API de osu!.`;
        }
    }

    if (!scores || !Array.isArray(scores) || scores.length === 0) {
        return `No se encontraron puntuaciones en la tabla de clasificación de este mapa.`;
    }

    // Asignamos el índice original antes de cualquier filtro local
    scores.forEach((score, idx) => {
        score.leaderboardRank = idx + 1;
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

    const content = await doContent(beatmap_metadata, targetGamemode, countryFilter, friendsUsername);
    const initialEmbed = await doEmbed(message, filtered_scores.slice(startIndex, startIndex + 5), beatmap_metadata, startIndex, total_plays, page, max_pages, parsed_args, usedSupporter);

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
            const embed = await doEmbed(message, chunk, beatmap_metadata, startIndex, total_plays, currentPage, max_pages, parsed_args, usedSupporter);

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
