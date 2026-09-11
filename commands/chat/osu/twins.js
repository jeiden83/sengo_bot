const { getOsuUser, getUserTopScores, argsParser } = require("../../utils/osu.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");
const SkillsModel = require("../../../models/SkillsModel.js");
const TwinModel = require("../../../models/TwinModel.js");
const { doTwinMainEmbed, doTwinSharedEmbed, doTwinTopPlaysEmbed, buildTwinActionRow } = require("../../../views/twinViews.js");
const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    const { message, res, reply, logger } = messages;
    const locale = message?.locale || "es";
    const safeArgs = Array.isArray(args) ? args : [];

    // 1. Detectar modo de juego explícito
    let explicitMode = null;
    let cleanArgs = [];
    let closeRank = false;
    let country = null;

    for (let i = 0; i < safeArgs.length; i++) {
        const arg = safeArgs[i];
        if (typeof arg !== "string") continue;
        const lower = arg.toLowerCase();

        if (["-t", "-taiko", "--taiko", "taiko"].includes(lower)) explicitMode = "taiko";
        else if (["-c", "-catch", "--catch", "catch", "-ctb", "--ctb", "ctb", "-fruits", "--fruits", "fruits"].includes(lower)) explicitMode = "fruits";
        else if (["-mania", "--mania", "mania"].includes(lower) || lower === "-m") explicitMode = "mania";
        else if (["-std", "--std", "std", "-osu", "--osu", "osu"].includes(lower)) explicitMode = "osu";
        else if (["-rank", "--rank", "-close", "--close", "-nivel", "--nivel"].includes(lower)) closeRank = true;
        else if (["-pais", "-country", "--pais", "--country", "-p", "-c"].includes(lower) && safeArgs[i + 1]) {
            country = safeArgs[i + 1].toUpperCase();
            i++; // saltar el código de país
        } else {
            cleanArgs.push(arg);
        }
    }

    // 2. Parsear el usuario objetivo
    let osuUser = null;
    let detectedMode = explicitMode;

    if (cleanArgs.length > 0) {
        const parser_res = await argsParser(cleanArgs, {
            fn: () => null,
            message: message,
            command: "twins"
        });

        if (parser_res && parser_res.user) {
            osuUser = parser_res.user;
        } else if (parser_res && parser_res.username && parser_res.username.length > 0) {
            try {
                osuUser = await getOsuUser({ username: [parser_res.username[0]], gamemode: explicitMode || "osu", server: "bancho" });
            } catch (e) {
                // Silenciar
            }
        }
    }

    // Fallback: usuario vinculado en Discord
    if (!osuUser || !osuUser.id) {
        try {
            const linked = await OsuUserModel.getLinkedUser(res?.User, message.author?.id);
            if (linked && (linked.osu_id || linked.username)) {
                const queryUser = String(linked.osu_id || linked.username);
                osuUser = await getOsuUser({ username: [queryUser], gamemode: explicitMode || linked.main_gamemode || "osu", server: "bancho" });
                if (!detectedMode && linked.main_gamemode) {
                    detectedMode = linked.main_gamemode;
                }
            }
        } catch (err) {
            console.warn("[.twins] Error al resolver usuario vinculado:", err.message);
        }
    }

    if (!osuUser || !osuUser.id || typeof osuUser === "string") {
        return t(locale, "twins.err_no_user");
    }

    const targetMode = detectedMode || osuUser.playmode || "osu";

    try {
        if (logger) logger.process(`Buscando gemelo de mods para ${osuUser.username} en modo ${targetMode}`);

        // 3. Obtener las mejores jugadas del usuario (hasta 200)
        const userTopScores = await getUserTopScores({ username: [String(osuUser.id)], gamemode: targetMode, server: "bancho" }).catch(() => []);

        if (!userTopScores || userTopScores.length === 0) {
            return t(locale, "twins.err_no_scores", { username: osuUser.username });
        }

        // 4. Calcular ponderación real de mods por decaimiento de PP (0.95^i * pp)
        const userModStats = TwinModel.calculatePpWeightedModStats(userTopScores);

        // Guardar o actualizar en segundo plano en user_skills para enriquecer la base de datos
        try {
            const breakdown = SkillsModel.analyzeSkills(userTopScores, false, targetMode);
            SkillsModel.saveUserSkills({
                osuUser,
                skillsBreakdown: breakdown,
                gamemode: targetMode,
                discordId: message.author?.id
            }).catch(() => {});
        } catch {
            // Silenciar error en segundo plano
        }

        // 5. Encontrar a los gemelos más afines en la base de datos
        const candidates = await TwinModel.findTwins(osuUser, userModStats, {
            gamemode: targetMode,
            country,
            closeRank,
            limit: 5
        });

        if (!candidates || candidates.length === 0) {
            return t(locale, "twins.err_no_twins");
        }

        // 6. Caché local en memoria de scores de gemelos para cambios instantáneos de página
        const twinScoresCache = new Map();
        let currentCandidateIdx = 0;
        let currentPage = 1;

        // Precargar en segundo plano las jugadas del candidato 0
        const prefetchScores = async (candidateOsuId) => {
            if (!twinScoresCache.has(candidateOsuId)) {
                const s = await getUserTopScores({ username: [String(candidateOsuId)], gamemode: targetMode, server: "bancho" }).catch(() => []);
                twinScoresCache.set(candidateOsuId, s || []);
            }
            return twinScoresCache.get(candidateOsuId);
        };
        prefetchScores(candidates[0].osu_id).catch(() => {});

        // 7. Renderizar embed y botones
        const renderCurrentView = async () => {
            const currentCandidate = candidates[currentCandidateIdx];
            const candidateScores = await prefetchScores(currentCandidate.osu_id);

            let embed;
            if (currentPage === 1) {
                embed = doTwinMainEmbed(
                    message,
                    osuUser,
                    currentCandidate,
                    userModStats,
                    currentCandidate.modStats,
                    { currentIndex: currentCandidateIdx, totalCandidates: candidates.length, gamemode: targetMode },
                    locale
                );
            } else if (currentPage === 2) {
                const comparison = TwinModel.compareSharedTopScores(userTopScores, candidateScores);
                embed = doTwinSharedEmbed(message, osuUser, currentCandidate, comparison, locale);
            } else {
                embed = doTwinTopPlaysEmbed(message, currentCandidate, candidateScores, locale);
            }

            const row = buildTwinActionRow(currentPage, currentCandidateIdx, candidates.length, currentCandidate.username, locale);
            return { embeds: [embed], components: [row] };
        };

        const initialPayload = await renderCurrentView();

        let sentMessage = null;
        if (typeof reply?.reply === "function") {
            sentMessage = await reply.reply(initialPayload);
        } else if (typeof message?.reply === "function") {
            sentMessage = await message.reply(initialPayload);
        } else if (message?.channel && typeof message.channel.send === "function") {
            sentMessage = await message.channel.send(initialPayload);
        }

        if (!sentMessage || typeof sentMessage.createMessageComponentCollector !== "function") {
            return sentMessage || initialPayload;
        }

        // 8. Collector interactivo de botones (duración 2 minutos)
        const collector = sentMessage.createMessageComponentCollector({
            filter: (i) => i.user.id === message.author?.id,
            time: 120000
        });

        collector.on("collect", async (interaction) => {
            try {
                if (interaction.customId === "twin_page_main") {
                    currentPage = 1;
                } else if (interaction.customId === "twin_page_shared") {
                    currentPage = 2;
                } else if (interaction.customId === "twin_page_top") {
                    currentPage = 3;
                } else if (interaction.customId === "twin_prev") {
                    if (currentCandidateIdx > 0) currentCandidateIdx--;
                } else if (interaction.customId === "twin_next") {
                    if (currentCandidateIdx < candidates.length - 1) currentCandidateIdx++;
                }

                const updatedPayload = await renderCurrentView();
                await interaction.update(updatedPayload);
            } catch (err) {
                console.error("[.twins] Error en interacción de botones:", err.message);
            }
        });

        collector.on("end", async () => {
            try {
                if (sentMessage.editable) {
                    await sentMessage.edit({ components: [] });
                }
            } catch {
                // Silenciar si el mensaje fue borrado
            }
        });

        return sentMessage;
    } catch (error) {
        console.error("[.twins] Error general:", error);
        return t(locale, "twins.err_generic", { error: error.message });
    }
}

run.alias = {
    twin: true,
    twins: true,
    gemelo: true,
    gemelos: true,
    similar: true
};

run.description = "Encuentra a tu gemelo de juego en osu! según la afinidad y ponderación real de tus mods";

module.exports = {
    run,
    alias: run.alias,
    description: run.description
};
