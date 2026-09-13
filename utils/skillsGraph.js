const { createCanvas } = require('canvas');

/**
 * Genera un buffer PNG con un gráfico de barras apiladas moderno para el desglose de skills por PP.
 * Compatible con todos los modos de juego (osu!, taiko, catch, mania).
 *
 * @param {Object} params
 * @param {string} params.beatmapTitle Título y dificultad del beatmap
 * @param {string} params.modsStr String de mods activos (ej: "HDHR")
 * @param {string} params.activeMode Modo de juego ('osu', 'taiko', 'fruits', 'mania')
 * @param {number} params.stars Star rating del mapa con mods
 * @param {Object} params.skillsData Datos de habilidades y desglose de precisiones
 * @param {string} [params.locale='es'] Idioma para textos del gráfico
 * @returns {Buffer} Buffer de imagen PNG
 */
function generateSkillsBarChart({
    beatmapTitle = "",
    modsStr = "",
    activeMode = "osu",
    stars = 0,
    skillsData = {},
    locale = "es"
}) {
    const width = 750;
    const height = 290;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const mode = activeMode || 'osu';
    const skillsByAcc = skillsData.skillsByAcc || [
        { accuracy: 100, pp: 0, aimPP: 0, speedPP: 0, accPP: 0, flPP: 0, readingPP: 0, diffPP: 0 }
    ];

    const aimStars = Number(skillsData.aimStars || 0);
    const speedStars = Number(skillsData.speedStars || 0);
    const readingStars = Number(skillsData.readingStars || 0);
    const flashlightStars = Number(skillsData.flashlightStars || 0);

    // 1. Fondo principal estilizado
    ctx.fillStyle = '#141215';
    ctx.fillRect(0, 0, width, height);

    // Fondo del panel con borde sutil
    const panelX = 20;
    const panelY = 15;
    const panelW = width - 40;
    const panelH = height - 30;
    const radius = 12;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, radius);
    ctx.fillStyle = '#1b191e';
    ctx.fill();
    ctx.strokeStyle = '#2d2933';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // 2. Encabezado
    ctx.save();
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#ff66aa';
    ctx.fillText('⚡ SENGO PP ENGINE', panelX + 20, panelY + 28);

    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.textAlign = 'right';
    const modTag = modsStr ? ` +${modsStr}` : ' (NoMod)';
    ctx.fillText(`${Number(stars).toFixed(2)}★${modTag}`, panelX + panelW - 20, panelY + 28);

    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#8f8a96';
    ctx.textAlign = 'left';
    const cleanTitle = beatmapTitle || 'Beatmap';
    const titleText = cleanTitle.length > 55 ? cleanTitle.slice(0, 52) + '...' : cleanTitle;
    ctx.fillText(titleText, panelX + 20, panelY + 46);
    ctx.restore();

    // 3. Tarjetas / Pills de Resumen de Skills
    const pillY = panelY + 58;
    const pillH = 34;
    const pillSpacing = 8;
    const topRow = skillsByAcc[0] || {};

    let pills = [];
    if (mode === 'osu') {
        pills.push({
            label: 'AIM',
            value: `${Number(topRow.aimPP || 0).toFixed(1)} pp`,
            stars: aimStars > 0 ? `${aimStars.toFixed(2)}★` : null,
            color: '#ff66aa',
            bg: 'rgba(255, 102, 170, 0.12)'
        });
        pills.push({
            label: 'SPEED',
            value: `${Number(topRow.speedPP || 0).toFixed(1)} pp`,
            stars: speedStars > 0 ? `${speedStars.toFixed(2)}★` : null,
            color: '#44aaff',
            bg: 'rgba(68, 170, 255, 0.12)'
        });
        pills.push({
            label: 'ACCURACY',
            value: `${Number(topRow.accPP || 0).toFixed(1)} pp`,
            stars: null,
            color: '#4ade80',
            bg: 'rgba(74, 222, 128, 0.12)'
        });
        pills.push({
            label: 'READING',
            value: `${Number(topRow.readingPP || 0).toFixed(1)} pp`,
            stars: readingStars > 0 ? `${readingStars.toFixed(2)}★` : null,
            color: '#a855f7',
            bg: 'rgba(168, 85, 247, 0.12)'
        });

        if (flashlightStars > 0.05 || (topRow.flPP && topRow.flPP > 0.5)) {
            pills.push({
                label: 'FLASHLIGHT',
                value: `${Number(topRow.flPP || 0).toFixed(1)} pp`,
                stars: flashlightStars > 0 ? `${flashlightStars.toFixed(2)}★` : null,
                color: '#facc15',
                bg: 'rgba(250, 204, 21, 0.12)'
            });
        }
    } else if (mode === 'taiko') {
        pills.push({
            label: 'DIFFICULTY',
            value: `${Number(topRow.diffPP || 0).toFixed(1)} pp`,
            stars: `${Number(stars).toFixed(2)}★`,
            color: '#ff5555',
            bg: 'rgba(255, 85, 85, 0.12)'
        });
        pills.push({
            label: 'ACCURACY',
            value: `${Number(topRow.accPP || 0).toFixed(1)} pp`,
            stars: null,
            color: '#4ade80',
            bg: 'rgba(74, 222, 128, 0.12)'
        });
    } else if (mode === 'mania') {
        pills.push({
            label: 'DIFFICULTY',
            value: `${Number(topRow.diffPP || topRow.pp || 0).toFixed(1)} pp`,
            stars: `${Number(stars).toFixed(2)}★`,
            color: '#aa55ff',
            bg: 'rgba(170, 85, 255, 0.12)'
        });
        pills.push({
            label: 'TOTAL PP',
            value: `${Number(topRow.pp || 0).toFixed(1)} pp`,
            stars: null,
            color: '#38bdf8',
            bg: 'rgba(56, 189, 248, 0.12)'
        });
    } else {
        // fruits / catch
        pills.push({
            label: 'DIFFICULTY',
            value: `${Number(topRow.diffPP || topRow.pp || 0).toFixed(1)} pp`,
            stars: `${Number(stars).toFixed(2)}★`,
            color: '#ff8833',
            bg: 'rgba(255, 136, 51, 0.12)'
        });
        pills.push({
            label: 'TOTAL PP',
            value: `${Number(topRow.pp || 0).toFixed(1)} pp`,
            stars: null,
            color: '#38bdf8',
            bg: 'rgba(56, 189, 248, 0.12)'
        });
    }

    const totalPills = pills.length;
    const pillW = (panelW - 40 - (pillSpacing * (totalPills - 1))) / totalPills;

    pills.forEach((p, idx) => {
        const px = panelX + 20 + idx * (pillW + pillSpacing);
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(px, pillY, pillW, pillH, 8);
        ctx.fillStyle = p.bg;
        ctx.fill();
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.font = 'bold 9px sans-serif';
        ctx.fillStyle = p.color;
        ctx.fillText(p.label, px + 8, pillY + 13);

        ctx.font = 'bold 11px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(p.value, px + 8, pillY + 27);

        if (p.stars) {
            ctx.font = '10px sans-serif';
            ctx.fillStyle = '#ffd700';
            ctx.textAlign = 'right';
            ctx.fillText(p.stars, px + pillW - 8, pillY + 22);
        }
        ctx.restore();
    });

    // 4. Gráfico de Barras Apiladas por Precisión
    const chartY = panelY + 106;
    const chartH = 110;
    const barAreaX = panelX + 75;
    const barAreaW = panelW - 175;
    const maxPP = Math.max(1, ...skillsByAcc.map(s => Number(s.pp || 0))) * 1.05;

    const rowH = chartH / skillsByAcc.length;
    const barH = 16;

    skillsByAcc.forEach((row, i) => {
        const yCenter = chartY + i * rowH + (rowH / 2);
        const yTop = yCenter - (barH / 2);

        // Etiqueta de Precisión (Izquierda)
        ctx.save();
        ctx.font = 'bold 12px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${row.accuracy}%`, barAreaX - 12, yCenter);

        // Fondo de la barra (track)
        ctx.beginPath();
        ctx.roundRect(barAreaX, yTop, barAreaW, barH, 4);
        ctx.fillStyle = '#252229';
        ctx.fill();

        let curX = barAreaX;
        const drawSegment = (segW, color) => {
            if (segW <= 0.5) return;
            ctx.fillStyle = color;
            ctx.fillRect(curX, yTop, segW, barH);
            curX += segW;
        };

        // Recorte con la forma de la barra redondeada
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(barAreaX, yTop, barAreaW, barH, 4);
        ctx.clip();

        if (mode === 'osu') {
            const wAim = (Number(row.aimPP || 0) / maxPP) * barAreaW;
            const wSpeed = (Number(row.speedPP || 0) / maxPP) * barAreaW;
            const wAcc = (Number(row.accPP || 0) / maxPP) * barAreaW;
            const wReading = (Number(row.readingPP || 0) / maxPP) * barAreaW;
            const wFl = (Number(row.flPP || 0) / maxPP) * barAreaW;

            drawSegment(wAim, '#ff66aa');
            drawSegment(wSpeed, '#44aaff');
            drawSegment(wAcc, '#4ade80');
            drawSegment(wReading, '#a855f7');
            drawSegment(wFl, '#facc15');
        } else if (mode === 'taiko') {
            const wDiff = (Number(row.diffPP || 0) / maxPP) * barAreaW;
            const wAcc = (Number(row.accPP || 0) / maxPP) * barAreaW;

            drawSegment(wDiff, '#ff5555');
            drawSegment(wAcc, '#4ade80');
        } else if (mode === 'mania') {
            const wDiff = (Number(row.diffPP || row.pp || 0) / maxPP) * barAreaW;
            drawSegment(wDiff, '#aa55ff');
        } else {
            // fruits
            const wDiff = (Number(row.diffPP || row.pp || 0) / maxPP) * barAreaW;
            drawSegment(wDiff, '#ff8833');
        }

        ctx.restore();

        // Borde fino para la barra completa
        ctx.beginPath();
        ctx.roundRect(barAreaX, yTop, barAreaW, barH, 4);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Etiqueta de PP Total (Derecha)
        ctx.font = 'bold 12px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${Number(row.pp || 0).toFixed(1)} pp`, barAreaX + barAreaW + 12, yCenter);
        ctx.restore();
    });

    // 5. Leyenda Inferior
    const legendY = panelY + panelH - 14;
    let legendItems = [];

    if (mode === 'osu') {
        legendItems.push({ label: 'Aim PP', color: '#ff66aa' });
        legendItems.push({ label: 'Speed PP', color: '#44aaff' });
        legendItems.push({ label: 'Acc PP', color: '#4ade80' });
        legendItems.push({ label: 'Reading PP', color: '#a855f7' });
        if (skillsByAcc.some(s => (s.flPP || 0) > 0.5) || flashlightStars > 0.05) {
            legendItems.push({ label: 'FL PP', color: '#facc15' });
        }
    } else if (mode === 'taiko') {
        legendItems.push({ label: 'Difficulty PP', color: '#ff5555' });
        legendItems.push({ label: 'Acc PP', color: '#4ade80' });
    } else if (mode === 'mania') {
        legendItems.push({ label: 'Difficulty PP', color: '#aa55ff' });
    } else {
        legendItems.push({ label: 'Difficulty PP', color: '#ff8833' });
    }

    ctx.save();
    ctx.font = 'bold 10px sans-serif';
    ctx.textBaseline = 'middle';
    let lx = panelX + 25;
    legendItems.forEach(item => {
        ctx.fillStyle = item.color;
        ctx.beginPath();
        ctx.arc(lx, legendY, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#a09ba6';
        ctx.fillText(item.label, lx + 8, legendY);
        lx += ctx.measureText(item.label).width + 22;
    });

    // Pie derecho
    const footerHint = locale === 'en'
        ? 'Proportional breakdown by accuracy (100%, 99%, 98%, 95%)'
        : 'Desglose proporcional por precisión (100%, 99%, 98%, 95%)';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#6e6975';
    ctx.font = '10px sans-serif';
    ctx.fillText(footerHint, panelX + panelW - 20, legendY);
    ctx.restore();

    return canvas.toBuffer('image/png');
}

module.exports = {
    generateSkillsBarChart
};
