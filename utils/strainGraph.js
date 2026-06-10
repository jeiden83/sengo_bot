const { createCanvas } = require('canvas');
const rosu = require("rosu-pp-js");

function formatLength(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

/**
 * Genera el búfer de imagen (PNG) del gráfico de strains para un beatmap dado.
 * @param {rosu.Beatmap} map Instancia del mapa de rosu-pp-js
 * @param {string} modsStr String de los mods activos
 * @param {string} activeMode Modo de juego activo ('osu', 'taiko', 'fruits', 'mania')
 * @param {number} totalLength Duración total del mapa en segundos
 * @param {number} [failPercent] Porcentaje opcional en que falló el usuario (0 a 1)
 * @returns {Buffer} Búfer de la imagen PNG
 */
function generateStrainGraph(map, modsStr, activeMode, totalLength, failPercent) {
    const diff = new rosu.Difficulty({ mods: modsStr });
    const strains = diff.strains(map);

    // Identificar los arreglos a graficar según el modo de juego
    let lines = [];
    const mode = activeMode || 'osu';

    if (mode === 'osu') {
        if (strains.aim) lines.push({ label: 'Aim', data: strains.aim, color: '#ff66aa', fill: 'rgba(255, 102, 170, 0.12)' });
        if (strains.speed) lines.push({ label: 'Speed', data: strains.speed, color: '#44aaff', fill: 'rgba(68, 170, 255, 0.12)' });
        if (modsStr.toUpperCase().includes('FL') && strains.flashlight) {
            lines.push({ label: 'Flashlight', data: strains.flashlight, color: '#ffcc44', fill: 'rgba(255, 204, 68, 0.12)' });
        }
    } else if (mode === 'taiko') {
        if (strains.stamina) lines.push({ label: 'Stamina', data: strains.stamina, color: '#ff5555', fill: 'rgba(255, 85, 85, 0.12)' });
        if (strains.color) lines.push({ label: 'Color', data: strains.color, color: '#5599ff', fill: 'rgba(85, 153, 255, 0.12)' });
        if (strains.rhythm) lines.push({ label: 'Rhythm', data: strains.rhythm, color: '#ffcc55', fill: 'rgba(255, 204, 85, 0.12)' });
    } else if (mode === 'fruits') {
        if (strains.movement) lines.push({ label: 'Movement', data: strains.movement, color: '#ff8833', fill: 'rgba(255, 136, 51, 0.12)' });
    } else if (mode === 'mania') {
        if (strains.strains) lines.push({ label: 'Strain', data: strains.strains, color: '#aa55ff', fill: 'rgba(170, 85, 255, 0.12)' });
    }

    // Si no hay líneas válidas con datos, liberar memoria y crear gráfico vacío/básico
    if (lines.length === 0 || lines.every(l => l.data.length === 0)) {
        strains.free();
        // Crear un canvas vacío básico
        const canvas = createCanvas(700, 200);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1c1a1d';
        ctx.fillRect(0, 0, 700, 200);
        ctx.fillStyle = '#888888';
        ctx.font = '14px sans-serif';
        ctx.fillText('No se pudieron calcular los datos de strains para este modo.', 50, 100);
        return canvas.toBuffer('image/png');
    }

    // Configuración del Canvas
    const width = 750;
    const height = 240;
    const padding = { top: 40, right: 30, bottom: 40, left: 50 };
    
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Fondo del gráfico (charcoal dark)
    ctx.fillStyle = '#181619';
    ctx.fillRect(0, 0, width, height);

    // Dibujar fondo de la zona del gráfico con un tono sutilmente más claro
    ctx.fillStyle = '#1f1d21';
    const graphWidth = width - padding.left - padding.right;
    const graphHeight = height - padding.top - padding.bottom;
    ctx.fillRect(padding.left, padding.top, graphWidth, graphHeight);

    // Encontrar el valor máximo de todas las series de strains para escalar el eje Y
    let maxVal = 0;
    let maxPointsCount = 0;
    lines.forEach(line => {
        const len = line.data.length;
        if (len > maxPointsCount) maxPointsCount = len;
        for (let i = 0; i < len; i++) {
            if (line.data[i] > maxVal) {
                maxVal = line.data[i];
            }
        }
    });

    // Añadir un margen del 10% en la parte superior del gráfico
    maxVal = maxVal > 0 ? maxVal * 1.1 : 1.0;

    // Dibujar la cuadrícula (Grid)
    ctx.strokeStyle = '#2e2b31';
    ctx.lineWidth = 1;
    
    // Líneas horizontales de la cuadrícula
    const gridRows = 4;
    for (let i = 0; i <= gridRows; i++) {
        const y = padding.top + (graphHeight * i) / gridRows;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();
    }

    // Líneas verticales de la cuadrícula
    const gridCols = 8;
    for (let i = 0; i <= gridCols; i++) {
        const x = padding.left + (graphWidth * i) / gridCols;
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, height - padding.bottom);
        ctx.stroke();
    }

    // Dibujar las series (Strains)
    lines.forEach(line => {
        const data = line.data;
        const points = data.length;
        if (points < 2) return;

        // 1. Dibujar el área rellena (Fill) debajo de la curva
        ctx.fillStyle = line.fill;
        ctx.beginPath();
        
        let startX = padding.left;
        let startY = padding.top + graphHeight;
        ctx.moveTo(startX, startY);

        for (let i = 0; i < points; i++) {
            const val = data[i];
            const x = padding.left + (i / (points - 1)) * graphWidth;
            const y = padding.top + graphHeight - (val / maxVal) * graphHeight;
            ctx.lineTo(x, y);
        }

        ctx.lineTo(padding.left + graphWidth, padding.top + graphHeight);
        ctx.closePath();
        ctx.fill();

        // 2. Dibujar la línea de contorno (Stroke) de la curva
        ctx.strokeStyle = line.color;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();

        for (let i = 0; i < points; i++) {
            const val = data[i];
            const x = padding.left + (i / (points - 1)) * graphWidth;
            const y = padding.top + graphHeight - (val / maxVal) * graphHeight;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
    });

    // Dibujar etiquetas de tiempo
    ctx.fillStyle = '#a5a1a8';
    ctx.font = 'bold 11px sans-serif';
    ctx.textBaseline = 'top';

    // Tiempo de inicio (0:00)
    ctx.textAlign = 'left';
    ctx.fillText('0:00', padding.left, height - padding.bottom + 8);

    // Tiempos intermedios
    ctx.textAlign = 'center';
    const midSeconds = totalLength / 2;
    ctx.fillText(formatLength(midSeconds), padding.left + graphWidth / 2, height - padding.bottom + 8);

    // Tiempo total de finalización
    ctx.textAlign = 'right';
    ctx.fillText(formatLength(totalLength), width - padding.right, height - padding.bottom + 8);

    // Dibujar leyenda en la esquina superior izquierda
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = 'bold 11px sans-serif';
    
    let legendX = padding.left + 10;
    lines.forEach(line => {
        // Cuadro de color de la leyenda
        ctx.fillStyle = line.color;
        ctx.fillRect(legendX, padding.top - 22, 12, 12);
        
        // Texto de la leyenda
        ctx.fillStyle = '#ffffff';
        ctx.fillText(line.label, legendX + 18, padding.top - 16);
        
        // Desplazar la coordenada X para la siguiente leyenda
        const textWidth = ctx.measureText(line.label).width;
        legendX += 18 + textWidth + 25;
    });

    // Dibujar título / texto indicativo a la derecha
    ctx.textAlign = 'right';
    ctx.fillStyle = '#8d8990';
    ctx.font = '10px sans-serif';
    ctx.fillText('Dificultad (Strain) a lo largo del mapa', width - padding.right, padding.top - 16);

    // Dibujar marcador de FAIL si el score falló
    if (failPercent !== undefined && failPercent !== null && failPercent >= 0 && failPercent <= 1) {
        const failX = padding.left + failPercent * graphWidth;

        ctx.strokeStyle = '#ff3333';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(failX, padding.top);
        ctx.lineTo(failX, height - padding.bottom);
        ctx.stroke();
        ctx.setLineDash([]); // Restablecer a línea sólida

        ctx.fillStyle = '#ff3333';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`FAIL (${Math.round(failPercent * 100)}%)`, failX, padding.top - 6);
    }

    // IMPORTANTE: Liberar memoria asignada de WebAssembly
    strains.free();

    return canvas.toBuffer('image/png');
}

module.exports = { generateStrainGraph };
