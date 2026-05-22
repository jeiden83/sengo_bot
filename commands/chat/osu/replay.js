const { doOsuReplayEmbed } = require("../../../views/osuReplayViews.js");
const { parseOSR } = require("../../utils/osr_parser.js");
const fetch = require('node-fetch');

async function run(messages, args, initialized_data) {
    const { message, reply } = messages;

    // Buscar el archivo adjunto en el mensaje o en el mensaje al que se responde
    let attachment = message.attachments.find(a => a.name.endsWith('.osr'));
    if (!attachment && reply && reply.attachments) {
        attachment = reply.attachments.find(a => a.name.endsWith('.osr'));
    }

    if (!attachment) {
        return "Por favor, adjunta un archivo de replay `.osr` o responde a un mensaje que lo tenga.";
    }

    try {
        await message.channel.sendTyping();
        
        const response = await fetch(attachment.url);
        const buffer = await response.buffer();

        const replayData = parseOSR(buffer);
        if (!replayData) {
            return "No se pudo parsear el archivo. Asegúrate de que sea un archivo de replay válido de osu!";
        }

        const gameModes = ['osu!standard', 'osu!taiko', 'osu!catch', 'osu!mania'];
        const modeStr = gameModes[replayData.gameMode] || 'Desconocido';

        // Parsear mods
        let parsedMods = [];
        if (replayData.lazerScoreInfo && replayData.lazerScoreInfo.mods) {
            parsedMods = replayData.lazerScoreInfo.mods;
        } else {
            const modMap = [
                { bit: 1<<0, acronym: 'NF' }, { bit: 1<<1, acronym: 'EZ' },
                { bit: 1<<2, acronym: 'TD' }, { bit: 1<<3, acronym: 'HD' },
                { bit: 1<<4, acronym: 'HR' }, { bit: 1<<5, acronym: 'SD' },
                { bit: 1<<6, acronym: 'DT' }, { bit: 1<<7, acronym: 'RX' },
                { bit: 1<<8, acronym: 'HT' }, { bit: 1<<9, acronym: 'NC' },
                { bit: 1<<10, acronym: 'FL' }, { bit: 1<<12, acronym: 'SO' },
                { bit: 1<<13, acronym: 'AP' }, { bit: 1<<14, acronym: 'PF' },
                { bit: 1<<29, acronym: 'V2' }
            ];
            for (const m of modMap) {
                if ((replayData.mods & m.bit) !== 0) parsedMods.push(m.acronym);
            }
            if (parsedMods.length === 0) parsedMods = ['NM'];
            if (parsedMods.includes('NC')) parsedMods = parsedMods.filter(m => m !== 'DT');
            if (parsedMods.includes('PF')) parsedMods = parsedMods.filter(m => m !== 'SD');

            const isStable = replayData.gameVersion < 30000000;
            if (isStable && !parsedMods.includes('CL')) {
                parsedMods.push('CL');
            }
        }

        // Calcular la fecha (Windows Ticks a JS Date)
        // 621355968000000000 es la diferencia en ticks entre el 1 de enero de 1601 y el 1 de enero de 1970
        let dateObj = null;
        try {
            const unixTime = Number((replayData.timestamp - 621355968000000000n) / 10000n);
            dateObj = new Date(unixTime);
        } catch(e) {}

        // Format the mods for display
        const displayMods = parsedMods.map(mod => {
            if (typeof mod === 'string') return mod;
            let str = mod.acronym;
            if (mod.settings) {
                if (mod.acronym === 'DT' && mod.settings.speed_change) str += `(${mod.settings.speed_change}x)`;
                else if (mod.acronym === 'DA') {
                    let da = [];
                    if (mod.settings.circle_size !== undefined) da.push(`CS${mod.settings.circle_size}`);
                    if (mod.settings.approach_rate !== undefined) da.push(`AR${mod.settings.approach_rate}`);
                    if (mod.settings.overall_difficulty !== undefined) da.push(`OD${mod.settings.overall_difficulty}`);
                    if (mod.settings.drain_rate !== undefined) da.push(`HP${mod.settings.drain_rate}`);
                    if (da.length > 0) str += `(${da.join(' ')})`;
                }
            }
            return str;
        });

        // Construir Embed utilizando la capa de visualización (View)
        const embed = doOsuReplayEmbed(replayData, modeStr, displayMods, dateObj);

        return { embeds: [embed] };

    } catch (e) {
        console.error("Error downloading or parsing osr:", e);
        return "Ocurrió un error al intentar leer la replay.";
    }
}

run.alias = {
    "osr": { "args": "" }
}

run.description = {
    'header': 'Lee un archivo de replay (.osr) y muestra sus datos.',
    'body': 'Sube un archivo `.osr` al chat junto con el comando `s.replay`, o responde al mensaje que tenga el archivo.',
    'usage': `s.replay [adjuntando archivo .osr]`
}

module.exports = { run, "description": run.description }
