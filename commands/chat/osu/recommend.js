const { getOsuPpsData, argsParser, getUserTopScores, getBeatmapUserScore } = require("../../utils/osu.js");
const { doOsuRecommendEmbed, buildRecommendButtonsRow } = require("../../../views/recommendViews.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");
const { EmbedBuilder } = require("discord.js");

function matchesModFilter(mValStr, filterStr) {
    const m = parseInt(mValStr);
    if (isNaN(m)) return false;

    if (!filterStr) return true;
    const normalizedFilter = filterStr.toUpperCase().trim();
    if (normalizedFilter === "NM" || normalizedFilter === "NOMOD") {
        const invalidMods = 64 | 16 | 2 | 1024 | 256; // DT, HR, EZ, FL, HT
        return (m & invalidMods) === 0;
    }

    if (normalizedFilter.includes("DT")) {
        return (m & 64) !== 0;
    }
    if (normalizedFilter.includes("HR")) {
        return (m & 16) !== 0;
    }
    if (normalizedFilter.includes("HD")) {
        return (m & 8) !== 0;
    }

    return true;
}

async function checkHasScore(beatmapId, userId) {
    try {
        const score = await getBeatmapUserScore({
            beatmap_url: beatmapId,
            username: [userId],
            gamemode: 'osu'
        });
        return score !== null && score !== undefined;
    } catch {
        return false;
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
        const arg = args[i].trim().toLowerCase();
        if (arg === "-jugados" || arg === "-played") {
            showPlayed = true;
            continue;
        }
        if (arg === "-pp" || arg === "-g") {
            if (i + 1 < args.length) {
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
            if (i + 1 < args.length) {
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
        "command_function": getUserTopScores
    });

    if (typeof parser_res.fn_response === 'string') return parser_res.fn_response;
    if (!Array.isArray(parser_res.fn_response) || parser_res.fn_response.length === 0) {
        return `❌ No se pudieron cargar las mejores jugadas del usuario.`;
    }

    const topScores = parser_res.fn_response;
    const osuUserId = parser_res.parsed_args.username[0];

    // Obtener perfil del usuario para mostrar información correcta en el embed
    let profile;
    try {
        const { Client } = require('osu-web.js');
        const token = await OsuUserModel.loadToken();
        const client = new Client(token.access_token);
        profile = await client.users.getUser(parseInt(osuUserId), { urlParams: { mode: 'osu' } });
    } catch {
        profile = {
            id: osuUserId,
            username: topScores[0].user.username,
            avatar_url: topScores[0].user.avatar_url
        };
    }

    // Calcular mod preferido del usuario basado en su Top 15 de PP
    const top15 = topScores.slice(0, 15);
    let dtCount = 0;
    let hrCount = 0;
    let nmCount = 0;

    top15.forEach(score => {
        const acronyms = (score.mods || []).map(m => m.acronym);
        if (acronyms.includes("DT") || acronyms.includes("NC")) {
            dtCount++;
        } else if (acronyms.includes("HR")) {
            hrCount++;
        } else {
            nmCount++;
        }
    });

    let preferredMod = "NM";
    if (dtCount > nmCount && dtCount > hrCount) {
        preferredMod = "DT";
    } else if (hrCount > nmCount && hrCount > dtCount) {
        preferredMod = "HR";
    }

    const suggestedMod = preferredMod === "DT" ? "NM" : "DT";

    // Calcular rango de PP recomendado
    let totalPP = 0;
    top15.forEach(score => {
        totalPP += score.pp;
    });
    const averagePP = totalPP / top15.length;

    let minPP = customMinPP || (averagePP * 0.90);
    let maxPP = customMaxPP || (averagePP * 1.10);
    let activeMods = customMods || preferredMod;

    // Cargar datos de osu-pps
    let ppsData;
    try {
        ppsData = await getOsuPpsData();
    } catch (e) {
        return `❌ Error al cargar los datos de farm: ${e.message}`;
    }

    const top100MapIds = new Set(topScores.map(score => score.beatmap.id.toString()));
    const skipSet = new Set();

    // Función auxiliar para obtener recomendaciones usando los parámetros activos
    async function getRecommendations() {
        const { diffs, mapsetsMap } = ppsData;

        const candidates = [];
        diffs.forEach(diff => {
            const beatmapId = diff.b;
            const pp99Value = parseFloat(diff.pp99);
            const estimated100PP = pp99Value * 1.11;

            if (top100MapIds.has(beatmapId) || skipSet.has(beatmapId)) return;
            if (pp99Value < minPP || pp99Value > maxPP) return;
            if (!matchesModFilter(diff.m, activeMods)) return;

            const set = mapsetsMap.get(diff.s);
            if (set) {
                candidates.push({
                    beatmapId: beatmapId,
                    beatmapsetId: diff.s,
                    title: set.t,
                    artist: set.art,
                    version: diff.v,
                    stars: parseFloat(diff.d),
                    maxPP: estimated100PP,
                    pp99: pp99Value,
                    mods: diff.m === "0" ? "NoMod" : (diff.m === "8" ? "HD" : (diff.m === "72" ? "HDDT" : (diff.m === "64" ? "DT" : (diff.m === "16" ? "HR" : "Mods")))),
                    popularity: parseInt(diff.h || 0)
                });
            }
        });

        candidates.sort((a, b) => b.popularity - a.popularity);

        const finalRecs = [];
        for (const candidate of candidates) {
            if (finalRecs.length >= 3) break;

            const hasScore = await checkHasScore(candidate.beatmapId, osuUserId);

            if (showPlayed) {
                if (hasScore) {
                    finalRecs.push(candidate);
                }
            } else {
                if (!hasScore) {
                    finalRecs.push(candidate);
                }
            }

            await new Promise(resolve => setTimeout(resolve, 150));
        }

        return finalRecs;
    }

    let currentRecs = await getRecommendations();
    currentRecs.forEach(c => skipSet.add(c.beatmapId));

    let params = { minPP, maxPP, mods: activeMods, showPlayed };
    let embed = doOsuRecommendEmbed(message, profile, currentRecs, params);
    let row = buildRecommendButtonsRow(params, suggestedMod);

    const sentMessage = await message.channel.send({
        embeds: [embed],
        components: [row]
    });

    const collector = sentMessage.createMessageComponentCollector({
        filter: btnInt => btnInt.user.id === message.author.id,
        idle: 120000
    });

    collector.on('collect', async i => {
        try {
            await i.deferUpdate();

            const loadingEmbed = EmbedBuilder.from(embed)
                .setDescription(`⏳ *Buscando nuevas recomendaciones de farm...*`);
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
            }

            currentRecs = await getRecommendations();
            currentRecs.forEach(c => skipSet.add(c.beatmapId));

            params = { minPP, maxPP, mods: activeMods, showPlayed };
            embed = doOsuRecommendEmbed(message, profile, currentRecs, params);
            row = buildRecommendButtonsRow(params, suggestedMod);

            await i.editReply({
                embeds: [embed],
                components: [row]
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
    'header': "Recomienda mapas de farm (PP)",
    'body': 'Sugiere mapas populares de farm que coinciden con tu rango de nivel de PP basándose en datos de osu-pps.',
    'usage': 's.recommend [-pp rango] [-mods mod] [-jugados]\nEjemplos:\n- s.recommend\n- s.recommend -pp 300\n- s.recommend -pp 250-300 -mods HDDT\n- s.recommend -jugados'
};

module.exports = { run, description: run.description };
