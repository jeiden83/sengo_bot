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
 * @param {string} [failLabel] Etiqueta opcional personalizada de fail
 * @returns {Buffer} Búfer de la imagen PNG
 */
function generateStrainGraph(map, modsStr, activeMode, totalLength, failPercent, failLabel) {
    const diff = new rosu.Difficulty({ mods: modsStr });
    const strains = diff.strains(map);

    // Identificar los arreglos a graficar según el modo de juego
    let lines = [];
    const mode = activeMode || 'osu';

    let peakIndices = [];
    if (mode === 'osu') {
        if (strains.aim) lines.push({ label: 'Aim', data: strains.aim, color: '#ff66aa', fill: 'rgba(255, 102, 170, 0.12)', width: 1.5 });
        if (strains.speed) lines.push({ label: 'Speed', data: strains.speed, color: '#44aaff', fill: 'rgba(68, 170, 255, 0.12)', width: 1.5 });
        if (strains.aim && strains.speed && strains.aim.length === strains.speed.length) {
            const totalData = [];
            let maxTotal = 0;
            for (let i = 0; i < strains.aim.length; i++) {
                const val = strains.aim[i] + strains.speed[i];
                totalData.push(val);
                if (val > maxTotal) {
                    maxTotal = val;
                }
            }
            lines.push({ label: 'Total', data: totalData, color: '#ffd700', fill: 'rgba(0, 0, 0, 0)', width: 3.0 });
        }
        if (modsStr.toUpperCase().includes('FL') && strains.flashlight) {
            lines.push({ label: 'Flashlight', data: strains.flashlight, color: '#ffcc44', fill: 'rgba(255, 204, 68, 0.12)', width: 2.0 });
        }
    } else if (mode === 'taiko') {
        if (strains.stamina) lines.push({ label: 'Stamina', data: strains.stamina, color: '#ff5555', fill: 'rgba(255, 85, 85, 0.12)', width: 2.0 });
        if (strains.color) lines.push({ label: 'Color', data: strains.color, color: '#5599ff', fill: 'rgba(85, 153, 255, 0.12)', width: 2.0 });
        if (strains.rhythm) lines.push({ label: 'Rhythm', data: strains.rhythm, color: '#ffcc55', fill: 'rgba(255, 204, 85, 0.12)', width: 2.0 });
    } else if (mode === 'fruits') {
        if (strains.movement) lines.push({ label: 'Movement', data: strains.movement, color: '#ff8833', fill: 'rgba(255, 136, 51, 0.12)', width: 2.0 });
    } else if (mode === 'mania') {
        if (strains.strains) lines.push({ label: 'Strain', data: strains.strains, color: '#aa55ff', fill: 'rgba(170, 85, 255, 0.12)', width: 2.0 });
    }

    // Calcular peakIndices de forma genérica para todos los modos de juego
    let maxPointsCount = 0;
    lines.forEach(line => {
        if (line.data && line.data.length > maxPointsCount) {
            maxPointsCount = line.data.length;
        }
    });

    if (maxPointsCount > 0) {
        let totalData = [];
        let maxTotal = 0;

        // Si ya hay una línea "Total" (como en osu!), la usamos directamente.
        // De lo contrario, calculamos la suma de todas las series.
        const totalLine = lines.find(l => l.label === 'Total');
        if (totalLine) {
            totalData = totalLine.data;
            for (let i = 0; i < totalData.length; i++) {
                if (totalData[i] > maxTotal) {
                    maxTotal = totalData[i];
                }
            }
        } else {
            for (let i = 0; i < maxPointsCount; i++) {
                let sum = 0;
                lines.forEach(line => {
                    if (line.data && line.data[i] !== undefined) {
                        sum += line.data[i];
                    }
                });
                totalData.push(sum);
                if (sum > maxTotal) {
                    maxTotal = sum;
                }
            }
        }

        if (maxTotal > 0) {
            // Encontrar picos locales que estén al menos al 80% del máximo total
            const peakThreshold = maxTotal * 0.80;
            for (let i = 1; i < totalData.length - 1; i++) {
                const val = totalData[i];
                if (val >= peakThreshold && val > totalData[i - 1] && val > totalData[i + 1]) {
                    peakIndices.push(i);
                }
            }

            if (peakIndices.length === 0) {
                const maxIdx = totalData.indexOf(maxTotal);
                if (maxIdx !== -1) peakIndices.push(maxIdx);
            }

            // Evitar picos demasiado juntos (debouncing espacial)
            // Ajustamos la distancia mínima para que las etiquetas de tiempo no se solapen.
            // Para un ancho de 670px, unos 50px de distancia es ideal (~7.5% de la longitud total).
            const minDistancePoints = Math.max(5, Math.round(totalData.length * 0.075));
            peakIndices.sort((a, b) => totalData[b] - totalData[a]); // Ordenar por valor descendente
            const filteredPeaks = [];
            for (const idx of peakIndices) {
                const isTooClose = filteredPeaks.some(p => Math.abs(p - idx) < minDistancePoints);
                if (!isTooClose) {
                    filteredPeaks.push(idx);
                }
            }
            peakIndices = filteredPeaks.slice(0, 5).sort((a, b) => a - b);
        }
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
    lines.forEach(line => {
        const len = line.data.length;
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

    // Dibujar las bandas de pico de dificultad en el fondo (detrás de las líneas)
    if (peakIndices && peakIndices.length > 0) {
        ctx.save();
        peakIndices.forEach(idx => {
            const x = padding.left + (idx / (maxPointsCount - 1)) * graphWidth;
            const bandWidth = 12;

            // Gradiente horizontal para dar efecto de resplandor (glow)
            const grad = ctx.createLinearGradient(x - bandWidth, padding.top, x + bandWidth, padding.top);
            grad.addColorStop(0, 'rgba(255, 215, 0, 0.0)');
            grad.addColorStop(0.3, 'rgba(255, 215, 0, 0.06)');
            grad.addColorStop(0.5, 'rgba(255, 215, 0, 0.12)');
            grad.addColorStop(0.7, 'rgba(255, 215, 0, 0.06)');
            grad.addColorStop(1, 'rgba(255, 215, 0, 0.0)');

            ctx.fillStyle = grad;
            ctx.fillRect(x - bandWidth, padding.top, bandWidth * 2, graphHeight);

            // Dibujar una delgada línea discontinua en el centro de la banda
            ctx.strokeStyle = 'rgba(255, 215, 0, 0.25)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, height - padding.bottom);
            ctx.stroke();
        });
        ctx.restore();
    }

    // Dibujar las series (Strains) con curvas suavizadas (redondeadas)
    lines.forEach(line => {
        const data = line.data;
        const points = data.length;
        if (points < 2) return;

        const firstX = padding.left;
        const firstY = padding.top + graphHeight - (data[0] / maxVal) * graphHeight;
        const lastX = padding.left + graphWidth;
        const lastY = padding.top + graphHeight - (data[points - 1] / maxVal) * graphHeight;

        // 1. Dibujar el área rellena (Fill) debajo de la curva
        if (line.fill && line.fill !== 'rgba(0, 0, 0, 0)' && line.fill !== 'transparent') {
            ctx.fillStyle = line.fill;
            ctx.beginPath();
            ctx.moveTo(padding.left, padding.top + graphHeight);
            ctx.lineTo(firstX, firstY);

            if (points === 2) {
                ctx.lineTo(lastX, lastY);
            } else {
                for (let i = 1; i < points - 1; i++) {
                    const currentX = padding.left + (i / (points - 1)) * graphWidth;
                    const currentY = padding.top + graphHeight - (data[i] / maxVal) * graphHeight;
                    const nextX = padding.left + ((i + 1) / (points - 1)) * graphWidth;
                    const nextY = padding.top + graphHeight - (data[i + 1] / maxVal) * graphHeight;
                    
                    const xc = (currentX + nextX) / 2;
                    const yc = (currentY + nextY) / 2;
                    ctx.quadraticCurveTo(currentX, currentY, xc, yc);
                }
                ctx.lineTo(lastX, lastY);
            }

            ctx.lineTo(padding.left + graphWidth, padding.top + graphHeight);
            ctx.closePath();
            ctx.fill();
        }

        // 2. Dibujar la línea de contorno (Stroke) de la curva
        ctx.strokeStyle = line.color;
        ctx.lineWidth = line.width || 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();

        ctx.moveTo(firstX, firstY);
        if (points === 2) {
            ctx.lineTo(lastX, lastY);
        } else {
            for (let i = 1; i < points - 1; i++) {
                const currentX = padding.left + (i / (points - 1)) * graphWidth;
                const currentY = padding.top + graphHeight - (data[i] / maxVal) * graphHeight;
                const nextX = padding.left + ((i + 1) / (points - 1)) * graphWidth;
                const nextY = padding.top + graphHeight - (data[i + 1] / maxVal) * graphHeight;
                
                const xc = (currentX + nextX) / 2;
                const yc = (currentY + nextY) / 2;
                ctx.quadraticCurveTo(currentX, currentY, xc, yc);
            }
            ctx.lineTo(lastX, lastY);
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

    // Dibujar etiquetas de tiempo de los picos de dificultad (siempre que no solapen con las estándar)
    if (peakIndices && peakIndices.length > 0) {
        ctx.save();
        ctx.fillStyle = '#ffd700'; // Color dorado para destacar
        ctx.font = 'bold 10px sans-serif';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'center';

        peakIndices.forEach(idx => {
            const x = padding.left + (idx / (maxPointsCount - 1)) * graphWidth;
            const peakSeconds = (idx / (maxPointsCount - 1)) * totalLength;
            const label = formatLength(peakSeconds);

            // Calcular distancia a las etiquetas estándar para evitar colisiones
            const xZero = padding.left;
            const xMid = padding.left + graphWidth / 2;
            const xEnd = padding.left + graphWidth;

            const minDistanceToStandard = 30; // Distancia mínima en píxeles
            
            const tooCloseToZero = Math.abs(x - xZero) < minDistanceToStandard + 5;
            const tooCloseToMid = Math.abs(x - xMid) < minDistanceToStandard;
            const tooCloseToEnd = Math.abs(x - xEnd) < minDistanceToStandard + 5;

            if (!tooCloseToZero && !tooCloseToMid && !tooCloseToEnd) {
                // Dibujar un borde oscuro detrás del texto dorado para garantizar legibilidad
                ctx.strokeStyle = '#181619';
                ctx.lineWidth = 3;
                ctx.lineJoin = 'miter';
                ctx.miterLimit = 2;
                ctx.strokeText(label, x, height - padding.bottom + 8);
                ctx.fillText(label, x, height - padding.bottom + 8);
            }
        });
        ctx.restore();
    }

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
        const label = failLabel || `FAIL (${Math.round(failPercent * 100)}%)`;
        ctx.fillText(label, failX, padding.top - 6);
    }

    // IMPORTANTE: Liberar memoria asignada de WebAssembly
    strains.free();

    return canvas.toBuffer('image/png');
}

module.exports = { generateStrainGraph };
