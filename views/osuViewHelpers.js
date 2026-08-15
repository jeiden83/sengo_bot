const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const emoji_mods = require("../src/emoji_mods.json");
const emoji_grades = require("../src/emoji_grades.json");
const emoji_difficulties = require("../src/emoji_difficulties.json");
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
    if (!statistics || statistics.is_estimated) {
        if (mode === 'mania') return `[?/?/?/?/?/?]`;
        if (mode === 'taiko') return `[?/?/?]`;
        return `[?/?/?/?]`;
    }
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
    if (!statistics || statistics.is_estimated) {
        if (mode === 'mania') return `[?/?/?/?/?/?]`;
        if (mode === 'taiko') return `[?/?/?]`;
        return `[?/?/?/?]`;
    }
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

function isLovedScore(score) {
    if (!score) return false;
    const b = score.beatmap || {};
    const bs = score.beatmapset || {};
    const status = b.status ?? bs.status ?? b.ranked_status ?? bs.ranked_status ?? b.ranked ?? bs.ranked ?? score.beatmap_status ?? score.status;
    if (typeof status === 'string' && status.toLowerCase() === 'loved') return true;
    if (status === 4) return true;
    return false;
}

function buildAnsiBlock(stats_str, user_pp, max_pp, pp_fc) {
    const maxPpStr = (max_pp !== null && max_pp !== undefined) ? `${max_pp.toFixed(2)}PP` : '';
    const ppStr = pp_fc 
        ? `${colorear(user_pp + 'PP')}/${colorear("(" + pp_fc.toFixed(2) + "PP)", "amarillo")}` 
        : `${colorear(user_pp + 'PP')}${maxPpStr ? '/' + colorear(maxPpStr, "amarillo") : ''}`;
    return `\`\`\`ansi\n${stats_str} • ${ppStr}\n\`\`\``;
}

function hexToAnsiColor(hex) {
    if (!hex || typeof hex !== 'string') return "amarillo";
    const cleaned = hex.replace('#', '');
    const num = parseInt(cleaned, 16);
    if (isNaN(num)) return "amarillo";
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;

    const ansiMap = [
        { name: "rojo", r: 255, g: 85, b: 85 },
        { name: "verde", r: 85, g: 255, b: 85 },
        { name: "amarillo", r: 255, g: 215, b: 0 },
        { name: "azul", r: 85, g: 85, b: 255 },
        { name: "magenta", r: 200, g: 85, b: 255 },
        { name: "cyan", r: 85, g: 255, b: 255 },
        { name: "blanco", r: 255, g: 255, b: 255 }
    ];

    let closest = "amarillo";
    let minDist = Infinity;
    for (const c of ansiMap) {
        const dist = Math.hypot(r - c.r, g - c.g, b - c.b);
        if (dist < minDist) {
            minDist = dist;
            closest = c.name;
        }
    }
    return closest;
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
    if (typeof stars !== 'number' || isNaN(stars) || stars <= 0) return emoji_difficulties["easy"];
    if (stars < 2.0) return emoji_difficulties["easy"];        // Easy: 0.0 - 1.99
    if (stars < 2.7) return emoji_difficulties["normal"];      // Normal: 2.0 - 2.69
    if (stars < 4.0) return emoji_difficulties["hard"];        // Hard: 2.7 - 3.99
    if (stars < 5.3) return emoji_difficulties["insane"];      // Insane: 4.0 - 5.29
    if (stars < 6.5) return emoji_difficulties["expert"];      // Expert: 5.3 - 6.49
    return emoji_difficulties["expert_plus"];                  // Expert+: 6.5 and above
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

const GAMEMODE_DISPLAY_NAMES = {
    'osu': 'std',
    'taiko': 'taiko',
    'fruits': 'catch',
    'mania': 'mania'
};

function getDisplayGamemode(mode) {
    if (!mode) return 'std';
    const m = String(mode).toLowerCase();
    return GAMEMODE_DISPLAY_NAMES[m] || (m === 'ctb' ? 'catch' : m);
}

/**
 * Calcula las estadísticas modificadas del beatmap con los mods y genera la línea formateada
 * con indicadores de aumento (▲) o disminución (▼).
 * Ej: `CS 5.2▲ | AR 10▲ | OD 10▲ | HP 7▲ | BPM 180`
 */
function getBeatmapStatsLine(beatmap = {}, mods = [], mode = 'osu') {
    const rosu = require('rosu-pp-js');
    const baseCs = beatmap.cs !== undefined ? beatmap.cs : 0;
    const baseAr = beatmap.ar !== undefined ? beatmap.ar : (beatmap.accuracy !== undefined ? beatmap.accuracy : 0);
    const baseOd = beatmap.accuracy !== undefined ? beatmap.accuracy : (beatmap.od !== undefined ? beatmap.od : (beatmap.ar !== undefined ? beatmap.ar : 0));
    const baseHp = beatmap.drain !== undefined ? beatmap.drain : (beatmap.hp !== undefined ? beatmap.hp : 0);
    const baseBpm = Math.round(beatmap.bpm || 0);

    const rosuModeMap = {
        'osu': rosu.GameMode.Osu,
        'taiko': rosu.GameMode.Taiko,
        'fruits': rosu.GameMode.Catch,
        'catch': rosu.GameMode.Catch,
        'ctb': rosu.GameMode.Catch,
        'mania': rosu.GameMode.Mania,
        0: rosu.GameMode.Osu,
        1: rosu.GameMode.Taiko,
        2: rosu.GameMode.Catch,
        3: rosu.GameMode.Mania
    };
    const activeMode = rosuModeMap[mode] !== undefined ? rosuModeMap[mode] : rosu.GameMode.Osu;

    let modCs = baseCs;
    let modAr = baseAr;
    let modOd = baseOd;
    let modHp = baseHp;
    let clockRate = 1.0;

    try {
        const builder = new rosu.BeatmapAttributesBuilder({
            cs: baseCs,
            ar: baseAr,
            od: baseOd,
            hp: baseHp,
            mode: activeMode,
            mods: mods || []
        });
        const attrs = builder.build();
        if (attrs) {
            modCs = attrs.cs !== undefined ? attrs.cs : baseCs;
            modAr = attrs.ar !== undefined ? attrs.ar : baseAr;
            modOd = attrs.od !== undefined ? attrs.od : baseOd;
            modHp = attrs.hp !== undefined ? attrs.hp : baseHp;
            clockRate = attrs.clockRate || 1.0;
        }
    } catch (err) {
        // En caso de error, se mantienen las estadísticas base
    }

    const modBpm = Math.round(baseBpm * clockRate);

    const formatStat = (label, baseVal, modVal, decimals = 1) => {
        const diff = modVal - baseVal;
        let arrow = '';
        if (diff > 0.01) arrow = '▲';
        else if (diff < -0.01) arrow = '▼';

        const rounded = Number(modVal.toFixed(decimals));
        return `${label} ${rounded}${arrow}`;
    };

    const csDecimals = (mode === 'mania' || mode === 3) ? 0 : 1;
    const csStr = formatStat('CS', baseCs, modCs, csDecimals);
    const arStr = formatStat('AR', baseAr, modAr, 1);
    const odStr = formatStat('OD', baseOd, modOd, 1);
    const hpStr = formatStat('HP', baseHp, modHp, 1);
    const bpmStr = formatStat('BPM', baseBpm, modBpm, 0);

    return `\`${csStr} | ${arStr} | ${odStr} | ${hpStr} | ${bpmStr}\``;
}

module.exports = {
    getEmbedColor,
    getFormattedScore,
    getGradeEmoji,
    formatMods,
    getStatsString,
    getPlainStatsString,
    buildAnsiBlock,
    hexToAnsiColor,
    getFlagEmoji,
    buildPaginationRow,
    buildRecentButtonsRow,
    buildCompareSingleButtonsRow,
    buildTopSingleButtonsRow,
    getDifficultyEmoji,
    isLovedScore,
    getDisplayGamemode,
    getBeatmapStatsLine
};

