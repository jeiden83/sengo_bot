const { getOsuUser, getUserTopScores, argsParser } = require("../../utils/osu.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");
const SkillsModel = require("../../../models/SkillsModel.js");
const TwinModel = require("../../../models/TwinModel.js");
const {
    doTwinMainEmbed,
    doTwinSharedEmbed,
    doTwinTopPlaysEmbed,
    doTwinListEmbed,
    buildTwinActionRow,
    buildTwinListActionRow
} = require("../../../views/twinViews.js");
const { t } = require("../../../utils/i18n.js");

const VALID_SKILLS = new Set(["ACC", "ACCURACY", "AIM", "SPEED", "READING", "STAMINA", "ALL"]);

async function run(messages, args) {
    const { message, res, reply, logger } = messages;
    const locale = message?.locale || "es";
    const safeArgs = Array.isArray(args) ? args : [];

    // 1. Detectar flags y parámetros
    let explicitMode = null;
    let cleanArgs = [];
    let closeRank = false;
    let country = null;
    let prioritizeCountry = false;
    let sortByPP = false;
    let skillFilter = null;
    let requestedMods = null;
    let isListView = false;
    let initialIndex = 0;
    let explicitUsername = null;

    for (let i = 0; i < safeArgs.length; i++) {
        const arg = safeArgs[i];
        if (typeof arg !== "string") continue;
        const lower = arg.toLowerCase();

        // Modos de juego
        if (["-t", "-taiko", "--taiko"].includes(lower)) explicitMode = "taiko";
        else if (["-catch", "--catch", "-ctb", "--ctb", "-fruits", "--fruits"].includes(lower)) explicitMode = "fruits";
        else if (["-mania", "--mania", "-m"].includes(lower)) explicitMode = "mania";
        else if (["-std", "--std", "-osu", "--osu"].includes(lower)) explicitMode = "osu";

        // Filtro por usuario explícito (-u, -user, -usuario)
        else if (["-u", "--u", "-user", "--user", "-usuario", "--usuario"].includes(lower) && safeArgs[i + 1] && !safeArgs[i + 1].startsWith("-")) {
            explicitUsername = safeArgs[i + 1];
            i++;
        }

        // Filtro por rango / nivel
        else if (["-rank", "--rank", "-close", "--close", "-nivel", "--nivel"].includes(lower)) closeRank = true;

        // Filtro por mods: -mods <mods> o +<mods>
        else if (["-mods", "--mods", "-mod", "--mod"].includes(lower) && safeArgs[i + 1] && !safeArgs[i + 1].startsWith("-")) {
            requestedMods = TwinModel.parseModFilter(safeArgs[i + 1]);
            i++;
        } else if (arg.startsWith("+") && arg.length > 1 && !arg.startsWith("++")) {
            requestedMods = TwinModel.parseModFilter(arg.slice(1));
        }

        // Ordenar por cercanía en PP: -pp
        else if (["-pp", "--pp"].includes(lower)) sortByPP = true;

        // Búsqueda por cercanía en skills: -skills [skill]
        else if (["-skills", "--skills", "-skill", "--skill", "-s"].includes(lower)) {
            const nextArg = safeArgs[i + 1];
            if (nextArg && VALID_SKILLS.has(nextArg.toUpperCase()) && !nextArg.startsWith("-")) {
                skillFilter = nextArg.toUpperCase();
                i++;
            } else {
                skillFilter = "ALL";
            }
        }

        // País: -pais [CL] o -pais (priorizar país del que ejecuta)
        else if (["-pais", "--pais", "-country", "--country"].includes(lower)) {
            const nextArg = safeArgs[i + 1];
            if (nextArg && /^[a-zA-Z]{2}$/.test(nextArg) && !nextArg.startsWith("-")) {
                country = nextArg.toUpperCase();
                i++;
            } else {
                prioritizeCountry = true;
            }
        }

        // Vista de lista compacta: -l
        else if (["-l", "--list", "-list", "-lista", "--lista"].includes(lower)) {
            isListView = true;
        }

        // Índice específico: -i <index>
        else if (["-i", "--index", "-index"].includes(lower) && safeArgs[i + 1] && /^\d+$/.test(safeArgs[i + 1])) {
            initialIndex = Math.max(0, parseInt(safeArgs[i + 1], 10) - 1);
            i++;
        } else {
            cleanArgs.push(arg);
        }
    }

    // 2. Parsear el usuario objetivo
    let osuUser = null;
    let detectedMode = explicitMode;

    // Caso A: Si se pasó flag explícita de usuario (-u / -user)
    if (explicitUsername) {
        try {
            const mentionMatch = explicitUsername.match(/<@!?(\d+)>/);
            const discordId = mentionMatch ? mentionMatch[1] : (/^\d{17,20}$/.test(explicitUsername) ? explicitUsername : null);
            if (discordId) {
                const linked = await OsuUserModel.getLinkedUser(res?.User, discordId);
                if (linked && (linked.osu_id || linked.username)) {
                    const queryUser = String(linked.osu_id || linked.username);
                    osuUser = await getOsuUser({ username: [queryUser], gamemode: explicitMode || linked.main_gamemode || "osu", server: "bancho" });
                    if (!detectedMode && linked.main_gamemode) detectedMode = linked.main_gamemode;
                }
            }
            if (!osuUser || !osuUser.id) {
                osuUser = await getOsuUser({ username: [explicitUsername], gamemode: explicitMode || "osu", server: "bancho" });
            }
        } catch (err) {
            console.warn("[.twins] Error al resolver usuario explícito (-u):", err.message);
        }
    }

    // Caso B: Si se pasó un nombre o mención posicional en los argumentos limpios (ej: s.twins milin)
    if ((!osuUser || !osuUser.id) && cleanArgs.length > 0) {
        const candidateName = cleanArgs.map(x => x.replace(/^["']|["']$/g, "")).join(" ").trim();
        
        // 1. Probar si es mención de Discord o Discord ID
        const mentionMatch = candidateName.match(/<@!?(\d+)>/);
        const discordId = mentionMatch ? mentionMatch[1] : (/^\d{17,20}$/.test(candidateName) ? candidateName : null);
        if (discordId) {
            try {
                const linked = await OsuUserModel.getLinkedUser(res?.User, discordId);
                if (linked && (linked.osu_id || linked.username)) {
                    const queryUser = String(linked.osu_id || linked.username);
                    osuUser = await getOsuUser({ username: [queryUser], gamemode: explicitMode || linked.main_gamemode || "osu", server: "bancho" });
                    if (!detectedMode && linked.main_gamemode) detectedMode = linked.main_gamemode;
                }
            } catch {}
        }

        // 2. Probar con getOsuUser directo para el nombre de usuario
        if (!osuUser || !osuUser.id) {
            try {
                const directUser = await getOsuUser({ username: [candidateName], gamemode: explicitMode || "osu", server: "bancho" });
                if (directUser && directUser.id) {
                    osuUser = directUser;
                }
            } catch {}
        }

        // 3. Fallback con argsParser estándar
        if (!osuUser || !osuUser.id) {
            try {
                const parser_res = await argsParser(cleanArgs, {
                    command_function: getOsuUser,
                    fn: getOsuUser,
                    message: message,
                    res: res || {},
                    command: "twins",
                    gamemode: explicitMode,
                    ignoreBeatmap: true
                });

                if (parser_res && parser_res.fn_response && parser_res.fn_response.id) {
                    osuUser = parser_res.fn_response;
                } else if (parser_res && parser_res.user && parser_res.user.id) {
                    osuUser = parser_res.user;
                } else if (parser_res && parser_res.username && parser_res.username.length > 0 && parser_res.username[0] !== "") {
                    osuUser = await getOsuUser({ username: [parser_res.username[0]], gamemode: explicitMode || "osu", server: "bancho" });
                }
            } catch {}
        }
    }

    // Caso C: Fallback al usuario vinculado en Discord del que ejecuta el comando
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

    // Determinar país del ejecutor para priorización
    let runnerCountry = null;
    if (prioritizeCountry) {
        try {
            const runnerLinked = await OsuUserModel.getLinkedUser(res?.User, message.author?.id);
            if (runnerLinked?.country_code) {
                runnerCountry = runnerLinked.country_code.toUpperCase();
            }
        } catch {}
        if (!runnerCountry && osuUser?.country_code) {
            runnerCountry = (osuUser.country_code || osuUser.country?.code || "").toUpperCase();
        }
    }

    try {
        if (logger) logger.process(`Buscando gemelos para ${osuUser.username} en modo ${targetMode}`);

        // 3. Obtener las mejores jugadas del usuario (hasta 100)
        const userTopScores = await getUserTopScores({ username: [String(osuUser.id)], gamemode: targetMode, server: "bancho" }).catch(() => []);

        if (!userTopScores || userTopScores.length === 0) {
            return t(locale, "twins.err_no_scores", { username: osuUser.username });
        }

        // 4. Calcular ponderación real de mods y descomposición de skills
        const userModStats = TwinModel.calculatePpWeightedModStats(userTopScores);
        let userSkillsBreakdown = {};
        try {
            userSkillsBreakdown = SkillsModel.analyzeSkills(userTopScores, false, targetMode);
            let authorDiscordId = null;
            try {
                const authorLinked = await OsuUserModel.getLinkedUser(res?.User, message.author?.id);
                if (authorLinked && String(authorLinked.osu_id) === String(osuUser.id)) {
                    authorDiscordId = message.author?.id;
                }
            } catch {}

            SkillsModel.saveUserSkills({
                osuUser,
                skillsBreakdown: userSkillsBreakdown,
                gamemode: targetMode,
                discordId: authorDiscordId
            }).catch(() => {});
        } catch {
            // Silenciar error en segundo plano
        }

        // 5. Encontrar a los gemelos más afines en la base de datos
        const candidates = await TwinModel.findTwins(osuUser, userModStats, {
            gamemode: targetMode,
            country,
            prioritizeCountry,
            runnerCountry,
            closeRank,
            limit: 25,
            requestedMods,
            sortByPP,
            targetPP: osuUser.statistics?.pp || 0,
            skillFilter,
            targetSkills: userSkillsBreakdown
        });

        if (!candidates || candidates.length === 0) {
            return t(locale, "twins.err_no_twins");
        }

        // 6. Caché local en memoria de scores de gemelos para cambios instantáneos
        const twinScoresCache = new Map();
        let inListView = isListView;
        let currentCandidateIdx = Math.max(0, Math.min(candidates.length - 1, initialIndex));
        let listPage = Math.floor(currentCandidateIdx / 5) + 1;
        let currentPage = 1;

        const prefetchScores = async (candidateOsuId) => {
            if (!twinScoresCache.has(candidateOsuId)) {
                const s = await getUserTopScores({ username: [String(candidateOsuId)], gamemode: targetMode, server: "bancho" }).catch(() => []);
                twinScoresCache.set(candidateOsuId, s || []);
            }
            return twinScoresCache.get(candidateOsuId);
        };
        prefetchScores(candidates[currentCandidateIdx].osu_id).catch(() => {});

        const commonOptions = {
            gamemode: targetMode,
            country,
            prioritizeCountry,
            runnerCountry,
            sortByPP,
            skillFilter,
            requestedMods,
            userSkills: userSkillsBreakdown,
            userModStats
        };

        // 7. Renderizar vista actual (lista compacta o perfil detallado)
        const renderCurrentView = async () => {
            if (inListView) {
                const totalPages = Math.max(1, Math.ceil(candidates.length / 5));
                listPage = Math.max(1, Math.min(totalPages, listPage));

                const embed = doTwinListEmbed(
                    message,
                    osuUser,
                    candidates,
                    listPage,
                    totalPages,
                    commonOptions,
                    locale
                );
                const components = buildTwinListActionRow(listPage, totalPages, locale);
                return { embeds: [embed], components };
            }

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
                    {
                        currentIndex: currentCandidateIdx,
                        totalCandidates: candidates.length,
                        ...commonOptions
                    },
                    locale
                );
            } else if (currentPage === 2) {
                const comparison = TwinModel.compareSharedTopScores(userTopScores, candidateScores);
                embed = doTwinSharedEmbed(message, osuUser, currentCandidate, comparison, locale);
            } else {
                embed = doTwinTopPlaysEmbed(message, currentCandidate, candidateScores, locale);
            }

            const components = buildTwinActionRow(
                currentPage,
                currentCandidateIdx,
                candidates.length,
                currentCandidate.username,
                locale,
                true // permitir volver a la lista
            );
            return { embeds: [embed], components };
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
                const id = interaction.customId;
                const totalPages = Math.max(1, Math.ceil(candidates.length / 5));

                if (id === "twin_list_prev") {
                    if (listPage > 1) listPage--;
                } else if (id === "twin_list_next") {
                    if (listPage < totalPages) listPage++;
                } else if (id === "twin_list_inspect") {
                    inListView = false;
                    currentCandidateIdx = (listPage - 1) * 5;
                    currentPage = 1;
                } else if (id === "twin_back_to_list") {
                    inListView = true;
                    listPage = Math.floor(currentCandidateIdx / 5) + 1;
                } else if (id === "twin_page_main") {
                    currentPage = 1;
                } else if (id === "twin_page_shared") {
                    currentPage = 2;
                } else if (id === "twin_page_top") {
                    currentPage = 3;
                } else if (id === "twin_prev") {
                    if (currentCandidateIdx > 0) currentCandidateIdx--;
                } else if (id === "twin_next") {
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

run.description = {
    header: t("es", "commands.twins.header"),
    body: t("es", "commands.twins.body"),
    usage: t("es", "commands.twins.usage")
};

module.exports = {
    run,
    alias: run.alias,
    description: run.description
};
