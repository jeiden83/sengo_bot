const fs = require('fs');
const { AttachmentBuilder } = require('discord.js');
const { lookupBeatmapByMD5, getBeatmap, findBeatmapInChannel, argsParserNoCommand } = require('../../utils/osu.js');
const BeatmapModel = require('../../../models/BeatmapModel.js');
const ppEngine = require('../../../utils/ppEngine.js');
const { parseReplayBuffer, parseOsuHitObjects, analyzeReplayPerformance, renderAnalyzeChart } = require('../../../utils/replayAnalyzer.js');
const { doOsuAnalyzeEmbed } = require('../../../views/osuAnalyzeViews.js');
const { t } = require('../../../utils/i18n.js');

async function run(messages, args) {
    const { message, reply } = messages;
    const locale = (message.locale || 'es').split('-')[0];
    const parsed_args = argsParserNoCommand(args);

    // 1. Identificar el mensaje de origen que contiene la replay
    const sourceMessage = (message.attachments && (message.attachments.size > 0 || message.attachments.length > 0)) ? message : reply;

    if (!sourceMessage || !sourceMessage.attachments) {
        return t(locale, 'analyze.err_no_osr');
    }

    let osrAttachment = null;
    if (typeof sourceMessage.attachments.find === 'function') {
        osrAttachment = sourceMessage.attachments.find(a => a.name && a.name.toLowerCase().endsWith('.osr'));
    } else if (Array.isArray(sourceMessage.attachments)) {
        osrAttachment = sourceMessage.attachments.find(a => a.name && a.name.toLowerCase().endsWith('.osr'));
    } else if (typeof sourceMessage.attachments.values === 'function') {
        for (const a of sourceMessage.attachments.values()) {
            if (a.name && a.name.toLowerCase().endsWith('.osr')) {
                osrAttachment = a;
                break;
            }
        }
    }

    if (!osrAttachment) {
        return t(locale, 'analyze.err_no_osr');
    }

    try {
        if (typeof message.channel?.sendTyping === 'function') {
            await message.channel.sendTyping().catch(() => {});
        }
    } catch {}

    // 2. Descargar buffer de la replay .osr
    let replayBuffer;
    try {
        const response = await fetch(osrAttachment.url);
        replayBuffer = Buffer.from(await response.arrayBuffer());
    } catch (err) {
        console.error('[analizar.js] Error descargando .osr:', err);
        return t(locale, 'analyze.err_download_failed');
    }

    // 3. Parsear replay
    const replay = parseReplayBuffer(replayBuffer);
    if (!replay) {
        return t(locale, 'analyze.err_corrupt_osr');
    }

    // Calcular precisión si no vino en el objeto
    const totalHits = (replay.count300 || 0) + (replay.count100 || 0) + (replay.count50 || 0) + (replay.countMiss || 0);
    if (totalHits > 0) {
        replay.accuracy = ((replay.count300 * 300) + (replay.count100 * 100) + (replay.count50 * 50)) / (totalHits * 300);
    } else {
        replay.accuracy = 0;
    }

    // 4. Resolver beatmap mediante MD5
    let beatmapId = null;
    let beatmapMetadata = null;

    if (replay.beatmapMD5) {
        const bm = await lookupBeatmapByMD5(replay.beatmapMD5);
        if (bm && bm.id) {
            beatmapId = bm.id;
            beatmapMetadata = bm;
        }
    }

    // Fallback: Buscar beatmap en el canal
    if (!beatmapId && sourceMessage) {
        const channelBm = await findBeatmapInChannel(sourceMessage, true, parsed_args.index);
        if (channelBm && channelBm.beatmap_url) {
            beatmapId = channelBm.beatmap_url;
            beatmapMetadata = await getBeatmap(beatmapId);
        }
    }

    if (!beatmapId) {
        return t(locale, 'analyze.err_map_not_found', { md5: replay.beatmapMD5 });
    }

    if (!beatmapMetadata || !beatmapMetadata.beatmapset) {
        beatmapMetadata = await getBeatmap(beatmapId);
    }

    // 5. Descargar / Leer archivo .osu
    let engineMap = null;
    let osuFilePath = null;
    try {
        engineMap = await BeatmapModel.getBeatmap_osu(beatmapMetadata.beatmapset_id, beatmapId, beatmapMetadata);
        osuFilePath = await BeatmapModel.downloadBeatmapOsuFile(beatmapMetadata.beatmapset_id, beatmapId, beatmapMetadata);
    } catch (err) {
        console.error('[analizar.js] Error obteniendo .osu:', err);
        return t(locale, 'analyze.err_osu_file_failed');
    }

    let osuContent = '';
    try {
        osuContent = fs.readFileSync(osuFilePath, 'utf8');
    } catch (err) {
        console.error('[analizar.js] Error leyendo archivo local .osu:', err);
        return t(locale, 'analyze.err_osu_file_failed');
    }

    // 6. Analizar HitObjects y Rendimiento de la Replay
    const mapData = parseOsuHitObjects(osuContent);
    const analysis = analyzeReplayPerformance({ replay, mapData });

    // 7. Calcular Strains y PP con sengo-pp
    let strains = null;
    let ppData = { pp: 0, pp_fc: 0, maxCombo: 0 };
    try {
        const diff = new ppEngine.Difficulty({ mods: replay.modsStr });
        strains = diff.strains(engineMap);
        const attrs = diff.calculate(engineMap);

        const perf = new ppEngine.Performance({
            mods: replay.modsStr,
            combo: replay.maxCombo,
            misses: replay.countMiss,
            n300: replay.count300,
            n100: replay.count100,
            n50: replay.count50
        }).calculate(attrs);

        const fcPerf = new ppEngine.Performance({
            mods: replay.modsStr,
            combo: attrs.maxCombo || replay.maxCombo,
            misses: 0,
            n300: (replay.count300 || 0) + (replay.countMiss || 0),
            n100: replay.count100,
            n50: replay.count50
        }).calculate(attrs);

        ppData = {
            pp: perf.pp || 0,
            pp_fc: fcPerf.pp || 0,
            maxCombo: attrs.maxCombo || 0
        };
    } catch (err) {
        console.error('[analizar.js] Error calculando PP y strains:', err);
    }

    // 8. Renderizar Gráfica de Análisis
    const chartBuffer = renderAnalyzeChart({
        title: mapData.title || beatmapMetadata.beatmapset?.title,
        artist: mapData.artist || beatmapMetadata.beatmapset?.artist,
        version: mapData.version || beatmapMetadata.version,
        player: replay.playerName,
        modsStr: replay.modsStr,
        durationMs: analysis.totalDurationMs,
        misses: analysis.misses,
        topSections: analysis.topSections,
        comboPeak: replay.maxCombo,
        firstChokeTime: analysis.firstChoke,
        strains,
        totalMissCount: replay.countMiss
    });

    const attachment = new AttachmentBuilder(chartBuffer, { name: 'replay_analysis.png' });

    // 9. Crear Embed de Respuesta
    const embed = doOsuAnalyzeEmbed({
        message,
        replay,
        mapData: {
            title: mapData.title || beatmapMetadata.beatmapset?.title,
            artist: mapData.artist || beatmapMetadata.beatmapset?.artist,
            version: mapData.version || beatmapMetadata.version
        },
        analysis,
        ppData,
        beatmapId,
        locale
    });

    return { embeds: [embed], files: [attachment] };
}

run.alias = {
    "analyze": { "args": "" },
    "replay": { "args": "" }
};

run.description = {
    'header': t('es', 'commands.analizar.header'),
    'body': t('es', 'commands.analizar.body'),
    'usage': t('es', 'commands.analizar.usage')
};

module.exports = { run, description: run.description };
