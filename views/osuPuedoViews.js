const { EmbedBuilder } = require('discord.js');
const { getEmbedColor, formatDecimal, formatNumber } = require('./osuViewHelpers.js');
const emoji_mods = require('../src/emoji_mods.json');

function renderProgressBar(percentage, length = 10) {
    const filled = Math.max(0, Math.min(length, Math.round((percentage / 100) * length)));
    const empty = length - filled;
    return '▰'.repeat(filled) + '▱'.repeat(empty);
}

function doOsuPuedoEmbed({ message, user, map, analysis, activeModsStr, locale = 'es' }) {
    const embedColor = getEmbedColor(message);

    const title = `${map.artist || ''} - ${map.title} [${map.version}]`;
    const mapUrl = `https://osu.ppy.sh/b/${map.id}`;
    const coverUrl = map.covers?.['cover@2x'] || map.covers?.cover || user.avatar_url;

    const passBar = renderProgressBar(analysis.passProb, 10);
    const fcBar = renderProgressBar(analysis.fcProb, 10);

    let passVerdict = '🟡 Desafío alcanzable';
    if (analysis.passedBefore && !analysis.usedNF) passVerdict = '🏆 ¡Ya te lo pasaste!';
    else if (analysis.passProb >= 85) passVerdict = '🟢 Totalmente a tu alcance';
    else if (analysis.passProb >= 65) passVerdict = '🟢 Alta probabilidad de pass';
    else if (analysis.passProb >= 40) passVerdict = '🟡 Desafío alcanzable (posible pass)';
    else if (analysis.passProb >= 15) passVerdict = '🟠 Muy difícil / Push extremo';
    else passVerdict = '🔴 Fuera de tu nivel actual';

    let fcVerdict = '🔴 FC fuera de rango';
    if (analysis.fcProb >= 70) fcVerdict = '🟢 Alta probabilidad de FC';
    else if (analysis.fcProb >= 40) fcVerdict = '🟢 FC factible con intentos';
    else if (analysis.fcProb >= 15) fcVerdict = '🟡 Posible pero propenso a choke';
    else if (analysis.fcProb >= 3) fcVerdict = '🟠 Muy difícil / Choke casi seguro';
    else fcVerdict = '🔴 FC prácticamente imposible';

    // Historial previo
    let historyText = '*Sin puntuaciones registradas en este mapa.*';
    if (analysis.prevScore) {
        const nfTag = analysis.usedNF ? ' `[NoFail]`' : '';
        historyText = `**Rango ${analysis.prevScore.rank}**${nfTag} • **${analysis.prevScore.acc}** • **${analysis.prevScore.combo}**`;
    }

    // Diagnóstico
    const tips = [];
    if (analysis.factors.bpmOver > 0) {
        tips.push(`⚠️ **Velocidad:** El mapa corre a **${analysis.map.bpm} BPM**, superando tu techo cómodo estimado de ~${analysis.factors.estimatedComfortBPM} BPM.`);
    } else {
        tips.push(`✅ **Velocidad:** Los **${analysis.map.bpm} BPM** están dentro de tu zona cómoda.`);
    }

    if (analysis.map.sr > analysis.factors.pushStars + 0.3) {
        tips.push(`⚠️ **Dificultad:** Con **${analysis.map.sr.toFixed(2)}★**, está por encima de tu zona de push (**${analysis.factors.pushStars.toFixed(2)}★**).`);
    } else if (analysis.map.sr <= analysis.factors.pushStars) {
        tips.push(`✅ **Dificultad:** Sus **${analysis.map.sr.toFixed(2)}★** están en tu rango de comodidad/push (**${analysis.factors.pushStars.toFixed(2)}★**).`);
    }

    if (analysis.map.combo > 1200) {
        tips.push(`⚠️ **Consistencia:** Mapa largo (**${analysis.map.combo}x** combo); el riesgo de choke para FC es elevado.`);
    }

    const embed = new EmbedBuilder()
        .setAuthor({
            name: `🔍 ¿Me lo puedo pasar? • ${user.username} (#${formatNumber(user.statistics?.global_rank || 0, locale)})`,
            iconURL: user.avatar_url,
            url: `https://osu.ppy.sh/users/${user.id}`
        })
        .setTitle(title)
        .setURL(mapUrl)
        .setDescription(
            `**🎯 Probabilidad de Pass:** \`${passBar}\` **${analysis.passProb}%**\n` +
            `└ *${passVerdict}*\n\n` +
            `**⭐ Probabilidad de FC:** \`${fcBar}\` **${analysis.fcProb}%**\n` +
            `└ *${fcVerdict}*\n\n` +
            `**📜 Historial en el mapa:**\n` +
            `└ ${historyText}\n\n` +
            `**⚡ Diagnóstico Cinemático:**\n` +
            tips.map(t => `• ${t}`).join('\n')
        )
        .addFields(
            {
                name: '🗺️ Atributos del Mapa',
                value: `**Dificultad:** \`${analysis.map.sr.toFixed(2)}★\`\n**Tempo:** \`${analysis.map.bpm} BPM\`\n**Combo:** \`${analysis.map.combo}x\`\n**AR / OD:** \`${analysis.map.ar} / ${analysis.map.od}\``,
                inline: true
            },
            {
                name: '👤 Perfil del Jugador',
                value: `**Push Stars:** \`${analysis.factors.pushStars.toFixed(2)}★\`\n**Techo BPM:** \`~${analysis.factors.estimatedComfortBPM} BPM\`\n**Aim / Speed:** \`${analysis.factors.userAim.toFixed(1)} / ${analysis.factors.userSpeed.toFixed(1)}\`\n**Precisión:** \`${(analysis.factors.avgAcc * 100).toFixed(1)}%\``,
                inline: true
            }
        )
        .setImage(coverUrl)
        .setColor(analysis.passProb >= 65 ? 0x2ecc71 : (analysis.passProb >= 35 ? 0xf39c12 : 0xe74c3c))
        .setFooter({
            text: `Sengo • Diagnóstico Cinemático • s.puedo`,
            iconURL: 'https://jeiden.s-ul.eu/3ssHl9Gd'
        })
        .setTimestamp();

    return embed;
}

module.exports = { doOsuPuedoEmbed, renderProgressBar };
