const { getBeatmap_osu, saveUserscore, getUserRecentScores, argsParser, getBeatmap, calculatePP } = require("../../utils/osu.js");
const { colorear } = require("../../utils/admin.js");

const { EmbedBuilder } = require("discord.js");
const axios = require('axios').default;
const fs = require('fs');
const path = require('path');
const rosu = require("rosu-pp-js");



async function doOsuEmbed(message, recent_scores, pre_calculated){
	const username = recent_scores.user.username;
	const user_url = recent_scores.user.server === 'gatari' ? `https://osu.gatari.pw/u/${recent_scores.user.id}` : `https://osu.ppy.sh/users/${recent_scores.user.id}`;
	const avatar_url = recent_scores.user.avatar_url;

	const song_title = recent_scores.beatmapset.title;

	const beatmap_difficulty = recent_scores.beatmap.version;
	const beatmap_url = `https://osu.ppy.sh/b/${recent_scores.beatmap.id}`;
	const beatmap_cover = recent_scores.beatmapset.covers["cover@2x"];

	// Asegurar que si no es en lazer (!isLazer), se le agregue el mod CL si no lo tiene
	const isLazer = recent_scores.build_id !== null && recent_scores.build_id !== undefined;
	if (!isLazer && recent_scores.mods) {
		const hasCL = recent_scores.mods.some(m => (m.acronym || m) === 'CL');
		if (!hasCL) {
			const isObjectMod = recent_scores.mods.length > 0 && typeof recent_scores.mods[0] === 'object';
			if (isObjectMod) {
				recent_scores.mods.push({ acronym: 'CL' });
			} else {
				recent_scores.mods.push('CL');
			}
		}
	}

	const raw_score = (recent_scores.legacy_total_score && recent_scores.legacy_total_score > 0) ? recent_scores.legacy_total_score :
	                  (recent_scores.classic_total_score && recent_scores.classic_total_score > 0) ? recent_scores.classic_total_score :
	                  recent_scores.total_score || recent_scores.score || 0;
	const score = raw_score.toLocaleString('es-ES');
	
	const accuracy = (recent_scores.accuracy * 100).toFixed(2);
	const user_max_combo = recent_scores.max_combo;

	const beatmap_max_combo = pre_calculated.beatmap_max_combo;

	const user_pp = `${pre_calculated.pp.toFixed(2)}`

	const difficulty = pre_calculated.maxAttrs.difficulty.stars.toFixed(2);

	const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#ffffff';

	const { perfect = 0, great = 0, good = 0, ok = 0, meh = 0, miss = 0 } = recent_scores.statistics;

	const emoji_mods = require("../../../src/emoji_mods.json");
    const emoji_grades = require("../../../src/emoji_grades.json");

	let grade_emoji = emoji_grades[!recent_scores.passed ? "F" : recent_scores.rank];
    	grade_emoji = grade_emoji[0] == "grade_f" ? `:${grade_emoji[1]}:` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`;

	const mods_used = recent_scores.mods.length > 0 ? recent_scores.mods.reduce((acc, mod) => {
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

	const map_completion = recent_scores.passed ? `` : `(${((pre_calculated.map_completion)*100).toFixed(2)}%)`;

	let stats_str = "";
	let ratio_str = "";
	if (recent_scores.beatmap.mode === 'mania') {
		stats_str = `[${colorear(perfect, "cyan")}/${colorear(great, "amarillo")}/${colorear(good, "verde")}/${colorear(ok, "azul")}/${colorear(meh, "magenta")}/${colorear(miss, "rojo")}]`;
		const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
		ratio_str = ` ▸ ${ratio}:1`;
	} else if (recent_scores.beatmap.mode === 'taiko') {
		stats_str = `[${colorear(great, "azul")}/${colorear(ok, "verde")}/${colorear(miss, "rojo")}]`;
	} else {
		stats_str = `[${colorear(great, "azul")}/${colorear(ok, "verde")}/${colorear(meh, "amarillo")}/${colorear(miss, "rojo")}]`;
	}
	let leaderboard_pos = null;
	let user_top_pos = null;
	if (recent_scores.passed) {
		if (recent_scores.user.server !== 'gatari') {
			try {
				const { v2 } = require('osu-api-extended');
				const unrankedWithoutLeaderboard = new Set(['pending', 'wip', 'graveyard']);
				const hasLeaderboard = recent_scores.beatmap.status && !unrankedWithoutLeaderboard.has(recent_scores.beatmap.status);

				const [best, topScores] = await Promise.all([
					hasLeaderboard ? v2.scores.list({
						type: 'user_beatmap_best',
						beatmap_id: recent_scores.beatmap.id,
						user_id: recent_scores.user.id,
						mode: recent_scores.beatmap.mode
					}).catch(() => null) : null,
					v2.scores.list({
						type: 'user_best',
						user_id: recent_scores.user.id,
						mode: recent_scores.beatmap.mode,
						limit: 100
					}).catch(() => null)
				]);

				if (best && best.score) {
					const isRecentPlayBest = (
						new Date(best.score.ended_at).getTime() === new Date(recent_scores.ended_at).getTime() ||
						best.score.total_score === recent_scores.total_score ||
						best.score.legacy_total_score === recent_scores.legacy_total_score ||
						(recent_scores.id && best.score.id === recent_scores.id)
					);
					if (isRecentPlayBest) {
						leaderboard_pos = best.position;
					}
				}

				if (topScores && Array.isArray(topScores)) {
					const topIndex = topScores.findIndex(s => {
						return (recent_scores.id && s.id === recent_scores.id) ||
							(new Date(s.ended_at).getTime() === new Date(recent_scores.ended_at).getTime() &&
							(s.legacy_total_score === recent_scores.legacy_total_score || s.total_score === recent_scores.total_score));
					});
					if (topIndex !== -1) {
						user_top_pos = topIndex + 1;
					}
				}
			} catch (e) {
				console.error("Error fetching beatmap best score position / top scores:", e);
			}
		} else {
			try {
				const modeMap = { 'osu': 0, 'taiko': 1, 'fruits': 2, 'mania': 3 };
				const m = modeMap[recent_scores.beatmap.mode || 'osu'];
				const response = await fetch(`https://api.gatari.pw/user/scores/best?id=${recent_scores.user.id}&mode=${m}&l=100`);
				const data = await response.json();
				if (data && Array.isArray(data.scores)) {
					const topIndex = data.scores.findIndex(s => {
						const recentTime = Math.floor(new Date(recent_scores.ended_at).getTime() / 1000);
						const scoreVal = recent_scores.legacy_total_score || recent_scores.total_score || 0;
						return s.beatmap.beatmap_id === recent_scores.beatmap.id &&
							Math.abs(s.score - scoreVal) < 100 &&
							Math.abs(s.time - recentTime) < 5;
					});
					if (topIndex !== -1) {
						user_top_pos = topIndex + 1;
					}
				}
			} catch (e) {
				console.error("Error fetching gatari best scores:", e);
			}
		}
	}

	let footerText = "SengoBot";
	if (recent_scores.beatmap.mode === 'mania') {
		const ratioVal = great > 0 ? (perfect / great) : null;
		if (ratioVal !== null && ratioVal < 10) {
			footerText = "ratio de virgo";
		}
	}

	// Construccion del embed
	let pp_fc_str = "";
	if (pre_calculated.pp_fc) {
		pp_fc_str = ` ${colorear("if(" + pre_calculated.pp_fc.toFixed(2) + "PP)", "amarillo")}`;
	}

	const embed = new EmbedBuilder()
		.setAuthor({
			name: `Puntuación Reciente de ${username} en ${recent_scores.beatmap.mode}!`,
			url: user_url,
			iconURL: `${avatar_url}`,
		})
		.setTitle(`${song_title} [${beatmap_difficulty}] - ${difficulty + '★'} `)
		.setURL(beatmap_url)
		.setDescription(`**Puntuación**: \`${score}\` **▸** ${grade_emoji} ${map_completion} **▸** ${mods_used}${leaderboard_pos ? ` **▸** 🌐 \`#${leaderboard_pos}\`` : ''}${user_top_pos ? ` **▸** 🏆 \`#${user_top_pos}\`` : ''}
\`\`\`ansi
${stats_str} ${colorear(user_pp + 'PP')}/${pre_calculated.maxAttrs.pp.toFixed(2)}PP${pp_fc_str} ${accuracy}%${ratio_str} x${user_max_combo}/${colorear(beatmap_max_combo)}
\`\`\`
		`)
		.setImage(beatmap_cover)
		.setColor(embedColor)
		.setFooter({
			text: footerText,
			iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
		})
		.setTimestamp(new Date(recent_scores.ended_at));
  
	return embed;
}

async function doOsuListEmbed(message, parsed_args, recent_scores_chunk, startIndex, total_plays, loadingIndex = null) {
    const emoji_mods = require("../../../src/emoji_mods.json");
    const emoji_grades = require("../../../src/emoji_grades.json");

    let embed_description = '';

    for (let i = 0; i < recent_scores_chunk.length; i++) {
        const score = recent_scores_chunk[i];
        const globalIndex = startIndex + i + 1; // 1-indexed for display

        let grade_emoji = emoji_grades[!score.passed ? "F" : score.rank];
        grade_emoji = grade_emoji[0] == "grade_f" ? `:${grade_emoji[1]}:` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`;

        const { perfect = 0, great = 0, good = 0, ok = 0, meh = 0, miss = 0 } = score.statistics;
        const total_hits = great + ok + meh + miss;

        let map_completion = "";
        if (score.calculatedPassPercent !== undefined) {
            if (!score.passed && score.calculatedPassPercent > 0) {
                map_completion = `*(${score.calculatedPassPercent.toFixed(1)}% pass)*`;
            }
        } else if (!score.passed) {
            const count_circles = score.beatmap.count_circles || 0;
            const count_sliders = score.beatmap.count_sliders || 0;
            const count_spinners = score.beatmap.count_spinners || 0;
            const total_objects = count_circles + count_sliders + count_spinners;
            if (total_objects > 0) {
                map_completion = `*(${((score.statistics.great + score.statistics.ok + score.statistics.meh + score.statistics.miss) / total_objects * 100).toFixed(1)}% pass)*`;
            }
        }
        
        // Asegurar que si no es en lazer (!isLazer), se le agregue el mod CL si no lo tiene
        const isLazer = score.build_id !== null && score.build_id !== undefined;
        if (!isLazer && score.mods) {
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

        let raw_legacy_score = (score.legacy_total_score && score.legacy_total_score > 0) ? score.legacy_total_score :
                               (score.classic_total_score && score.classic_total_score > 0) ? score.classic_total_score :
                               score.total_score || score.score || 0;
        let legacy_score = raw_legacy_score.toLocaleString('es-ES');
        let accuracy = (score.accuracy * 100).toFixed(2);
        let max_combo = score.max_combo;

        let stats_str = "";
        let ratio_str = "";
        const gamemode = score.beatmap.mode || parsed_args.gamemode || 'osu';
        if (gamemode === 'mania') {
            stats_str = `\`[${perfect}/${great}/${good}/${ok}/${meh}/${miss}]\``;
            const ratio = great > 0 ? (perfect / great).toFixed(2) : perfect;
            ratio_str = ` ▸ **${ratio}:1**`;
        } else if (gamemode === 'taiko') {
            stats_str = `\`[${great}/${ok}/${miss}]\``;
        } else {
            stats_str = `\`[${great}/${ok}/${meh}/${miss}]\``;
        }

        let ppVal = score.calculatedPP !== undefined ? score.calculatedPP : score.pp;
        let pp = `${ppVal ? ppVal.toFixed(2) + "pp" : "⏳ pp"}`;
        
        let starsVal = score.calculatedStars !== undefined ? score.calculatedStars : score.beatmap.difficulty_rating;
        const stars = starsVal ? `${starsVal.toFixed(2)}★` : "";
        
        let time_set = `<t:${Math.floor((new Date(score.ended_at)).getTime() / 1000)}:R>`;

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

        const map_link = `[${score.beatmapset.title} [${score.beatmap.version}]](https://osu.ppy.sh/b/${score.beatmap.id})`;

        const score_line = `**#${globalIndex}** ▸ ${map_link} +${mods_used} [${stars}]\n` +
            ` ▸ ${grade_emoji} ▸ **${pp}** ▸ **${accuracy}%**${ratio_str} ▸ x${max_combo} ▸ ${stats_str} ▸ ${time_set} ${map_completion != "" ? `▸ ${map_completion}` : ""}\n\n`;

        embed_description = embed_description.concat(score_line);
    }

    const username = recent_scores_chunk[0].user.username;
    const user_url = recent_scores_chunk[0].user.server === 'gatari' ? `https://osu.gatari.pw/u/${recent_scores_chunk[0].user.id}` : `https://osu.ppy.sh/users/${recent_scores_chunk[0].user.id}`;
    const avatar_url = recent_scores_chunk[0].user.avatar_url;

    const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    const embedColor = roleColor !== 0 && roleColor !== undefined ? roleColor : '#ffffff';

    let footerText = `Mostrando jugadas ${startIndex + 1}-${startIndex + recent_scores_chunk.length} de ${total_plays} recientes`;
    if (loadingIndex !== null) {
        footerText = `⏳ Calculando pp de la play #${loadingIndex} de ${total_plays}...`;
    }

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `Puntuaciones recientes de ${username} en osu!${parsed_args.gamemode || 'std'}`,
            url: user_url,
            iconURL: avatar_url
        })
        .setDescription(embed_description)
        .setColor(embedColor)
        .setFooter({
            text: footerText,
            iconURL: "https://jeiden.s-ul.eu/3ssHl9Gd",
        })
        .setTimestamp();

    return embed;
}

async function run(messages, args) {
    const { message, res } = messages;

    // Parseamos args
    const parser_res = await argsParser(args, {
        "message": message,
        "res": res,
        "command_function": getUserRecentScores
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
                } catch (e) {}
            }
        }
    }

    const total_plays = parser_res.fn_response.length;

    // Interceptamos si se activa el modo de lista (-l)
    if (parser_res.parsed_args.listMode) {
        let startIndex = 0;
        const initialListEmbed = await doOsuListEmbed(message, parser_res.parsed_args, parser_res.fn_response.slice(startIndex, startIndex + 5), startIndex, total_plays);

        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

        const getListButtonsRow = (start, total) => {
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('rsl_first')
                    .setLabel('<<')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(start <= 0),
                new ButtonBuilder()
                    .setCustomId('rsl_prev')
                    .setLabel('<')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(start <= 0),
                new ButtonBuilder()
                    .setCustomId('rsl_next')
                    .setLabel('>')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(start + 5 >= total),
                new ButtonBuilder()
                    .setCustomId('rsl_last')
                    .setLabel('>>')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(start + 5 >= total)
            );
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
                    } catch (e) {}
                }

                const { perfect = 0, great = 0, good = 0, ok = 0, meh = 0, miss = 0 } = score.statistics;
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
                        await saveUserscore(score, pre_calculated);
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
                } catch (e) {}
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
            } catch (e) {}
        });

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
        const { great = 0, ok = 0, meh = 0, miss = 0 } = recent_scores.statistics;
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

        await saveUserscore(recent_scores, pre_calculated);
        const embed = await doOsuEmbed(message, recent_scores, pre_calculated);
        map.free();
        return embed;
    }

    // Procesamos la jugada inicial
    const initialEmbed = await processScore(index);

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

    const getButtonsRow = (curr, max) => {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('rs_newest')
                .setLabel('<<')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(curr <= 1),
            new ButtonBuilder()
                .setCustomId('rs_newer')
                .setLabel('<')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(curr <= 1),
            new ButtonBuilder()
                .setCustomId('rs_older')
                .setLabel('>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(curr >= max),
            new ButtonBuilder()
                .setCustomId('rs_oldest')
                .setLabel('>>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(curr >= max)
        );
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