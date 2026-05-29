const { argsParser, getUserTopScores, getBeatmapUserScore } = require("../../utils/osu.js");
const { doOsuRecommendEmbed, buildRecommendButtonsRow } = require("../../../views/recommendViews.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");
const RecommendationModel = require("../../../models/RecommendationModel.js");
const { EmbedBuilder } = require("discord.js");

const recommendCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutos

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

async function checkHasScore(beatmapId, userId, gamemode = 'osu') {
    try {
        const score = await getBeatmapUserScore({
            beatmap_url: beatmapId,
            username: [userId],
            gamemode: gamemode
        });
        return score !== null && score !== undefined;
    } catch {
        return false;
    }
}

async function preloadDefaultRecommendation(osuUserId, username, avatarUrl, res, gamemode = 'osu') {
    try {
        const gamemodeKey = gamemode || 'osu';
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

        const minPP = averagePP * 0.90;
        const maxPP = averagePP * 1.10;

        const finalRecs = await RecommendationModel.getPersonalizedRecommendations({
            topScores,
            customMinPP: minPP,
            customMaxPP: maxPP,
            customMods: userProfile.preferredMod,
            style: 'standard',
            showPlayed: false
        });

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

async function run(messages, args) {
    const { message, res } = messages;

    // 1. Filtrar los flags personalizados de recommend para que argsParser no se confunda
    let showPlayed = false;
    let customMinPP = null;
    let customMaxPP = null;
    let customMods = null;

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
    const parser_res = await argsParser(cleanArgs, {
        "message": message,
        "res": res,
        "command_function": getUserTopScores,
        "resolveUserByIndex": true,
        "ignoreBeatmap": true
    });

    if (typeof parser_res.fn_response === 'string') return parser_res.fn_response;
    if (!Array.isArray(parser_res.fn_response) || parser_res.fn_response.length === 0) {
        return "No se encontraron jugadas recientes o el perfil no existe.";
    }

    const topScores = parser_res.fn_response;
    const osuUserId = parser_res.parsed_args.username[0];

    // Consultar si el usuario que invocó el comando tiene supporter activo
    const linkedUser = await OsuUserModel.getLinkedUser(res.User, message.author.id);
    let hasSupporter = linkedUser ? !!linkedUser.is_supporter : false;

    // Verificar si es una consulta por defecto (sin filtros custom)
    const isDefaultRun = (customMinPP === null && customMaxPP === null && customMods === null && showPlayed === false);

    let currentRecs = [];
    let minPP;
    let maxPP;
    let activeMods;
    let suggestedMod;
    let profile;
    let currentStyle = 'standard';

    const activeGamemode = parser_res.parsed_args.gamemode || "osu";
    const cacheKey = `${osuUserId}:${activeGamemode}`;
    const cached = isDefaultRun ? recommendCache.get(cacheKey) : null;

    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        currentRecs = cached.recommendations;
        minPP = cached.minPP;
        maxPP = cached.maxPP;
        activeMods = cached.suggestedMod;
        suggestedMod = cached.suggestedMod === "DT" ? "NM" : "DT";
        profile = cached.profile;
        currentStyle = cached.style || 'standard';
    } else {
        // Obtener perfil del usuario para mostrar información correcta en el embed
        try {
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
        suggestedMod = userProfile.preferredMod === "DT" ? "NM" : "DT";

        // Calcular rango de PP recomendado
        const top15 = topScores.slice(0, 15);
        let totalPP = 0;
        top15.forEach(score => {
            totalPP += score.pp;
        });
        const averagePP = totalPP / top15.length;

        minPP = customMinPP || (averagePP * 0.90);
        maxPP = customMaxPP || (averagePP * 1.10);
        activeMods = customMods || userProfile.preferredMod;

        const skipSetLocal = new Set();

        async function getRecommendations() {
            try {
                const candidates = await RecommendationModel.getPersonalizedRecommendations({
                    topScores,
                    customMinPP: minPP,
                    customMaxPP: maxPP,
                    customMods: activeMods,
                    style: currentStyle,
                    showPlayed,
                    skipSet: skipSetLocal
                });

                const finalRecs = [];
                for (const candidate of candidates) {
                    if (finalRecs.length >= 3) break;

                    const hasScore = await checkHasScore(candidate.beatmapId, osuUserId, activeGamemode);
                    if (showPlayed) {
                        if (hasScore) finalRecs.push(candidate);
                    } else {
                        if (!hasScore) finalRecs.push(candidate);
                    }

                    await new Promise(resolve => setTimeout(resolve, 80));
                }
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
    currentRecs.forEach(c => skipSet.add(c.beatmapId));

    let params = { minPP, maxPP, mods: activeMods, showPlayed, hasSupporter, style: currentStyle };
    let embed = doOsuRecommendEmbed(message, profile, currentRecs, params);
    let rows = buildRecommendButtonsRow(params, suggestedMod, currentRecs.length > 0, currentRecs, hasSupporter);

    const sentMessage = await message.channel.send({
        embeds: [embed],
        components: rows
    });

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
                customMods: activeMods,
                style: currentStyle,
                showPlayed,
                skipSet: skipSet
            });

            const finalRecs = [];
            for (const candidate of candidates) {
                if (finalRecs.length >= 3) break;

                const hasScore = await checkHasScore(candidate.beatmapId, osuUserId, activeGamemode);
                if (showPlayed) {
                    if (hasScore) finalRecs.push(candidate);
                } else {
                    if (!hasScore) finalRecs.push(candidate);
                }

                await new Promise(resolve => setTimeout(resolve, 80));
            }
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
                .setDescription(`⏳ *Buscando recomendaciones personalizadas...*`);
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
                if (activeMods === "NM") {
                    activeMods = suggestedMod || "DT";
                } else {
                    activeMods = "NM";
                }
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
            } else if (i.customId === 'rec_style_reset') {
                currentStyle = 'standard';
                skipSet.clear();
            }

            currentRecs = await getRecommendationsForButtons();
            currentRecs.forEach(c => skipSet.add(c.beatmapId));

            params = { minPP, maxPP, mods: activeMods, showPlayed, hasSupporter, style: currentStyle };
            embed = doOsuRecommendEmbed(message, profile, currentRecs, params);
            rows = buildRecommendButtonsRow(params, suggestedMod, currentRecs.length > 0, currentRecs, hasSupporter);

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
    'header': "Recomienda mapas de farm (PP) personalizados",
    'body': 'Sugiere mapas que coinciden con tu nivel y estilo de juego basándose en la base de datos de beatmaps clasificados de Sengo.',
    'usage': 's.recommend [-pp rango] [-mods mod] [-jugados]\nEjemplos:\n- s.recommend\n- s.recommend -pp 300\n- s.recommend -pp 250-300 -mods HDDT\n- s.recommend -jugados'
};

module.exports = { run, description: run.description, preloadDefaultRecommendation };
