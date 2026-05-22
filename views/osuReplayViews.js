const { EmbedBuilder } = require("discord.js");

/**
 * Renderiza el embed que detalla la información técnica de una replay (.osr)
 */
function doOsuReplayEmbed(replayData, modeStr, displayMods, dateObj) {
    const embed = new EmbedBuilder()
        .setTitle(`Replay Parser: ${replayData.playerName}`)
        .setDescription(`**Modo de juego:** ${modeStr}\n**Versión del juego:** ${replayData.gameVersion}\n**Mods:** ${displayMods.join(', ')}`)
        .addFields(
            { name: 'Puntuación Total', value: `${replayData.totalScore.toLocaleString('es-ES')}`, inline: true },
            { name: 'Max Combo', value: `${replayData.maxCombo}x`, inline: true },
            { name: 'Combo Perfecto', value: replayData.perfect ? 'Sí' : 'No', inline: true },
            { name: 'Estadísticas', value: `300s: **${replayData.count300}**\n100s: **${replayData.count100}**\n50s: **${replayData.count50}**\nMisses: **${replayData.countMiss}**\nGekis: **${replayData.countGeki}**\nKatus: **${replayData.countKatu}**`, inline: false },
            { name: 'Beatmap MD5', value: `\`${replayData.beatmapMD5}\``, inline: false }
        )
        .setColor('#ff66aa')
        .setFooter({ text: "SengoBot Replay Parser" });

    if (dateObj && !isNaN(dateObj.getTime())) {
        embed.setTimestamp(dateObj);
    }

    return embed;
}

module.exports = {
    doOsuReplayEmbed
};
