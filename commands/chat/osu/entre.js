const { getOsuUser, getUserTopScores, argsParserNoCommand } = require("../../utils/osu.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");
const OsuScoreModel = require("../../../models/OsuScoreModel.js");
const { analyzeSkills } = require("../../../models/SkillsModel.js");
const { doOsuCompareStatsEmbed } = require("../../../views/osuUserViews.js");
const { t } = require("../../../utils/i18n.js");

async function run(messages, args) {
    const { message, res } = messages;
    const locale = (message.locale || 'es').split('-')[0];

    // Parse arguments
    const parsed_args = argsParserNoCommand(args);
    const inputs = parsed_args.username[0] ? parsed_args.username[0].split(/\s+/).filter(Boolean) : [];

    let playerAInput, playerBInput;

    if (inputs.length === 0) {
        return t(locale, 'entre.err_usage');
    } else if (inputs.length === 1) {
        // Player A is the command invoker (author)
        const discord_id = message.author.id;
        const user_found = await OsuUserModel.getLinkedUser(res ? res.User : null, discord_id);
        if (!user_found || !user_found.osu_id) {
            return t(locale, 'entre.err_not_linked', { id: discord_id });
        }
        playerAInput = user_found.osu_id.toString();
        playerBInput = inputs[0];
    } else {
        playerAInput = inputs[0];
        playerBInput = inputs[1];
    }

    // Resolve gamemode and server
    let gamemode = parsed_args.gamemode;
    let server = parsed_args.server || "bancho";

    if (!gamemode) {
        const discord_id = message.author.id;
        const author_linked = await OsuUserModel.getLinkedUser(res ? res.User : null, discord_id);
        if (author_linked && author_linked.main_gamemode) {
            gamemode = author_linked.main_gamemode === "std" ? "osu" : author_linked.main_gamemode;
        } else {
            gamemode = "osu";
        }
    }

    if (gamemode === "std") {
        gamemode = "osu";
    }

    // Fetch user profiles in parallel
    const resolvePlayer = async (input) => {
        const isDiscordId = /^\d{17,20}$/.test(input);
        if (isDiscordId) {
            const user_found = await OsuUserModel.getLinkedUser(res ? res.User : null, input);
            if (!user_found) {
                return { error: 'not_linked', id: input };
            }
            return { osuId: user_found.osu_id };
        }
        return { osuUsername: input };
    };

    const [resolvedA, resolvedB] = await Promise.all([
        resolvePlayer(playerAInput),
        resolvePlayer(playerBInput)
    ]);

    if (resolvedA.error === 'not_linked') {
        return t(locale, 'entre.err_not_linked', { id: resolvedA.id });
    }
    if (resolvedB.error === 'not_linked') {
        return t(locale, 'entre.err_not_linked', { id: resolvedB.id });
    }

    const fetchProfile = async (resolved) => {
        const query = {
            username: [resolved.osuId || resolved.osuUsername],
            gamemode,
            server
        };
        try {
            const user = await getOsuUser(query);
            if (typeof user === 'string') {
                return { error: 'not_found', user: resolved.osuId || resolved.osuUsername };
            }
            return { user };
        } catch {
            return { error: 'not_found', user: resolved.osuId || resolved.osuUsername };
        }
    };

    const [profileA, profileB] = await Promise.all([
        fetchProfile(resolvedA),
        fetchProfile(resolvedB)
    ]);

    if (profileA.error) {
        return t(locale, 'entre.err_not_found', { user: profileA.user });
    }
    if (profileB.error) {
        return t(locale, 'entre.err_not_found', { user: profileB.user });
    }

    const userA = profileA.user;
    const userB = profileB.user;

    const modeToInt = {
        'osu': 0,
        'taiko': 1,
        'fruits': 2,
        'mania': 3
    };

    const modeInt = modeToInt[gamemode] ?? 0;
    const countryA = (userA.country_code || 'VE').toUpperCase();
    const countryB = (userB.country_code || 'VE').toUpperCase();

    // Fetch top scores, national tops count and snipes history in parallel
    const [scoresA, scoresB, nationalTopsA, nationalTopsB, snipesHistoryA, snipesHistoryB] = await Promise.all([
        getUserTopScores({ username: [userA.id], gamemode, server }).catch(() => null),
        getUserTopScores({ username: [userB.id], gamemode, server }).catch(() => null),
        OsuScoreModel.getUserNationalTopsCount(userA.id, modeInt, countryA).catch(() => 0),
        OsuScoreModel.getUserNationalTopsCount(userB.id, modeInt, countryB).catch(() => 0),
        OsuScoreModel.getUserSnipesHistory(userA.id).catch(() => ({ made: [], received: [] })),
        OsuScoreModel.getUserSnipesHistory(userB.id).catch(() => ({ made: [], received: [] }))
    ]);

    // --- Extra Stats & Skills Calculations ---
    const topPpA = scoresA && scoresA[0] ? (Number(scoresA[0].pp) || 0) : 0;
    const topPpB = scoresB && scoresB[0] ? (Number(scoresB[0].pp) || 0) : 0;

    // Promedio de PP y Stars de los mejores puntajes
    let avgPpA = 0;
    let avgSrA = 0;
    if (scoresA && scoresA.length > 0) {
        const validPp = scoresA.map(s => Number(s.pp || 0)).filter(p => p > 0);
        if (validPp.length > 0) {
            avgPpA = validPp.reduce((a, b) => a + b, 0) / validPp.length;
        }
        const validSr = scoresA.map(s => Number(s.beatmap?.difficulty_rating || 0)).filter(sr => sr > 0);
        if (validSr.length > 0) {
            avgSrA = validSr.reduce((a, b) => a + b, 0) / validSr.length;
        }
    }

    let avgPpB = 0;
    let avgSrB = 0;
    if (scoresB && scoresB.length > 0) {
        const validPp = scoresB.map(s => Number(s.pp || 0)).filter(p => p > 0);
        if (validPp.length > 0) {
            avgPpB = validPp.reduce((a, b) => a + b, 0) / validPp.length;
        }
        const validSr = scoresB.map(s => Number(s.beatmap?.difficulty_rating || 0)).filter(sr => sr > 0);
        if (validSr.length > 0) {
            avgSrB = validSr.reduce((a, b) => a + b, 0) / validSr.length;
        }
    }

    // Skills analíticas (Aim, Speed, Acc, Reading, etc.)
    let sumSkillsA = 0;
    let topSkillA = { key: '', val: 0 };
    if (scoresA && scoresA.length > 0) {
        const analyzedA = analyzeSkills(scoresA, false, gamemode);
        const keysA = analyzedA.skillKeys || ['aim', 'speed', 'acc', 'reading'];
        for (const k of keysA) {
            const val = Number(analyzedA[k]) || 0;
            sumSkillsA += val;
            if (val > topSkillA.val) {
                topSkillA = { key: k.toUpperCase(), val };
            }
        }
    }

    let sumSkillsB = 0;
    let topSkillB = { key: '', val: 0 };
    if (scoresB && scoresB.length > 0) {
        const analyzedB = analyzeSkills(scoresB, false, gamemode);
        const keysB = analyzedB.skillKeys || ['aim', 'speed', 'acc', 'reading'];
        for (const k of keysB) {
            const val = Number(analyzedB[k]) || 0;
            sumSkillsB += val;
            if (val > topSkillB.val) {
                topSkillB = { key: k.toUpperCase(), val };
            }
        }
    }

    // Ecosistema Sengo & Comunidad
    const snipesMadeA = snipesHistoryA?.made || [];
    const snipesMadeB = snipesHistoryB?.made || [];
    const snipesA = snipesMadeA.length;
    const snipesB = snipesMadeB.length;

    const cleanIdA = String(userA.id).replace(/\.0+$/, '');
    const cleanIdB = String(userB.id).replace(/\.0+$/, '');

    const directAtoB = snipesMadeA.filter(m => String(m.sniped_id || '').replace(/\.0+$/, '') === cleanIdB).length;
    const directBtoA = snipesMadeB.filter(m => String(m.sniped_id || '').replace(/\.0+$/, '') === cleanIdA).length;

    const rankedMapsA = Number(userA.ranked_and_approved_beatmapset_count || userA.ranked_beatmapset_count || 0);
    const rankedMapsB = Number(userB.ranked_and_approved_beatmapset_count || userB.ranked_beatmapset_count || 0);

    const kudosuA = Number(userA.kudosu?.total || 0);
    const kudosuB = Number(userB.kudosu?.total || 0);

    const medalsA = Array.isArray(userA.user_achievements) ? userA.user_achievements.length : 0;
    const medalsB = Array.isArray(userB.user_achievements) ? userB.user_achievements.length : 0;

    const natA = Number(nationalTopsA || 0);
    const natB = Number(nationalTopsB || 0);

    // Compare stats to calculate wins
    let winsA = 0;
    let winsB = 0;

    const compareMetric = (valA, valB, higherIsBetter = true) => {
        if (valA === valB) return;
        if (higherIsBetter) {
            if (valA > valB) winsA++;
            else if (valB > valA) winsB++;
        } else {
            // Lower is better (global rank)
            if (!valA && valB) winsB++;
            else if (valA && !valB) winsA++;
            else if (valA < valB) winsA++;
            else if (valB < valA) winsB++;
        }
    };

    // --- SECCIÓN 1: PERFIL GENERAL ---
    const ppA = userA.statistics?.pp || 0;
    const ppB = userB.statistics?.pp || 0;
    compareMetric(ppA, ppB, true);

    const rankA = userA.statistics?.global_rank;
    const rankB = userB.statistics?.global_rank;
    compareMetric(rankA, rankB, false);

    const accA = userA.statistics?.hit_accuracy || 0;
    const accB = userB.statistics?.hit_accuracy || 0;
    compareMetric(accA, accB, true);

    const mcA = userA.statistics?.maximum_combo || 0;
    const mcB = userB.statistics?.maximum_combo || 0;
    compareMetric(mcA, mcB, true);

    const rsA = userA.statistics?.ranked_score || 0;
    const rsB = userB.statistics?.ranked_score || 0;
    compareMetric(rsA, rsB, true);

    const ptA = userA.statistics?.play_time || 0;
    const ptB = userB.statistics?.play_time || 0;
    compareMetric(ptA, ptB, true);

    const lvlA = (userA.statistics?.level?.current || 0) + (userA.statistics?.level?.progress || 0) / 100;
    const lvlB = (userB.statistics?.level?.current || 0) + (userB.statistics?.level?.progress || 0) / 100;
    compareMetric(lvlA, lvlB, true);

    const pcA = userA.statistics?.play_count || 0;
    const pcB = userB.statistics?.play_count || 0;
    compareMetric(pcA, pcB, true);

    // --- SECCIÓN 2: RENDIMIENTO & SKILLS ---
    compareMetric(topPpA, topPpB, true);
    if (avgPpA > 0 || avgPpB > 0) compareMetric(avgPpA, avgPpB, true);
    if (avgSrA > 0 || avgSrB > 0) compareMetric(avgSrA, avgSrB, true);
    if (sumSkillsA > 0 || sumSkillsB > 0) compareMetric(sumSkillsA, sumSkillsB, true);
    if (topSkillA.val > 0 || topSkillB.val > 0) compareMetric(topSkillA.val, topSkillB.val, true);

    // --- SECCIÓN 3: ECOSISTEMA SENGO & COMUNIDAD ---
    if (natA > 0 || natB > 0) compareMetric(natA, natB, true);
    if (snipesA > 0 || snipesB > 0) compareMetric(snipesA, snipesB, true);
    if (rankedMapsA > 0 || rankedMapsB > 0) compareMetric(rankedMapsA, rankedMapsB, true);
    if (kudosuA > 0 || kudosuB > 0) compareMetric(kudosuA, kudosuB, true);
    if (medalsA > 0 || medalsB > 0) compareMetric(medalsA, medalsB, true);

    const extra = {
        topPpA,
        topPpB,
        avgPpA,
        avgPpB,
        avgSrA,
        avgSrB,
        sumSkillsA,
        sumSkillsB,
        topSkillA,
        topSkillB,
        nationalTopsA: natA,
        nationalTopsB: natB,
        snipesA,
        snipesB,
        rankedMapsA,
        rankedMapsB,
        kudosuA,
        kudosuB,
        medalsA,
        medalsB,
        directAtoB,
        directBtoA
    };

    const embed = doOsuCompareStatsEmbed(
        message,
        userA,
        userB,
        gamemode,
        server,
        winsA,
        winsB,
        locale,
        extra
    );
    return { embeds: [embed] };
}

run.alias = {
    "vs": {
        "args": ""
    },
};

run.description = {
    'header': t('es', 'commands.entre.header'),
    'body': t('es', 'commands.entre.body'),
    'usage': t('es', 'commands.entre.usage')
};

module.exports = { run, description: run.description };
