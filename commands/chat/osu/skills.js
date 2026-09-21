const { t } = require("../../../utils/i18n.js");
const { getOsuUser, getUserTopScores, argsParser } = require("../../utils/osu.js");
const { analyzeSkillsBreakdown, saveUserSkills, getCountrySkillsLeaderboard, getServerSkillsLeaderboard } = require("../../../models/SkillsModel.js");
const { doOsuSkillsEmbed, doOsuSkillsRankingEmbed } = require("../../../views/osuSkillsView.js");
const { buildPaginationRow } = require("../../../views/osuViewHelpers.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");

async function run(messages, args) {
    const { message, res, logger } = messages;
    const locale = message?.locale || "es";
    const safeArgs = Array.isArray(args) ? args : [];

    // Mapeo de alias de habilidades para filtrado en -top y ranking nacional/servidor
    const SKILL_ALIASES = {
        aim: "aim",
        speed: "speed",
        acc: "acc",
        accuracy: "acc",
        precision: "acc",
        reading: "reading",
        read: "reading",
        stamina: "stamina",
        stam: "stamina",
        color: "color",
        colour: "color",
        rhythm: "rhythm",
        movement: "movement",
        move: "movement",
        stream: "stream",
        jack: "jack",
        jacks: "jack",
        tech: "tech",
        ln: "tech",
        pp: "pp"
    };

    // Flags que activan el ranking nacional de habilidades
    const NATIONAL_FLAGS = new Set([
        "-nacional", "--nacional", "-nac", "--nac",
        "-national", "--national",
        "-lb", "--lb", "-leaderboard", "--leaderboard"
    ]);

    // Flags que activan el ranking de habilidades del servidor (miembros vinculados)
    const SERVER_FLAGS = new Set([
        "-server", "--server",
        "-servidor", "--servidor",
        "-guild", "--guild",
        "-srv", "--srv"
    ]);

    let isNational = false;
    let isServer = false;
    let isForce = false;
    let targetGuildId = null;
    let countryArg = null;
    let selectedSkill = null;
    const countryCodesData = require("../../../src/country_codes.json");

    for (let i = 0; i < safeArgs.length; i++) {
        const arg = safeArgs[i];
        if (typeof arg !== "string") continue;
        const lower = arg.toLowerCase().trim();
        const stripped = lower.replace(/^--?/, "");

        if (["-force", "--force", "-f", "-refresh", "--refresh", "-recargar"].includes(lower)) {
            isForce = true;
            continue;
        }

        // 1. Caso flag con prefijo y separador : o = (ej: -server:123456, --server=123456, -srv:123456)
        const inlineMatch = lower.match(/^--(server|servidor|guild|srv)[:=](.+)$/) || lower.match(/^-(server|servidor|guild|srv)[:=](.+)$/);
        if (inlineMatch) {
            isServer = true;
            const possibleId = inlineMatch[2].trim();
            if (/^\d{6,22}$/.test(possibleId)) {
                targetGuildId = possibleId;
            }
            continue;
        }

        if (SERVER_FLAGS.has(lower)) {
            isServer = true;
            if (i + 1 < safeArgs.length) {
                const nextCandidate = String(safeArgs[i + 1]).trim();
                const nextStripped = nextCandidate.toLowerCase().replace(/^--?/, "");
                // Si no es un alias de skill ni flag y es numérico (ID de servidor)
                if (!SKILL_ALIASES[nextStripped] && !nextCandidate.startsWith("-") && /^\d{6,22}$/.test(nextCandidate)) {
                    targetGuildId = nextCandidate;
                    i++;
                }
            }
            continue;
        }

        if (NATIONAL_FLAGS.has(lower)) {
            isNational = true;
            continue;
        }

        if (lower === "-pais" || lower === "--pais" || lower === "-country" || lower === "--country") {
            isNational = true;
            if (i + 1 < safeArgs.length && !safeArgs[i + 1].startsWith("-")) {
                countryArg = safeArgs[i + 1].trim().toUpperCase();
                i++;
            }
            continue;
        }

        if (["skills", "skill", "s"].includes(stripped)) {
            if (i + 1 < safeArgs.length) {
                const nextStripped = safeArgs[i + 1].toLowerCase().replace(/^--?/, "");
                if (SKILL_ALIASES[nextStripped]) {
                    selectedSkill = SKILL_ALIASES[nextStripped];
                    i++;
                }
            }
            continue;
        }

        if (SKILL_ALIASES[stripped]) {
            selectedSkill = SKILL_ALIASES[stripped];
            continue;
        }

        // Si es código ISO de 2 letras y coincide con el catálogo de países
        if (/^[a-zA-Z]{2}$/.test(arg)) {
            const pot = arg.toUpperCase();
            if (countryCodesData[pot]) {
                countryArg = pot;
            }
        }
    }

    // Si se especificó un país directo con -top (ej: s.skills -top VE), interpretar como ranking nacional
    if (countryArg && safeArgs.some(a => typeof a === "string" && (a.toLowerCase() === "-top" || a.toLowerCase() === "--top"))) {
        isNational = true;
    }

    // 🏠 Flujo de Ranking de Servidor de Habilidades (jugadores vinculados en el Discord actual o especificado)
    if (isServer) {
        let targetGuild = null;
        let serverName = null;
        let serverIconUrl = null;

        if (targetGuildId) {
            targetGuild = message.client?.guilds?.cache?.get(targetGuildId);
            if (!targetGuild && typeof message.client?.guilds?.fetch === "function") {
                targetGuild = await message.client.guilds.fetch(targetGuildId).catch(() => null);
            }

            if (targetGuild) {
                serverName = targetGuild.name;
                serverIconUrl = targetGuild.iconURL ? targetGuild.iconURL({ extension: "png", size: 128 }) : null;
            } else {
                // Si el bot no está en el servidor (ej: dev sengo consultando un servidor donde solo está sengo de render)
                serverName = `Servidor (${targetGuildId})`;
                try {
                    const { getSupabaseClient } = require("../../../db/database.js");
                    const supabase = getSupabaseClient();
                    if (supabase) {
                        const { data: wh } = await supabase
                            .from('webhook_channels')
                            .select('guild_name')
                            .eq('guild_id', targetGuildId)
                            .maybeSingle();
                        if (wh && wh.guild_name) {
                            serverName = wh.guild_name;
                        }
                    }
                } catch {}

                if (serverName === `Servidor (${targetGuildId})`) {
                    try {
                        const widgetRes = await fetch(`https://discord.com/api/guilds/${targetGuildId}/widget.json`, { signal: AbortSignal.timeout(1500) });
                        if (widgetRes.ok) {
                            const widgetData = await widgetRes.json();
                            if (widgetData?.name) serverName = widgetData.name;
                        }
                    } catch {}
                }
            }
        } else {
            targetGuild = message.guild;
            if (!targetGuild) {
                const err = t(locale, "skills.server_dm_error") || "❌ Este comando con `-server` solo puede utilizarse dentro de un servidor de Discord o indicando la ID del servidor.";
                if (typeof message.reply === "function") return await message.reply(err);
                return message.channel?.send ? await message.channel.send(err) : err;
            }
            serverName = targetGuild.name;
            serverIconUrl = targetGuild.iconURL ? targetGuild.iconURL({ extension: "png", size: 128 }) : null;
        }

        let targetMode = "osu";
        for (const arg of safeArgs) {
            if (typeof arg !== "string") continue;
            const lower = arg.toLowerCase();
            if (["-t", "-taiko", "--taiko", "taiko"].includes(lower)) targetMode = "taiko";
            else if (["-c", "-catch", "--catch", "catch", "-ctb", "--ctb", "ctb", "-fruits", "--fruits", "fruits"].includes(lower)) targetMode = "fruits";
            else if (["-mania", "--mania", "mania"].includes(lower) || lower === "-m") targetMode = "mania";
            else if (["-std", "--std", "std", "-osu", "--osu", "osu"].includes(lower)) targetMode = "osu";
        }

        if (logger) logger.process(`Consultando miembros vinculados en ${serverName}...`);

        const effectiveGuildId = targetGuild ? targetGuild.id : targetGuildId;
        const isBotInGuild = message.client?.guilds?.cache?.has(effectiveGuildId);

        // Si el bot no está en el servidor (ej. User-Installed App en servidor externo), advertir que se requiere a Sengo en el servidor
        if (!isBotInGuild) {
            const err = t(locale, "skills.server_not_member") || "❌ Esta opción requiere que Sengo sea miembro de este servidor de Discord para poder consultar los perfiles y jugadas de sus integrantes. ¡Invita a Sengo al servidor para usar el ranking de habilidades del servidor!";
            if (typeof message.reply === "function") return await message.reply(err);
            return message.channel?.send ? await message.channel.send(err) : err;
        }

        const linkedUsers = await OsuUserModel.getLinkedUsers({ guildId: effectiveGuildId, guild: targetGuild });
        let osuIds = (linkedUsers || []).map(u => String(u.osu_id)).filter(Boolean);

        // Si el bot está en el servidor, enriquecer con miembros en caché de Discord
        if (targetGuild) {
            let membersCache = targetGuild.members?.cache;
            if (typeof targetGuild.members?.fetch === "function") {
                try {
                    membersCache = await targetGuild.members.fetch();
                } catch {
                    membersCache = targetGuild.members?.cache;
                }
            }

            if (membersCache) {
                const linkedMap = await OsuUserModel.getLinkedUsersMap();
                for (const [osuId, info] of linkedMap.entries()) {
                    if (info.discord_id && membersCache.has(info.discord_id)) {
                        if (!osuIds.includes(osuId)) {
                            osuIds.push(osuId);
                        }
                    }
                }
            }

            // Si el autor del comando está en este servidor y vinculado, asegurarse de que esté incluido
            try {
                if (membersCache && message.author?.id && membersCache.has(message.author.id)) {
                    const authorToken = await OsuUserModel.getOAuthTokenRecord(message.author.id);
                    if (authorToken && authorToken.osu_id && !osuIds.includes(String(authorToken.osu_id))) {
                        osuIds.push(String(authorToken.osu_id));
                    }
                }
            } catch {}
        }

        // Si no se encontraron usuarios vinculados en el servidor
        if (osuIds.length === 0) {
            const err = t(locale, "skills.server_no_members", { server: serverName }) || `❌ No se encontraron jugadores de osu! vinculados a Sengo en **${serverName}**.`;
            if (typeof message.reply === "function") return await message.reply(err);
            return message.channel?.send ? await message.channel.send(err) : err;
        }

        const skillToQuery = selectedSkill || "aim";
        const pageSize = 10;
        let startIndex = 0;

        if (logger) logger.process(`Consultando ranking de servidor (${skillToQuery}) para ${serverName} (${osuIds.length} miembros vinculados)`);

        const initialData = await getServerSkillsLeaderboard({
            osuIds,
            gamemode: targetMode,
            skill: skillToQuery,
            limit: pageSize,
            offset: startIndex
        });

        const embed = doOsuSkillsRankingEmbed({
            players: initialData.players,
            totalCount: initialData.totalCount,
            startIndex,
            serverName: serverName,
            serverIcon: serverIconUrl,
            gamemode: targetMode,
            skill: skillToQuery,
            message,
            locale
        });

        const total = initialData.totalCount;
        const hasButtons = total > pageSize;
        const components = hasButtons
            ? [buildPaginationRow({ prefix: "skills_srv_lb", current: startIndex, total, pageSize })]
            : [];

        let sentMessage = null;
        if (typeof message.channel?.send === "function") {
            sentMessage = await message.channel.send({
                embeds: [embed],
                components
            });
        } else if (typeof message.reply === "function") {
            sentMessage = await message.reply({
                embeds: [embed],
                components
            });
        }

        if (!hasButtons || !sentMessage || typeof sentMessage.createMessageComponentCollector !== "function") {
            return sentMessage || { embeds: [embed], components };
        }

        const btnFilter = btnInt => btnInt.user.id === message.author?.id;
        const collector = sentMessage.createMessageComponentCollector({
            filter: btnFilter,
            idle: 60000
        });

        collector.on("collect", async i => {
            try {
                await i.deferUpdate();

                if (i.customId === "skills_srv_lb_first") {
                    startIndex = 0;
                } else if (i.customId === "skills_srv_lb_prev") {
                    startIndex = Math.max(0, startIndex - pageSize);
                } else if (i.customId === "skills_srv_lb_next") {
                    startIndex = startIndex + pageSize;
                } else if (i.customId === "skills_srv_lb_last") {
                    startIndex = Math.floor((total - 1) / pageSize) * pageSize;
                }

                const pageData = await getServerSkillsLeaderboard({
                    osuIds,
                    gamemode: targetMode,
                    skill: skillToQuery,
                    limit: pageSize,
                    offset: startIndex
                });

                const updatedEmbed = doOsuSkillsRankingEmbed({
                    players: pageData.players,
                    totalCount: pageData.totalCount,
                    startIndex,
                    serverName: serverName,
                    serverIcon: serverIconUrl,
                    gamemode: targetMode,
                    skill: skillToQuery,
                    message,
                    locale
                });

                const updatedComponents = [
                    buildPaginationRow({ prefix: "skills_srv_lb", current: startIndex, total, pageSize })
                ];

                await i.editReply({
                    embeds: [updatedEmbed],
                    components: updatedComponents
                });
            } catch (err) {
                console.error("[s.skills -server] Error al paginar leaderboard de servidor:", err.message);
            }
        });

        collector.on("end", async () => {
            try {
                const disabledComponents = [
                    buildPaginationRow({ prefix: "skills_srv_lb", current: startIndex, total, pageSize, disabled: true })
                ];
                await sentMessage.edit({ components: disabledComponents });
            } catch {}
        });

        return sentMessage;
    }

    // 🏆 Flujo de Ranking Nacional de Habilidades (cero llamadas on-the-fly, consulta 100% DB)
    if (isNational) {
        let targetMode = "osu";
        for (const arg of safeArgs) {
            if (typeof arg !== "string") continue;
            const lower = arg.toLowerCase();
            if (["-t", "-taiko", "--taiko", "taiko"].includes(lower)) targetMode = "taiko";
            else if (["-c", "-catch", "--catch", "catch", "-ctb", "--ctb", "ctb", "-fruits", "--fruits", "fruits"].includes(lower)) targetMode = "fruits";
            else if (["-mania", "--mania", "mania"].includes(lower) || lower === "-m") targetMode = "mania";
            else if (["-std", "--std", "std", "-osu", "--osu", "osu"].includes(lower)) targetMode = "osu";
        }

        let countryCode = countryArg;
        if (!countryCode || countryCode === "SELF") {
            try {
                const userToken = await OsuUserModel.getOAuthTokenRecord(message.author?.id);
                if (userToken && userToken.country_code) {
                    countryCode = userToken.country_code.toUpperCase();
                }
            } catch (err) {
                console.warn("[s.skills] Error al consultar país del autor en OAuth:", err.message);
            }
            if (!countryCode) countryCode = "VE";
        }

        const skillToQuery = selectedSkill || "aim";
        const pageSize = 10;
        let startIndex = 0;

        if (logger) logger.process(`Consultando ranking nacional de habilidades (${skillToQuery}) para ${countryCode}`);

        const initialData = await getCountrySkillsLeaderboard({
            countryCode,
            gamemode: targetMode,
            skill: skillToQuery,
            limit: pageSize,
            offset: startIndex
        });

        const embed = doOsuSkillsRankingEmbed({
            players: initialData.players,
            totalCount: initialData.totalCount,
            startIndex,
            countryCode: initialData.countryCode,
            gamemode: targetMode,
            skill: skillToQuery,
            message,
            locale
        });

        const total = initialData.totalCount;
        const hasButtons = total > pageSize;
        const components = hasButtons
            ? [buildPaginationRow({ prefix: "skills_lb", current: startIndex, total, pageSize })]
            : [];

        let sentMessage = null;
        if (typeof message.channel?.send === "function") {
            sentMessage = await message.channel.send({
                embeds: [embed],
                components
            });
        } else if (typeof message.reply === "function") {
            sentMessage = await message.reply({
                embeds: [embed],
                components
            });
        }

        if (!hasButtons || !sentMessage || typeof sentMessage.createMessageComponentCollector !== "function") {
            return sentMessage || { embeds: [embed], components };
        }

        const btnFilter = btnInt => btnInt.user.id === message.author?.id;
        const collector = sentMessage.createMessageComponentCollector({
            filter: btnFilter,
            idle: 60000
        });

        collector.on("collect", async i => {
            try {
                await i.deferUpdate();

                if (i.customId === "skills_lb_first") {
                    startIndex = 0;
                } else if (i.customId === "skills_lb_prev") {
                    startIndex = Math.max(0, startIndex - pageSize);
                } else if (i.customId === "skills_lb_next") {
                    startIndex = startIndex + pageSize;
                } else if (i.customId === "skills_lb_last") {
                    startIndex = Math.floor((total - 1) / pageSize) * pageSize;
                }

                const pageData = await getCountrySkillsLeaderboard({
                    countryCode,
                    gamemode: targetMode,
                    skill: skillToQuery,
                    limit: pageSize,
                    offset: startIndex
                });

                const updatedEmbed = doOsuSkillsRankingEmbed({
                    players: pageData.players,
                    totalCount: total,
                    startIndex,
                    countryCode: pageData.countryCode,
                    gamemode: targetMode,
                    skill: skillToQuery,
                    message,
                    locale
                });

                const updatedRow = buildPaginationRow({ prefix: "skills_lb", current: startIndex, total, pageSize });

                if (typeof sentMessage.edit === "function") {
                    await sentMessage.edit({
                        embeds: [updatedEmbed],
                        components: [updatedRow]
                    });
                }
            } catch (collectErr) {
                console.warn("[s.skills] Error en botón de paginación:", collectErr.message);
            }
        });

        collector.on("end", async () => {
            try {
                if (sentMessage && typeof sentMessage.edit === "function") {
                    await sentMessage.edit({ components: [] });
                }
            } catch {
                // Mensaje ya editado o borrado
            }
        });

        return sentMessage;
    }

    // ponytail: Si se incluye -top o un flag de habilidad (-reading, -aim, etc.) sin ser ranking nacional, delegar a mejores jugadas
    const hasSkillArg = safeArgs.some(arg => typeof arg === "string" && Boolean(SKILL_ALIASES[arg.toLowerCase().replace(/^--?/, "")]));
    const isTopMode = safeArgs.some(arg => typeof arg === "string" && (arg.toLowerCase() === "-top" || arg.toLowerCase() === "--top")) || hasSkillArg;
    if (isTopMode) {
        let requestedSkill = null;
        const cleanArgs = [];
        for (const arg of safeArgs) {
            if (typeof arg !== "string") continue;
            const lower = arg.toLowerCase();
            if (lower === "-top" || lower === "--top") continue;

            const stripped = lower.replace(/^--?/, "");
            if (SKILL_ALIASES[stripped]) {
                requestedSkill = SKILL_ALIASES[stripped];
                continue;
            }
            cleanArgs.push(arg);
        }

        const topCommand = require("./top.js");
        return await topCommand.run(messages, cleanArgs, {
            isSkillTop: true,
            requestedSkill
        });
    }

    // Detectar modo explícito si fue especificado por argumentos
    let explicitMode = null;
    for (const arg of safeArgs) {
        if (typeof arg !== "string") continue;
        const lower = arg.toLowerCase();
        if (["-t", "-taiko", "--taiko", "taiko"].includes(lower)) explicitMode = "taiko";
        else if (["-c", "-catch", "--catch", "catch", "-ctb", "--ctb", "ctb", "-fruits", "--fruits", "fruits"].includes(lower)) explicitMode = "fruits";
        else if (["-mania", "--mania", "mania"].includes(lower) || lower === "-m") explicitMode = "mania";
        else if (["-std", "--std", "std", "-osu", "--osu", "osu"].includes(lower)) explicitMode = "osu";
    }

    // Detectar servidor explícito si fue pasado en los argumentos (-droid, droid, -gatari, etc.)
    let explicitServer = null;
    for (const arg of safeArgs) {
        if (typeof arg !== "string") continue;
        const lower = arg.toLowerCase();
        if (["-droid", "--droid", "droid", "-osudroid", "--osudroid", "osudroid", "-od", "-odroid"].includes(lower)) explicitServer = "droid";
        else if (["-gatari", "--gatari", "gatari"].includes(lower)) explicitServer = "gatari";
        else if (["-bancho", "--bancho", "bancho"].includes(lower)) explicitServer = "bancho";
    }

    let osuUser = null;
    let detectedMode = explicitMode;

    if (logger) logger.process("Consultando usuario de osu!");

    if (safeArgs.length > 0) {
        const osuUserdata = await argsParser(safeArgs, {
            message,
            res: res || {},
            command_function: getOsuUser,
            gamemode: explicitMode,
            server: explicitServer,
            ignore_main_gamemode: Boolean(explicitMode),
            resolveUserByIndex: true,
            ignoreBeatmap: true
        });

        if (osuUserdata && osuUserdata.gamemode) {
            detectedMode = explicitMode || osuUserdata.gamemode;
        }

        if (osuUserdata && osuUserdata.fn_response) {
            if (typeof osuUserdata.fn_response === "string") {
                return osuUserdata.fn_response;
            }
            osuUser = osuUserdata.fn_response;
        }
    }

    const targetMode = detectedMode || osuUser?.playmode || "osu";

    if (!osuUser || !osuUser.id) {
        try {
            const linked = await OsuUserModel.getLinkedUser(res?.User, message.author?.id);
            const isDroid = explicitServer === "droid" || safeArgs.some(a => typeof a === "string" && ["-droid", "--droid", "-osudroid", "--osudroid", "droid", "osudroid"].includes(a.toLowerCase()));
            if (isDroid) {
                if (linked && linked.droid_uid) {
                    osuUser = await getOsuUser({ username: [String(linked.droid_uid)], gamemode: "osu", server: "droid" });
                } else {
                    return `⚠️ No tienes una cuenta de \`osu!droid\` vinculada. Usa \`s.droid link <nombre_o_uid>\` o especifica un usuario con \`s.skills -droid <usuario>\`.`;
                }
            } else if (linked && (linked.osu_id || linked.username)) {
                const queryUser = String(linked.osu_id || linked.username);
                osuUser = await getOsuUser({ username: [queryUser], gamemode: targetMode, server: explicitServer || "bancho" });
            }
        } catch (err) {
            console.warn("[s.skills] Error al obtener usuario vinculado:", err.message);
        }

        if (!osuUser || !osuUser.id) {
            return t(locale, "skills.err_no_user");
        }
    }

    if (!osuUser || !osuUser.id || typeof osuUser === "string") {
        return t(locale, "skills.err_user_not_found");
    }

    try {
        const targetServer = osuUser.server || explicitServer || "bancho";
        if (logger) logger.process(`Obteniendo Top 100 puntuaciones en ${targetMode} (${targetServer}) y analizando habilidades`);
        const topScores = await getUserTopScores({
            username: [String(osuUser.id)],
            gamemode: targetMode,
            server: targetServer,
            force: isForce
        }).catch(() => []);

        if (!topScores || topScores.length === 0) {
            return t(locale, "skills.err_no_scores", { username: osuUser.username });
        }

        const skillsBreakdown = await analyzeSkillsBreakdown(topScores, targetMode, {
            userId: osuUser.id,
            server: targetServer,
            forceRefresh: isForce
        });
        const embed = doOsuSkillsEmbed(message, osuUser, skillsBreakdown, locale);

        // Determinar si el osuUser consultado pertenece al autor del mensaje
        let authorDiscordId = null;
        try {
            const authorLinked = await OsuUserModel.getLinkedUser(res?.User, message.author?.id);
            if (authorLinked && String(authorLinked.osu_id) === String(osuUser.id)) {
                authorDiscordId = message.author?.id;
            }
        } catch {
            // Silenciar
        }

        // Auto-persistencia pasiva en Supabase en segundo plano (para cualquier usuario consultado)
        saveUserSkills({
            osuUser,
            skillsBreakdown,
            gamemode: targetMode,
            discordId: authorDiscordId
        }).catch(err => {
            console.warn("[s.skills] Error al persistir skills en background:", err.message);
        });

        return { embeds: [embed] };
    } catch (error) {
        console.error("[s.skills] Error al procesar desglose de habilidades:", error);
        return `❌ ${t(locale, "skills.err_generic", { error: error.message })}`;
    }
}

run.alias = {
    skill: true,
    ts: true
};

run.flags = [
    'gamemode',
    'server',
    'skills_breakdown',
    'country',
    'force',
    'target_user'
];

run.description = {
    header: t("es", "commands.skills.header"),
    body: t("es", "commands.skills.body"),
    usage: t("es", "commands.skills.usage")
};

module.exports = {
    run,
    description: run.description
};

