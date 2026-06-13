const { getBeatmap_osu, getUserRecentScores, getUserTopScores, getBeatmapUserAllScores, getUnrankedBeatmapUserAllScores, getBeatmap, calculatePP, saveUserscore } = require("../../utils/osu.js");
const { doOsuEmbed, doOsuCompareSingleEmbed, doOsuTopSingleEmbed } = require("../../../views/osuEmbeds.js");
const { buildRecentButtonsRow, buildCompareSingleButtonsRow, buildPaginationRow, formatMods } = require("../../../views/osuViewHelpers.js");
const { t } = require("../../../utils/i18n.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");

async function run(messages, args, forcedMode = 'lazer') {
    const { message } = messages;
    const locale = message.locale || 'es';

    // Buscar el mensaje al que se responde o el más reciente en el canal que tenga embeds
    let targetMsg = null;
    if (message.reference && message.reference.messageId) {
        try {
            targetMsg = await message.channel.messages.fetch(message.reference.messageId);
        } catch (err) {
            console.error("Error fetching referenced message:", err);
        }
    } else {
        try {
            const msgs = await message.channel.messages.fetch({ limit: 15 });
            targetMsg = msgs.find(msg => 
                msg.embeds && msg.embeds.length > 0 && 
                msg.embeds[0].author && msg.embeds[0].author.url && 
                (msg.embeds[0].author.url.includes('/users/') || msg.embeds[0].author.url.includes('/u/')) && 
                msg.embeds[0].url && 
                (msg.embeds[0].url.includes('/b/') || msg.embeds[0].url.includes('/beatmaps/'))
            );
        } catch (err) {
            console.error("Error fetching channel messages for automatic target:", err);
        }
    }

    if (!targetMsg || !targetMsg.embeds || targetMsg.embeds.length === 0) {
        return t(locale, 'recent.lazer_no_target_embed') || "❌ Responde a un embed de jugada válido de Sengo o asegúrate de que haya uno reciente en el canal.";
    }

    const embed = targetMsg.embeds[0];
    const authorUrl = embed.author?.url || '';
    const titleUrl = embed.url || '';
    const userMatch = authorUrl.match(/users?\/(\d+)/) || authorUrl.match(/u\/(\d+)/);
    const beatmapMatch = titleUrl.match(/b(eatmaps)?\/(\d+)/);

    if (!userMatch || !beatmapMatch) {
        return t(locale, 'recent.lazer_err_parsing') || "❌ No se pudo extraer la información del jugador o el mapa del embed.";
    }

    const isList = embed.description && (embed.description.includes('**#1**') || embed.description.includes('**#2**') || embed.description.includes('**#3**') || embed.description.includes('➔'));
    if (isList) {
        return "❌ Este comando solo se puede usar respondiendo a una jugada individual (no a una lista).";
    }

    const userId = userMatch[1];
    const beatmapId = beatmapMatch[2];
    const server = authorUrl.includes('gatari') ? 'gatari' : 'bancho';

    let beatmap;
    try {
        beatmap = await getBeatmap(beatmapId);
    } catch (err) {
        console.error("Error al cargar beatmap en lazer:", err);
        return "❌ Error al cargar los detalles del mapa.";
    }
    const gamemode = beatmap.mode || 'osu';

    const indexMatch = targetMsg.content ? targetMsg.content.match(/\*\*#(\d+)\*\*/) : null;
    let index = indexMatch ? parseInt(indexMatch[1], 10) : 1;

    let type = 'recent';
    const msgContent = targetMsg.content || '';
    const embedFooter = (embed.footer && embed.footer.text) || '';
    if (msgContent.includes('comparadas') || msgContent.includes('compared') || embedFooter.includes('compared') || embedFooter.includes('comparación')) {
        type = 'compare';
    } else if (msgContent.includes('Top de PP') || msgContent.includes('PP Top') || embedFooter.includes('PP Top') || embedFooter.includes('Top de PP')) {
        type = 'top';
    }

    let scores = [];
    if (type === 'recent') {
        scores = await getUserRecentScores({ username: [userId], gamemode: gamemode, server: server });
    } else if (type === 'top') {
        scores = await getUserTopScores({ username: [userId], gamemode: gamemode, server: server });
    } else {
        const unranked_statuses = new Set(['pending', 'graveyard', 'wip']);
        const fn = unranked_statuses.has(beatmap.status) ? getUnrankedBeatmapUserAllScores : getBeatmapUserAllScores;
        scores = await fn({ username: [userId], beatmap_url: beatmapId, gamemode: gamemode, server: server });
    }

    if (!scores || scores.length === 0) {
        return "❌ No se encontraron puntuaciones para renderizar.";
    }

    let total_plays = scores.length;
    if (index > total_plays) index = total_plays;
    if (index < 1) index = 1;

    let currentScoreMode = forcedMode;

    // Helper to process a score at index
    async function processScore(scoreIndex) {
        const score = scores[scoreIndex - 1];
        if (!score.user) {
            score.user = {
                username: embed.author.name ? embed.author.name.split(':')[0].trim() : 'Usuario',
                id: userId,
                avatar_url: embed.author.iconURL || `https://a.ppy.sh/${userId}`,
                server: server
            };
        }

        const stats = score.statistics || {};
        const great = stats.great !== undefined ? stats.great : (stats.count_300 || 0);
        const ok = stats.ok !== undefined ? stats.ok : (stats.count_100 || 0);
        const meh = stats.meh !== undefined ? stats.meh : (stats.count_50 || 0);
        const miss = stats.miss !== undefined ? stats.miss : (stats.count_miss || 0);
        const total_hits = great + ok + meh + miss;

        const map = await getBeatmap_osu(score.beatmap.beatmapset_id || beatmap.beatmapset_id, score.beatmap.id || beatmap.id, beatmap);
        const maxAttrs = calculatePP(score, map, "maximo_pp");

        const user_pp = score.pp ? score.pp : calculatePP(score, map, null, maxAttrs).pp;
        const beatmap_max_combo = beatmap.max_combo || (maxAttrs && maxAttrs.difficulty ? maxAttrs.difficulty.maxCombo : 0);

        let pp_fc = null;
        const isFC = score.perfect || (miss === 0 && score.max_combo >= beatmap_max_combo - 2);
        if (!isFC) {
            try {
                const fc_statistics = {
                    ...score.statistics,
                    great: (score.statistics.great || 0) + miss,
                    miss: 0
                };
                const fc_score = {
                    ...score,
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
            "map_completion": score.passed ? 100 : total_hits / map.nObjects,
            "maxAttrs": maxAttrs,
            "pp": user_pp,
            "beatmap_max_combo": beatmap_max_combo,
            "pp_fc": pp_fc
        };

        if (type === 'recent') {
            saveUserscore(score, pre_calculated, true).catch(err => console.error("❌ Error al guardar score en bd:", err));
        }

        let resultEmbed;
        if (type === 'recent') {
            resultEmbed = await doOsuEmbed(message, score, pre_calculated, locale, currentScoreMode);
        } else if (type === 'top') {
            resultEmbed = await doOsuTopSingleEmbed(message, score, pre_calculated, scoreIndex, total_plays, { gamemode: gamemode }, 0, locale, currentScoreMode);
        } else {
            resultEmbed = await doOsuCompareSingleEmbed(message, score, pre_calculated, scoreIndex, total_plays, { username: [score.user.username] }, beatmap, currentScoreMode);
        }

        map.free();
        return { embed: resultEmbed, score };
    }

    const initial = await processScore(index);
    
    const getComponents = (currIndex, scoreObj) => {
        if (type === 'recent') {
            return [buildRecentButtonsRow(currIndex, total_plays, scoreObj, false, currentScoreMode)];
        } else if (type === 'top') {
            return [buildPaginationRow({
                prefix: 'top',
                current: currIndex,
                total: total_plays,
                oneIndexed: true,
                customSuffixes: { first: 'first', prev: 'prev', next: 'next', last: 'last' }
            })];
        } else {
            return [buildCompareSingleButtonsRow(currIndex, total_plays, scoreObj, false, currentScoreMode)];
        }
    };

    const contentLabel = type === 'recent' ? 'recent.showing_index' : (type === 'top' ? 'top.showing_score_index' : 'compare.showing_score_index');
    let contentMsg = t(locale, contentLabel, { index, total: total_plays });

    const sent_message = await message.channel.send({
        content: contentMsg,
        embeds: [initial.embed],
        components: getComponents(index, initial.score)
    });

    const filter = btnInt => btnInt.user.id === message.author.id;
    const collector = sent_message.createMessageComponentCollector({
        filter,
        idle: 30000
    });

    collector.on('collect', async i => {
        try {
            if (i.customId === 'rs_render' || i.customId === 'c_single_render') {
                let infoMsg;
                try {
                    infoMsg = await message.channel.send("⏳ **Descargando replay y preparando renderizado...**");
                } catch (e) {
                    console.error("Error al enviar mensaje temporal en render:", e);
                }

                try {
                    const currentScore = scores[index - 1];
                    const fs = require('fs');
                    let token = null;
                    try {
                        const tokenData = JSON.parse(fs.readFileSync('./osu_api_extended_token.json', 'utf8'));
                        token = tokenData.access_token;
                    } catch (err) {
                        console.error("Error al leer token:", err);
                    }

                    if (!token) {
                        throw new Error("No token available");
                    }

                    const scoreId = currentScore.id;
                    const url = `https://osu.ppy.sh/api/v2/scores/${scoreId}/download`;
                    
                    const downloadRes = await fetch(url, {
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    });

                    if (!downloadRes.ok) {
                        throw new Error(`osu! API returned ${downloadRes.status}`);
                    }

                    const replayBuffer = await downloadRes.buffer();
                    const renderCmd = require('./render.js');
                    const mockMessages = {
                        message: {
                            author: i.user,
                            locale: locale,
                            channel: {
                                send: async (options) => {
                                    try { await infoMsg.delete(); } catch {}
                                    return await i.channel.send(options);
                                },
                                sendTyping: async () => {}
                            }
                        }
                    };

                    let beatmapInfo = null;
                    try {
                        beatmapInfo = await getBeatmap(currentScore.beatmap.id);
                    } catch (err) {
                        console.warn("[render] No se pudo obtener metadatos adicionales del beatmap:", err.message);
                    }

                    const username = currentScore.user?.username || 'Usuario';
                    const artist = currentScore.beatmapset?.artist || beatmapInfo?.beatmapset?.artist || '';
                    const title = currentScore.beatmapset?.title || beatmapInfo?.beatmapset?.title || '';
                    const version = currentScore.beatmap?.version || beatmapInfo?.version || '';
                    const stars = (currentScore.beatmap?.difficulty_rating || beatmapInfo?.difficulty_rating)
                        ? ` (${(currentScore.beatmap?.difficulty_rating || beatmapInfo?.difficulty_rating).toFixed(2)}★)`
                        : '';
                    const modsString = currentScore.mods && currentScore.mods.length > 0 ? ` +${formatMods(currentScore.mods)}` : '';
                    const accuracy = currentScore.accuracy ? ` | Accuracy: ${(currentScore.accuracy * 100).toFixed(2)}%` : '';
                    const customDescription = `${username} on ${artist} - ${title} [${version}]${stars}${modsString}${accuracy}`;

                    await renderCmd.startRenderFlow(
                        mockMessages,
                        replayBuffer,
                        `recent_${scoreId}.osr`,
                        { skin: 'default', resolution: '1280x720', skinSpecified: false, customDescription },
                        locale
                    );
                } catch (err) {
                    console.error("Error al descargar/renderizar:", err);
                    if (infoMsg) {
                        await infoMsg.edit(`❌ **Error:** No se pudo obtener el replay para esta jugada desde los servidores de osu! (es común para jugadas que no son del Top 100 del mapa o si son muy antiguas/fallidas).`);
                    }
                }
                return;
            }

            await i.deferUpdate();

            if (i.customId.startsWith('rs_toggle_score_') || i.customId.startsWith('c_single_toggle_score_')) {
                currentScoreMode = currentScoreMode === 'classic' ? 'lazer' : 'classic';
                await OsuUserModel.setPreferredScoreMode(message.author.id, currentScoreMode);
            } else if (i.customId === 'rs_oldest' || i.customId === 'c_single_last' || i.customId === 'top_last') {
                index = total_plays;
            } else if (i.customId === 'rs_older' || i.customId === 'c_single_next' || i.customId === 'top_next') {
                index = Math.min(total_plays, index + 1);
            } else if (i.customId === 'rs_newer' || i.customId === 'c_single_prev' || i.customId === 'top_prev') {
                index = Math.max(1, index - 1);
            } else if (i.customId === 'rs_newest' || i.customId === 'c_single_first' || i.customId === 'top_first') {
                index = 1;
            }

            const processed = await processScore(index);
            contentMsg = t(locale, contentLabel, { index, total: total_plays });

            await i.editReply({
                content: contentMsg,
                embeds: [processed.embed],
                components: getComponents(index, processed.score)
            });
        } catch (err) {
            console.error("Error al navegar score en lazer/classic cmd:", err);
        }
    });

    collector.on('end', async () => {
        try {
            await sent_message.edit({ components: [] });
        } catch {}
    });
}

run.description = {
    header: "Muestra la jugada referenciada en formato lazer (Lazer Score)",
    body: "Permite cambiar el embed de una jugada a puntuación estandarizada de osu! (1 millón de score máximo por defecto en lazer, vs clásico).",
    usage: "s.lazer (como respuesta a un embed de jugada)"
};

module.exports = { run, description: run.description };
