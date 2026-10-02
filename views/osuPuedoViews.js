const { EmbedBuilder } = require('discord.js');
const { getEmbedColor, formatDecimal, formatNumber } = require('./osuViewHelpers.js');
const { t } = require('../utils/i18n.js');
const emoji_mods = require('../src/emoji_mods.json');

function renderProgressBar(percentage, length = 10) {
    const filled = Math.max(0, Math.min(length, Math.round((percentage / 100) * length)));
    const empty = length - filled;
    return '▰'.repeat(filled) + '▱'.repeat(empty);
}

function doOsuPuedoEmbed({ message, user, map, analysis, activeModsStr, locale = 'es' }) {
    const embedColor = getEmbedColor(message);

    const modsTag = (activeModsStr && activeModsStr !== 'NM') ? ` +${activeModsStr}` : '';
    const title = `${map.artist || ''} - ${map.title} [${map.version}]${modsTag}`;
    const mapUrl = `https://osu.ppy.sh/b/${map.id}`;
    const coverUrl = map.covers?.['cover@2x'] || map.covers?.cover || user.avatar_url;

    const passBar = renderProgressBar(analysis.passProb, 10);
    const fcBar = renderProgressBar(analysis.fcProb, 10);

    let passVerdict = t(locale, 'puedo.verdict_pass_40');
    if (analysis.passedBefore && !analysis.usedNF) passVerdict = t(locale, 'puedo.verdict_pass_passed');
    else if (analysis.passProb >= 85) passVerdict = t(locale, 'puedo.verdict_pass_95');
    else if (analysis.passProb >= 65) passVerdict = t(locale, 'puedo.verdict_pass_65');
    else if (analysis.passProb >= 40) passVerdict = t(locale, 'puedo.verdict_pass_40');
    else if (analysis.passProb >= 15) passVerdict = t(locale, 'puedo.verdict_pass_15');
    else passVerdict = t(locale, 'puedo.verdict_pass_0');

    let fcVerdict = t(locale, 'puedo.verdict_fc_0');
    if (analysis.fcProb >= 70) fcVerdict = t(locale, 'puedo.verdict_fc_70');
    else if (analysis.fcProb >= 40) fcVerdict = t(locale, 'puedo.verdict_fc_40');
    else if (analysis.fcProb >= 15) fcVerdict = t(locale, 'puedo.verdict_fc_15');
    else if (analysis.fcProb >= 3) fcVerdict = t(locale, 'puedo.verdict_fc_3');
    else fcVerdict = t(locale, 'puedo.verdict_fc_0');

    // Historial previo
    let historyText = t(locale, 'puedo.history_empty');
    if (analysis.prevScore) {
        const nfTag = analysis.usedNF ? ' `[NoFail]`' : '';
        historyText = t(locale, 'puedo.history_score', {
            rank: analysis.prevScore.rank,
            nfTag,
            acc: analysis.prevScore.acc,
            combo: analysis.prevScore.combo
        });
    }

    // Diagnóstico
    const tips = [];
    if (analysis.factors.bpmOver > 0) {
        tips.push(t(locale, 'puedo.tip_bpm_over', {
            bpm: analysis.map.bpm,
            comfort: analysis.factors.estimatedComfortBPM
        }));
    } else {
        tips.push(t(locale, 'puedo.tip_bpm_ok', {
            bpm: analysis.map.bpm
        }));
    }

    if (analysis.map.sr > analysis.factors.pushStars + 0.3) {
        tips.push(t(locale, 'puedo.tip_sr_over', {
            sr: analysis.map.sr.toFixed(2),
            pushStars: analysis.factors.pushStars.toFixed(2)
        }));
    } else if (analysis.map.sr <= analysis.factors.pushStars) {
        tips.push(t(locale, 'puedo.tip_sr_ok', {
            sr: analysis.map.sr.toFixed(2),
            pushStars: analysis.factors.pushStars.toFixed(2)
        }));
    }

    if (analysis.map.combo > 1200) {
        tips.push(t(locale, 'puedo.tip_combo', {
            combo: analysis.map.combo
        }));
    }

    const rankStr = user.statistics?.global_rank ? ` (#${formatNumber(user.statistics.global_rank, locale)})` : '';
    const authorName = t(locale, 'puedo.embed_author', {
        username: user.username,
        rank: rankStr
    });

    const embed = new EmbedBuilder()
        .setAuthor({
            name: authorName,
            iconURL: user.avatar_url,
            url: `https://osu.ppy.sh/users/${user.id}`
        })
        .setTitle(title)
        .setURL(mapUrl)
        .setDescription(
            `**${t(locale, 'puedo.pass_prob')}** \`${passBar}\` **${analysis.passProb}%**\n` +
            `└ *${passVerdict}*\n\n` +
            `**${t(locale, 'puedo.fc_prob')}** \`${fcBar}\` **${analysis.fcProb}%**\n` +
            `└ *${fcVerdict}*\n\n` +
            `**${t(locale, 'puedo.history_title')}**\n` +
            `└ ${historyText}\n\n` +
            `**${t(locale, 'puedo.diagnostic_title')}**\n` +
            tips.map(tip => `• ${tip}`).join('\n')
        )
        .addFields(
            {
                name: t(locale, 'puedo.field_map_attrs'),
                value: `**${t(locale, 'puedo.attr_difficulty')}** \`${analysis.map.sr.toFixed(2)}★\`\n**${t(locale, 'puedo.attr_tempo')}** \`${analysis.map.bpm} BPM\`\n**${t(locale, 'puedo.attr_combo')}** \`${analysis.map.combo}x\`\n**${t(locale, 'puedo.attr_ar_od')}** \`${analysis.map.ar} / ${analysis.map.od}\``,
                inline: true
            },
            {
                name: t(locale, 'puedo.field_player_profile'),
                value: `**${t(locale, 'puedo.profile_push_stars')}** \`${analysis.factors.pushStars.toFixed(2)}★\`\n**${t(locale, 'puedo.profile_bpm_ceiling')}** \`~${analysis.factors.estimatedComfortBPM} BPM\`\n**${t(locale, 'puedo.profile_aim_speed')}** \`${analysis.factors.userAim.toFixed(1)} / ${analysis.factors.userSpeed.toFixed(1)}\`\n**${t(locale, 'puedo.profile_precision')}** \`${(analysis.factors.avgAcc * 100).toFixed(1)}%\``,
                inline: true
            }
        )
        .setImage(coverUrl)
        .setColor(analysis.passProb >= 65 ? 0x2ecc71 : (analysis.passProb >= 35 ? 0xf39c12 : 0xe74c3c))
        .setFooter({
            text: t(locale, 'puedo.embed_footer'),
            iconURL: 'https://jeiden.s-ul.eu/3ssHl9Gd'
        })
        .setTimestamp();

    return embed;
}

module.exports = { doOsuPuedoEmbed, renderProgressBar };

