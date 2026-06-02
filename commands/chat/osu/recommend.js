const { argsParser, getUserTopScores, getBeatmapUserScore } = require("../../utils/osu.js");
const { doOsuRecommendEmbed, buildRecommendButtonsRow } = require("../../../views/recommendViews.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");
const RecommendationModel = require("../../../models/RecommendationModel.js");
const { EmbedBuilder } = require("discord.js");
const { t } = require("../../../utils/i18n.js");

const recommendCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutos
const scoreCheckCache = new Map();

function getModAcronyms(modsBitmask) {
    const bitVal = parseInt(modsBitmask, 10);
    if (isNaN(bitVal) || bitVal === 0) return "NoMod";

    const ModList = [
        { bit: 1, acronym: 'NF' },
        { bit: 2, acronym: 'EZ' },
        { bit: 8, acronym: 'HD' },
        { bit: 16, acronym: 'HR' },
        { bit: 32, acronym: 'SD' },
        { bit: 64, acronym: 'DT' },
        { bit: 128, acronym: 'RX' },
        { bit: 256, acronym: 'HT' },
        { bit: 512, acronym: 'NC' },
        { bit: 1024, acronym: 'FL' },
        { bit: 4096, acronym: 'SO' },
        { bit: 16384, acronym: 'PF' }
    ];
    let mods = [];
    for (let mod of ModList) {
        if ((bitVal & mod.bit) === mod.bit) {
            if (mod.acronym === 'NC') mods = mods.filter(m => m !== 'DT');
            if (mod.acronym === 'PF') mods = mods.filter(m => m !== 'SD');
            mods.push(mod.acronym);
        }
    }
    return mods.length > 0 ? mods.join("") : "NoMod";
}

async function checkHasScore(beatmapId, userId, gamemode = 'osu', top100Ids = null) {
    const idStr = beatmapId.toString();
    if (top100Ids && top100Ids.has(idStr)) {
        return true;
    }

    const cacheKey = `${userId}:${idStr}:${gamemode}`;
    const cached = scoreCheckCache.get(cacheKey);
    if (cached) {
        if (cached.hasScore || (Date.now() - cached.timestamp < 60 * 60 * 1000)) {
            return cached.hasScore;
        }
    }

    try {
        const score = await getBeatmapUserScore({
            beatmap_url: idStr,
            username: [userId],
            gamemode: gamemode
        });
        const hasScore = score !== null && score !== undefined;
        scoreCheckCache.set(cacheKey, {
            hasScore,
            timestamp: Date.now()
        });
        return hasScore;
    } catch {
        return false;
    }
}

function selectRecommendedFromTier(tier) {
    if (!tier || tier.length === 0) return null;
    
    // Encontrar el elemento con la afinidad máxima
    const best = tier.reduce((max, current) => current.matchScore > max.matchScore ? current : max, tier[0]);
    const maxScore = best.matchScore;

    // 40% de probabilidad de tomar uno con 10% a 50% menos de afinidad
    if (Math.random() < 0.40) {
        const minTarget = maxScore * 0.50;
        const maxTarget = maxScore * 0.90;
        const choices = tier.filter(x => x.matchScore >= minTarget && x.matchScore <= maxTarget);
        if (choices.length > 0) {
            const chosen = choices[Math.floor(Math.random() * choices.length)];
            if (chosen !== best) {
                chosen.isRandomAffinity = true;
            }
            return chosen;
        }
    }
    return best;
}

async function preloadDefaultRecommendation(osuUserId, username, avatarUrl, res, gamemode = 'osu') {
    try {
        const gamemodeKey = gamemode || 'osu';
        if (gamemodeKey !== 'osu') return;
        const cacheKey = `${osuUserId}:${gamemodeKey}`;
        const existing = recommendCache.get(cacheKey);
        if (existing && (Date.now() - existing.timestamp < CACHE_TTL)) {
            return;
        }

        const topScores = await getUserTopScores({
            username: [osuUserId],
            gamemode: gamemodeKey,
            limit: 100
        });

        if (!Array.isArray(topScores) || topScores.length === 0) return;

        const profile = {
            id: osuUserId,
            username: username || topScores[0].user.username,
            avatar_url: avatarUrl || topScores[0].user.avatar_url
        };

        const userProfile = await RecommendationModel.buildUserProfileAsync(topScores);
        if (!userProfile) return;

        const top15 = topScores.slice(0, 15);
        let totalPP = 0;
        top15.forEach(score => {
            totalPP += score.pp;
        });
        const averagePP = totalPP / top15.length;

        // 35% de probabilidad de recomendar en rango de -5% a +20%
        let minPP, maxPP;
        if (Math.random() < 0.35) {
            minPP = averagePP * 0.95;
            maxPP = averagePP * 1.20;
        } else {
            minPP = averagePP * 0.90;
            maxPP = averagePP * 1.10;
        }

        const candidates = await RecommendationModel.getPersonalizedRecommendations({
            topScores,
            customMinPP: minPP,
            customMaxPP: maxPP,
            customMods: null, // Permitir 80/20 mod selection
            style: 'standard',
            showPlayed: false
        });

        const filteredCandidates = [];
        const seenBeatmapsets = new Set();
        for (const candidate of candidates) {
            if (filteredCandidates.length >= 12) break;
            if (seenBeatmapsets.has(candidate.beatmapsetId)) continue;
            seenBeatmapsets.add(candidate.beatmapsetId);
            filteredCandidates.push(candidate);
        }

        let finalRecs = [];
        if (filteredCandidates.length >= 3) {
            const pool = filteredCandidates.slice(0, 12);
            pool.sort((a, b) => b.popularity - a.popularity);
            const N = pool.length;
            const tierSize = Math.floor(N / 3);
            const highTier = pool.slice(0, tierSize);
            const midTier = pool.slice(tierSize, 2 * tierSize);
            const lowTier = pool.slice(2 * tierSize);
            
            const rec1 = selectRecommendedFromTier(highTier);
            const rec2 = selectRecommendedFromTier(midTier);
            const rec3 = selectRecommendedFromTier(lowTier);
            
            if (rec1) finalRecs.push(rec1);
            if (rec2) finalRecs.push(rec2);
            if (rec3) finalRecs.push(rec3);
            
            for (const item of filteredCandidates) {
                if (finalRecs.length >= 3) break;
                if (!finalRecs.some(r => r.beatmapId === item.beatmapId)) {
                    finalRecs.push(item);
                }
            }
            finalRecs.sort((a, b) => b.popularity - a.popularity);
        } else {
            finalRecs = filteredCandidates;
        }

        await RecommendationModel.recalculateExactPP(finalRecs);

        if (finalRecs.length > 0) {
            recommendCache.set(cacheKey, {
                recommendations: finalRecs,
                minPP,
                maxPP,
                suggestedMod: userProfile.preferredMod,
                profile,
                style: 'standard',
                timestamp: Date.now()
            });
        }
    } catch (e) {
        // Silenciar errores en background
    }
}

/**
 * Invalida el caché de recomendaciones si el usuario jugó un mapa que está en su caché.
 * Se ejecuta en segundo plano sin bloquear el flujo del bot.
 * @param {string} osuUserId - ID numérico del usuario de osu!
 * @param {number|string} beatmapId - ID del beatmap jugado recientemente
 * @param {string} [gamemode='osu'] - Modo de juego activo
 */
function invalidateRecCacheIfPlayed(osuUserId, beatmapId, gamemode = 'osu') {
    try {
        const cacheKey = `${osuUserId}:${gamemode}`;
        const cached = recommendCache.get(cacheKey);
        if (!cached || !cached.recommendations) return;

        const playedId = beatmapId.toString();
        const isInCache = cached.recommendations.some(
            rec => rec.beatmapId.toString() === playedId
        );

        if (isInCache) {
            recommendCache.delete(cacheKey);
        }
    } catch {
        // Silenciar errores: esta función es de segundo plano
    }
}

async function run(messages, args) {
    const { message, res, logger, interaction } = messages;
    const locale = message.locale || 'es';
    const isSlash = !!interaction;
    let statusMessage = null;
    let isInitialRun = true;

    async function updateStatus(stepText, consoleText) {
        if (logger) {
            logger.process(consoleText || stepText);
        }
        try {
            const displayMsg = t(locale, 'recommend.msg_thinking', { step: stepText });
            if (isSlash) {
                await interaction.editReply({ content: displayMsg });
            } else {
                if (!statusMessage) {
                    statusMessage = await message.channel.send({ content: displayMsg });
                } else {
                    await statusMessage.edit({ content: displayMsg });
                }
            }
        } catch (err) {
            console.error("Error al actualizar estado de recommend:", err.message);
        }
    }

    // 1. Filtrar los flags personalizados de recommend para que argsParser no se confunda
    let showPlayed = false;
    let customMinPP = null;
    let customMaxPP = null;
    let customMods = null;
    let forceRefresh = false;

    const cleanArgs = [];
    let skipNext = false;
    for (let i = 0; i < args.length; i++) {
        if (skipNext) {
            skipNext = false;
            continue;
        }
        if (args[i] === null || args[i] === undefined || typeof args[i] !== 'string') {
            continue;
        }
        const arg = args[i].trim().toLowerCase();
        if (arg === "-jugados" || arg === "-played") {
            showPlayed = true;
            continue;
        }
        if (arg === "-force" || arg === "-forzar") {
            forceRefresh = true;
            continue;
        }
        if (arg === "-pp" || arg === "-g") {
            if (i + 1 < args.length && typeof args[i + 1] === 'string') {
                const nextVal = args[i + 1].trim();
                const rangeMatch = nextVal.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
                if (rangeMatch) {
                    customMinPP = parseFloat(rangeMatch[1]);
                    customMaxPP = parseFloat(rangeMatch[2]);
                } else {
                    const singlePP = parseFloat(nextVal);
                    if (!isNaN(singlePP)) {
                        customMinPP = singlePP * 0.90;
                        customMaxPP = singlePP * 1.10;
                    }
                }
                skipNext = true;
            }
            continue;
        }
        if (arg === "-mods" || arg === "-m") {
            if (i + 1 < args.length && typeof args[i + 1] === 'string') {
                customMods = args[i + 1].trim().toUpperCase();
                skipNext = true;
            }
            continue;
        }
        cleanArgs.push(args[i]);
    }

    // 2. Parseamos argumentos con argsParser de Sengo
    await updateStatus(t(locale, 'recommend.step_profile'), t(locale, 'recommend.step_profile_log'));
    const parser_res = await argsParser(cleanArgs, {
        "message": message,
        "res": res,
        "command_function": getUserTopScores,
        "resolveUserByIndex": true,
        "ignoreBeatmap": true
    });

    if (typeof parser_res.fn_response === 'string') {
        if (isSlash) {
            await interaction.editReply({ content: parser_res.fn_response });
        } else if (statusMessage) {
            await statusMessage.edit({ content: parser_res.fn_response });
        } else {
            await message.channel.send(parser_res.fn_response);
        }
        return;
    }
    if (!Array.isArray(parser_res.fn_response) || parser_res.fn_response.length === 0) {
        const errorMsg = t(locale, 'recommend.err_no_plays_or_profile');
        if (isSlash) {
            await interaction.editReply({ content: errorMsg });
        } else if (statusMessage) {
            await statusMessage.edit({ content: errorMsg });
        } else {
            await message.channel.send(errorMsg);
        }
        return;
    }

    const topScores = parser_res.fn_response;
    const osuUserId = parser_res.parsed_args.username[0];
    const top100Ids = new Set(topScores.map(score => score.beatmap.id.toString()));

    if (!customMods) {
        if (parser_res.parsed_args.modFilter) {
            customMods = parser_res.parsed_args.modFilter;
        } else if (parser_res.parsed_args.modContainFilter) {
            customMods = parser_res.parsed_args.modContainFilter;
        }
    }

    // Consultar si el usuario que invocó el comando tiene supporter activo
    const linkedUser = await OsuUserModel.getLinkedUser(res.User, message.author.id);
    let hasSupporter = linkedUser ? !!linkedUser.is_supporter : false;

    // Verificar si es una consulta por defecto (sin filtros custom)
    const isDefaultRun = (customMinPP === null && customMaxPP === null && customMods === null && showPlayed === false);

    // Si se usa -force, borrar la caché del usuario antes de continuar
    if (forceRefresh) {
        const forceCacheKey = `${osuUserId}:${parser_res.parsed_args.gamemode || 'osu'}`;
        recommendCache.delete(forceCacheKey);
    }

    let currentRecs = [];
    let minPP;
    let maxPP;
    let activeMods;
    let preferredMod = "NM";
    let suggestedMod;
    let profile;
    let currentStyle = 'standard';

    const activeGamemode = parser_res.parsed_args.gamemode || "osu";
    if (activeGamemode !== "osu") {
        const errorMsg = t(locale, 'recommend.err_only_std');
        if (isSlash) {
            await interaction.editReply({ content: errorMsg });
        } else if (statusMessage) {
            await statusMessage.edit({ content: errorMsg });
        } else {
            await message.channel.send(errorMsg);
        }
        return;
    }
    const cacheKey = `${osuUserId}:${activeGamemode}`;
    const cached = isDefaultRun ? recommendCache.get(cacheKey) : null;

    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        currentRecs = cached.recommendations;
        minPP = cached.minPP;
        maxPP = cached.maxPP;
        activeMods = cached.activeMods || cached.suggestedMod || "NM";
        preferredMod = cached.preferredMod || (cached.suggestedMod === "DT" ? "DT" : "NM");
        suggestedMod = activeMods === "NM" ? (preferredMod === "NM" ? "DT" : preferredMod) : "NM";
        profile = cached.profile;
        currentStyle = cached.style || 'standard';
    } else {
        // Obtener perfil del usuario para mostrar información correcta en el embed
        try {
            await updateStatus(t(locale, 'recommend.step_profile_analyze'), t(locale, 'recommend.step_profile_analyze_log'));
            const { Client } = require('osu-web.js');
            const token = await OsuUserModel.loadToken();
            const client = new Client(token.access_token);
            profile = await client.users.getUser(parseInt(osuUserId), { urlParams: { mode: activeGamemode } });
        } catch {
            profile = {
                id: osuUserId,
                username: topScores[0].user.username,
                avatar_url: topScores[0].user.avatar_url
            };
        }

        const userProfile = await RecommendationModel.buildUserProfileAsync(topScores);
        preferredMod = userProfile.preferredMod || "NM";
        activeMods = customMods || preferredMod;
        suggestedMod = activeMods === "NM" ? (preferredMod === "NM" ? "DT" : preferredMod) : "NM";

        // Calcular rango de PP recomendado
        const top15 = topScores.slice(0, 15);
        let totalPP = 0;
        top15.forEach(score => {
            totalPP += score.pp;
        });
        const averagePP = totalPP / top15.length;

        // 35% de probabilidad de recomendar en rango de -5% a +20%
        if (customMinPP === null) {
            if (Math.random() < 0.35) {
                minPP = averagePP * 0.95;
                maxPP = averagePP * 1.20;
            } else {
                minPP = averagePP * 0.90;
                maxPP = averagePP * 1.10;
            }
        } else {
            minPP = customMinPP;
            maxPP = customMaxPP;
        }

        const skipSetLocal = new Set();

        async function getRecommendations() {
            try {
                if (isInitialRun) {
                    await updateStatus(t(locale, 'recommend.step_query_db'), t(locale, 'recommend.step_query_db_log'));
                }
                const candidates = await RecommendationModel.getPersonalizedRecommendations({
                    topScores,
                    customMinPP: minPP,
                    customMaxPP: maxPP,
                    customMods: customMods,
                    style: currentStyle,
                    showPlayed,
                    skipSet: skipSetLocal
                });

                if (isInitialRun) {
                    await updateStatus(t(locale, 'recommend.step_filter_plays'), t(locale, 'recommend.step_filter_plays_log'));
                }

                const acceptedHigh = [];
                const acceptedMid = [];
                const acceptedLow = [];
                const seenBeatmapsets = new Set();

                for (const candidate of candidates) {
                    if (acceptedHigh.length >= 10 && acceptedMid.length >= 10 && acceptedLow.length >= 10) {
                        break;
                    }
                    if (seenBeatmapsets.has(candidate.beatmapsetId)) continue;

                    const pop = candidate.popularity;
                    if (pop >= 1000000 && acceptedHigh.length >= 10) continue;
                    if (pop >= 150000 && pop < 1000000 && acceptedMid.length >= 10) continue;
                    if (pop < 150000 && acceptedLow.length >= 10) continue;

                    const idStr = candidate.beatmapId.toString();
                    const isCached = scoreCheckCache.has(`${osuUserId}:${idStr}:${activeGamemode}`) || (top100Ids && top100Ids.has(idStr));

                    const hasScore = await checkHasScore(candidate.beatmapId, osuUserId, activeGamemode, top100Ids);
                    let accepted = false;
                    if (showPlayed) {
                        if (hasScore) accepted = true;
                    } else {
                        if (!hasScore) accepted = true;
                    }

                    if (accepted) {
                        seenBeatmapsets.add(candidate.beatmapsetId);
                        if (pop >= 1000000) {
                            acceptedHigh.push(candidate);
                        } else if (pop >= 150000) {
                            acceptedMid.push(candidate);
                        } else {
                            acceptedLow.push(candidate);
                        }
                    }

                    if (!isCached) {
                        await new Promise(resolve => setTimeout(resolve, 80));
                    }
                }

                // Ordenar cada lista por afinidad descendente usando rawScore
                acceptedHigh.sort((a, b) => b.rawScore - a.rawScore);
                acceptedMid.sort((a, b) => b.rawScore - a.rawScore);
                acceptedLow.sort((a, b) => b.rawScore - a.rawScore);

                let finalRecs = [];
                // Intentar tomar la mejor de cada categoría usando selectRecommendedFromTier
                const rec1 = selectRecommendedFromTier(acceptedHigh);
                const rec2 = selectRecommendedFromTier(acceptedMid);
                const rec3 = selectRecommendedFromTier(acceptedLow);
                
                if (rec1) finalRecs.push(rec1);
                if (rec2) finalRecs.push(rec2);
                if (rec3) finalRecs.push(rec3);

                // Si no llegamos a 3, rellenamos con el resto
                if (finalRecs.length < 3) {
                    const remaining = [];
                    const usedIds = new Set(finalRecs.map(r => r.beatmapId));
                    const allRemaining = [
                        ...acceptedHigh,
                        ...acceptedMid,
                        ...acceptedLow
                    ];
                    allRemaining.forEach(c => {
                        if (!usedIds.has(c.beatmapId)) {
                            remaining.push(c);
                        }
                    });
                    remaining.sort((a, b) => b.rawScore - a.rawScore);
                    for (const item of remaining) {
                        if (finalRecs.length >= 3) break;
                        finalRecs.push(item);
                    }
                }

                // Ordenar por popularidad descendente para presentación
                finalRecs.sort((a, b) => b.popularity - a.popularity);

                await RecommendationModel.recalculateExactPP(finalRecs, customMods);
                return finalRecs;
            } catch (err) {
                console.error("Error al obtener recomendaciones de base de datos:", err);
                return [];
            }
        }

        currentRecs = await getRecommendations();

        if (isDefaultRun && currentRecs.length > 0) {
            recommendCache.set(cacheKey, {
                recommendations: currentRecs,
                minPP,
                maxPP,
                activeMods,
                preferredMod,
                suggestedMod: activeMods,
                profile,
                style: currentStyle,
                timestamp: Date.now()
            });
        }
    }

    if (profile && profile.id && linkedUser && profile.id.toString() === linkedUser.osu_id.toString()) {
        const apiSupporter = !!profile.is_supporter;
        if (apiSupporter && !hasSupporter) {
            hasSupporter = true;
            const supabase = res.supabaseClient;
            if (supabase) {
                supabase.from('users')
                    .update({ is_supporter: true })
                    .eq('discord_id', message.author.id)
                    .then(() => {})
                    .catch(() => {});
            }
        }
    }

    const skipSet = new Set();
    currentRecs.forEach(c => {
        skipSet.add(c.beatmapId);
        if (c.beatmapsetId) {
            skipSet.add(c.beatmapsetId.toString());
        }
    });

    let params = { minPP, maxPP, mods: activeMods, showPlayed, hasSupporter, style: currentStyle };
    let embed = doOsuRecommendEmbed(message, profile, currentRecs, params, locale);
    let rows = buildRecommendButtonsRow(params, suggestedMod, currentRecs.length > 0, currentRecs, hasSupporter, locale);

    let sentMessage;
    if (isSlash) {
        sentMessage = await interaction.editReply({
            content: "",
            embeds: [embed],
            components: rows
        });
    } else {
        if (statusMessage) {
            sentMessage = await statusMessage.edit({
                content: "",
                embeds: [embed],
                components: rows
            });
        } else {
            sentMessage = await message.channel.send({
                embeds: [embed],
                components: rows
            });
        }
    }

    isInitialRun = false;

    const collector = sentMessage.createMessageComponentCollector({
        filter: btnInt => btnInt.user.id === message.author.id,
        idle: 120000
    });

    async function getRecommendationsForButtons() {
        try {
            const candidates = await RecommendationModel.getPersonalizedRecommendations({
                topScores,
                customMinPP: minPP,
                customMaxPP: maxPP,
                customMods: customMods,
                style: currentStyle,
                showPlayed,
                skipSet: skipSet
            });

            const acceptedHigh = [];
            const acceptedMid = [];
            const acceptedLow = [];
            const seenBeatmapsets = new Set();

            for (const candidate of candidates) {
                if (acceptedHigh.length >= 10 && acceptedMid.length >= 10 && acceptedLow.length >= 10) {
                    break;
                }
                if (seenBeatmapsets.has(candidate.beatmapsetId)) continue;

                const pop = candidate.popularity;
                if (pop >= 1000000 && acceptedHigh.length >= 10) continue;
                if (pop >= 150000 && pop < 1000000 && acceptedMid.length >= 10) continue;
                if (pop < 150000 && acceptedLow.length >= 10) continue;

                const idStr = candidate.beatmapId.toString();
                const isCached = scoreCheckCache.has(`${osuUserId}:${idStr}:${activeGamemode}`) || (top100Ids && top100Ids.has(idStr));

                const hasScore = await checkHasScore(candidate.beatmapId, osuUserId, activeGamemode, top100Ids);
                let accepted = false;
                if (showPlayed) {
                    if (hasScore) accepted = true;
                } else {
                    if (!hasScore) accepted = true;
                }

                if (accepted) {
                    seenBeatmapsets.add(candidate.beatmapsetId);
                    if (pop >= 1000000) {
                        acceptedHigh.push(candidate);
                    } else if (pop >= 150000) {
                        acceptedMid.push(candidate);
                    } else {
                        acceptedLow.push(candidate);
                    }
                }

                if (!isCached) {
                    await new Promise(resolve => setTimeout(resolve, 80));
                }
            }

            // Ordenar cada lista por afinidad descendente usando rawScore
            acceptedHigh.sort((a, b) => b.rawScore - a.rawScore);
            acceptedMid.sort((a, b) => b.rawScore - a.rawScore);
            acceptedLow.sort((a, b) => b.rawScore - a.rawScore);

            let finalRecs = [];
            // Intentar tomar la mejor de cada categoría
            const rec1 = selectRecommendedFromTier(acceptedHigh);
            const rec2 = selectRecommendedFromTier(acceptedMid);
            const rec3 = selectRecommendedFromTier(acceptedLow);
            
            if (rec1) finalRecs.push(rec1);
            if (rec2) finalRecs.push(rec2);
            if (rec3) finalRecs.push(rec3);

            // Si no llegamos a 3, rellenamos con el resto
            if (finalRecs.length < 3) {
                const remaining = [];
                const usedIds = new Set(finalRecs.map(r => r.beatmapId));
                const allRemaining = [
                    ...acceptedHigh,
                    ...acceptedMid,
                    ...acceptedLow
                ];
                allRemaining.forEach(c => {
                    if (!usedIds.has(c.beatmapId)) {
                        remaining.push(c);
                    }
                });
                remaining.sort((a, b) => b.rawScore - a.rawScore);
                for (const item of remaining) {
                    if (finalRecs.length >= 3) break;
                    finalRecs.push(item);
                }
            }

            // Ordenar por popularidad descendente para presentación
            finalRecs.sort((a, b) => b.popularity - a.popularity);

            await RecommendationModel.recalculateExactPP(finalRecs, customMods);
            return finalRecs;
        } catch (err) {
            console.error("Error al obtener recomendaciones de botones:", err);
            return [];
        }
    }

    collector.on('collect', async i => {
        try {
            await i.deferUpdate();

            const loadingEmbed = EmbedBuilder.from(embed)
                .setDescription(t(locale, 'recommend.msg_searching_custom'));
            await i.editReply({ embeds: [loadingEmbed] });

            if (i.customId === 'rec_refresh') {
                // Mantener skipSet
            } else if (i.customId === 'rec_more_pp') {
                minPP *= 1.10;
                maxPP *= 1.10;
                skipSet.clear();
            } else if (i.customId === 'rec_less_pp') {
                minPP *= 0.90;
                maxPP *= 0.90;
                skipSet.clear();
            } else if (i.customId === 'rec_toggle_mods') {
                activeMods = activeMods === "NM" ? (preferredMod === "NM" ? "DT" : preferredMod) : "NM";
                suggestedMod = activeMods === "NM" ? (preferredMod === "NM" ? "DT" : preferredMod) : "NM";
                customMods = activeMods;
                skipSet.clear();
            } else if (i.customId === 'rec_toggle_played') {
                showPlayed = !showPlayed;
                skipSet.clear();
            } else if (i.customId === 'rec_style_aim') {
                currentStyle = 'aim';
                skipSet.clear();
            } else if (i.customId === 'rec_style_speed') {
                currentStyle = 'speed';
                skipSet.clear();
            } else if (i.customId === 'rec_style_length') {
                currentStyle = 'length';
                skipSet.clear();
            } else if (i.customId === 'rec_style_rarezas') {
                currentStyle = 'rarezas';
                skipSet.clear();
            } else if (i.customId === 'rec_style_tags') {
                currentStyle = 'tags';
                skipSet.clear();
            } else if (i.customId === 'rec_style_reset') {
                currentStyle = 'standard';
                skipSet.clear();
            }

            currentRecs = await getRecommendationsForButtons();
            currentRecs.forEach(c => {
                skipSet.add(c.beatmapId);
                if (c.beatmapsetId) {
                    skipSet.add(c.beatmapsetId.toString());
                }
            });

            params = { minPP, maxPP, mods: activeMods, showPlayed, hasSupporter, style: currentStyle };
            embed = doOsuRecommendEmbed(message, profile, currentRecs, params, locale);
            rows = buildRecommendButtonsRow(params, suggestedMod, currentRecs.length > 0, currentRecs, hasSupporter, locale);

            await i.editReply({
                embeds: [embed],
                components: rows
            });
        } catch (err) {
            console.error("Error al procesar interacción de botones en recommend:", err);
        }
    });

    collector.on('end', async () => {
        try {
            await sentMessage.edit({ components: [] });
        } catch {}
    });

    return;
}

run.alias = {
    "recomendar": {
        "args": ""
    },
    "rec": {
        "args": ""
    }
};

run.description = {
    'header': t('es', 'commands.recommend.header'),
    'body': t('es', 'commands.recommend.body'),
    'usage': t('es', 'commands.recommend.usage')
};

module.exports = { run, description: run.description, preloadDefaultRecommendation, invalidateRecCacheIfPlayed };
