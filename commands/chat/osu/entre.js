const { getOsuUser, getUserTopScores, argsParserNoCommand } = require("../../utils/osu.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");
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
        if (!user_found) {
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
        } catch (err) {
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

    // Fetch top scores for both users to get their highest PP plays
    const [scoresA, scoresB] = await Promise.all([
        getUserTopScores({ username: [userA.id], gamemode, server }).catch(() => null),
        getUserTopScores({ username: [userB.id], gamemode, server }).catch(() => null)
    ]);

    const topPpA = scoresA && scoresA[0] ? (scoresA[0].pp || 0) : 0;
    const topPpB = scoresB && scoresB[0] ? (scoresB[0].pp || 0) : 0;

    // Compare stats to calculate wins
    let winsA = 0;
    let winsB = 0;

    // PP
    const ppA = userA.statistics.pp || 0;
    const ppB = userB.statistics.pp || 0;
    if (ppA > ppB) winsA++;
    else if (ppB > ppA) winsB++;

    // Rank (lower is better, but handle nulls)
    const rankA = userA.statistics.global_rank;
    const rankB = userB.statistics.global_rank;
    if (!rankA && rankB) {
        winsB++;
    } else if (rankA && !rankB) {
        winsA++;
    } else if (rankA && rankB) {
        if (rankA < rankB) winsA++;
        else if (rankB < rankA) winsB++;
    }

    // Max Combo
    const mcA = userA.statistics.maximum_combo || 0;
    const mcB = userB.statistics.maximum_combo || 0;
    if (mcA > mcB) winsA++;
    else if (mcB > mcA) winsB++;

    // Accuracy
    const accA = userA.statistics.hit_accuracy || 0;
    const accB = userB.statistics.hit_accuracy || 0;
    if (accA > accB) winsA++;
    else if (accB > accA) winsB++;

    // Ranked Score
    const rsA = userA.statistics.ranked_score || 0;
    const rsB = userB.statistics.ranked_score || 0;
    if (rsA > rsB) winsA++;
    else if (rsB > rsA) winsB++;

    // Top PP (Highest PP play)
    if (topPpA > topPpB) winsA++;
    else if (topPpB > topPpA) winsB++;

    // Playcount
    const pcA = userA.statistics.play_count || 0;
    const pcB = userB.statistics.play_count || 0;
    if (pcA > pcB) winsA++;
    else if (pcB > pcA) winsB++;

    // Playtime
    const ptA = userA.statistics.play_time || 0;
    const ptB = userB.statistics.play_time || 0;
    if (ptA > ptB) winsA++;
    else if (ptB > ptA) winsB++;

    // Level
    const lvlA = (userA.statistics.level?.current || 0) + (userA.statistics.level?.progress || 0) / 100;
    const lvlB = (userB.statistics.level?.current || 0) + (userB.statistics.level?.progress || 0) / 100;
    if (lvlA > lvlB) winsA++;
    else if (lvlB > lvlA) winsB++;

    const embed = doOsuCompareStatsEmbed(message, userA, userB, gamemode, server, winsA, winsB, locale, topPpA, topPpB);
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
