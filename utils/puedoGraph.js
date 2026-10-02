/**
 * utils/puedoGraph.js
 * Generador visual de diagnóstico cinemático híbrido para s.puedo.
 * Renderiza en 2x Retina un panel panorámico compuesto por:
 *  - Izquierda: Curva temporal de esfuerzo (strains) de Aim y Speed con líneas de techo (Pass / FC).
 *  - Derecha: Medidores de probabilidad (Pass % vs FC %) y benchmark de 3 ejes (Aim, Tempo, Dificultad).
 *
 * ponytail: 0 librerías pesadas adicionales, usa canvas nativo ya instalado.
 */

const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');

// Registro de fuentes Poppins / Montserrat si existen
try {
    const fontDir = path.join(__dirname, '..', 'fonts');
    if (fs.existsSync(fontDir)) {
        const poppinsRegular = path.join(fontDir, 'Poppins-Regular.ttf');
        const poppinsBold = path.join(fontDir, 'Poppins-Bold.ttf');
        const poppinsSemiBold = path.join(fontDir, 'Poppins-SemiBold.ttf');
        if (fs.existsSync(poppinsRegular)) registerFont(poppinsRegular, { family: 'Poppins', weight: 'normal' });
        if (fs.existsSync(poppinsSemiBold)) registerFont(poppinsSemiBold, { family: 'Poppins', weight: '600' });
        if (fs.existsSync(poppinsBold)) registerFont(poppinsBold, { family: 'Poppins', weight: 'bold' });
    }
} catch (_) {}

function formatSeconds(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

/**
 * Genera el gráfico panorámico híbrido de diagnóstico de puedo en Buffer PNG.
 *
 * @param {Object} params
 * @param {Object} params.mapData - Metadatos del beatmap
 * @param {Object} params.analysis - Análisis probabilístico y factores
 * @param {Object} [params.strains] - Strains calculados por ppEngine
 * @param {string} [params.activeModsStr='NM'] - Mods solicitados
 * @param {Object} [params.user] - Datos del usuario
 * @param {string} [params.locale='es'] - Idioma
 * @returns {Promise<Buffer>} Buffer de imagen PNG
 */
async function generatePuedoGraph({
    mapData = {},
    analysis = {},
    strains = null,
    activeModsStr = 'NM',
    user = {},
    locale = 'es'
}) {
    const W = 960;
    const H = 380;
    const scale = 2; // Renderizado 2x Retina HiDPI
    const canvas = createCanvas(W * scale, H * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    const isEs = locale === 'es';

    // 1. Fondo principal oscuro
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, '#121015');
    bgGrad.addColorStop(0.5, '#16141c');
    bgGrad.addColorStop(1, '#0e0d11');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Cover de fondo tenue si existe
    try {
        const coverUrl = mapData.covers?.['cover@2x'] || mapData.covers?.cover || mapData.beatmapset?.covers?.['cover@2x'] || mapData.beatmapset?.covers?.cover;
        if (coverUrl) {
            const img = await loadImage(coverUrl);
            ctx.save();
            ctx.globalAlpha = 0.12;
            ctx.drawImage(img, 0, 0, W, H);
            ctx.restore();
        }
    } catch (_) {}

    // 2. Paneles principales (Izquierdo: Strains / Derecho: Diagnóstico)
    const pLeft = { x: 18, y: 64, w: 520, h: 298 };
    const pRight = { x: 552, y: 64, w: 390, h: 298 };
    const r = 12;

    const drawCard = (p) => {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(p.x, p.y, p.w, p.h, r);
        ctx.fillStyle = 'rgba(25, 23, 30, 0.85)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
    };

    drawCard(pLeft);
    drawCard(pRight);

    // 3. Barra Superior (Encabezado)
    ctx.save();
    const artist = mapData.artist || mapData.beatmapset?.artist || '';
    const title = mapData.title || mapData.beatmapset?.title || 'Beatmap';
    const version = mapData.version || '';
    const modsBadge = (activeModsStr && activeModsStr !== 'NM') ? ` +${activeModsStr}` : '';
    const fullTitle = `${artist ? `${artist} - ` : ''}${title}${version ? ` [${version}]` : ''}${modsBadge}`;
    const truncatedTitle = fullTitle.length > 58 ? fullTitle.slice(0, 55) + '...' : fullTitle;

    ctx.font = 'bold 15px Poppins, Montserrat, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(truncatedTitle, 22, 28);

    ctx.font = 'bold 12px Poppins, Montserrat, sans-serif';
    ctx.fillStyle = '#a855f7';
    let archetypeLabel = isEs ? '⚖️ HÍBRIDO' : '⚖️ HYBRID';
    if (analysis.map?.archetypeKey === 'puedo.archetype_jumps') {
        archetypeLabel = isEs ? '🎯 JUMPS / AIM' : '🎯 JUMPS / AIM';
    } else if (analysis.map?.archetypeKey === 'puedo.archetype_streams') {
        archetypeLabel = isEs ? '🌊 STREAMS / STAMINA' : '🌊 STREAMS / STAMINA';
    }
    ctx.fillText(archetypeLabel, 22, 48);

    // Métricas rápidas a la derecha
    ctx.textAlign = 'right';
    ctx.font = 'bold 16px Poppins, Montserrat, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.fillText(`${(analysis.map?.sr || 5.0).toFixed(2)}★`, W - 22, 28);

    ctx.font = '12px Poppins, Montserrat, sans-serif';
    ctx.fillStyle = '#9e9aa8';
    const hpStr = Number(analysis.map?.hp || 5.0).toFixed(1);
    ctx.fillText(`${analysis.map?.bpm || 180} BPM  •  AR ${analysis.map?.ar || 9.0}  •  OD ${analysis.map?.od || 8.0}  •  HP ${hpStr}`, W - 22, 48);
    ctx.restore();

    // ==========================================
    // 4. PANEL IZQUIERDO: Curva de Strains
    // ==========================================
    ctx.save();
    ctx.font = 'bold 11px Poppins, Montserrat, sans-serif';
    ctx.fillStyle = '#8e8a99';
    ctx.fillText(isEs ? '⚡ TIMELINE DE ESFUERZO CINEMÁTICO' : '⚡ KINETIC STRAIN TIMELINE', pLeft.x + 16, pLeft.y + 24);

    // Leyenda de series
    ctx.font = '10px Poppins, Montserrat, sans-serif';
    let legX = pLeft.x + pLeft.w - 190;
    // Aim
    ctx.fillStyle = '#ff66aa';
    ctx.fillRect(legX, pLeft.y + 16, 8, 8);
    ctx.fillStyle = '#dcd7e5';
    ctx.fillText('Aim', legX + 12, pLeft.y + 24);
    // Speed
    legX += 45;
    ctx.fillStyle = '#44aaff';
    ctx.fillRect(legX, pLeft.y + 16, 8, 8);
    ctx.fillStyle = '#dcd7e5';
    ctx.fillText('Speed', legX + 12, pLeft.y + 24);
    // Pass Ceiling
    legX += 55;
    ctx.strokeStyle = '#2ecc71';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(legX, pLeft.y + 20);
    ctx.lineTo(legX + 12, pLeft.y + 20);
    ctx.stroke();
    ctx.fillStyle = '#2ecc71';
    ctx.fillText('Pass', legX + 16, pLeft.y + 24);

    // Área del gráfico
    const gx = pLeft.x + 16;
    const gy = pLeft.y + 42;
    const gw = pLeft.w - 32;
    const gh = pLeft.h - 72;

    let aimData = strains?.aim || [];
    let speedData = strains?.speed || [];
    const nPoints = Math.max(aimData.length, speedData.length);

    if (nPoints > 1) {
        let maxStrain = 1;
        for (let i = 0; i < nPoints; i++) {
            const a = aimData[i] || 0;
            const s = speedData[i] || 0;
            if (a > maxStrain) maxStrain = a;
            if (s > maxStrain) maxStrain = s;
        }

        const yMax = maxStrain * 1.25;

        // Grilla de fondo horizontal
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        for (let step = 0.25; step <= 1; step += 0.25) {
            const lineY = gy + gh - (gh * step);
            ctx.beginPath();
            ctx.moveTo(gx, lineY);
            ctx.lineTo(gx + gw, lineY);
            ctx.stroke();
        }

        const getX = (i) => gx + (i / (nPoints - 1)) * gw;
        const getY = (val) => gy + gh - Math.max(0, Math.min(gh, (val / yMax) * gh));

        // Dibujar curvas de área para Speed
        if (speedData.length > 0) {
            ctx.beginPath();
            ctx.moveTo(gx, gy + gh);
            for (let i = 0; i < speedData.length; i++) {
                ctx.lineTo(getX(i), getY(speedData[i]));
            }
            ctx.lineTo(gx + gw, gy + gh);
            ctx.closePath();
            const spGrad = ctx.createLinearGradient(0, gy, 0, gy + gh);
            spGrad.addColorStop(0, 'rgba(68, 170, 255, 0.35)');
            spGrad.addColorStop(1, 'rgba(68, 170, 255, 0.01)');
            ctx.fillStyle = spGrad;
            ctx.fill();

            ctx.beginPath();
            for (let i = 0; i < speedData.length; i++) {
                if (i === 0) ctx.moveTo(getX(i), getY(speedData[i]));
                else ctx.lineTo(getX(i), getY(speedData[i]));
            }
            ctx.strokeStyle = '#44aaff';
            ctx.lineWidth = 1.6;
            ctx.stroke();
        }

        // Dibujar curvas de área para Aim
        if (aimData.length > 0) {
            ctx.beginPath();
            ctx.moveTo(gx, gy + gh);
            for (let i = 0; i < aimData.length; i++) {
                ctx.lineTo(getX(i), getY(aimData[i]));
            }
            ctx.lineTo(gx + gw, gy + gh);
            ctx.closePath();
            const aimGrad = ctx.createLinearGradient(0, gy, 0, gy + gh);
            aimGrad.addColorStop(0, 'rgba(255, 102, 170, 0.38)');
            aimGrad.addColorStop(1, 'rgba(255, 102, 170, 0.01)');
            ctx.fillStyle = aimGrad;
            ctx.fill();

            ctx.beginPath();
            for (let i = 0; i < aimData.length; i++) {
                if (i === 0) ctx.moveTo(getX(i), getY(aimData[i]));
                else ctx.lineTo(getX(i), getY(aimData[i]));
            }
            ctx.strokeStyle = '#ff66aa';
            ctx.lineWidth = 1.8;
            ctx.stroke();
        }

        // Línea Horizontal: Techo de Pass del Jugador
        const mapSR = Math.max(0.1, analysis.map?.sr || 5.0);
        const passRatio = (analysis.factors?.effectivePassRating || mapSR) / mapSR;
        const passStrainEquiv = maxStrain * passRatio;
        const passLineY = getY(passStrainEquiv);

        if (passLineY >= gy && passLineY <= gy + gh) {
            ctx.save();
            ctx.setLineDash([5, 4]);
            ctx.strokeStyle = '#2ecc71';
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.moveTo(gx, passLineY);
            ctx.lineTo(gx + gw, passLineY);
            ctx.stroke();
            ctx.restore();

            ctx.fillStyle = '#2ecc71';
            ctx.font = 'bold 10px Poppins, Montserrat, sans-serif';
            ctx.fillText(`Pass Limit: ${(analysis.factors?.effectivePassRating || 0).toFixed(2)}★`, gx + 6, passLineY - 4);
        }

        // Línea Horizontal: Techo de FC del Jugador
        const fcRatio = (analysis.factors?.pushStars || mapSR) / mapSR;
        const fcStrainEquiv = maxStrain * fcRatio;
        const fcLineY = getY(fcStrainEquiv);

        if (fcLineY >= gy && fcLineY <= gy + gh) {
            ctx.save();
            ctx.setLineDash([3, 4]);
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(gx, fcLineY);
            ctx.lineTo(gx + gw, fcLineY);
            ctx.stroke();
            ctx.restore();

            ctx.fillStyle = '#ffd700';
            ctx.font = 'bold 9px Poppins, Montserrat, sans-serif';
            ctx.fillText(`FC Push: ${(analysis.factors?.pushStars || 0).toFixed(2)}★`, gx + gw - 90, fcLineY - 4);
        }

        // Marcas de tiempo en el eje X
        const secLen = (strains.sectionLength || 400) / 1000;
        const totalSec = nPoints * secLen;
        ctx.fillStyle = '#736e7d';
        ctx.font = '10px Poppins, Montserrat, sans-serif';
        const timeIntervals = 5;
        for (let i = 0; i <= timeIntervals; i++) {
            const frac = i / timeIntervals;
            const curSec = totalSec * frac;
            const tx = gx + (gw * frac);
            ctx.textAlign = i === 0 ? 'left' : (i === timeIntervals ? 'right' : 'center');
            ctx.fillText(formatSeconds(curSec), tx, gy + gh + 18);
        }
    } else {
        ctx.fillStyle = '#736e7d';
        ctx.font = '12px Poppins, Montserrat, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(isEs ? 'Strains no disponibles para este mapa' : 'Strains unavailable for this map', gx + gw / 2, gy + gh / 2);
    }
    ctx.restore();

    // ==========================================
    // 5. PANEL DERECHO: Métricas & Probabilidades
    // ==========================================
    ctx.save();
    ctx.font = 'bold 11px Poppins, Montserrat, sans-serif';
    ctx.fillStyle = '#8e8a99';
    ctx.fillText(isEs ? '📊 DIAGNÓSTICO DE RENDIMIENTO' : '📊 PERFORMANCE DIAGNOSTIC', pRight.x + 16, pRight.y + 24);

    // Medidores de Probabilidad (Pass vs FC)
    const gaugeY = pRight.y + 36;
    const gBoxW = (pRight.w - 40) / 2;
    const gBoxH = 68;

    // Caja PASS
    const passBoxX = pRight.x + 15;
    ctx.beginPath();
    ctx.roundRect(passBoxX, gaugeY, gBoxW, gBoxH, 8);
    ctx.fillStyle = 'rgba(46, 204, 113, 0.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(46, 204, 113, 0.25)';
    ctx.stroke();

    ctx.fillStyle = '#2ecc71';
    ctx.font = 'bold 24px Poppins, Montserrat, sans-serif';
    ctx.fillText(`${analysis.passProb}%`, passBoxX + 12, gaugeY + 32);
    ctx.font = 'bold 10px Poppins, Montserrat, sans-serif';
    ctx.fillStyle = '#a6f0c2';
    ctx.fillText(isEs ? 'PROB. PASS' : 'PASS PROB.', passBoxX + 12, gaugeY + 48);
    ctx.font = '9px Poppins, Montserrat, sans-serif';
    ctx.fillStyle = '#8ed6ab';
    const passStatus = analysis.passedBefore
        ? (isEs ? '🏆 Ya pasado' : '🏆 Passed')
        : (analysis.passProb >= 70
            ? (isEs ? '🟢 Factible' : '🟢 Achievable')
            : (analysis.passProb >= 40
                ? (isEs ? '🟡 Desafío' : '🟡 Challenge')
                : (isEs ? '🔴 Extremo' : '🔴 Extreme')));
    ctx.fillText(passStatus, passBoxX + 12, gaugeY + 60);

    // Caja FC
    const fcBoxX = passBoxX + gBoxW + 10;
    ctx.beginPath();
    ctx.roundRect(fcBoxX, gaugeY, gBoxW, gBoxH, 8);
    const fcColor = analysis.fcProb >= 40 ? '#2ecc71' : (analysis.fcProb >= 10 ? '#f39c12' : '#e74c3c');
    ctx.fillStyle = `${fcColor}14`;
    ctx.fill();
    ctx.strokeStyle = `${fcColor}40`;
    ctx.stroke();

    ctx.fillStyle = fcColor;
    ctx.font = 'bold 24px Poppins, Montserrat, sans-serif';
    ctx.fillText(`${analysis.fcProb}%`, fcBoxX + 12, gaugeY + 32);
    ctx.font = 'bold 10px Poppins, Montserrat, sans-serif';
    ctx.fillStyle = '#e0dede';
    ctx.fillText(isEs ? 'PROB. FC' : 'FC PROB.', fcBoxX + 12, gaugeY + 48);
    ctx.font = '9px Poppins, Montserrat, sans-serif';
    ctx.fillStyle = '#a39f9f';
    const fcStatus = analysis.fcProb >= 50
        ? (isEs ? '🟢 Alta' : '🟢 High')
        : (analysis.fcProb >= 15
            ? (isEs ? '🟡 Choke risk' : '🟡 Choke risk')
            : (isEs ? '🔴 Imposible' : '🔴 Impossible'));
    ctx.fillText(fcStatus, fcBoxX + 12, gaugeY + 60);

    // Barras de Benchmark Comparativo (3 Factores con espaciado amplio)
    const bStartY = gaugeY + gBoxH + 18;
    const bW = pRight.w - 30;
    const bX = pRight.x + 15;

    const renderMetricRow = (y, label, valRight, pct, barColor, note) => {
        ctx.font = 'bold 10px Poppins, Montserrat, sans-serif';
        ctx.fillStyle = '#d5d0df';
        ctx.fillText(label, bX, y);

        ctx.textAlign = 'right';
        ctx.fillStyle = '#9e99a8';
        ctx.fillText(valRight, bX + bW, y);
        ctx.textAlign = 'left';

        // Barra de progreso
        const barY = y + 5;
        const barH = 6;
        ctx.beginPath();
        ctx.roundRect(bX, barY, bW, barH, 3);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fill();

        const filledW = Math.max(4, Math.min(bW, (pct / 100) * bW));
        ctx.beginPath();
        ctx.roundRect(bX, barY, filledW, barH, 3);
        ctx.fillStyle = barColor;
        ctx.fill();

        if (note) {
            ctx.font = '9px Poppins, Montserrat, sans-serif';
            ctx.fillStyle = barColor;
            ctx.fillText(note, bX, barY + 16);
        }
    };

    let curY = bStartY;

    // 1. Aim Skill vs Mapa
    const aimSharePct = Math.round((analysis.map?.aimWeight || 0.5) * 100);
    const userAim = analysis.factors?.userAim || 50;
    renderMetricRow(
        curY,
        `AIM: ${userAim.toFixed(1)} / 100`,
        isEs ? `Mapa: ${aimSharePct}% Aim` : `Map: ${aimSharePct}% Aim`,
        Math.min(100, (userAim / 80) * 100),
        '#ff66aa',
        userAim >= 60 ? (isEs ? '✨ Alto superávit de Aim (+1.1★ bono pass)' : '✨ High Aim surplus (+1.1★ pass bonus)') : null
    );

    curY += 44;

    // 2. Speed / BPM
    const bpmComfort = analysis.factors?.estimatedComfortBPM || 180;
    const mapBPM = analysis.map?.bpm || 180;
    const bpmOver = mapBPM > bpmComfort;
    const bpmPct = Math.min(100, (mapBPM / (bpmComfort * 1.25)) * 100);
    renderMetricRow(
        curY,
        `TEMPO: ${mapBPM} BPM`,
        isEs ? `Confort: ~${bpmComfort} BPM` : `Comfort: ~${bpmComfort} BPM`,
        bpmPct,
        bpmOver ? '#e74c3c' : '#44aaff',
        bpmOver
            ? (isEs ? `⚠️ Excede confort por +${mapBPM - bpmComfort} BPM` : `⚠️ Exceeds comfort by +${mapBPM - bpmComfort} BPM`)
            : (isEs ? '✅ Dentro de velocidad cómoda' : '✅ Within comfortable speed')
    );

    curY += 44;

    // 3. Techos de Dificultad (FC vs Pass)
    const sr = analysis.map?.sr || 5.0;
    const fcCeil = analysis.factors?.pushStars || 5.0;
    const passCeil = analysis.factors?.effectivePassRating || 6.0;
    const diffPct = Math.min(100, Math.max(10, ((sr - (fcCeil - 1.0)) / (passCeil - (fcCeil - 1.0) + 0.5)) * 100));

    renderMetricRow(
        curY,
        isEs ? `TECHO FC / PASS: ${fcCeil.toFixed(2)}★ / ${passCeil.toFixed(2)}★` : `FC / PASS CEILING: ${fcCeil.toFixed(2)}★ / ${passCeil.toFixed(2)}★`,
        isEs ? `Mapa: ${sr.toFixed(2)}★` : `Map: ${sr.toFixed(2)}★`,
        diffPct,
        sr <= passCeil ? '#2ecc71' : '#e74c3c',
        sr <= passCeil
            ? (isEs ? `🟢 Mapa dentro de tu límite de pass (${passCeil.toFixed(2)}★)` : `🟢 Map within your pass limit (${passCeil.toFixed(2)}★)`)
            : (isEs ? `🔴 Mapa por encima de tu límite de pass` : `🔴 Map above your pass limit`)
    );

    ctx.restore();

    return canvas.toBuffer('image/png');
}

module.exports = { generatePuedoGraph };
