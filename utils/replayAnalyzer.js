const lzma = require('lzma');
const { createCanvas } = require('canvas');
const { parseOSR, OSRParser } = require('../commands/utils/osr_parser.js');

/**
 * Parsea el búfer binario de una replay .osr extrayendo metadatos y frames descomprimidos.
 */
function parseReplayBuffer(buffer) {
    const parsed = parseOSR(buffer);
    if (!parsed) return null;

    const p = new OSRParser(buffer);
    p.readByte(); p.readInt(); p.readString(); p.readString(); p.readString();
    p.readShort(); p.readShort(); p.readShort(); p.readShort(); p.readShort(); p.readShort();
    p.readInt(); p.readShort(); p.readByte(); p.readInt(); p.readString(); p.readLong();
    const streamLen = p.readInt();
    const compressed = buffer.slice(p.offset, p.offset + streamLen);
    
    let frameString = '';
    try {
        const decomp = lzma.decompress(compressed);
        frameString = typeof decomp === 'string' ? decomp : Buffer.from(decomp).toString('utf8');
    } catch (err) {
        console.error('[ReplayAnalyzer] Error descomprimiendo stream LZMA:', err.message);
    }

    const frames = [];
    let currentTime = 0;
    for (const a of frameString.split(',')) {
        if (!a) continue;
        const parts = a.split('|');
        if (parts.length < 4) continue;
        const w = parseInt(parts[0], 10);
        if (w === -12345) continue; // Seed frame
        currentTime += w;
        frames.push({
            time: currentTime,
            x: parseFloat(parts[1]),
            y: parseFloat(parts[2]),
            keys: parseInt(parts[3], 10)
        });
    }

    // Parsear lista de mods legibles
    const modMap = [
        { bit: 1 << 0, acronym: 'NF' }, { bit: 1 << 1, acronym: 'EZ' },
        { bit: 1 << 2, acronym: 'TD' }, { bit: 1 << 3, acronym: 'HD' },
        { bit: 1 << 4, acronym: 'HR' }, { bit: 1 << 5, acronym: 'SD' },
        { bit: 1 << 6, acronym: 'DT' }, { bit: 1 << 7, acronym: 'RX' },
        { bit: 1 << 8, acronym: 'HT' }, { bit: 1 << 9, acronym: 'NC' },
        { bit: 1 << 10, acronym: 'FL' }, { bit: 1 << 12, acronym: 'SO' },
        { bit: 1 << 13, acronym: 'AP' }, { bit: 1 << 14, acronym: 'PF' }
    ];
    let modsList = [];
    if (parsed.lazerScoreInfo && parsed.lazerScoreInfo.mods) {
        modsList = parsed.lazerScoreInfo.mods.map(m => typeof m === 'string' ? m : m.acronym);
    } else {
        for (const m of modMap) {
            if ((parsed.mods & m.bit) !== 0) modsList.push(m.acronym);
        }
        if (modsList.length === 0) modsList = ['NM'];
        if (modsList.includes('NC')) modsList = modsList.filter(m => m !== 'DT');
        if (modsList.includes('PF')) modsList = modsList.filter(m => m !== 'SD');
    }

    return {
        ...parsed,
        modsList,
        modsStr: modsList.join(''),
        frames
    };
}

/**
 * Parsea el contenido de texto de un archivo .osu extrayendo dificultad, metadatos y HitObjects.
 */
function parseOsuHitObjects(osuContent) {
    const lines = osuContent.split(/\r?\n/);
    let cs = 4, od = 8, ar = 8, hp = 6;
    let title = '', artist = '', version = '', creator = '';
    const hitObjects = [];
    let inH = false;

    for (const l of lines) {
        if (l.startsWith('CircleSize:')) cs = parseFloat(l.split(':')[1]);
        if (l.startsWith('OverallDifficulty:')) od = parseFloat(l.split(':')[1]);
        if (l.startsWith('ApproachRate:')) ar = parseFloat(l.split(':')[1]);
        if (l.startsWith('HPDrainRate:')) hp = parseFloat(l.split(':')[1]);
        if (l.startsWith('Title:')) title = l.split(':')[1].trim();
        if (l.startsWith('Artist:')) artist = l.split(':')[1].trim();
        if (l.startsWith('Version:')) version = l.split(':')[1].trim();
        if (l.startsWith('Creator:')) creator = l.split(':')[1].trim();

        if (l.trim() === '[HitObjects]') { inH = true; continue; }
        if (inH && l.startsWith('[')) break;
        if (!inH || !l.trim()) continue;

        const p = l.split(',');
        if (p.length >= 4) {
            const type = parseInt(p[3], 10);
            hitObjects.push({
                index: hitObjects.length,
                x: parseFloat(p[0]),
                y: parseFloat(p[1]),
                time: parseInt(p[2], 10),
                type,
                isCircle: (type & 1) !== 0,
                isSlider: (type & 2) !== 0,
                isSpinner: (type & 8) !== 0
            });
        }
    }

    return { cs, od, ar, hp, title, artist, version, creator, hitObjects };
}

/**
 * Simula y analiza el rendimiento de la repetición:
 * - Detecta timestamps de misses y hits.
 * - Calcula el Unstable Rate (UR) y Offset promedio si no es Relax.
 * - Localiza las 3 secciones con más misses mediante ventana deslizante.
 * - Identifica patrones de fallo y momento del primer choke.
 */
function analyzeReplayPerformance({ replay, mapData }) {
    const { frames, mods, countMiss } = replay;
    const { hitObjects, cs: baseCS, od: baseOD } = mapData;

    const isRelax = (mods & 128) !== 0;
    const isDT = (mods & 64) !== 0 || (mods & 512) !== 0;
    const isHT = (mods & 256) !== 0;
    const isHR = (mods & 16) !== 0;
    const isEZ = (mods & 2) !== 0;

    const clockRate = isDT ? 1.5 : (isHT ? 0.75 : 1.0);
    let effCS = baseCS;
    if (isHR) effCS = Math.min(10, baseCS * 1.3);
    if (isEZ) effCS = baseCS * 0.5;

    let effOD = baseOD;
    if (isHR) effOD = Math.min(10, baseOD * 1.4);
    if (isEZ) effOD = baseOD * 0.5;

    const radius = 54.4 - 4.48 * effCS;
    const hitWindow50 = (200 - 10 * effOD) * clockRate;

    const misses = [];
    const hits = [];
    const offsets = [];

    let fIdx = 0;
    for (let i = 0; i < hitObjects.length; i++) {
        const obj = hitObjects[i];
        const tMin = obj.time - hitWindow50;
        const tMax = obj.time + hitWindow50;

        while (fIdx > 0 && frames[fIdx].time > tMin) fIdx--;
        while (fIdx < frames.length - 1 && frames[fIdx].time < tMin) fIdx++;

        let hit = false;
        let minDistance = 999999;
        let bestOffset = 0;

        for (let k = fIdx; k < frames.length; k++) {
            const f = frames[k];
            if (f.time > tMax) break;

            const dx = f.x - obj.x;
            const dy = f.y - obj.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDistance) minDistance = dist;

            if (isRelax) {
                if (dist <= radius) {
                    hit = true;
                    bestOffset = f.time - obj.time;
                    break;
                }
            } else {
                if (f.keys > 0 && dist <= radius) {
                    hit = true;
                    bestOffset = f.time - obj.time;
                    break;
                }
            }
        }

        const prevObj = i > 0 ? hitObjects[i - 1] : null;
        const spacing = prevObj ? Math.sqrt(Math.pow(obj.x - prevObj.x, 2) + Math.pow(obj.y - prevObj.y, 2)) : 0;
        const dtPrev = prevObj ? (obj.time - prevObj.time) : 1000;

        let patternType = 'circle';
        if (obj.isSlider) patternType = 'slider';
        else if (spacing > 140 && dtPrev < 300) patternType = 'jump';
        else if (dtPrev <= 160) patternType = 'stream';

        if (hit) {
            hits.push({ index: i, time: obj.time, offset: bestOffset, patternType });
            if (!isRelax) offsets.push(bestOffset);
        } else {
            misses.push({ index: i, time: obj.time, minDistance, patternType, spacing, dtPrev });
        }
    }

    const firstChoke = misses.length > 0 ? misses[0].time : null;

    let unstableRate = null;
    let meanOffset = null;
    if (!isRelax && offsets.length > 0) {
        const sum = offsets.reduce((a, b) => a + b, 0);
        meanOffset = sum / offsets.length;
        const variance = offsets.reduce((acc, val) => acc + Math.pow(val - meanOffset, 2), 0) / offsets.length;
        const stdDev = Math.sqrt(variance);
        unstableRate = (stdDev * 10) / clockRate;
    }

    const windowSizeMs = 15000;
    const maxTime = hitObjects.length > 0 ? hitObjects[hitObjects.length - 1].time : 1;
    const candidates = [];

    for (let t = 0; t <= maxTime; t += 5000) {
        const windowMisses = misses.filter(m => m.time >= t && m.time < t + windowSizeMs);
        if (windowMisses.length > 0) {
            candidates.push({
                startTime: t,
                endTime: t + windowSizeMs,
                count: windowMisses.length,
                percent: Math.round((windowMisses.length / Math.max(1, countMiss || misses.length)) * 100),
                misses: windowMisses
            });
        }
    }

    candidates.sort((a, b) => b.count - a.count);
    const topSections = [];
    for (const c of candidates) {
        const overlaps = topSections.some(s => Math.abs(s.startTime - c.startTime) < windowSizeMs);
        if (!overlaps) {
            const jumpCount = c.misses.filter(m => m.patternType === 'jump').length;
            const streamCount = c.misses.filter(m => m.patternType === 'stream').length;
            const sliderCount = c.misses.filter(m => m.patternType === 'slider').length;
            let pattern = 'Saltos (Jumps)';
            if (streamCount > jumpCount && streamCount > sliderCount) pattern = 'Ráfagas / Streams';
            else if (sliderCount > jumpCount && sliderCount > streamCount) pattern = 'Sliders / Seguimiento';

            topSections.push({ ...c, dominantPattern: pattern });
            if (topSections.length === 3) break;
        }
    }

    let patternDiagnosisKey = 'diag_consistent';
    if (misses.length > 0) {
        const jumps = misses.filter(m => m.patternType === 'jump').length;
        const streams = misses.filter(m => m.patternType === 'stream').length;
        const sliders = misses.filter(m => m.patternType === 'slider').length;
        if (jumps >= streams && jumps >= sliders) {
            patternDiagnosisKey = 'diag_jumps';
        } else if (streams >= jumps && streams >= sliders) {
            patternDiagnosisKey = 'diag_streams';
        } else if (sliders > 0) {
            patternDiagnosisKey = 'diag_sliders';
        }
    }

    return {
        hits,
        misses,
        firstChoke,
        unstableRate,
        meanOffset,
        topSections,
        patternDiagnosisKey,
        totalDurationMs: maxTime
    };
}

/**
 * Renderiza la gráfica Canvas de la repetición:
 * - Curva de dificultad / tensión a lo largo del tiempo.
 * - Puntos brillantes de misses y líneas verticales.
 * - Zonas críticas destacadas con badges #1, #2, #3.
 */
function renderAnalyzeChart({ title, artist, version, player, modsStr, durationMs, misses, topSections, comboPeak, firstChokeTime, strains, totalMissCount }) {
    // Resolución 2x HiDPI (1800x540) para máxima nitidez en Discord
    const scale = 2;
    const width = 900 * scale;
    const height = 270 * scale;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Fondo degradado Dark OLED
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, '#090a12');
    bgGrad.addColorStop(0.5, '#0e111d');
    bgGrad.addColorStop(1, '#141829');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Borde exterior
    ctx.strokeStyle = '#232840';
    ctx.lineWidth = 2 * scale;
    ctx.strokeRect(scale, scale, width - 2 * scale, height - 2 * scale);

    const padX = 50 * scale;
    const chartY = 75 * scale;
    const chartH = 135 * scale;
    const chartW = width - padX * 2;
    const totalMs = Math.max(1, durationMs);

    // Rejilla horizontal
    ctx.strokeStyle = '#181b2e';
    ctx.lineWidth = 1 * scale;
    for (let i = 0; i <= 4; i++) {
        const y = chartY + (chartH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padX, y);
        ctx.lineTo(padX + chartW, y);
        ctx.stroke();
    }

    // Cabecera izquierda: Jugador + Mods y Título de Canción
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${17 * scale}px "Segoe UI", sans-serif`;
    ctx.fillText(`${player}  •  ${modsStr ? `+${modsStr}` : 'No Mod'}`, padX, 35 * scale);

    ctx.fillStyle = '#8f9bbd';
    ctx.font = `${13 * scale}px "Segoe UI", sans-serif`;
    const fullSubTitle = `${artist} - ${title} [${version}]`;
    const truncatedSub = fullSubTitle.length > 58 ? fullSubTitle.slice(0, 55) + '...' : fullSubTitle;
    ctx.fillText(truncatedSub, padX, 55 * scale);

    // Cabecera derecha: Conteo de Misses y Combo / Choke
    ctx.textAlign = 'right';
    const displayMisses = totalMissCount !== undefined ? totalMissCount : misses.length;
    ctx.fillStyle = '#ff4d6d';
    ctx.font = `bold ${15 * scale}px "Segoe UI", sans-serif`;
    ctx.fillText(`❌ ${displayMisses} Misses`, width - padX, 35 * scale);

    ctx.fillStyle = '#e0af68';
    ctx.font = `${13 * scale}px "Segoe UI", sans-serif`;
    const chokeStr = firstChokeTime ? `Primer Choke: ${formatTime(firstChokeTime)}` : 'Full Combo';
    ctx.fillText(`Max Combo: ${comboPeak}x   •   ${chokeStr}`, width - padX, 55 * scale);
    ctx.textAlign = 'left';

    // 1. Curva de Dificultad (Strains combinados Aim + Speed)
    let combinedStrains = [];
    if (strains && strains.aim && strains.speed && strains.aim.length > 0) {
        for (let i = 0; i < strains.aim.length; i++) {
            combinedStrains.push((strains.aim[i] || 0) + (strains.speed[i] || 0));
        }
    }

    if (combinedStrains.length > 0) {
        const maxStrain = Math.max(1, ...combinedStrains);
        const numPoints = combinedStrains.length;

        // Degradado de área
        const strainGrad = ctx.createLinearGradient(0, chartY, 0, chartY + chartH);
        strainGrad.addColorStop(0, 'rgba(122, 162, 247, 0.42)');
        strainGrad.addColorStop(0.6, 'rgba(122, 162, 247, 0.15)');
        strainGrad.addColorStop(1, 'rgba(122, 162, 247, 0.00)');

        ctx.fillStyle = strainGrad;
        ctx.beginPath();
        ctx.moveTo(padX, chartY + chartH);
        for (let i = 0; i < numPoints; i++) {
            const px = padX + (i / (numPoints - 1)) * chartW;
            const norm = combinedStrains[i] / maxStrain;
            const py = chartY + chartH - (norm * (chartH - 8 * scale));
            ctx.lineTo(px, py);
        }
        ctx.lineTo(padX + chartW, chartY + chartH);
        ctx.closePath();
        ctx.fill();

        // Línea trazada con brillo sutil
        ctx.save();
        ctx.shadowColor = 'rgba(122, 162, 247, 0.5)';
        ctx.shadowBlur = 6 * scale;
        ctx.strokeStyle = '#7aa2f7';
        ctx.lineWidth = 1.8 * scale;
        ctx.beginPath();
        for (let i = 0; i < numPoints; i++) {
            const px = padX + (i / (numPoints - 1)) * chartW;
            const norm = combinedStrains[i] / maxStrain;
            const py = chartY + chartH - (norm * (chartH - 8 * scale));
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
    }

    // 2. Dibujar las 3 Secciones Críticas de Misses (Columnas rojas con pill badge)
    topSections.forEach((sec, idx) => {
        const x1 = padX + (sec.startTime / totalMs) * chartW;
        const x2 = padX + (sec.endTime / totalMs) * chartW;
        const w = Math.max(18 * scale, x2 - x1);

        ctx.fillStyle = 'rgba(255, 60, 90, 0.16)';
        ctx.fillRect(x1, chartY, w, chartH);

        ctx.strokeStyle = 'rgba(255, 80, 110, 0.7)';
        ctx.lineWidth = 1.2 * scale;
        ctx.strokeRect(x1, chartY, w, chartH);

        // Pastilla distintiva
        const pillW = 62 * scale;
        const pillH = 18 * scale;
        const pillX = x1 + (w - pillW) / 2;
        const pillY = chartY + 6 * scale;

        ctx.fillStyle = 'rgba(255, 50, 80, 0.85)';
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 4 * scale);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${10.5 * scale}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(`#${idx + 1} (${sec.count}❌)`, pillX + pillW / 2, pillY + 13 * scale);
    });

    // 3. Línea vertical de Primer Choke (Dorado discontinuo)
    if (firstChokeTime && firstChokeTime > 0) {
        const chokeX = padX + (firstChokeTime / totalMs) * chartW;
        ctx.save();
        ctx.setLineDash([4 * scale, 3 * scale]);
        ctx.strokeStyle = 'rgba(224, 175, 104, 0.85)';
        ctx.lineWidth = 1.5 * scale;
        ctx.beginPath();
        ctx.moveTo(chokeX, chartY);
        ctx.lineTo(chokeX, chartY + chartH);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.fillStyle = '#e0af68';
        ctx.font = `bold ${10 * scale}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('⚡ CHOKE', chokeX, chartY - 6 * scale);
        ctx.restore();
    }

    // 4. Marcadores de Misses (Líneas verticales neon y puntos con núcleo blanco)
    misses.forEach(m => {
        const px = padX + (m.time / totalMs) * chartW;

        ctx.strokeStyle = 'rgba(255, 77, 109, 0.65)';
        ctx.lineWidth = 1.6 * scale;
        ctx.beginPath();
        ctx.moveTo(px, chartY + chartH - 2 * scale);
        ctx.lineTo(px, chartY + chartH - 26 * scale);
        ctx.stroke();

        ctx.fillStyle = '#ff1744';
        ctx.beginPath();
        ctx.arc(px, chartY + chartH - 26 * scale, 3.8 * scale, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(px, chartY + chartH - 26 * scale, 1.6 * scale, 0, Math.PI * 2);
        ctx.fill();
    });

    // 5. Eje de Tiempo (Ticks y minutos:segundos)
    ctx.textAlign = 'center';
    ctx.fillStyle = '#787c99';
    ctx.font = `${11 * scale}px "Segoe UI", sans-serif`;
    const numTicks = 6;
    for (let i = 0; i <= numTicks; i++) {
        const t = (totalMs / numTicks) * i;
        const px = padX + (i / numTicks) * chartW;
        ctx.fillText(formatTime(t), px, chartY + chartH + 20 * scale);

        ctx.strokeStyle = '#3e4466';
        ctx.lineWidth = 1 * scale;
        ctx.beginPath();
        ctx.moveTo(px, chartY + chartH);
        ctx.lineTo(px, chartY + chartH + 5 * scale);
        ctx.stroke();
    }

    // Leyenda inferior
    ctx.textAlign = 'left';
    ctx.font = `${11 * scale}px "Segoe UI", sans-serif`;

    ctx.fillStyle = '#7aa2f7';
    ctx.fillText('■ Dificultad (Strain)', padX, height - 12 * scale);

    ctx.fillStyle = '#ff1744';
    ctx.fillText('● Miss registrado', padX + 180 * scale, height - 12 * scale);

    ctx.fillStyle = '#ff4d6d';
    ctx.fillText('▨ Zona crítica de fallos', padX + 350 * scale, height - 12 * scale);

    ctx.fillStyle = '#e0af68';
    ctx.fillText('┊ Primer Choke', padX + 540 * scale, height - 12 * scale);

    return canvas.toBuffer('image/png');
}

function formatTime(ms) {
    const min = Math.floor(ms / 60000);
    const sec = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
    return `${min}:${sec}`;
}

module.exports = {
    parseReplayBuffer,
    parseOsuHitObjects,
    analyzeReplayPerformance,
    renderAnalyzeChart,
    formatTime
};
