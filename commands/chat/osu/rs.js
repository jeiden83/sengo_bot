const { getBeatmap_osu, saveUserscore, getUserRecentScores, argsParser, getBeatmap, calculatePP, triggerBackgroundRecentPreload } = require("../../utils/osu.js");






const { doOsuEmbed, doOsuListEmbed } = require("../../../views/osuEmbeds.js");
const { buildPaginationRow } = require("../../../views/osuViewHelpers.js");

async function run(messages, args) {
    const { message, res } = messages;

    // Parseamos args
    const parser_res = await argsParser(args, {
        "message": message,
        "res": res,
        "command_function": getUserRecentScores,
        "ignoreBeatmap": true
    });

    if (typeof parser_res.fn_response === 'string') return parser_res.fn_response;
    
    const filterPass = parser_res.parsed_args.filterPass;
    if (filterPass && Array.isArray(parser_res.fn_response)) {
        parser_res.fn_response = parser_res.fn_response.filter(score => score.passed);
    }
    
    if (!Array.isArray(parser_res.fn_response) || parser_res.fn_response.length === 0) {
        return filterPass ? `No tienes scores recientes que no sean fallidas.` : `Pero si no has jugado nada`;
    }

    if (parser_res.parsed_args.bestSort && Array.isArray(parser_res.fn_response) && parser_res.fn_response.length > 0) {
        let loading_msg;
        try {
            loading_msg = await message.channel.send("⏳ Obteniendo mapas y calculando PP de las jugadas recientes para ordenar...");
        } catch (e) {
            console.error("Error al enviar mensaje temporal en rs -b:", e);
        }

        for (let i = 0; i < parser_res.fn_response.length; i++) {
            const score = parser_res.fn_response[i];
            if (score.pp !== null && score.pp !== undefined) {
                score.calculatedPP = score.pp;
                continue;
            }
            try {
                const beatmap = await getBeatmap(score.beatmap.id);
                const map = await getBeatmap_osu(score.beatmap.beatmapset_id, score.beatmap.id, beatmap);
                const maxAttrs = calculatePP(score, map, "maximo_pp");
                const user_pp = calculatePP(score, map, null, maxAttrs).pp;
                score.calculatedPP = user_pp || 0;
                map.free();
            } catch (err) {
                console.error(`Error calculando PP para score en map ${score.beatmap.id}:`, err);
                score.calculatedPP = 0;
            }
        }

        // Ordenar por PP de mayor a menor
        parser_res.fn_response.sort((a, b) => {
            const ppA = a.calculatedPP !== undefined ? a.calculatedPP : (a.pp || 0);
            const ppB = b.calculatedPP !== undefined ? b.calculatedPP : (b.pp || 0);
            return ppB - ppA;
        });

        if (loading_msg && typeof loading_msg.delete === 'function') {
            const isMocked = message.channel.send.toString().includes("editReply");
            if (!isMocked) {
                try {
                    await loading_msg.delete();
                } catch {}
            }
        }
    }

    const total_plays = parser_res.fn_response.length;

    // Interceptamos si se activa el modo de lista (-l)
    if (parser_res.parsed_args.listMode) {
        let startIndex = 0;
        const initialListEmbed = await doOsuListEmbed(message, parser_res.parsed_args, parser_res.fn_response.slice(startIndex, startIndex + 5), startIndex, total_plays);

        const getListButtonsRow = (start, total) => {
            return buildPaginationRow({ prefix: 'rsl', current: start, total, pageSize: 5 });
        };

        const sent_message = await message.channel.send({
            embeds: [initialListEmbed],
            components: [getListButtonsRow(startIndex, total_plays)]
        });

        // Función para procesar secuencialmente el chunk en segundo plano y actualizar UX
        const processChunk = async (msg_obj, start) => {
            const chunk = parser_res.fn_response.slice(start, start + 5);
            
            for (let i = 0; i < chunk.length; i++) {
                const score = chunk[i];
                const globalIndex = start + i + 1;

                if (score.calculatedPP !== undefined) continue;

                // Actualizar footer para la play actual si seguimos en la misma página
                if (start === startIndex) {
                    const tempEmbed = await doOsuListEmbed(message, parser_res.parsed_args, chunk, start, total_plays, globalIndex);
                    try {
                        await msg_obj.edit({ embeds: [tempEmbed] });
                    } catch {}
                }

                const stats = score.statistics || {};
                const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
                const ok = stats.ok !== undefined ? stats.ok : (stats.count_100 || 0);
                const meh = stats.meh !== undefined ? stats.meh : (stats.count_50 || 0);
                const miss = stats.miss !== undefined ? stats.miss : (stats.count_miss || 0);
                const perfect = stats.perfect !== undefined ? stats.perfect : (stats.count_geki || 0);
                const good = stats.good !== undefined ? stats.good : (stats.count_katu || 0);
                const total_hits = great + ok + meh + miss;
                let ppVal = score.pp;
                let starsVal = score.beatmap.difficulty_rating;
                let passPercent = 0;

                try {
                    const beatmap = await getBeatmap(score.beatmap.id);
                    const map = await getBeatmap_osu(score.beatmap.beatmapset_id, score.beatmap.id, beatmap);
                    const maxAttrs = calculatePP(score, map, "maximo_pp");
                    
                    if (!ppVal) {
                        ppVal = calculatePP(score, map, null, maxAttrs).pp;
                    }

                    if (map.nObjects > 0) {
                        passPercent = (total_hits / map.nObjects * 100);
                    }

                    if (maxAttrs && maxAttrs.difficulty && maxAttrs.difficulty.stars !== undefined) {
                        starsVal = maxAttrs.difficulty.stars;
                    }
                    
                    if (globalIndex === 1) {
                        const beatmap_max_combo = beatmap.max_combo || (maxAttrs && maxAttrs.difficulty ? maxAttrs.difficulty.maxCombo : 0);
                        const pre_calculated = {
                            "map": map,
                            "map_completion": score.passed ? 100 : total_hits / map.nObjects,
                            "maxAttrs": maxAttrs,
                            "pp": ppVal,
                            "beatmap_max_combo": beatmap_max_combo
                        };
                        saveUserscore(score, pre_calculated, true).catch(err => console.error("❌ [List-Save] Error al guardar score en segundo plano:", err));
                    }
                    
                    map.free();
                } catch (err) {
                    console.error(`Error al procesar PP de #${globalIndex}:`, err);
                }

                score.calculatedPP = ppVal || 0;
                score.calculatedStars = starsVal;
                score.calculatedPassPercent = passPercent;
            }

            // Renderizado final
            if (start === startIndex) {
                const finalEmbed = await doOsuListEmbed(message, parser_res.parsed_args, chunk, start, total_plays, null);
                try {
                    await msg_obj.edit({ embeds: [finalEmbed] });
                } catch {}
            }
        };

        // Iniciamos el cálculo en background para la primera página
        processChunk(sent_message, startIndex);

        const filter = btnInt => btnInt.user.id === message.author.id;
        const collector = sent_message.createMessageComponentCollector({
            filter,
            idle: 30000
        });

        collector.on('collect', async i => {
            try {
                await i.deferUpdate();

                if (i.customId === 'rsl_first') {
                    startIndex = 0;
                } else if (i.customId === 'rsl_prev') {
                    startIndex = Math.max(0, startIndex - 5);
                } else if (i.customId === 'rsl_next') {
                    startIndex = startIndex + 5;
                } else if (i.customId === 'rsl_last') {
                    startIndex = Math.floor((total_plays - 1) / 5) * 5;
                }

                const chunk = parser_res.fn_response.slice(startIndex, startIndex + 5);
                const embed = await doOsuListEmbed(message, parser_res.parsed_args, chunk, startIndex, total_plays);

                await i.editReply({
                    embeds: [embed],
                    components: [getListButtonsRow(startIndex, total_plays)]
                });

                // Lanzar procesamiento en background para la nueva página seleccionada
                processChunk(sent_message, startIndex);
            } catch (err) {
                console.error("Error al navegar la lista de scores recientes:", err);
            }
        });

        collector.on('end', async () => {
            try {
                await sent_message.edit({ components: [] });
            } catch {}
        });

        // Iniciar precargas en segundo plano para el mapa más reciente de la lista
        try {
            const targetScore = parser_res.fn_response[0];
            if (targetScore && targetScore.beatmap) {
                const { setChannelRecentPlayType } = require("../../utils/channelPlayCache.js");
                const isLazer = targetScore.build_id !== null && targetScore.build_id !== undefined;
                setChannelRecentPlayType(message.channel.id, targetScore.beatmap.id, isLazer);
                triggerBackgroundRecentPreload(message, targetScore, parser_res.parsed_args);
            }
        } catch (err) {
            console.error("[BG-PRELOAD] Error al disparar las precargas en segundo plano (lista):", err);
        }

        return;
    }
    let index = parser_res.parsed_args.index || 1;
    let content_msg = '';

    if (index > total_plays) {
        content_msg = `⚠️ Solo se encontraron **${total_plays}** jugadas recientes. Mostrando la última (#${total_plays}):`;
        index = total_plays;
    } else if (index < 1) {
        content_msg = `⚠️ Índice inválido. Mostrando la más reciente (#1):`;
        index = 1;
    } else {
        content_msg = `Mostrando la jugada **#${index}** de **${total_plays}** recientes:`;
    }

    // Función auxiliar para procesar y construir el embed de un score determinado
    async function processScore(scoreIndex) {
        const recent_scores = parser_res.fn_response[scoreIndex - 1];
        const isLazer = recent_scores.build_id !== null && recent_scores.build_id !== undefined;
        const { setChannelRecentPlayType } = require("../../utils/channelPlayCache.js");
        setChannelRecentPlayType(message.channel.id, recent_scores.beatmap.id, isLazer);

        const stats = recent_scores.statistics || {};
        const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
        const ok = stats.ok !== undefined ? stats.ok : (stats.count_100 || 0);
        const meh = stats.meh !== undefined ? stats.meh : (stats.count_50 || 0);
        const miss = stats.miss !== undefined ? stats.miss : (stats.count_miss || 0);
        const total_hits = great + ok + meh + miss;
        const beatmap = await getBeatmap(recent_scores.beatmap.id);
        const map = await getBeatmap_osu(recent_scores.beatmap.beatmapset_id, recent_scores.beatmap.id, beatmap);
        const maxAttrs = calculatePP(recent_scores, map, "maximo_pp");

        const user_pp = recent_scores.pp ? recent_scores.pp : calculatePP(recent_scores, map, null, maxAttrs).pp;
        const beatmap_max_combo = beatmap.max_combo || (maxAttrs && maxAttrs.difficulty ? maxAttrs.difficulty.maxCombo : 0);

        let pp_fc = null;
        const isFC = recent_scores.perfect || (miss === 0 && recent_scores.max_combo >= beatmap_max_combo - 2);
        if (!isFC) {
            try {
                const fc_statistics = {
                    ...recent_scores.statistics,
                    great: (recent_scores.statistics.great || 0) + miss,
                    miss: 0
                };
                const fc_score = {
                    ...recent_scores,
                    max_combo: beatmap_max_combo,
                    statistics: fc_statistics
                };
                pp_fc = calculatePP(fc_score, map, null, maxAttrs).pp;
            } catch (err) {
                console.error("Error calculating pp_fc:", err);
            }
        }

        const pre_calculated = {
            "map": map,
            "map_completion": recent_scores.passed ? 100 : total_hits / map.nObjects,
            "maxAttrs": maxAttrs,
            "pp": user_pp,
            "beatmap_max_combo": beatmap_max_combo,
            "pp_fc": pp_fc
        };

        saveUserscore(recent_scores, pre_calculated, true).catch(err => console.error("❌ [RS-Save] Error al guardar score en segundo plano:", err));
        const embed = await doOsuEmbed(message, recent_scores, pre_calculated);
        map.free();
        return embed;
    }

    // Procesamos la jugada inicial
    const initialEmbed = await processScore(index);

    const getButtonsRow = (curr, max) => {
        return buildPaginationRow({ prefix: 'rs', current: curr, total: max, oneIndexed: true });
    };

    const sent_message = await message.channel.send({
        content: content_msg,
        embeds: [initialEmbed],
        components: [getButtonsRow(index, total_plays)]
    });

    const filter = btnInt => btnInt.user.id === message.author.id;
    const collector = sent_message.createMessageComponentCollector({
        filter,
        idle: 30000 // Timeout de 30 segundos inactivo
    });

    collector.on('collect', async i => {
        try {
            await i.deferUpdate();

            if (i.customId === 'rs_oldest') {
                index = total_plays;
            } else if (i.customId === 'rs_older') {
                index = Math.min(total_plays, index + 1);
            } else if (i.customId === 'rs_newer') {
                index = Math.max(1, index - 1);
            } else if (i.customId === 'rs_newest') {
                index = 1;
            }

            const embed = await processScore(index);
            const content = `Mostrando la jugada **#${index}** de **${total_plays}** recientes:`;

            await i.editReply({
                content: content,
                embeds: [embed],
                components: [getButtonsRow(index, total_plays)]
            });
        } catch (err) {
            console.error("Error al navegar entre scores con botones:", err);
        }
    });

    collector.on('end', async () => {
        try {
            await sent_message.edit({ components: [] });
        } catch (e) {
            // Ignorar si el mensaje original fue borrado
        }
    });

    // Iniciar precargas en segundo plano para el mapa mostrado
    try {
        const targetScore = parser_res.fn_response[index - 1] || parser_res.fn_response[0];
        if (targetScore && targetScore.beatmap) {
            triggerBackgroundRecentPreload(message, targetScore, parser_res.parsed_args);
        }
    } catch (err) {
        console.error("[BG-PRELOAD] Error al disparar las precargas en segundo plano:", err);
    }

    return;
}

run.alias = {
	"rm": {
		"args" : "-mania"
	},
	"rc": {
		"args" : "-ctb"
	}, 
	"rt": {
		"args" : "-taiko"
	}, 
	"recent": {
		"args" : ""
	},
	"r": {
		"args" : ""
	}
}

run.description = 
{
    'header' : 'Obten la play reciente',
    'body' : `Al hacer .rs en un mapa fallido o unranked, accedes a que se guarde en una db local para que luego se pueda usar con el .c y el .gap`,
    'usage' : `s.rs : Obten la play reciente del usuario linkeado al bot.\ns.rs -b : Ordena los recientes por PP y muestra la mejor play.\ns.rs 'usuario' : Obtiene del usuario en el argumento\ns.rs 'usuario' 'modo': Obtiene del usuario en el argumento con respecto al modo de juego.`
}

module.exports = { run, "description": run.description}