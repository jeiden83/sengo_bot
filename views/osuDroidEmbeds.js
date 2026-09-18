// views/osuDroidEmbeds.js
// Vistas y embeds para comandos de osu!droid en Sengo

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { t, formatNumber, formatDecimal } = require("../utils/i18n.js");
const { getEmbedColor, getGradeEmoji } = require("./osuViewHelpers.js");
const osuDroidModel = require("../models/osuDroidModel.js");

/**
 * Genera el emoji de la bandera nacional a partir del código ISO de dos letras (ej: 've' -> 🇻🇪)
 * @param {string} regionCode 
 * @returns {string}
 */
function getCountryFlag(regionCode) {
    if (!regionCode || typeof regionCode !== 'string' || regionCode.length !== 2) return '🌐';
    const code = regionCode.toUpperCase();
    const first = 0x1F1E6 + code.charCodeAt(0) - 65;
    const second = 0x1F1E6 + code.charCodeAt(1) - 65;
    return String.fromCodePoint(first, second);
}

/**
 * Botones de navegación para la vista de Perfil
 */
function buildDroidProfileButtons(userId, locale = 'es') {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`droid_top_${userId}_0`)
            .setLabel(t(locale, 'droid.view_top') || '🏆 Top 50')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`droid_rs_${userId}`)
            .setLabel(t(locale, 'droid.view_recent') || '⚡ Reciente')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setLabel(t(locale, 'droid.view_web') || '🌐 Perfil Web')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://osudroid.moe/profile.php?uid=${userId}`)
    );
    return row;
}

/**
 * Botones para la vista de Jugada Reciente
 */
function buildDroidRecentButtons(scoreId, userId, locale = 'es') {
    const row = new ActionRowBuilder();

    if (scoreId) {
        row.addComponents(
            new ButtonBuilder()
                .setLabel(t(locale, 'droid.download_replay') || '📥 Descargar Replay (.odr)')
                .setStyle(ButtonStyle.Link)
                .setURL(osuDroidModel.getReplayUrl(scoreId))
        );
    }

    if (userId) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`droid_prof_${userId}`)
                .setLabel(t(locale, 'droid.view_profile') || '📊 Perfil')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`droid_top_${userId}_0`)
                .setLabel(t(locale, 'droid.view_top') || '🏆 Top 50')
                .setStyle(ButtonStyle.Primary)
        );
    }

    return row;
}

/**
 * Botones de paginación para la vista de Top 50 Plays
 */
function buildDroidTopButtons(userId, page, maxPages, locale = 'es') {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`droid_top_${userId}_0`)
            .setLabel('⏮️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId(`droid_top_${userId}_${page - 1}`)
            .setLabel('◀️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId(`droid_top_${userId}_${page + 1}`)
            .setLabel('▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= maxPages - 1),
        new ButtonBuilder()
            .setCustomId(`droid_top_${userId}_${maxPages - 1}`)
            .setLabel('⏭️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= maxPages - 1),
        new ButtonBuilder()
            .setCustomId(`droid_prof_${userId}`)
            .setLabel(t(locale, 'droid.view_profile') || '📊 Perfil')
            .setStyle(ButtonStyle.Primary)
    );
    return row;
}

/**
 * Botones de paginación para la vista de Leaderboard
 */
function buildDroidLeaderboardButtons(hash, page, maxPages, locale = 'es') {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`droid_lb_${hash}_1`)
            .setLabel('⏮️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page <= 1),
        new ButtonBuilder()
            .setCustomId(`droid_lb_${hash}_${page - 1}`)
            .setLabel('◀️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page <= 1),
        new ButtonBuilder()
            .setCustomId(`droid_lb_${hash}_${page + 1}`)
            .setLabel('▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= maxPages),
        new ButtonBuilder()
            .setCustomId(`droid_lb_${hash}_${maxPages}`)
            .setLabel('⏭️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= maxPages)
    );
    return row;
}

/**
 * Construye el embed principal del perfil de osu!droid (idéntico a Bancho)
 */
function doDroidProfileEmbed(message, profile, locale = 'es') {
    const { doOsuProfileEmbed } = require("./osuEmbeds.js");
    const countryCode = (profile.Region || "XX").toUpperCase();
    const osu_userdata = {
        id: profile.UserId,
        username: profile.Username,
        country_code: countryCode,
        country: { code: countryCode, name: profile.Region },
        avatar_url: osuDroidModel.getAvatarUrl(profile.UserId),
        cover_url: osuDroidModel.getBannerUrl(profile.UserId) || osuDroidModel.getAvatarUrl(profile.UserId),
        join_date: profile.Registered || new Date().toISOString(),
        rank_highest: null,
        user_achievements: [],
        statistics: {
            global_rank: profile.GlobalRank,
            pp: profile.OverallPP,
            hit_accuracy: (profile.OverallAccuracy || 0) * 100,
            play_count: profile.OverallPlaycount,
            play_time: 0,
            total_score: profile.OverallScore,
            level: { current: 100, progress: 0 },
            rank: { country: profile.CountryRank },
            grade_counts: { ssh: 0, ss: 0, sh: 0, s: 0, a: 0 }
        },
        server: 'droid',
        is_supporter: !!profile.Supporter,
        _droid_raw: profile
    };
    const res = doOsuProfileEmbed(message, osu_userdata, 'osu', false, null, locale);
    return {
        embeds: res.embeds,
        components: [buildDroidProfileButtons(profile.UserId, locale)]
    };
}

/**
 * Construye el embed de la jugada reciente de osu!droid (idéntico a Bancho)
 */
async function doDroidRecentEmbed(message, profile, score, beatmapInfo = null, locale = 'es') {
    const { doOsuEmbed } = require("./osuEmbeds.js");
    const modsFormatted = Array.isArray(score.Mods) ? score.Mods.map(m => m.acronym).filter(Boolean) : [];
    const bId = beatmapInfo?.id || null;
    const bSetId = beatmapInfo?.beatmapset_id || null;
    const coverUrl = beatmapInfo?.beatmapset?.covers?.['cover@2x'] || beatmapInfo?.beatmapset?.covers?.cover || osuDroidModel.getAvatarUrl(profile.UserId);

    const recent_scores = {
        id: score.ScoreId,
        accuracy: score.MapAccuracy || 0,
        passed: score.MapRank !== 'F',
        rank: score.MapRank || 'A',
        mods: modsFormatted,
        droid_mods: score.Mods,
        max_combo: score.MapCombo || 0,
        statistics: {
            perfect: score.MapPerfect || 0,
            great: score.MapPerfect || 0,
            good: score.MapGood || 0,
            ok: score.MapGood || 0,
            meh: score.MapBad || 0,
            miss: score.MapMiss || 0,
            count_300: score.MapPerfect || 0,
            count_100: score.MapGood || 0,
            count_50: score.MapBad || 0,
            count_miss: score.MapMiss || 0
        },
        pp: score.MapPP || 0,
        total_score: score.MapScore || 0,
        legacy_total_score: score.MapScore || 0,
        ended_at: score.PlayedDate || new Date().toISOString(),
        beatmap: {
            id: bId,
            version: beatmapInfo?.version || (score.Filename || '').match(/\[(.*?)\](?:\.osu)?$/i)?.[1] || 'Normal',
            checksum: score.MapHash,
            mode: 'osu',
            beatmapset_id: bSetId,
            difficulty_rating: beatmapInfo?.difficulty_rating != null ? Number(beatmapInfo.difficulty_rating) : 0
        },
        beatmapset: {
            id: bSetId,
            title: beatmapInfo?.beatmapset?.title || (score.Filename || '').replace(/\[.*?\](?:\.osu)?$/i, '').trim(),
            artist: beatmapInfo?.beatmapset?.artist || '',
            covers: { "cover@2x": coverUrl, "cover": coverUrl }
        },
        user: {
            id: profile.UserId,
            username: profile.Username,
            avatar_url: osuDroidModel.getAvatarUrl(profile.UserId),
            server: 'droid'
        }
    };

    const pre_calculated = {
        map: null,
        map_completion: recent_scores.passed ? 100 : 100,
        maxAttrs: { stars: recent_scores.beatmap.difficulty_rating || 0, pp: recent_scores.pp || 0 },
        pp: recent_scores.pp || 0,
        beatmap_max_combo: beatmapInfo?.max_combo || recent_scores.max_combo || 0,
        pp_fc: null
    };

    const embed = await doOsuEmbed(message, recent_scores, pre_calculated, locale, 'classic');
    return {
        embeds: [embed],
        components: [buildDroidRecentButtons(score.ScoreId, profile.UserId, locale)]
    };
}

/**
 * Construye el embed paginado de las mejores jugadas de osu!droid (idéntico a Bancho)
 */
async function doDroidTopEmbed(message, profile, page = 0, pageSize = 5, locale = 'es') {
    const { doOsuTopListEmbed } = require("./osuEmbeds.js");
    const topPlays = profile.Top50Plays || [];
    const total_plays = topPlays.length;
    const startIndex = page * pageSize;
    const chunk = topPlays.slice(startIndex, startIndex + pageSize);

    const normalizedChunk = chunk.map((s, idx) => {
        const modsFormatted = Array.isArray(s.Mods) ? s.Mods.map(m => m.acronym).filter(Boolean) : [];
        return {
            id: s.ScoreId,
            accuracy: s.MapAccuracy || 0,
            passed: s.MapRank !== "F",
            rank: s.MapRank || 'A',
            mods: modsFormatted,
            droid_mods: s.Mods,
            max_combo: s.MapCombo || 0,
            originalRank: startIndex + idx + 1,
            statistics: {
                perfect: s.MapGeki || 0,
                great: s.MapPerfect || 0,
                good: s.MapKatu || 0,
                ok: s.MapGood || 0,
                meh: s.MapBad || 0,
                miss: s.MapMiss || 0,
                count_300: s.MapPerfect || 0,
                count_100: s.MapGood || 0,
                count_50: s.MapBad || 0,
                count_miss: s.MapMiss || 0
            },
            pp: s.MapPP || 0,
            total_score: s.MapScore || 0,
            legacy_total_score: s.MapScore || 0,
            ended_at: s.PlayedDate || new Date().toISOString(),
            beatmap: {
                id: null,
                version: (s.Filename || '').match(/\[(.*?)\](?:\.osu)?$/i)?.[1] || 'Normal',
                checksum: s.MapHash,
                mode: 'osu',
                difficulty_rating: 0
            },
            beatmapset: {
                id: null,
                title: (s.Filename || '').replace(/\[.*?\](?:\.osu)?$/i, '').trim(),
                artist: '',
                covers: {}
            },
            user: {
                id: profile.UserId,
                username: profile.Username,
                avatar_url: osuDroidModel.getAvatarUrl(profile.UserId),
                server: 'droid'
            }
        };
    });

    const embed = await doOsuTopListEmbed(message, { gamemode: 'osu' }, normalizedChunk, startIndex, total_plays, 0, [], locale);
    return {
        embeds: [embed],
        components: [buildDroidTopButtons(profile.UserId, page, Math.max(1, Math.ceil(total_plays / pageSize)), locale)]
    };
}

/**
 * Construye el embed del Leaderboard de un Beatmap en osu!droid (idéntico a Bancho)
 */
function doDroidLeaderboardEmbed(message, hash, lbData, beatmapInfo = null, page = 1, locale = 'es') {
    const { doOsuLbEmbed, doOsuLbContent } = require("./osuLeaderboardViews.js");
    const plays = lbData?.Top50Plays || [];
    const pageSize = 5;
    const maxPages = Math.max(1, Math.ceil(plays.length / pageSize));
    const safePage = Math.max(1, Math.min(page, maxPages));
    const startIndex = (safePage - 1) * pageSize;
    const currentPlays = plays.slice(startIndex, startIndex + pageSize);

    const normalizedScores = currentPlays.map((p, idx) => {
        const mods = Array.isArray(p.Mods) ? p.Mods.map(m => m.acronym).filter(Boolean) : [];
        return {
            id: p.ScoreId,
            total_score: p.MapTotalScore || 0,
            legacy_total_score: p.MapTotalScore || 0,
            accuracy: p.MapAccuracy || 0,
            max_combo: p.MapCombo || 0,
            rank: p.MapRank || 'A',
            passed: p.MapRank !== 'F',
            pp: p.MapPP || 0,
            mods: mods,
            droid_mods: p.Mods,
            statistics: {
                count_300: p.MapPerfect || 0,
                count_100: p.MapGood || 0,
                count_50: p.MapBad || 0,
                count_miss: p.MapMiss || 0
            },
            ended_at: p.PlayedDate || new Date().toISOString(),
            leaderboardRank: p.Rank || (startIndex + idx + 1),
            user: {
                id: p.UserId,
                username: p.Username,
                country_code: (p.Region || "XX").toUpperCase(),
                avatar_url: osuDroidModel.getAvatarUrl(p.UserId),
                server: 'droid'
            }
        };
    });

    const beatmap_metadata = beatmapInfo || {
        id: null,
        version: 'Normal',
        difficulty_rating: 0,
        max_combo: 0,
        mode: 'osu',
        url: `https://new.osudroid.moe/api2/game/leaderboard/?hash=${hash}`,
        beatmapset: {
            title: `Beatmap MD5: ${hash.substring(0, 10)}...`,
            covers: { cover: 'https://osudroid.moe/favicon.ico' }
        }
    };

    const embed = doOsuLbEmbed(message, normalizedScores, beatmap_metadata, startIndex, plays.length, safePage, maxPages, {}, null, locale);
    const content = doOsuLbContent(beatmap_metadata, 'osu', null, null, false, locale, 'osu!droid');

    return {
        content,
        embeds: [embed],
        components: [buildDroidLeaderboardButtons(hash, safePage, maxPages, locale)]
    };
}

module.exports = {
    getCountryFlag,
    buildDroidProfileButtons,
    buildDroidRecentButtons,
    buildDroidTopButtons,
    buildDroidLeaderboardButtons,
    doDroidProfileEmbed,
    doDroidRecentEmbed,
    doDroidTopEmbed,
    doDroidLeaderboardEmbed
};
