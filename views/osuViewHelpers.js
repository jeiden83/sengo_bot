const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const emoji_mods = require("../src/emoji_mods.json");
const emoji_grades = require("../src/emoji_grades.json");
const { colorear } = require("../commands/utils/admin.js");

function getEmbedColor(message) {
    const roleColor = message.member?.roles?.highest?.color || '#ffffff';
    return roleColor !== 0 && roleColor !== undefined ? roleColor : '#ffffff';
}

function getFormattedScore(score, scoreMode = 'classic') {
    const raw_score = scoreMode === 'lazer'
        ? (score.total_score || score.score || 0)
        : ((score.legacy_total_score && score.legacy_total_score > 0) ? score.legacy_total_score :
           (score.classic_total_score && score.classic_total_score > 0) ? score.classic_total_score :
           score.total_score || score.score || 0);
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

/**
 * Genera una fila de botones de paginación estándar (<<, <, >, >>).
 * @param {Object} params - Parámetros de configuración.
 * @param {string} params.prefix - Prefijo para los customIds (ej: 'amigos', 'rsl', 'con').
 * @param {number} params.current - El valor actual (puede ser 0-indexed start o 1-indexed index).
 * @param {number} params.total - El total de elementos o páginas.
 * @param {number} [params.pageSize=10] - El tamaño del paso (solo usado para 0-indexed).
 * @param {boolean} [params.oneIndexed=false] - Indica si el valor 'current' y los límites están basados en 1 (como rs_newest o top_first).
 * @param {Object} [params.customSuffixes] - Sufijos personalizados opcionales para los customIds.
 * @returns {ActionRowBuilder} Fila de acción con los botones configurados.
 */
function buildPaginationRow({ prefix, current, total, pageSize = 10, oneIndexed = false, customSuffixes = null }) {
    const suffixes = customSuffixes || (oneIndexed
        ? { first: 'newest', prev: 'newer', next: 'older', last: 'oldest' }
        : { first: 'first', prev: 'prev', next: 'next', last: 'last' });

    let disablePrev = false;
    let disableNext = false;

    if (oneIndexed) {
        disablePrev = current <= 1;
        disableNext = current >= total;
    } else {
        disablePrev = current <= 0;
        disableNext = current + pageSize >= total;
    }

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${prefix}_${suffixes.first}`)
            .setLabel('<<')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disablePrev),
        new ButtonBuilder()
            .setCustomId(`${prefix}_${suffixes.prev}`)
            .setLabel('<')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disablePrev),
        new ButtonBuilder()
            .setCustomId(`${prefix}_${suffixes.next}`)
            .setLabel('>')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disableNext),
        new ButtonBuilder()
            .setCustomId(`${prefix}_${suffixes.last}`)
            .setLabel('>>')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disableNext)
    );
}

function getDifficultyEmoji(stars) {
    if (!stars || typeof stars !== 'number') return '⚪';
    if (stars < 2.0) return '🟢'; // Easy
    if (stars < 2.7) return '🔵'; // Normal
    if (stars < 4.0) return '🟡'; // Hard
    if (stars < 5.3) return '🔴'; // Insane
    if (stars < 6.5) return '🟣'; // Expert
    return '⚫'; // Expert+
}

/**
 * Genera la fila de botones de paginación para Recent Score, añadiendo el botón de renderizar si procede.
 */
function buildRecentButtonsRow(current, total, score, renderDisabled = false, scoreMode = 'classic') {
    const row1 = buildPaginationRow({ prefix: 'rs', current, total, oneIndexed: true });

    const canRender = score &&
        (score.mode === 'osu' || score.ruleset_id === 0) &&
        (score.id !== undefined && score.id !== null) &&
        score.replay === true;

    const row2 = new ActionRowBuilder();
    if (canRender) {
        row2.addComponents(
            new ButtonBuilder()
                .setCustomId('rs_render')
                .setLabel('🎬')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(renderDisabled)
        );
    }

    const toggleLabel = scoreMode === 'lazer' ? 'Classic 🎮' : 'Lazer 🌐';
    const toggleId = `rs_toggle_score_${scoreMode}`;
    row2.addComponents(
        new ButtonBuilder()
            .setCustomId(toggleId)
            .setLabel(toggleLabel)
            .setStyle(ButtonStyle.Secondary)
    );

    return [row1, row2];
}

/**
 * Genera la fila de botones de paginación para Compare Single, añadiendo el botón de renderizar si procede.
 */
function buildCompareSingleButtonsRow(current, total, score, renderDisabled = false, scoreMode = 'classic') {
    const row1 = buildPaginationRow({
        prefix: 'c_single',
        current,
        total,
        oneIndexed: true,
        customSuffixes: { first: 'first', prev: 'prev', next: 'next', last: 'last' }
    });

    const canRender = score &&
        (score.mode === 'osu' || score.ruleset_id === 0) &&
        (score.id !== undefined && score.id !== null) &&
        score.replay === true;

    const row2 = new ActionRowBuilder();
    if (canRender) {
        row2.addComponents(
            new ButtonBuilder()
                .setCustomId('c_single_render')
                .setLabel('🎬')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(renderDisabled)
        );
    }

    const toggleLabel = scoreMode === 'lazer' ? 'Classic 🎮' : 'Lazer 🌐';
    const toggleId = `c_single_toggle_score_${scoreMode}`;
    row2.addComponents(
        new ButtonBuilder()
            .setCustomId(toggleId)
            .setLabel(toggleLabel)
            .setStyle(ButtonStyle.Secondary)
    );

    return [row1, row2];
}

/**
 * Genera la fila de botones de paginación para Top Single Play, añadiendo el botón de renderizar y de alternar modo.
 */
function buildTopSingleButtonsRow(current, total, score, renderDisabled = false, scoreMode = 'classic') {
    const row1 = buildPaginationRow({
        prefix: 'top',
        current,
        total,
        oneIndexed: true,
        customSuffixes: { first: 'first', prev: 'prev', next: 'next', last: 'last' }
    });

    const canRender = score &&
        (score.mode === 'osu' || score.ruleset_id === 0) &&
        (score.id !== undefined && score.id !== null) &&
        score.replay === true;

    const row2 = new ActionRowBuilder();
    if (canRender) {
        row2.addComponents(
            new ButtonBuilder()
                .setCustomId('top_render')
                .setLabel('🎬')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(renderDisabled)
        );
    }

    const toggleLabel = scoreMode === 'lazer' ? 'Classic 🎮' : 'Lazer 🌐';
    const toggleId = `top_toggle_score_${scoreMode}`;
    row2.addComponents(
        new ButtonBuilder()
            .setCustomId(toggleId)
            .setLabel(toggleLabel)
            .setStyle(ButtonStyle.Secondary)
    );

    return [row1, row2];
}

module.exports = {
    getEmbedColor,
    getFormattedScore,
    getGradeEmoji,
    formatMods,
    getStatsString,
    getPlainStatsString,
    buildAnsiBlock,
    getFlagEmoji,
    buildPaginationRow,
    buildRecentButtonsRow,
    buildCompareSingleButtonsRow,
    buildTopSingleButtonsRow,
    getDifficultyEmoji
};

