const fs = require("fs");
const path = require("path");
const axios = require("axios");
const sharp = require("sharp");
const { createCanvas, loadImage, registerFont } = require("canvas");
const { renderQueue } = require("../utils/RenderQueue.js");

// 1. Registrar tipografías Montserrat (con fallback a Poppins)
const fontDir = path.join(__dirname, "../assets/fonts");
if (fs.existsSync(path.join(fontDir, "Montserrat-Regular.ttf"))) {
    registerFont(path.join(fontDir, "Montserrat-Regular.ttf"), { family: "Montserrat", weight: "normal", style: "normal" });
}
if (fs.existsSync(path.join(fontDir, "Montserrat-Medium.ttf"))) {
    registerFont(path.join(fontDir, "Montserrat-Medium.ttf"), { family: "Montserrat", weight: "500", style: "normal" });
}
if (fs.existsSync(path.join(fontDir, "Montserrat-SemiBold.ttf"))) {
    registerFont(path.join(fontDir, "Montserrat-SemiBold.ttf"), { family: "Montserrat", weight: "600", style: "normal" });
}
if (fs.existsSync(path.join(fontDir, "Montserrat-Bold.ttf"))) {
    registerFont(path.join(fontDir, "Montserrat-Bold.ttf"), { family: "Montserrat", weight: "bold", style: "normal" });
}
if (fs.existsSync(path.join(fontDir, "Montserrat-ExtraBold.ttf"))) {
    registerFont(path.join(fontDir, "Montserrat-ExtraBold.ttf"), { family: "Montserrat", weight: "800", style: "normal" });
}
if (fs.existsSync(path.join(fontDir, "Poppins-Regular.ttf"))) {
    registerFont(path.join(fontDir, "Poppins-Regular.ttf"), { family: "Poppins", weight: "normal", style: "normal" });
}
if (fs.existsSync(path.join(fontDir, "Poppins-SemiBold.ttf"))) {
    registerFont(path.join(fontDir, "Poppins-SemiBold.ttf"), { family: "Poppins", weight: "600", style: "normal" });
}
if (fs.existsSync(path.join(fontDir, "Poppins-Bold.ttf"))) {
    registerFont(path.join(fontDir, "Poppins-Bold.ttf"), { family: "Poppins", weight: "bold", style: "normal" });
}

// Registrar fuentes del sistema para tipografía y footer idéntico a osuCardViews
const winFonts = "C:/Windows/Fonts";
if (fs.existsSync(path.join(winFonts, "segoeui.ttf"))) {
    registerFont(path.join(winFonts, "segoeui.ttf"), { family: "SegoeCustom", weight: "normal", style: "normal" });
    registerFont(path.join(winFonts, "segoeuib.ttf"), { family: "SegoeCustom", weight: "bold", style: "normal" });
    registerFont(path.join(winFonts, "segoeuii.ttf"), { family: "SegoeCustom", weight: "normal", style: "italic" });
    registerFont(path.join(winFonts, "segoeuiz.ttf"), { family: "SegoeCustom", weight: "bold", style: "italic" });
}
if (fs.existsSync(path.join(winFonts, "arial.ttf"))) {
    registerFont(path.join(winFonts, "arial.ttf"), { family: "ArialCustom", weight: "normal", style: "normal" });
    registerFont(path.join(winFonts, "arialbd.ttf"), { family: "ArialCustom", weight: "bold", style: "normal" });
    registerFont(path.join(winFonts, "ariali.ttf"), { family: "ArialCustom", weight: "normal", style: "italic" });
    registerFont(path.join(winFonts, "arialbi.ttf"), { family: "ArialCustom", weight: "bold", style: "italic" });
}

// Caché en memoria para imágenes y buffers de tarjetas generadas
const imageMemoryCache = new Map();
const MAX_IMAGE_CACHE_SIZE = 150;
const IMAGE_CACHE_TTL_MS = 6 * 60 * 1000;

const cardBufferCache = new Map();
const MAX_CARD_CACHE_SIZE = 40;
const CARD_CACHE_TTL_MS = 3 * 60 * 1000;

function setWithLimit(map, key, value, limit) {
    if (map.size >= limit) {
        const oldestKey = map.keys().next().value;
        map.delete(oldestKey);
    }
    map.set(key, value);
}

// Patrón de granulado / film grain analógico cacheado para el fondo
let cachedGrainCanvas = null;

function getGrainCanvas(size = 256, maxAlpha = 18) {
    if (cachedGrainCanvas) return cachedGrainCanvas;
    const grainCanvas = createCanvas(size, size);
    const gctx = grainCanvas.getContext("2d");
    const imgData = gctx.createImageData(size, size);
    const data = imgData.data;

    for (let i = 0; i < data.length; i += 4) {
        const rand = Math.random();
        if (rand > 0.5) {
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = Math.floor((rand - 0.5) * 2 * maxAlpha);
        } else {
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = Math.floor((0.5 - rand) * 2 * maxAlpha);
        }
    }

    gctx.putImageData(imgData, 0, 0);
    cachedGrainCanvas = grainCanvas;
    return cachedGrainCanvas;
}

/**
 * Descarga una imagen remota de forma segura y devuelve un Image object de canvas.
 */
async function fetchImageSafe(url) {
    if (!url || typeof url !== "string") return null;

    if (fs.existsSync(url)) {
        try {
            return await loadImage(url);
        } catch {
            return null;
        }
    }

    const now = Date.now();
    const isStaticFlag = url.includes("flagcdn.com");
    const cached = imageMemoryCache.get(url);

    if (cached && (isStaticFlag || (now - cached.timestamp) < IMAGE_CACHE_TTL_MS)) {
        return cached.img;
    }

    try {
        const res = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 6000,
            headers: { "User-Agent": "Sengo/MapperCardGenerator" }
        });
        const img = await loadImage(Buffer.from(res.data));
        setWithLimit(imageMemoryCache, url, { img, timestamp: now }, MAX_IMAGE_CACHE_SIZE);
        return img;
    } catch {
        return null;
    }
}

/**
 * Descarga y desenfoca una imagen de portada usando el filtro Gaussiano nativo de sharp (libvips).
 * Garantiza un desenfoque tipo filtro analógico continuo sin pixelar ni deformar la imagen.
 */
async function fetchBlurredCoverSafe(url, w = 1024, h = 567, sigma = 3.5) {
    if (!url || typeof url !== "string") return null;

    const cacheKey = `blurred_cover:${url}:${w}x${h}:${sigma}`;
    const now = Date.now();
    const cached = imageMemoryCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < IMAGE_CACHE_TTL_MS) {
        return cached.img;
    }

    try {
        let rawBuffer = null;
        if (fs.existsSync(url)) {
            rawBuffer = fs.readFileSync(url);
        } else {
            const res = await axios.get(url, {
                responseType: "arraybuffer",
                timeout: 6000,
                headers: { "User-Agent": "Sengo/MapperCardGenerator" }
            });
            rawBuffer = Buffer.from(res.data);
        }

        const blurredBuffer = await sharp(rawBuffer)
            .resize(w, h, { fit: "cover" })
            .blur(sigma)
            .toBuffer();

        const img = await loadImage(blurredBuffer);
        setWithLimit(imageMemoryCache, cacheKey, { img, timestamp: now }, MAX_IMAGE_CACHE_SIZE);
        return img;
    } catch {
        // Fallback a imagen normal si sharp o el filtro fallan
        return await fetchImageSafe(url);
    }
}

/**
 * Traza un rectángulo con esquinas redondeadas usando curvas cuadráticas sin fallos.
 */
function roundRect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

/**
 * Dibuja un contenedor con efecto Glassmorphism y Glow.
 */
function drawGlassCard(ctx, x, y, w, h, r, options = {}) {
    const {
        fillGradient = null,
        fillColor = "rgba(255, 255, 255, 0.22)",
        borderColor = "rgba(255, 255, 255, 0.55)",
        borderWidth = 1.5,
        shadowColor = "rgba(255, 255, 255, 0.20)",
        shadowBlur = 18,
        innerHighlight = true
    } = options;

    ctx.save();

    if (shadowBlur > 0 && shadowColor) {
        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = shadowBlur;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 2;
    }

    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = fillGradient || fillColor;
    ctx.fill();

    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;

    if (borderWidth > 0 && borderColor) {
        ctx.lineWidth = borderWidth;
        ctx.strokeStyle = borderColor;
        ctx.stroke();
    }

    if (innerHighlight) {
        ctx.save();
        roundRect(ctx, x, y, w, h, r);
        ctx.clip();
        const topGlow = ctx.createLinearGradient(x, y, x, y + Math.min(35, h * 0.35));
        topGlow.addColorStop(0, "rgba(255, 255, 255, 0.28)");
        topGlow.addColorStop(1, "rgba(255, 255, 255, 0.0)");
        ctx.fillStyle = topGlow;
        ctx.fillRect(x, y, w, Math.min(35, h * 0.35));
        ctx.restore();
    }

    ctx.restore();
}

/**
 * Dibuja una imagen centrada recortando sin deformar (object-fit: cover con zoom opcional).
 */
function drawImageCover(ctx, img, x, y, w, h, alignY = 0.5, alignX = 0.5, zoom = 1.0) {
    if (!img) return;
    const imgRatio = img.width / img.height;
    const targetRatio = w / h;
    let sw, sh, sx, sy;

    if (imgRatio > targetRatio) {
        sh = img.height / zoom;
        sw = (img.height * targetRatio) / zoom;
        sx = (img.width - sw) * alignX;
        sy = (img.height - sh) * alignY;
    } else {
        sw = img.width / zoom;
        sh = (img.width / targetRatio) / zoom;
        sx = (img.width - sw) * alignX;
        sy = (img.height - sh) * alignY;
    }

    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

/**
 * Renderiza la tarjeta de Mapper (.card -mapper) utilizando Node Canvas
 * @param {Object} user - Objeto del usuario
 * @param {Object} mapperData - Paquete de datos obtenido desde MapperCardModel
 * @param {Object} options - Configuración y personalización
 * @returns {Promise<Buffer>} Buffer PNG de la tarjeta
 */
async function renderMapperCard(user, mapperData = null, options = {}) {
    const userId = user?.id || mapperData?.user?.id || "unknown";
    const cacheKey = `mapper_card:${userId}:${options?.locale || "es"}`;

    if (!options?.forceRefresh) {
        const cached = cardBufferCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < CARD_CACHE_TTL_MS) {
            return cached.buffer;
        }
    }

    return renderQueue.add(async () => {
        if (!options?.forceRefresh) {
            const cached = cardBufferCache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < CARD_CACHE_TTL_MS) {
                return cached.buffer;
            }
        }
        return _renderMapperCardCanvas(user, mapperData, options, cacheKey);
    });
}

async function _renderMapperCardCanvas(user, mapperData, options, cacheKey) {
    // Si mapperData no fue provisto, obtenerlo mediante el modelo
    if (!mapperData) {
        const MapperCardModel = require("../models/MapperCardModel.js");
        mapperData = await MapperCardModel.getMapperCardData(user, options);
    }

    const W = 1024;
    const H = 567;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const countryCode = (mapperData.user.countryCode || "VE").toUpperCase();
    const flagUrl = `https://flagcdn.com/w160/${countryCode.toLowerCase()}.png`;

    // Descarga paralela de imágenes requeridas
    const [avatarImg, coverImg, takeThisImg, prevMapImg, flagImg] = await Promise.all([
        fetchImageSafe(mapperData.user.avatarUrl),
        fetchBlurredCoverSafe(mapperData.user.coverUrl, W, H, 3.5),
        fetchImageSafe(mapperData.latestMap?.coverUrl),
        fetchImageSafe(mapperData.prevMap?.coverUrl),
        fetchImageSafe(flagUrl)
    ]);

    // 1. FONDO PRINCIPAL
    const bgBase = ctx.createLinearGradient(0, 0, W, H);
    bgBase.addColorStop(0, "#32233f");
    bgBase.addColorStop(0.35, "#54334f");
    bgBase.addColorStop(0.70, "#a85766");
    bgBase.addColorStop(1, "#d68e7d");
    ctx.fillStyle = bgBase;
    ctx.fillRect(0, 0, W, H);

    if (coverImg) {
        ctx.save();
        ctx.globalAlpha = 0.52;
        ctx.drawImage(coverImg, 0, 0, W, H);
        ctx.restore();
    }

    // Capa de atenuación suave para reducir el brillo ligeramente
    ctx.fillStyle = "rgba(16, 10, 24, 0.16)";
    ctx.fillRect(0, 0, W, H);

    // Glow ambiental cálido sutil
    ctx.save();
    const glowGrad = ctx.createRadialGradient(W * 0.9, H * 0.9, 30, W * 0.9, H * 0.9, 500);
    glowGrad.addColorStop(0, "rgba(255, 175, 145, 0.30)");
    glowGrad.addColorStop(1, "rgba(255, 175, 145, 0)");
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // Capa de granulado / film grain analógico sobre el fondo
    const grainCanvas = getGrainCanvas();
    const grainPattern = ctx.createPattern(grainCanvas, "repeat");
    if (grainPattern) {
        ctx.save();
        ctx.fillStyle = grainPattern;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
    }

    // Viñeta superior para contraste del título
    const topVignette = ctx.createLinearGradient(0, 0, 0, 140);
    topVignette.addColorStop(0, "rgba(25, 18, 35, 0.65)");
    topVignette.addColorStop(0.6, "rgba(25, 18, 35, 0.20)");
    topVignette.addColorStop(1, "rgba(25, 18, 35, 0)");
    ctx.fillStyle = topVignette;
    ctx.fillRect(0, 0, W, 140);

    // 2. TÍTULO SUPERIOR DINÁMICO
    const cardTitle = options.title || mapperData.title || "Novato Ranked";
    ctx.save();
    let titleFontSize = 28;
    ctx.font = `bold ${titleFontSize}px "Montserrat", "Poppins", sans-serif`;
    while (ctx.measureText(cardTitle).width > 460 && titleFontSize > 18) {
        titleFontSize -= 1;
        ctx.font = `bold ${titleFontSize}px "Montserrat", "Poppins", sans-serif`;
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillText(cardTitle, W / 2, 44);
    ctx.restore();

    // 3. CÁPSULA IZQUIERDA (AVATAR & PERFIL)
    const pillX = 38;
    const pillY = 76;
    const pillW = 168;
    const pillH = 318;
    const pillR = 84;

    const pillGrad = ctx.createLinearGradient(pillX, pillY, pillX + pillW, pillY + pillH);
    pillGrad.addColorStop(0, "rgba(255, 255, 255, 0.35)");
    pillGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.18)");
    pillGrad.addColorStop(1, "rgba(255, 255, 255, 0.12)");

    drawGlassCard(ctx, pillX, pillY, pillW, pillH, pillR, {
        fillGradient: pillGrad,
        borderColor: "rgba(255, 255, 255, 0.68)",
        borderWidth: 1.5,
        shadowColor: "rgba(255, 255, 255, 0.22)",
        shadowBlur: 20
    });

    const avatarCenterX = pillX + pillW / 2;
    const avatarCenterY = pillY + 82;
    const avatarInnerR = 64;
    const avatarRingR = 71;

    // Anillo exterior blanco brillante
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCenterX, avatarCenterY, avatarRingR, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(255, 255, 255, 0.5)";
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.restore();

    // Imagen del avatar
    if (avatarImg) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarCenterX, avatarCenterY, avatarInnerR, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        drawImageCover(ctx, avatarImg, avatarCenterX - avatarInnerR, avatarCenterY - avatarInnerR, avatarInnerR * 2, avatarInnerR * 2);
        ctx.restore();
    }

    // Nombre del mapper
    ctx.save();
    ctx.font = '600 21px "Montserrat", "Poppins", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#2f243d";
    ctx.fillText(mapperData.user.username || "Mapper", avatarCenterX, pillY + 188);
    ctx.restore();

    // Círculo inferior para modo de juego (STD hitcircle por defecto, o diseño según modo)
    const targetCenterY = pillY + 258;
    const outerTargetR = 32;
    const innerTargetR = 21;
    const gamemode = (mapperData.mode || options.gamemode || "osu").toLowerCase();

    ctx.save();
    if (gamemode === "taiko") {
        ctx.beginPath();
        ctx.arc(avatarCenterX, targetCenterY, outerTargetR, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 4;
        ctx.shadowColor = "rgba(255, 255, 255, 0.85)";
        ctx.shadowBlur = 8;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(avatarCenterX, targetCenterY, innerTargetR, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(avatarCenterX, targetCenterY, 11, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
    } else if (gamemode === "fruits" || gamemode === "catch") {
        ctx.beginPath();
        ctx.arc(avatarCenterX, targetCenterY, outerTargetR, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 4;
        ctx.shadowColor = "rgba(255, 255, 255, 0.85)";
        ctx.shadowBlur = 8;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(avatarCenterX, targetCenterY + 3, 14, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();

        ctx.beginPath();
        ctx.arc(avatarCenterX + 4, targetCenterY - 10, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
    } else if (gamemode === "mania") {
        ctx.beginPath();
        ctx.arc(avatarCenterX, targetCenterY, outerTargetR, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 4;
        ctx.shadowColor = "rgba(255, 255, 255, 0.85)";
        ctx.shadowBlur = 8;
        ctx.stroke();

        const kw = 5, kh = 22, kg = 2;
        const startKx = avatarCenterX - (4 * kw + 3 * kg) / 2;
        for (let k = 0; k < 4; k++) {
            roundRect(ctx, startKx + k * (kw + kg), targetCenterY - kh / 2, kw, kh, 2);
            ctx.fillStyle = "#ffffff";
            ctx.fill();
        }
    } else {
        // Círculo central relleno sólido para modo STD (hitcircle con approach circle)
        ctx.beginPath();
        ctx.arc(avatarCenterX, targetCenterY, innerTargetR, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "rgba(255, 255, 255, 0.95)";
        ctx.shadowBlur = 12;
        ctx.fill();

        // Anillo exterior circundante (approach circle)
        ctx.beginPath();
        ctx.arc(avatarCenterX, targetCenterY, outerTargetR, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 4.8;
        ctx.shadowColor = "rgba(255, 255, 255, 0.85)";
        ctx.shadowBlur = 8;
        ctx.stroke();
    }
    ctx.restore();

    // 4. TARJETA SUPERIOR CENTRAL (BANDERA Y RANGOS)
    const rankCardX = 219;
    const rankCardY = 92;
    const rankCardW = 284;
    const rankCardH = 150;
    const rankCardR = 24;

    const rankGrad = ctx.createLinearGradient(rankCardX, rankCardY, rankCardX, rankCardY + rankCardH);
    rankGrad.addColorStop(0, "rgba(255, 255, 255, 0.30)");
    rankGrad.addColorStop(0.35, "rgba(255, 255, 255, 0.16)");
    rankGrad.addColorStop(1, "rgba(85, 55, 88, 0.45)");

    drawGlassCard(ctx, rankCardX, rankCardY, rankCardW, rankCardH, rankCardR, {
        fillGradient: rankGrad,
        borderColor: "rgba(255, 255, 255, 0.60)",
        borderWidth: 1.5,
        shadowColor: "rgba(255, 255, 255, 0.18)",
        shadowBlur: 16
    });

    // Bandera nacional
    const flagW = 66;
    const flagH = 44;
    const flagX = rankCardX + (rankCardW - flagW) / 2;
    const flagY = rankCardY + 14;
    const flagR = 10;

    if (flagImg) {
        ctx.save();
        roundRect(ctx, flagX, flagY, flagW, flagH, flagR);
        ctx.clip();
        drawImageCover(ctx, flagImg, flagX, flagY, flagW, flagH);
        ctx.restore();
    }

    ctx.save();
    roundRect(ctx, flagX, flagY, flagW, flagH, flagR);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Línea divisora vertical entre país y servidor
    const dividerX = rankCardX + rankCardW / 2;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.40)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(dividerX, rankCardY + 74);
    ctx.lineTo(dividerX, rankCardY + 134);
    ctx.stroke();
    ctx.restore();

    // Rango País
    const countryColX = rankCardX + rankCardW * 0.25;
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = 'bold 25px "Montserrat", "Poppins", sans-serif';
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0, 0, 0, 0.2)";
    ctx.shadowBlur = 4;
    ctx.fillText(mapperData.ranks?.countryRank || "#-", countryColX, rankCardY + 95);

    ctx.font = 'bold 12.5px "Montserrat", "Poppins", sans-serif';
    ctx.fillStyle = "#221829";
    ctx.shadowColor = "transparent";
    ctx.fillText("Rango", countryColX, rankCardY + 116);
    ctx.fillText("Pais", countryColX, rankCardY + 130);
    ctx.restore();

    // Rango Servidor (en dorado vibrante)
    const serverColX = rankCardX + rankCardW * 0.75;
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = 'bold 28px "Montserrat", "Poppins", sans-serif';
    ctx.fillStyle = "#ffe600";
    ctx.shadowColor = "rgba(255, 230, 0, 0.95)";
    ctx.shadowBlur = 14;
    ctx.fillText(mapperData.ranks?.serverRank || "#-", serverColX, rankCardY + 95);

    ctx.font = 'bold 12.5px "Montserrat", "Poppins", sans-serif';
    ctx.fillStyle = "#221829";
    ctx.shadowColor = "transparent";
    ctx.fillText("Rango", serverColX, rankCardY + 116);
    ctx.fillText("Servidor", serverColX, rankCardY + 130);
    ctx.restore();

    // 5. TARJETA CENTRAL-MEDIA (BARRAS DE ATRIBUTOS DEL MAPPER)
    const barsCardX = 220;
    const barsCardY = 264;
    const barsCardW = 516;
    const barsCardH = 175;
    const barsCardR = 24;

    const barsGrad = ctx.createLinearGradient(barsCardX, barsCardY, barsCardX + barsCardW, barsCardY + barsCardH);
    barsGrad.addColorStop(0, "rgba(255, 255, 255, 0.32)");
    barsGrad.addColorStop(1, "rgba(255, 255, 255, 0.15)");

    drawGlassCard(ctx, barsCardX, barsCardY, barsCardW, barsCardH, barsCardR, {
        fillGradient: barsGrad,
        borderColor: "rgba(255, 255, 255, 0.60)",
        borderWidth: 1.5,
        shadowColor: "rgba(255, 255, 255, 0.20)",
        shadowBlur: 16
    });

    function drawPillStack(centerX, topText, filledCount, labelLines, wobbleOffsets = [0, 0, 0, 0, 0, 0]) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = 'bold 13px "Montserrat", "Poppins", sans-serif';
        ctx.fillStyle = "#221829";
        ctx.fillText(topText, centerX, barsCardY + 22);
        ctx.restore();

        const pillBarW = 68;
        const pillBarH = 10.5;
        const pillBarR = 6;
        const gap = 4;
        const startY = barsCardY + 106;

        for (let i = 0; i < 6; i++) {
            const py = startY - i * (pillBarH + gap);
            const wobble = wobbleOffsets[i] || 0;
            const px = centerX - pillBarW / 2 + wobble;
            const isFilled = i < filledCount;

            ctx.save();
            roundRect(ctx, px, py, pillBarW, pillBarH, pillBarR);

            if (isFilled) {
                ctx.fillStyle = "#ffffff";
                ctx.shadowColor = "rgba(255, 255, 255, 0.70)";
                ctx.shadowBlur = 6;
                ctx.fill();
            } else {
                ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
                ctx.fill();
                ctx.strokeStyle = "rgba(255, 255, 255, 0.60)";
                ctx.lineWidth = 1.4;
                ctx.stroke();
            }
            ctx.restore();
        }

        ctx.save();
        ctx.textAlign = "center";
        ctx.font = '700 11.5px "Montserrat", "Poppins", sans-serif';
        ctx.fillStyle = "#221829";
        if (labelLines.length === 1) {
            ctx.fillText(labelLines[0], centerX, barsCardY + 145);
        } else {
            ctx.fillText(labelLines[0], centerX, barsCardY + 138);
            ctx.fillText(labelLines[1], centerX, barsCardY + 152);
        }
        ctx.restore();
    }

    const ampBars = mapperData.metrics?.amplitudeBars ?? 3;
    const rhythmBars = mapperData.metrics?.rhythmBars ?? 1;
    const reachBars = mapperData.metrics?.reachBars ?? 3;

    drawPillStack(barsCardX + barsCardW * 0.22, mapperData.metrics?.amplitudeSR || "5.5*", ampBars, ["Amplitud de", "rango"], [1, -1.5, 0.5, 2, -1, 0]);
    drawPillStack(barsCardX + barsCardW * 0.50, mapperData.metrics?.rhythmPct || "23.5%", rhythmBars, ["Ritmo"], [-1, 1.5, -0.5, 1, -1.5, 0]);
    drawPillStack(barsCardX + barsCardW * 0.78, mapperData.metrics?.reachPct || "52.8%", reachBars, ["Alcance"], [1.5, -1, 1, 2, -1, 0]);

    // 6. TARJETA SUPERIOR DERECHA (ÚLTIMO MAPA SUBIDO)
    const mapCardX = 525;
    const mapCardY = 74;
    const mapCardW = 468;
    const mapCardH = 181;
    const mapCardR = 24;

    ctx.save();
    roundRect(ctx, mapCardX, mapCardY, mapCardW, mapCardH, mapCardR);
    ctx.clip();

    if (takeThisImg) {
        drawImageCover(ctx, takeThisImg, mapCardX, mapCardY, mapCardW, mapCardH, 0.45, 0.65, 1.15);
    } else {
        ctx.fillStyle = "#1e1428";
        ctx.fillRect(mapCardX, mapCardY, mapCardW, mapCardH);
    }

    const mapTopOverlay = ctx.createLinearGradient(mapCardX, mapCardY, mapCardX, mapCardY + 95);
    mapTopOverlay.addColorStop(0, "rgba(0, 0, 0, 0.72)");
    mapTopOverlay.addColorStop(0.65, "rgba(0, 0, 0, 0.25)");
    mapTopOverlay.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = mapTopOverlay;
    ctx.fillRect(mapCardX, mapCardY, mapCardW, 95);

    const mapBotOverlay = ctx.createLinearGradient(mapCardX, mapCardY + mapCardH - 55, mapCardX, mapCardY + mapCardH);
    mapBotOverlay.addColorStop(0, "rgba(0, 0, 0, 0)");
    mapBotOverlay.addColorStop(0.5, "rgba(0, 0, 0, 0.45)");
    mapBotOverlay.addColorStop(1, "rgba(0, 0, 0, 0.85)");
    ctx.fillStyle = mapBotOverlay;
    ctx.fillRect(mapCardX, mapCardY + mapCardH - 55, mapCardW, 55);

    const mapTitle = mapperData.latestMap?.title || "No Beatmaps Found";
    const mapArtist = mapperData.latestMap?.artist || "";

    ctx.font = 'bold 24px "Montserrat", "Poppins", sans-serif';
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
    ctx.shadowBlur = 6;
    ctx.fillText(mapTitle, mapCardX + 22, mapCardY + 36);

    ctx.font = '600 17px "Montserrat", "Poppins", sans-serif';
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.fillText(mapArtist, mapCardX + 22, mapCardY + 62);

    // Badge y buscador
    const badgeW = 74;
    const badgeH = 25;
    const badgeX = mapCardX + mapCardW - badgeW - 20;
    const badgeY = mapCardY + 18;
    const badgeR = 12.5;

    const searchX = badgeX - 22;
    const searchY = badgeY + badgeH / 2;
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.2;
    ctx.shadowColor = "rgba(255, 255, 255, 0.6)";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(searchX, searchY - 1, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(searchX + 4.5, searchY + 3.5);
    ctx.lineTo(searchX + 9, searchY + 8);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    roundRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeR);
    ctx.fillStyle = "#00c3ff";
    ctx.shadowColor = "rgba(0, 195, 255, 0.95)";
    ctx.shadowBlur = 14;
    ctx.fill();

    const statusText = mapperData.latestMap?.status || "RANKED";
    ctx.font = 'bold 11.5px "Montserrat", "Poppins", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "transparent";
    ctx.fillText(statusText, badgeX + badgeW / 2, badgeY + badgeH / 2 + 1);
    ctx.restore();

    // Métricas de plays y favorites (íconos huecos con glow)
    const botStatsY = mapCardY + mapCardH - 18;
    let statCurX = mapCardX + 24;

    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(255, 255, 255, 0.8)";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(statCurX, botStatsY - 12);
    ctx.lineTo(statCurX + 11, botStatsY - 6);
    ctx.lineTo(statCurX, botStatsY);
    ctx.closePath();
    ctx.stroke();

    statCurX += 17;
    ctx.font = 'bold 14.5px "Montserrat", "Poppins", sans-serif';
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    const playText = mapperData.latestMap?.playCount || "0";
    ctx.fillText(playText, statCurX, botStatsY - 6);
    const playWidth = ctx.measureText(playText).width;

    // Espacio amplio y generoso entre plays y favs
    statCurX += playWidth + 32;

    ctx.beginPath();
    const hx = statCurX;
    const hy = botStatsY - 10;
    ctx.moveTo(hx, hy + 3);
    ctx.bezierCurveTo(hx, hy, hx - 5, hy - 4, hx - 8, hy - 4);
    ctx.bezierCurveTo(hx - 13, hy - 4, hx - 13, hy + 2, hx - 13, hy + 2);
    ctx.bezierCurveTo(hx - 13, hy + 7, hx - 6, hy + 11, hx, hy + 15);
    ctx.bezierCurveTo(hx + 6, hy + 11, hx + 13, hy + 7, hx + 13, hy + 2);
    ctx.bezierCurveTo(hx + 13, hy + 2, hx + 13, hy - 4, hx + 8, hy - 4);
    ctx.bezierCurveTo(hx + 5, hy - 4, hx, hy, hx, hy + 3);
    ctx.stroke();

    statCurX += 20;
    ctx.fillText(mapperData.latestMap?.favCount || "0", statCurX, botStatsY - 6);
    ctx.restore();

    ctx.restore(); // Fin del clip de tarjeta

    ctx.save();
    roundRect(ctx, mapCardX, mapCardY, mapCardW, mapCardH, mapCardR);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.70)";
    ctx.lineWidth = 1.8;
    ctx.shadowColor = "rgba(255, 255, 255, 0.25)";
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.restore();

    // 7. TARJETA INFERIOR DERECHA ("Mapa Previo subido")
    const prevCardX = 748;
    const prevCardY = 266;
    const prevCardW = 242;
    const prevCardH = 64;
    const prevCardR = 18;

    ctx.save();
    roundRect(ctx, prevCardX, prevCardY, prevCardW, prevCardH, prevCardR);
    ctx.clip();

    if (prevMapImg) {
        drawImageCover(ctx, prevMapImg, prevCardX, prevCardY, prevCardW, prevCardH, 0.5, 0.5);
    } else {
        ctx.fillStyle = "#150e20";
        ctx.fillRect(prevCardX, prevCardY, prevCardW, prevCardH);
    }

    ctx.fillStyle = "rgba(15, 10, 22, 0.72)";
    ctx.fillRect(prevCardX, prevCardY, prevCardW, prevCardH);

    ctx.font = 'bold 14px "Montserrat", "Poppins", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
    ctx.shadowBlur = 8;
    ctx.fillText("Mapa Previo subido", prevCardX + prevCardW / 2, prevCardY + prevCardH / 2);
    ctx.restore();

    ctx.save();
    roundRect(ctx, prevCardX, prevCardY, prevCardW, prevCardH, prevCardR);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.60)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // 8. TARJETA INFERIOR (ESTADÍSTICAS GENERALES DEL MAPPER)
    const statCardX = 225;
    const statCardY = 448;
    const statCardW = 615;
    const statCardH = 101;
    const statCardR = 26;

    const statGrad = ctx.createLinearGradient(statCardX, statCardY, statCardX, statCardY + statCardH);
    statGrad.addColorStop(0, "rgba(110, 85, 120, 0.60)");
    statGrad.addColorStop(1, "rgba(38, 22, 45, 0.85)");

    drawGlassCard(ctx, statCardX, statCardY, statCardW, statCardH, statCardR, {
        fillGradient: statGrad,
        borderColor: "rgba(255, 255, 255, 0.45)",
        borderWidth: 1.5,
        shadowColor: "rgba(0, 0, 0, 0.35)",
        shadowBlur: 18
    });

    const lineY = statCardY + 50;
    ctx.save();
    const lineGrad = ctx.createLinearGradient(statCardX + 20, lineY, statCardX + statCardW - 20, lineY);
    lineGrad.addColorStop(0, "rgba(255, 255, 255, 0.1)");
    lineGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.65)");
    lineGrad.addColorStop(1, "rgba(255, 255, 255, 0.1)");
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(statCardX + 24, lineY);
    ctx.lineTo(statCardX + statCardW - 24, lineY);
    ctx.stroke();
    ctx.restore();

    const colStep = statCardW / 4;
    const cols = [
        { val1: mapperData.user?.followers || "0", lbl1: "Seguidores", val2: mapperData.stats?.rankedCount || "0", lbl2: "Rankeds" },
        { val1: mapperData.user?.subscribers || "0", lbl1: "Suscriptores", val2: mapperData.stats?.lovedCount || "0", lbl2: "Loveds" },
        { val1: mapperData.user?.kudosu || "0", lbl1: "Kudosus", val2: mapperData.stats?.pendingCount || "0", lbl2: "Pendings" },
        { val1: mapperData.stats?.successRate || "0%", lbl1: "tasa de éxitos", val2: mapperData.stats?.graveyardCount || "0", lbl2: "Graveyards" }
    ];

    ctx.save();
    ctx.textAlign = "center";

    cols.forEach((col, idx) => {
        const cx = statCardX + colStep * idx + colStep / 2;

        ctx.font = 'bold 17px "Montserrat", "Poppins", sans-serif';
        ctx.fillStyle = "#ffffff";
        ctx.fillText(col.val1, cx, statCardY + 23);

        ctx.font = '600 11px "Montserrat", "Poppins", sans-serif';
        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        ctx.fillText(col.lbl1, cx, statCardY + 39);

        ctx.font = 'bold 17px "Montserrat", "Poppins", sans-serif';
        ctx.fillStyle = "#ffffff";
        ctx.fillText(col.val2, cx, statCardY + 73);

        ctx.font = '600 11px "Montserrat", "Poppins", sans-serif';
        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        ctx.fillText(col.lbl2, cx, statCardY + 89);
    });
    ctx.restore();

    // 9. FOOTER DEL CARD (ESQUINA INFERIOR IZQUIERDA: BRANDING & FECHA IDÉNTICO AL CARD DE JUGADOR)
    const today = new Date().toISOString().split("T")[0];
    const MODE_NAMES = {
        osu: "osu!",
        taiko: "osu!taiko",
        fruits: "osu!catch",
        mania: "osu!mania"
    };
    const footerTitle = gamemode !== "osu" ? `Sengo • ${MODE_NAMES[gamemode] || gamemode}` : "Sengo";
    const footerX = 38;
    const footerY = 538;

    ctx.save();
    // footerBrand (Sengo) con glow rojizo #fe4d4d idéntico al card de jugador
    ctx.save();
    ctx.shadowColor = "rgba(254, 77, 77, 0.70)";
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = "#ffffff";
    ctx.font = 'italic bold 21px "Outfit", "SegoeCustom", "ArialCustom", "Segoe UI", sans-serif';
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const brandWidth = ctx.measureText(footerTitle).width;
    ctx.font = 'italic 15px "Outfit", "SegoeCustom", "ArialCustom", "Segoe UI", sans-serif';
    const dateWidth = ctx.measureText(today).width;
    const isSingleLine = (brandWidth + 10 + dateWidth) <= 175;

    ctx.font = 'italic bold 21px "Outfit", "SegoeCustom", "ArialCustom", "Segoe UI", sans-serif';
    if (isSingleLine) {
        ctx.fillText(footerTitle, footerX, footerY);
        ctx.restore();

        ctx.save();
        ctx.fillStyle = "#cbd5e1";
        ctx.font = 'italic 15px "Outfit", "SegoeCustom", "ArialCustom", "Segoe UI", sans-serif';
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(today, footerX + brandWidth + 10, footerY);
        ctx.restore();
    } else {
        ctx.fillText(footerTitle, footerX, footerY - 10);
        ctx.restore();

        ctx.save();
        ctx.fillStyle = "#cbd5e1";
        ctx.font = 'italic 14px "Outfit", "SegoeCustom", "ArialCustom", "Segoe UI", sans-serif';
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(today, footerX, footerY + 11);
        ctx.restore();
    }
    ctx.restore();

    const buffer = canvas.toBuffer("image/png");
    setWithLimit(cardBufferCache, cacheKey, { buffer, timestamp: Date.now() }, MAX_CARD_CACHE_SIZE);
    return buffer;
}

module.exports = {
    renderMapperCard
};
