const emoji_mods = require("../src/emoji_mods.json");
const emoji_grades = require("../src/emoji_grades.json");
const { colorear } = require("../commands/utils/admin.js");

function getEmbedColor(message) {
    const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    return roleColor !== 0 && roleColor !== undefined ? roleColor : '#ffffff';
}

function getFormattedScore(score) {
    const raw_score = (score.legacy_total_score && score.legacy_total_score > 0) ? score.legacy_total_score :
                      (score.classic_total_score && score.classic_total_score > 0) ? score.classic_total_score :
                      score.total_score || score.score || 0;
    return raw_score.toLocaleString('es-ES');
}

function getGradeEmoji(rank, passed) {
    const rank_aliases = { "SS": "X", "SSH": "XH" };
    const rank_key = !passed ? "F" : (rank_aliases[rank] ?? rank);
    const grade_emoji = emoji_grades[rank_key] ?? emoji_grades["F"];
    return grade_emoji[0] === "grade_f" ? `:${grade_emoji[1]}:` : `<:${grade_emoji[0]}:${grade_emoji[1]}>`;
}

function formatMods(mods, isLazer) {
    if (!mods) return `<:NM:${emoji_mods["NM"]}>`;
    
    const modsCopy = [...mods];
    if (!isLazer) {
        const hasCL = modsCopy.some(m => (m.acronym || m) === 'CL');
        if (!hasCL) {
            const isObjectMod = modsCopy.length > 0 && typeof modsCopy[0] === 'object';
            if (isObjectMod) {
                modsCopy.push({ acronym: 'CL' });
            } else {
                modsCopy.push('CL');
            }
        }
    }

    if (modsCopy.length === 0) return `<:NM:${emoji_mods["NM"]}>`;

    return modsCopy.reduce((acc, mod) => {
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
    }, '');
}

function getStatsString(statistics = {}, mode = 'osu') {
    const perfect = statistics.perfect !== undefined ? statistics.perfect : (statistics.count_geki || 0);
    const great = statistics.great !== undefined ? statistics.great : (statistics.count_300 || 0);
    const good = statistics.good !== undefined ? statistics.good : (statistics.count_katu || 0);
    const ok = statistics.ok !== undefined ? statistics.ok : (statistics.count_100 || 0);
    const meh = statistics.meh !== undefined ? statistics.meh : (statistics.count_50 || 0);
    const miss = statistics.miss !== undefined ? statistics.miss : (statistics.count_miss || 0);

    if (mode === 'mania') {
        return `[${colorear(perfect, "cyan")}/${colorear(great, "amarillo")}/${colorear(good, "verde")}/${colorear(ok, "azul")}/${colorear(meh, "magenta")}/${colorear(miss, "rojo")}]`;
    } else if (mode === 'taiko') {
        return `[${colorear(great, "azul")}/${colorear(ok, "verde")}/${colorear(miss, "rojo")}]`;
    } else {
        return `[${colorear(great, "azul")}/${colorear(ok, "verde")}/${colorear(meh, "amarillo")}/${colorear(miss, "rojo")}]`;
    }
}

function getPlainStatsString(statistics = {}, mode = 'osu') {
    const perfect = statistics.perfect !== undefined ? statistics.perfect : (statistics.count_geki || 0);
    const great = statistics.great !== undefined ? statistics.great : (statistics.count_300 || 0);
    const good = statistics.good !== undefined ? statistics.good : (statistics.count_katu || 0);
    const ok = statistics.ok !== undefined ? statistics.ok : (statistics.count_100 || 0);
    const meh = statistics.meh !== undefined ? statistics.meh : (statistics.count_50 || 0);
    const miss = statistics.miss !== undefined ? statistics.miss : (statistics.count_miss || 0);

    if (mode === 'mania') {
        return `[${perfect}/${great}/${good}/${ok}/${meh}/${miss}]`;
    } else if (mode === 'taiko') {
        return `[${great}/${ok}/${miss}]`;
    } else {
        return `[${great}/${ok}/${meh}/${miss}]`;
    }
}

function buildAnsiBlock(stats_str, user_pp, max_pp, pp_fc, accuracy, ratio_str, combo, max_combo) {
    let pp_fc_str = pp_fc ? ` ${colorear("if(" + pp_fc.toFixed(2) + "PP)", "amarillo")}` : "";
    return `\`\`\`ansi\n${stats_str} ${colorear(user_pp + 'PP')}/${max_pp.toFixed(2)}PP${pp_fc_str} ${accuracy}%${ratio_str} x${combo}/${colorear(max_combo)}\n\`\`\``;
}

const getFlagEmoji = (countryCode) => {
    if (!countryCode || typeof countryCode !== 'string') return "🏴";
    return countryCode
        .toUpperCase()
        .replace(/./g, char => String.fromCodePoint(0x1F1E6 - 65 + char.charCodeAt()));
};

module.exports = {
    getEmbedColor,
    getFormattedScore,
    getGradeEmoji,
    formatMods,
    getStatsString,
    getPlainStatsString,
    buildAnsiBlock,
    getFlagEmoji
};
