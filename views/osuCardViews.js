const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { EmbedBuilder } = require("discord.js");
const { createCanvas, loadImage, registerFont } = require("canvas");
const { getEmbedColor } = require("./osuViewHelpers.js");
const { getSupabaseClient } = require("../db/database.js");
const OsuScoreModel = require("../models/OsuScoreModel.js");
const BirthdayModel = require("../models/BirthdayModel.js");

// Cargar plantilla base predeterminada de Sengo
const TEMPLATE_DEFAULT_PATH = path.join(__dirname, "templates", "yo_card_default.json");
let cachedDefaultTemplate = null;

function getDefaultTemplate() {
    if (!cachedDefaultTemplate) {
        try {
            cachedDefaultTemplate = JSON.parse(fs.readFileSync(TEMPLATE_DEFAULT_PATH, "utf8"));
        } catch (e) {
            console.error("[CARD-VIEW] Error al leer plantilla base yo_card_default.json:", e.message);
            cachedDefaultTemplate = {};
        }
    }
    return JSON.parse(JSON.stringify(cachedDefaultTemplate));
}

// Registrar fuentes del sistema para coincidir con la tipografía
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

const DEFAULT_FONT_STACK = '"Outfit", "SegoeCustom", "ArialCustom", "Segoe UI", Arial, sans-serif';

// Mapeo oficial de colores para badges de mods de osu!lazer
const MOD_COLORS = {
    'EZ': { bg: '#56c9a8', fg: '#002b1f' },
    'NF': { bg: '#56c9a8', fg: '#002b1f' },
    'HT': { bg: '#56c9a8', fg: '#002b1f' },
    'DC': { bg: '#56c9a8', fg: '#002b1f' },
    'DT': { bg: '#fa4277', fg: '#ffffff' },
    'NC': { bg: '#fa4277', fg: '#ffffff' },
    'HD': { bg: '#a3e635', fg: '#1a2e00' },
    'HR': { bg: '#ff3b5c', fg: '#ffffff' },
    'FL': { bg: '#f59e0b', fg: '#331a00' },
    'SD': { bg: '#fa4277', fg: '#ffffff' },
    'PF': { bg: '#fa4277', fg: '#ffffff' },
    'BL': { bg: '#fa4277', fg: '#ffffff' },
    'ST': { bg: '#fa4277', fg: '#ffffff' },
    'CL': { bg: '#705988', fg: '#ffffff' },
    'RX': { bg: '#00b8ff', fg: '#002233' },
    'AP': { bg: '#00b8ff', fg: '#002233' },
    'SO': { bg: '#00b8ff', fg: '#002233' },
    'AT': { bg: '#00b8ff', fg: '#002233' },
    'CN': { bg: '#00b8ff', fg: '#002233' },
    'V2': { bg: '#bf55ec', fg: '#ffffff' },
    'SV2': { bg: '#bf55ec', fg: '#ffffff' },
    'MR': { bg: '#bf55ec', fg: '#ffffff' },
    'TD': { bg: '#00b8ff', fg: '#002233' }
};

// Caché en memoria para imágenes remotas (evita re-descargas repetidas en Render)
const imageMemoryCache = new Map();
const MAX_IMAGE_CACHE_SIZE = 120;
const IMAGE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos para avatares/covers

/**
 * Descarga una imagen remota de forma segura y devuelve un Image object de canvas.
 * Utiliza caché en memoria LRU para optimizar tiempo y CPU en Render.
 */
async function fetchImageSafe(url) {
    if (!url || typeof url !== "string") return null;

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
            headers: { "User-Agent": "Sengo/CardGenerator" }
        });
        const img = await loadImage(Buffer.from(res.data));

        if (imageMemoryCache.size >= MAX_IMAGE_CACHE_SIZE) {
            const oldestKey = imageMemoryCache.keys().next().value;
            imageMemoryCache.delete(oldestKey);
        }
        imageMemoryCache.set(url, { img, timestamp: now });

        return img;
    } catch {
        return null;
    }
}

/**
 * Recorta y dibuja una imagen en modo Cover sin deformarla.
 */
function drawImageCover(ctx, img, x, y, w, h, alignY = 0.5) {
    if (!img) return;
    const imgRatio = img.width / img.height;
    const targetRatio = w / h;
    let sw, sh, sx, sy;

    if (imgRatio > targetRatio) {
        sh = img.height;
        sw = img.height * targetRatio;
        sx = (img.width - sw) / 2;
        sy = 0;
    } else {
        sw = img.width;
        sh = img.width / targetRatio;
        sx = 0;
        sy = (img.height - sh) * alignY;
    }

    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

/**
 * Dibuja rectángulos con esquinas redondeadas.
 */
function roundRect(ctx, x, y, width, height, radius, fill = false, stroke = false) {
    if (typeof radius === "number") {
        radius = { tl: radius, tr: radius, br: radius, bl: radius };
    }
    ctx.beginPath();
    ctx.moveTo(x + radius.tl, y);
    ctx.lineTo(x + width - radius.tr, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
    ctx.lineTo(x + width, y + height - radius.br);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
    ctx.lineTo(x + radius.bl, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
    ctx.lineTo(x, y + radius.tl);
    ctx.quadraticCurveTo(x, y, x + radius.tl, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
}

/**
 * Consulta datos del ecosistema de Sengo (DB Turso & Supabase) de forma ultra rápida.
 */
async function fetchSengoData(userId, countryCode) {
    const data = {
        isLinked: false,
        skinName: null,
        birthday: null,
        nationalTopsCount: 0,
        snipesMade: 0,
        snipesReceived: 0,
        topScore: null
    };

    try {
        const supabase = getSupabaseClient();
        const userPromise = (async () => {
            if (!supabase) return null;
            const { data } = await supabase.from("users").select("discord_id, skin_name, skins").eq("osu_id", String(userId)).maybeSingle();
            return data;
        })().catch(() => null);

        const topsCountPromise = OsuScoreModel.getUserNationalTopsCount(userId, 0, countryCode || "VE").catch(() => 0);
        const snipesPromise = OsuScoreModel.getUserSnipesHistory(userId).catch(() => null);

        const [sUser, topsCount, snipesHistory] = await Promise.all([
            userPromise,
            topsCountPromise,
            snipesPromise
        ]);

        if (sUser) {
            data.isLinked = true;
            data.skinName = sUser.skin_name || (sUser.skins && sUser.skins.osu ? sUser.skins.osu.name : null);

            if (sUser.discord_id) {
                const bday = BirthdayModel.getUserBirthday(sUser.discord_id);
                if (bday && bday.day && bday.month) {
                    const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
                    data.birthday = `${String(bday.day).padStart(2, "0")} ${months[bday.month - 1] || bday.month}`;
                }
            }
        }

        data.nationalTopsCount = typeof topsCount === "number" ? topsCount : 0;

        if (snipesHistory) {
            data.snipesMade = (snipesHistory.made || []).length;
            data.snipesReceived = (snipesHistory.received || []).length;
        }
    } catch (e) {
        console.warn("[CARD] Error al consultar datos de Sengo:", e.message);
    }

    return data;
}

/**
 * Calcula el AR efectivo tomando en cuenta modificaciones de tiempo y escalado de mods.
 */
function calculateEffectiveAR(baseAR, modsStr) {
    let ar = baseAR;
    if (modsStr.includes("HR")) ar = Math.min(10.0, ar * 1.4);
    if (modsStr.includes("EZ")) ar = ar * 0.5;

    if (modsStr.includes("DT") || modsStr.includes("NC")) {
        let ms = ar <= 5 ? 1800 - 120 * ar : 1200 - 150 * (ar - 5);
        ms = ms / 1.5;
        if (ms >= 1200) {
            ar = (1800 - ms) / 120;
        } else {
            ar = 5 + (1200 - ms) / 150;
        }
    } else if (modsStr.includes("HT") || modsStr.includes("DC")) {
        let ms = ar <= 5 ? 1800 - 120 * ar : 1200 - 150 * (ar - 5);
        ms = ms / 0.75;
        if (ms >= 1200) {
            ar = (1800 - ms) / 120;
        } else {
            ar = 5 + (1200 - ms) / 150;
        }
    }
    return ar;
}

/**
 * Analiza skills del jugador a partir de sus mejores puntuaciones mediante
 * descomposición de strains de patrones y cinética calibrada con sengo-pp.
 */
function analyzeSkills(scores) {
    if (!scores || scores.length === 0) {
        return {
            aim: 35.00,
            speed: 30.00,
            acc: 50.00,
            reading: 30.00,
            modStats: { NM: 100 },
            topPlayPP: 0
        };
    }

    let dtCount = 0, hrCount = 0, hdCount = 0, flCount = 0, nmCount = 0, ezCount = 0;
    let aimSum = 0, speedSum = 0, accSum = 0, readingSum = 0, totalWeight = 0;

    for (let i = 0; i < scores.length; i++) {
        const s = scores[i];
        const weight = Math.pow(0.95, i);
        totalWeight += weight;

        const accuracy = Number(s.accuracy != null ? s.accuracy : 0.98);
        const accPct = accuracy <= 1 ? accuracy * 100 : accuracy;

        const modsList = Array.isArray(s.mods)
            ? s.mods.map(m => (typeof m === "string" ? m : m.acronym || "")).filter(Boolean)
            : (typeof s.mods === "string" ? s.mods.match(/.{1,2}/g) || [] : []);
        const modsStr = modsList.join("").toUpperCase();

        if (!modsStr || modsStr === "NM") nmCount++;
        if (modsStr.includes("DT") || modsStr.includes("NC")) dtCount++;
        if (modsStr.includes("HR")) hrCount++;
        if (modsStr.includes("HD")) hdCount++;
        if (modsStr.includes("FL")) flCount++;
        if (modsStr.includes("EZ")) ezCount++;

        const isDT = modsStr.includes("DT") || modsStr.includes("NC");
        const isHT = modsStr.includes("HT") || modsStr.includes("DC");
        const isHR = modsStr.includes("HR");
        const isHD = modsStr.includes("HD");
        const isEZ = modsStr.includes("EZ");
        const isFL = modsStr.includes("FL");

        const bpm = Number(s.beatmap?.bpm || 180);
        const sr = Number(s.beatmap?.difficulty_rating || 5.5);
        const ar = Number(s.beatmap?.ar || 9.0);
        const cs = Number(s.beatmap?.cs || 4.0);
        const circles = Number(s.beatmap?.count_circles || 0);
        const sliders = Number(s.beatmap?.count_sliders || 0);
        const totalObj = circles + sliders;

        const effBPM = bpm * (isDT ? 1.5 : (isHT ? 0.75 : 1.0));
        const effLen = Math.max(20, Number(s.beatmap?.hit_length || 100)) / (isDT ? 1.5 : (isHT ? 0.75 : 1.0));
        const circleRatio = totalObj > 0 ? (circles / totalObj) : 0.65;
        const circleDensity = circles / effLen;

        // Índice de corriente S ∈ [0.05, 0.95]
        let streaminess = ((circleRatio - 0.45) / 0.35) * Math.pow(Math.max(0.5, circleDensity) / 5.0, 0.4);
        streaminess = Math.max(0.05, Math.min(0.95, streaminess));

        // AIM STRAIN
        let aimBase = Math.pow(sr / 5.5, 1.16) * 48.0;
        aimBase *= (1.0 - 0.23 * streaminess);
        if (isHR) aimBase *= (1.21 + Math.max(0, cs - 4.0) * 0.05);
        if (isHD) aimBase *= 1.15;
        if (isEZ) aimBase *= 0.92;

        // SPEED STRAIN
        let speedBase = Math.pow(sr / 5.5, 0.45) * 45.0;
        speedBase *= Math.pow(effBPM / 185, 0.53);
        speedBase *= (0.50 + 0.276 * streaminess);
        if (isEZ) speedBase *= 0.90;
        if (streaminess > 0.50 && effBPM > 220) {
            speedBase *= (1.0 + (streaminess - 0.50) * (effBPM - 220) * 0.007);
        }

        // ACCURACY
        let accBase = Math.max(0, (accPct - 85) * 5.5);

        // READING STRAIN
        let readingBase = (aimBase * 0.52 + speedBase * 0.65);
        if (isHD) readingBase *= 1.12;
        if (isEZ) readingBase *= 1.76;
        if (isFL) readingBase *= 1.77;

        const effAR = calculateEffectiveAR(ar, modsStr);
        if (effAR < 9.0) {
            readingBase *= (1 + Math.min(6.0, 9.0 - effAR) * 0.005);
        } else if (effAR > 10.3) {
            readingBase *= (1 + Math.min(2.0, effAR - 10.3) * 0.09);
        }

        aimSum += aimBase * weight;
        speedSum += speedBase * weight;
        accSum += accBase * weight;
        readingSum += readingBase * weight;
    }

    const total = scores.length;
    const aim = totalWeight > 0 ? (aimSum / totalWeight) : 40.0;
    const speed = totalWeight > 0 ? (speedSum / totalWeight) : 30.0;
    const acc = totalWeight > 0 ? (accSum / totalWeight) : 50.0;
    const reading = totalWeight > 0 ? (readingSum / totalWeight) : 35.0;
    const topPlayPP = Math.round(Number(scores[0]?.pp || 0));

    return {
        aim: Number(aim.toFixed(2)),
        speed: Number(speed.toFixed(2)),
        acc: Number(acc.toFixed(2)),
        reading: Number(reading.toFixed(2)),
        topPlayPP,
        modStats: {
            DT: Math.round((dtCount / total) * 100),
            HD: Math.round((hdCount / total) * 100),
            HR: Math.round((hrCount / total) * 100),
            NM: Math.round((nmCount / total) * 100),
            FL: Math.round((flCount / total) * 100),
            EZ: Math.round((ezCount / total) * 100)
        }
    };
}

/**
 * Genera el título dinámico de 2 líneas con soporte de localización
 */
function generateCardTitle(skills, modStats, pp, user, sengoData, locale = "es") {
    const isEs = locale === "es";
    let prefix = isEs ? "Novato" : "Novice";
    if (pp > 16000) prefix = isEs ? "Legendario" : "Legendary";
    else if (pp > 11000) prefix = isEs ? "Experto" : "Expert";
    else if (pp > 6500) prefix = isEs ? "Avanzado" : "Advanced";
    else if (pp > 3500) prefix = isEs ? "Veterano" : "Seasoned";
    else if (pp > 1500) prefix = isEs ? "Intermedio" : "Intermediate";
    else if (pp > 500) prefix = isEs ? "Competente" : "Competent";

    let descriptor = isEs ? "Versátil" : "Versatile";
    if (modStats.NM >= 55) descriptor = isEs ? "Anti-Mods" : "Mod-Hating";
    else if (modStats.DT >= 40) descriptor = isEs ? "Veloz" : "Speedy";
    else if (modStats.HR >= 35) descriptor = isEs ? "Preciso" : "Ant-Clicking";
    else if (modStats.HD >= 45) descriptor = isEs ? "Abusador de HD" : "HD abusing";
    else if (modStats.FL >= 5) descriptor = isEs ? "Ciego" : "Blindsighted";
    else if (modStats.EZ >= 10) descriptor = isEs ? "Paciente" : "Patient";
    else if (modStats.NM <= 15) descriptor = isEs ? "Amante de Mods" : "Mod-Loving";

    let suffix = isEs ? "Todoterreno" : "All-Rounder";
    const rankedMaps = Number(user.ranked_and_approved_beatmapset_count || 0);
    const snipesCount = Number(sengoData.nationalTopsCount || 0);

    if (snipesCount >= 500) {
        suffix = isEs ? "Némesis Nacional" : "National Nemesis";
    } else if (snipesCount >= 200) {
        suffix = isEs ? "Amenaza de Snipes" : "Snipe Menace";
    } else if (rankedMaps >= 1) {
        suffix = isEs ? "Creador de Beatmaps" : "Beatmap Crafter";
    } else if (skills.reading > skills.aim && skills.reading > skills.speed) {
        suffix = isEs ? "Demonio de Lectura" : "Sightread Demon";
    } else if (skills.aim >= skills.speed && skills.aim >= skills.acc) {
        suffix = isEs ? "Cazador de Círculos" : "Whack-A-Mole";
    } else if (skills.speed >= skills.aim && skills.speed >= skills.acc) {
        suffix = isEs ? "Mecanógrafo Veloz" : "speedtypist";
    } else {
        suffix = isEs ? "Ritmo Encarnado" : "Rhythm-Incarnate";
    }

    return {
        line1: `${prefix} ${descriptor}`,
        line2: suffix
    };
}

/**
 * Obtiene los pinned scores del usuario de osu! o fallback a su jugada top #1
 */
async function fetchPinnedScore(userId, topScores) {
    try {
        const OsuUserModel = require("../models/OsuUserModel.js");
        const tokenData = await OsuUserModel.loadToken().catch(() => null);
        const token = tokenData?.access_token;

        if (token) {
            const res = await axios.get(`https://osu.ppy.sh/api/v2/users/${userId}/scores/pinned?mode=osu&limit=1`, {
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "x-api-version": "20240728"
                },
                timeout: 4000
            });
            if (res.data && res.data.length > 0) {
                return res.data[0];
            }
        }
    } catch (err) {
        console.warn("[fetchPinnedScore] Error al consultar pinned score:", err.message);
    }

    return topScores && topScores.length > 0 ? topScores[0] : null;
}

/**
 * Color de la letra de rango
 */
function getGradeColor(grade) {
    const g = (grade || "A").toUpperCase();
    if (g === "SS" || g === "X" || g === "XH") return "#e2e8f0";
    if (g === "S" || g === "SH") return "#facc15";
    if (g === "A") return "#22c55e";
    if (g === "B") return "#3b82f6";
    if (g === "C") return "#a855f7";
    return "#ef4444";
}

/**
 * Dibuja un texto personalizado aplicando tamaño, estilo, peso, efectos de sombra o glow, y auto-fit si aplica.
 */
function drawCustomText(ctx, fontConfig, text, x, y, align = "left", globalFontFamily = DEFAULT_FONT_STACK, maxWidth = null) {
    if (!fontConfig || text == null) return;
    const strText = String(text);
    ctx.save();

    if (fontConfig.effectType && fontConfig.effectType !== "none") {
        const opacity = fontConfig.effectOpacity != null ? fontConfig.effectOpacity : 1.0;
        let shadowCol = fontConfig.effectColor || "#c084fc";
        if (shadowCol.startsWith("#") && shadowCol.length === 7) {
            const r = parseInt(shadowCol.slice(1, 3), 16) || 0;
            const g = parseInt(shadowCol.slice(3, 5), 16) || 0;
            const b = parseInt(shadowCol.slice(5, 7), 16) || 0;
            ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${opacity})`;
        } else {
            ctx.shadowColor = shadowCol;
        }

        ctx.shadowBlur = fontConfig.effectBlur || 0;

        if (fontConfig.effectType === "shadow") {
            ctx.shadowOffsetX = fontConfig.effectOffsetX != null ? fontConfig.effectOffsetX : 0;
            ctx.shadowOffsetY = fontConfig.effectOffsetY != null ? fontConfig.effectOffsetY : 3;
        } else {
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
        }
    }

    ctx.fillStyle = fontConfig.color || "#ffffff";
    const italic = fontConfig.style === "italic" ? "italic " : "";
    const weight = fontConfig.weight ? `${fontConfig.weight} ` : "";
    let fontSize = fontConfig.size || 20;

    // Auto-fit para nombres largos si está habilitado
    if (fontConfig.autoFit && maxWidth) {
        ctx.font = `${italic}${weight}${fontSize}px ${globalFontFamily}`;
        let textWidth = ctx.measureText(strText).width;
        const minSize = fontConfig.minSize || 16;
        while (textWidth > maxWidth && fontSize > minSize) {
            fontSize -= 1;
            ctx.font = `${italic}${weight}${fontSize}px ${globalFontFamily}`;
            textWidth = ctx.measureText(strText).width;
        }
    }

    ctx.font = `${italic}${weight}${fontSize}px ${globalFontFamily}`;
    ctx.textAlign = align;
    ctx.fillText(strText, x, y);
    ctx.restore();
}

/**
 * Dibuja los patrones de fondo soportados exactamente como en el editor
 */
function drawPattern(ctx, patternType, patternColor, patternOpacity, patternSpacing, patternWidth, width, height) {
    if (!patternType || patternType === "none" || patternOpacity <= 0) return;

    ctx.save();
    const sp = patternSpacing || 20;
    const pWidth = patternWidth || 1.4;
    ctx.fillStyle = patternColor;
    ctx.strokeStyle = patternColor;
    ctx.globalAlpha = patternOpacity;
    ctx.lineWidth = pWidth;

    if (patternType === "staggered_dots" || patternType === "milin_dots") {
        const rowH = sp * 0.866;
        let rowIndex = 0;
        ctx.beginPath();
        for (let y = pWidth; y < height + rowH; y += rowH, rowIndex++) {
            const offsetX = (rowIndex % 2 === 1) ? sp / 2 : 0;
            for (let x = offsetX; x < width + sp; x += sp) {
                ctx.moveTo(x + pWidth, y);
                ctx.arc(x, y, pWidth, 0, Math.PI * 2);
            }
        }
        ctx.fill();
    } else if (patternType === "dots") {
        ctx.beginPath();
        for (let x = sp / 2; x < width; x += sp) {
            for (let y = sp / 2; y < height; y += sp) {
                ctx.moveTo(x + pWidth, y);
                ctx.arc(x, y, pWidth, 0, Math.PI * 2);
            }
        }
        ctx.fill();
    } else if (patternType === "grid") {
        for (let x = 0; x < width; x += sp) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
        }
        for (let y = 0; y < height; y += sp) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
        }
    } else if (patternType === "diamonds") {
        for (let x = -height; x < width + height; x += sp * 1.4) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + height, height); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - height, height); ctx.stroke();
        }
    } else if (patternType === "stripes") {
        for (let x = -height; x < width; x += sp) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + height, height); ctx.stroke();
        }
    } else if (patternType === "crosses") {
        const arm = sp * 0.28;
        for (let x = sp / 2; x < width; x += sp) {
            for (let y = sp / 2; y < height; y += sp) {
                ctx.beginPath();
                ctx.moveTo(x - arm, y); ctx.lineTo(x + arm, y);
                ctx.moveTo(x, y - arm); ctx.lineTo(x, y + arm);
                ctx.stroke();
            }
        }
    } else if (patternType === "hexagons") {
        const r = sp * 0.6;
        const hHex = r * Math.sqrt(3);
        for (let y = 0, row = 0; y < height + hHex; y += hHex * 0.75, row++) {
            const off = (row % 2 === 1) ? r * 1.5 : 0;
            for (let x = -r + off; x < width + r; x += r * 3) {
                ctx.beginPath();
                for (let a = 0; a < 6; a++) {
                    const angle = (a * 60) * Math.PI / 180;
                    const hx = x + r * Math.cos(angle);
                    const hy = y + r * Math.sin(angle);
                    if (a === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
                }
                ctx.closePath();
                ctx.stroke();
            }
        }
    } else if (patternType === "waves") {
        for (let y = sp; y < height; y += sp) {
            ctx.beginPath();
            for (let x = 0; x <= width; x += 10) {
                const wy = y + Math.sin(x * 0.025) * (sp * 0.25);
                if (x === 0) ctx.moveTo(x, wy); else ctx.lineTo(x, wy);
            }
            ctx.stroke();
        }
    } else if (patternType === "triangles") {
        const th = sp * 0.866;
        for (let y = 0; y < height + th; y += th) {
            for (let x = 0; x < width + sp; x += sp) {
                ctx.beginPath();
                ctx.moveTo(x, y + th);
                ctx.lineTo(x + sp / 2, y);
                ctx.lineTo(x + sp, y + th);
                ctx.closePath();
                ctx.stroke();
            }
        }
    } else if (patternType === "scanlines") {
        ctx.lineWidth = 1;
        for (let y = 0; y < height; y += 4) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
        }
    }
    ctx.restore();
}

/**
 * Dibuja la viñeta / sombra de fondo con difuminado (feathering) exacto
 */
function drawVignette(ctx, mode, spreadPct, opacity, color, featherPct, width, height) {
    if (!mode || mode === "none" || opacity <= 0) return;

    ctx.save();
    const vColor = color || "#000000";
    const vOp = opacity != null ? opacity : 0.6;
    const vSpread = (spreadPct != null ? spreadPct : 13) / 100;
    const vFeather = (featherPct != null ? featherPct : 34) / 100;

    let r = 0, g = 0, b = 0;
    if (vColor.startsWith("#") && vColor.length === 7) {
        r = parseInt(vColor.slice(1, 3), 16) || 0;
        g = parseInt(vColor.slice(3, 5), 16) || 0;
        b = parseInt(vColor.slice(5, 7), 16) || 0;
    }
    const colorSolid = `rgba(${r}, ${g}, ${b}, ${vOp})`;
    const colorMid = `rgba(${r}, ${g}, ${b}, ${vOp * (1 - vFeather * 0.55)})`;
    const colorTransparent = `rgba(${r}, ${g}, ${b}, 0)`;
    const midStop = Math.max(0.1, Math.min(0.9, 1.0 - vFeather * 0.5));

    if (mode === "top_bottom") {
        const topH = Math.max(20, height * vSpread);
        // Sombra superior
        const gradTop = ctx.createLinearGradient(0, 0, 0, topH);
        gradTop.addColorStop(0, colorSolid);
        gradTop.addColorStop(midStop, colorMid);
        gradTop.addColorStop(1, colorTransparent);
        ctx.fillStyle = gradTop;
        ctx.fillRect(0, 0, width, topH);

        // Sombra inferior
        const gradBot = ctx.createLinearGradient(0, height, 0, height - topH);
        gradBot.addColorStop(0, colorSolid);
        gradBot.addColorStop(midStop, colorMid);
        gradBot.addColorStop(1, colorTransparent);
        ctx.fillStyle = gradBot;
        ctx.fillRect(0, height - topH, width, topH);
    } else if (mode === "radial") {
        const rMax = Math.hypot(width / 2, height / 2);
        const rMin = Math.max(0, rMax * (1 - vSpread));
        const radGrad = ctx.createRadialGradient(width / 2, height / 2, rMin, width / 2, height / 2, rMax);
        radGrad.addColorStop(0, colorTransparent);
        radGrad.addColorStop(Math.min(0.9, 0.4 + 0.5 * (1 - vFeather)), colorMid);
        radGrad.addColorStop(1, colorSolid);
        ctx.fillStyle = radGrad;
        ctx.fillRect(0, 0, width, height);
    } else if (mode === "top_only") {
        const topH = Math.max(20, height * vSpread);
        const gradTop = ctx.createLinearGradient(0, 0, 0, topH);
        gradTop.addColorStop(0, colorSolid);
        gradTop.addColorStop(midStop, colorMid);
        gradTop.addColorStop(1, colorTransparent);
        ctx.fillStyle = gradTop;
        ctx.fillRect(0, 0, width, topH);
    } else if (mode === "bottom_only") {
        const botH = Math.max(20, height * vSpread);
        const gradBot = ctx.createLinearGradient(0, height, 0, height - botH);
        gradBot.addColorStop(0, colorSolid);
        gradBot.addColorStop(midStop, colorMid);
        gradBot.addColorStop(1, colorTransparent);
        ctx.fillStyle = gradBot;
        ctx.fillRect(0, height - botH, width, botH);
    } else if (mode === "sides") {
        const sideW = Math.max(20, (width / 2) * vSpread);
        const gradL = ctx.createLinearGradient(0, 0, sideW, 0);
        gradL.addColorStop(0, colorSolid);
        gradL.addColorStop(midStop, colorMid);
        gradL.addColorStop(1, colorTransparent);
        ctx.fillStyle = gradL;
        ctx.fillRect(0, 0, sideW, height);

        const gradR = ctx.createLinearGradient(width, 0, width - sideW, 0);
        gradR.addColorStop(0, colorSolid);
        gradR.addColorStop(midStop, colorMid);
        gradR.addColorStop(1, colorTransparent);
        ctx.fillStyle = gradR;
        ctx.fillRect(width - sideW, 0, sideW, height);
    } else if (mode === "corners") {
        const rCorner = Math.max(50, (height * 0.85) * vSpread);
        const corners = [
            [0, 0], [width, 0], [0, height], [width, height]
        ];
        for (const [cx, cy] of corners) {
            const cGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rCorner);
            cGrad.addColorStop(0, colorSolid);
            cGrad.addColorStop(1 - vFeather * 0.4, colorMid);
            cGrad.addColorStop(1, colorTransparent);
            ctx.fillStyle = cGrad;
            ctx.fillRect(cx === 0 ? 0 : width - rCorner, cy === 0 ? 0 : height - rCorner, rCorner, rCorner);
        }
    }
    ctx.restore();
}

// Caché de tarjetas generadas en memoria (1 hora de TTL, máx 60 tarjetas en RAM ~ 35MB)
const cardBufferCache = new Map();
const CARD_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora
const MAX_CARD_CACHE_SIZE = 60;

function setWithLimit(map, key, value, limit = 60) {
    if (map.size >= limit && !map.has(key)) {
        const firstKey = map.keys().next().value;
        map.delete(firstKey);
    }
    map.set(key, value);
}

function clearCardCache(userId) {
    if (userId) cardBufferCache.delete(`user:${userId}`);
}

async function renderOsuCard(user, topScores = [], options = {}) {
    const locale = options?.locale || user?.locale || "es";
    const isEs = locale === "es";
    const numLocale = isEs ? "de-DE" : "en-US";
    const cacheKey = `user:${user.id}:${locale}`;

    if (!options?.forceRefresh) {
        const cached = cardBufferCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < CARD_CACHE_TTL_MS) {
            return cached.buffer;
        }
    }

    const config = getDefaultTemplate();
    const width = 1300;
    const height = 720;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const countryCode = (user.country_code || user.country?.code || "VE").toUpperCase();
    const stats = user.statistics || {};
    const level = stats.level || { current: 100, progress: 0 };
    const globalRank = stats.global_rank ? `${Number(stats.global_rank).toLocaleString(numLocale)}` : "-";
    const countryRank = stats.rank?.country ? `${Number(stats.rank.country).toLocaleString(numLocale)}` : "-";
    const pp = Number(stats.pp || 0);
    const medalsCount = user.user_achievements ? user.user_achievements.length : 0;
    const totalMedals = 352;
    const medalsPct = Math.round((medalsCount / totalMedals) * 100);

    const [sengoData, pinnedPlay] = await Promise.all([
        fetchSengoData(user.id, countryCode),
        fetchPinnedScore(user.id, topScores)
    ]);
    const skillData = analyzeSkills(topScores);
    const dynamicTitle = generateCardTitle(skillData, skillData.modStats, pp, user, sengoData, locale);

    const theme = config.theme || {};
    const cards = config.cards || {};
    const fonts = config.fonts || {};
    const fontFamily = DEFAULT_FONT_STACK;

    // 1. FONDO PRINCIPAL
    ctx.fillStyle = theme.bgColor || "#27152c";
    ctx.fillRect(0, 0, width, height);

    const profileCoverUrl = user.cover_url || user.cover?.url || user.cover?.custom_url || theme.profileCoverUrl;
    const activeBgUrl = theme.useProfileCover && profileCoverUrl ? profileCoverUrl : theme.bgImageUrl;
    const flagUrl = `https://flagcdn.com/w160/${countryCode.toLowerCase()}.png`;
    const coverUrl = pinnedPlay?.beatmapset?.covers?.["cover@2x"] || pinnedPlay?.beatmapset?.covers?.cover || "https://jeiden.s-ul.eu/3ssHl9Gd";

    // Descarga paralela en segundo plano de todos los assets requeridos y cálculo de Star Rating con mods
    const srPromise = (async () => {
        if (!pinnedPlay?.beatmap?.id) return null;
        try {
            const BeatmapModel = require("../models/BeatmapModel.js");
            const OsuScoreModel = require("../models/OsuScoreModel.js");
            const mapObj = await BeatmapModel.getBeatmap_osu(
                pinnedPlay.beatmapset?.id || pinnedPlay.beatmap.beatmapset_id,
                pinnedPlay.beatmap.id,
                pinnedPlay.beatmap
            );
            if (mapObj) {
                const maxAttrs = OsuScoreModel.calculatePP(pinnedPlay, mapObj, "maximo_pp");
                const stars = maxAttrs.stars || maxAttrs.difficulty?.stars;
                if (typeof stars === "number" && !isNaN(stars) && stars > 0) {
                    return stars;
                }
            }
        } catch (_) {}
        return null;
    })();

    const [bgImg, avatarImg, flagImg, mapCoverImg, calculatedPlaySR] = await Promise.all([
        fetchImageSafe(activeBgUrl),
        fetchImageSafe(user.avatar_url),
        fetchImageSafe(flagUrl),
        fetchImageSafe(coverUrl),
        srPromise
    ]);

    // 1. FONDO PRINCIPAL
    ctx.fillStyle = theme.bgColor || "#27152c";
    ctx.fillRect(0, 0, width, height);

    if (bgImg) {
        ctx.save();
        ctx.globalAlpha = theme.bgImageOpacity != null ? theme.bgImageOpacity : 0.5;
        drawImageCover(ctx, bgImg, 0, 0, width, height);
        ctx.restore();

        // Degradado de mezcla sobre la imagen
        if (theme.bgGradientMode && theme.bgGradientMode !== "none") {
            ctx.save();
            ctx.globalAlpha = theme.bgGradientIntensity || 0.75;
            if (theme.bgGradientMode === "radial") {
                const radGrad = ctx.createRadialGradient(width / 2, height / 2, 180, width / 2, height / 2, width / 1.5);
                radGrad.addColorStop(0, "rgba(0,0,0,0)");
                radGrad.addColorStop(0.65, "rgba(0,0,0,0.35)");
                radGrad.addColorStop(1, theme.bgColor);
                ctx.fillStyle = radGrad;
            } else if (theme.bgGradientMode === "vertical") {
                const vertGrad = ctx.createLinearGradient(0, 0, 0, height);
                vertGrad.addColorStop(0, "rgba(0,0,0,0.1)");
                vertGrad.addColorStop(0.5, "rgba(0,0,0,0.4)");
                vertGrad.addColorStop(1, theme.bgColor);
                ctx.fillStyle = vertGrad;
            } else if (theme.bgGradientMode === "horizontal") {
                const horizGrad = ctx.createLinearGradient(0, 0, width, 0);
                horizGrad.addColorStop(0, theme.bgColor);
                horizGrad.addColorStop(0.3, "rgba(0,0,0,0.2)");
                horizGrad.addColorStop(0.7, "rgba(0,0,0,0.2)");
                horizGrad.addColorStop(1, theme.bgColor);
                ctx.fillStyle = horizGrad;
            }
            ctx.fillRect(0, 0, width, height);
            ctx.restore();
        }
    }

    // Patrón de fondo
    drawPattern(
        ctx,
        theme.patternType,
        theme.patternColor || "#ffc8ff",
        theme.patternOpacity != null ? theme.patternOpacity : 0.11,
        theme.patternSpacing || 20,
        theme.patternWidth || 3.9,
        width,
        height
    );

    // Viñeta de fondo
    drawVignette(
        ctx,
        theme.bgVignetteMode || "top_bottom",
        theme.bgVignetteSpread != null ? theme.bgVignetteSpread : 13,
        theme.bgVignetteOpacity != null ? theme.bgVignetteOpacity : 0.6,
        theme.bgVignetteColor || "#000000",
        theme.bgVignetteFeather != null ? theme.bgVignetteFeather : 34,
        width,
        height
    );

    // Helper para dibujar tarjetas individuales
    function drawCardBox(boxConfig) {
        if (!boxConfig) return;
        const bg = boxConfig.customBg || theme.cardColor || "#170c1a";
        const radius = boxConfig.customRadius != null ? boxConfig.customRadius : (theme.cardRadius || 14);

        ctx.save();
        if (theme.cardShadowBlur > 0) {
            ctx.shadowColor = `rgba(0, 0, 0, ${theme.cardShadowOpacity != null ? theme.cardShadowOpacity : 0.7})`;
            ctx.shadowBlur = theme.cardShadowBlur || 21;
            ctx.shadowOffsetY = theme.cardShadowY != null ? theme.cardShadowY : 4;
            ctx.shadowOffsetX = 0;
        }
        ctx.fillStyle = bg;
        roundRect(ctx, boxConfig.x, boxConfig.y, boxConfig.w, boxConfig.h, radius, true, false);
        ctx.restore();

        // Borde si está configurado
        if (theme.cardBorderColor && theme.cardBorderColor !== "transparent") {
            ctx.save();
            ctx.strokeStyle = theme.cardBorderColor;
            ctx.lineWidth = 1.5;
            roundRect(ctx, boxConfig.x, boxConfig.y, boxConfig.w, boxConfig.h, radius, false, true);
            ctx.restore();
        }
    }

    // 2. CABECERA: TÍTULO SUPERIOR + HITCIRCLE
    if (cards.header?.visible !== false) {
        drawCustomText(ctx, fonts.headerTitle1, dynamicTitle.line1, 500, 42, "center", fontFamily);
        drawCustomText(ctx, fonts.headerTitle2, dynamicTitle.line2, 500, 78, "center", fontFamily);

        // Hitcircle de osu!
        const circleX = config.header?.circleX || 870;
        const circleY = config.header?.circleY || 38;
        ctx.save();
        ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 3;
        ctx.shadowOffsetX = 0;

        ctx.strokeStyle = "#d1d5db";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(circleX, circleY, 32, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = "#cbd5e1";
        ctx.beginPath();
        ctx.arc(circleX, circleY, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // 3. COLUMNA IZQUIERDA UNIFICADA (AVATAR + NIVEL + MEDALLAS)
    if (cards.leftCol?.visible !== false) {
        const lc = cards.leftCol;
        drawCardBox(lc);

        const avatarH = config.leftCol?.avatarH || 265;
        const avatarRadius = lc.customRadius != null ? lc.customRadius : (theme.cardRadius || 14);

        ctx.save();
        roundRect(ctx, lc.x, lc.y, lc.w, avatarH, { tl: avatarRadius, tr: avatarRadius, bl: 0, br: 0 });
        ctx.clip();

        if (avatarImg) {
            drawImageCover(ctx, avatarImg, lc.x, lc.y, lc.w, avatarH, config.leftCol?.avatarAlignY || 0.2);
        }
        ctx.restore();

        // Nivel
        const levelTextY = lc.y + avatarH + 42;
        drawCustomText(ctx, fonts.levelText, `lvl ${level.current || 100}`, lc.x + (lc.w / 2), levelTextY, "center", fontFamily);

        const lvlBarX = lc.x + 15;
        const lvlBarW = lc.w - 30;
        const lvlBarY = levelTextY + 12;
        const lvlProg = Math.min(100, Math.max(0, level.progress || 0));

        ctx.fillStyle = "#2e253c";
        roundRect(ctx, lvlBarX, lvlBarY, lvlBarW, 8, 4, true);
        ctx.fillStyle = "#ffffff";
        roundRect(ctx, lvlBarX, lvlBarY, Math.max(8, (lvlBarW * lvlProg) / 100), 8, 4, true);

        // Medallas
        const medalsTextY = lvlBarY + 58;
        const medalsLabel = isEs ? "Medallas" : "Medals";
        drawCustomText(ctx, fonts.medalsText, `${medalsLabel} ${medalsPct}% ${medalsCount}/${totalMedals}`, lc.x + (lc.w / 2), medalsTextY, "center", fontFamily);

        const medalBarY = medalsTextY + 12;
        ctx.fillStyle = "#2e253c";
        roundRect(ctx, lvlBarX, medalBarY, lvlBarW, 8, 4, true);

        const medalGrad = ctx.createLinearGradient(lvlBarX, 0, lvlBarX + lvlBarW, 0);
        medalGrad.addColorStop(0, "#60a5fa");
        medalGrad.addColorStop(0.5, "#ec4899");
        medalGrad.addColorStop(1, "#a855f7");
        ctx.fillStyle = medalGrad;
        roundRect(ctx, lvlBarX, medalBarY, Math.max(8, (lvlBarW * medalsPct) / 100), 8, 4, true);
    }

    // 4. BLOQUE CENTRO-IZQUIERDA: TARJETA DE PERFIL Y RANKINGS
    if (cards.rankBox?.visible !== false) {
        const rb = cards.rankBox;
        drawCardBox(rb);

        const flagW = config.rankBox?.flagW || 84;
        const flagH = config.rankBox?.flagH || 56;
        const flagX = rb.x + 16;
        const flagY = rb.y + 16;

        if (flagImg) {
            ctx.save();
            roundRect(ctx, flagX, flagY, flagW, flagH, 8);
            ctx.clip();
            ctx.drawImage(flagImg, flagX, flagY, flagW, flagH);
            ctx.restore();
        }

        // Nombre de usuario con auto-fit
        const maxUsernameW = rb.w - flagW - 32;
        drawCustomText(ctx, fonts.username, user.username, rb.x + 112, flagY + 43, "left", fontFamily, maxUsernameW);

        // Global Rank
        const rankCenterX = rb.x + (rb.w / 2);
        drawCustomText(ctx, fonts.globalRankLabel, isEs ? "Rango Global" : "Global Rank", rankCenterX, rb.y + 115, "center", fontFamily);
        drawCustomText(ctx, fonts.globalRankVal, globalRank, rankCenterX, rb.y + 168, "center", fontFamily);

        // Country Rank
        drawCustomText(ctx, fonts.countryRankLabel, isEs ? "País" : "Country", rankCenterX, rb.y + 208, "center", fontFamily);
        drawCustomText(ctx, fonts.countryRankVal, countryRank, rankCenterX, rb.y + 254, "center", fontFamily);
    }

    // 5. BLOQUE SUPERIOR DERECHO: PINNED PLAY / TOP PLAY CARD
    if (cards.playBox?.visible !== false) {
        const pb = cards.playBox;
        const playRadius = pb.customRadius != null ? pb.customRadius : (theme.cardRadius || 14);

        // 1. Sombra y fondo base de playBox
        ctx.save();
        if (theme.cardShadowBlur > 0 && (theme.cardShadowOpacity || 0.7) > 0) {
            ctx.shadowColor = `rgba(0, 0, 0, ${theme.cardShadowOpacity != null ? theme.cardShadowOpacity : 0.7})`;
            ctx.shadowBlur = theme.cardShadowBlur || 21;
            ctx.shadowOffsetY = theme.cardShadowY != null ? theme.cardShadowY : 4;
        }
        ctx.fillStyle = pb.customBg || theme.cardColor || "#170c1a";
        roundRect(ctx, pb.x, pb.y, pb.w, pb.h, playRadius, true);
        ctx.restore();

        // 2. Imagen del beatmap con gradiente recortada
        ctx.save();
        roundRect(ctx, pb.x, pb.y, pb.w, pb.h, playRadius);
        ctx.clip();

        if (mapCoverImg) {
            drawImageCover(ctx, mapCoverImg, pb.x, pb.y, pb.w, pb.h, 0.3);
        } else {
            ctx.fillStyle = "#170c1a";
            ctx.fillRect(pb.x, pb.y, pb.w, pb.h);
        }

        const gradStop = config.playBox?.gradStop || 0.4;
        const playGrad = ctx.createLinearGradient(pb.x, 0, pb.x + pb.w, 0);
        playGrad.addColorStop(0, "rgba(15, 8, 20, 0.94)");
        playGrad.addColorStop(gradStop, "rgba(15, 8, 20, 0.70)");
        playGrad.addColorStop(0.70, "rgba(15, 8, 20, 0.35)");
        playGrad.addColorStop(1, "rgba(15, 8, 20, 0.15)");
        ctx.fillStyle = playGrad;
        ctx.fillRect(pb.x, pb.y, pb.w, pb.h);

        const mapTitle = pinnedPlay?.beatmapset?.title || "Ange du Blanc Pur";
        const mapArtist = pinnedPlay?.beatmapset?.artist || "ke-ji feat. Nanahira";
        const rawDiff = pinnedPlay?.beatmap?.version || "BMD's Absolution";
        const effectiveSRNumber = (calculatedPlaySR && !isNaN(calculatedPlaySR) && calculatedPlaySR > 0)
            ? calculatedPlaySR
            : (pinnedPlay?.beatmap?.difficulty_rating ? Number(pinnedPlay.beatmap.difficulty_rating) : 7.68);
        const mapSR = Number(effectiveSRNumber).toFixed(2);
        const mapDiffFormatted = rawDiff.toLowerCase().includes(mapSR) ? rawDiff : `${rawDiff} ${mapSR}★`;
        const scoreVal = pinnedPlay ? Number(pinnedPlay.total_score || pinnedPlay.score || 0).toLocaleString(numLocale) : "32.219.611";
        const scoreAcc = pinnedPlay ? (Number(pinnedPlay.accuracy || 0.96) * 100).toFixed(2) : "96.12";
        const scoreCombo = pinnedPlay?.max_combo ? `${pinnedPlay.max_combo}x` : "262x";
        const scoreGrade = pinnedPlay?.rank || "S";

        drawCustomText(ctx, fonts.playTitle, `${mapTitle} by ${mapArtist}`.slice(0, 48), pb.x + 16, pb.y + 34, "left", fontFamily);
        drawCustomText(ctx, fonts.playDiff, mapDiffFormatted.slice(0, 36), pb.x + 16, pb.y + 76, "left", fontFamily);
        drawCustomText(ctx, fonts.playScore, `${scoreVal} ${isEs ? 'Puntuación' : 'Score'}`, pb.x + pb.w - 16, pb.y + 76, "right", fontFamily);

        // Grade S/A
        const gradeFont = { ...fonts.playGrade, color: getGradeColor(scoreGrade) };
        drawCustomText(ctx, gradeFont, scoreGrade, pb.x + 80, pb.y + 175, "center", fontFamily);

        // Badges de mods estilo lazer
        const mods = Array.isArray(pinnedPlay?.mods)
            ? pinnedPlay.mods.map(m => (typeof m === "string" ? m : m.acronym || "")).filter(Boolean)
            : ["HD", "DT"];

        let modX = pb.x + 20;
        const modW = 54;
        const modH = 34;
        const modY = pb.y + 206;

        for (const mod of mods.slice(0, 4)) {
            const cleanMod = String(mod).toUpperCase();
            const colors = MOD_COLORS[cleanMod] || { bg: "#fa4277", fg: "#ffffff" };

            ctx.save();
            ctx.fillStyle = colors.bg;
            roundRect(ctx, modX, modY, modW, modH, 8, true);

            ctx.fillStyle = colors.fg;
            ctx.font = `bold 16px ${fontFamily}`;
            ctx.textAlign = "center";
            ctx.fillText(cleanMod, modX + (modW / 2), modY + (modH / 2) + 6);
            ctx.restore();

            modX += modW + 8;
        }

        drawCustomText(ctx, fonts.playStats, `${scoreAcc}%`, pb.x + pb.w - 16, pb.y + 155, "right", fontFamily);
        drawCustomText(ctx, fonts.playStats, `${scoreCombo}`, pb.x + pb.w - 16, pb.y + 225, "right", fontFamily);

        ctx.restore();

        // 3. Borde morado de playBox coincidente con theme.cardBorderColor
        if (theme.cardBorderColor && theme.cardBorderColor !== "transparent") {
            ctx.save();
            ctx.strokeStyle = theme.cardBorderColor;
            ctx.lineWidth = 1.5;
            roundRect(ctx, pb.x, pb.y, pb.w, pb.h, playRadius, false, true);
            ctx.restore();
        }
    }

    // 6. BLOQUE MEDIO: ESTADÍSTICAS Y 4 BARRAS DE SKILLS
    if (cards.statsBox?.visible !== false) {
        const sb = cards.statsBox;
        drawCardBox(sb);

        const rankedScoreVal = Number(stats.ranked_score || stats.total_score || 0).toLocaleString(numLocale);
        const rankedScoreLabel = isEs ? "Puntuación Ranked" : "Ranked Score";
        const accLabel = isEs ? "Precisión" : "Accuracy";
        const playcountLabel = isEs ? "Partidas" : "Playcount";

        drawCustomText(ctx, fonts.statsLabels, `${rankedScoreLabel}: ${rankedScoreVal}`, sb.x + 24, sb.y + 42, "left", fontFamily);
        drawCustomText(ctx, fonts.statsLabels, `${accLabel}: ${Number(stats.hit_accuracy || 98.12).toFixed(2)}%`, sb.x + 24, sb.y + 88, "left", fontFamily);
        drawCustomText(ctx, fonts.statsLabels, `${playcountLabel}: ${Number(stats.play_count || 0).toLocaleString(numLocale)}`, sb.x + 24, sb.y + 134, "left", fontFamily);

        const skillsList = [
            { label: "ACC", val: skillData.acc, x: sb.x + 380 },
            { label: "AIM", val: skillData.aim, x: sb.x + 500 },
            { label: "SPEED", val: skillData.speed, x: sb.x + 620 },
            { label: "READING", val: skillData.reading, x: sb.x + 750 }
        ];

        const pillarW = config.statsBox?.pillarW || 24;
        const pillarH = config.statsBox?.pillarH || 65;
        const pillarY = sb.y + 38;

        skillsList.forEach(s => {
            drawCustomText(ctx, fonts.skillValues, String(s.val), s.x, sb.y + 28, "center", fontFamily);

            ctx.fillStyle = "#2e233d";
            roundRect(ctx, s.x - (pillarW / 2), pillarY, pillarW, pillarH, 4, true);

            const fillRatio = Math.min(1, Math.max(0.08, s.val / 100));
            const fillH = pillarH * fillRatio;
            ctx.fillStyle = "#ffffff";
            roundRect(ctx, s.x - (pillarW / 2), pillarY + pillarH - fillH, pillarW, fillH, 4, true);

            drawCustomText(ctx, fonts.skillLabels, s.label, s.x, sb.y + 134, "center", fontFamily);
        });
    }

    // 7. BLOQUE INFERIOR: ECOSISTEMA SENGO Y LOCAL STATS
    if (cards.sengoBox?.visible !== false) {
        const sgb = cards.sengoBox;
        drawCardBox(sgb);

        const sengoHeaderLabel = isEs ? "Ecosistema Sengo y estadísticas locales" : "Sengo ecosystem & local stats";
        drawCustomText(ctx, fonts.sengoHeader, sengoHeaderLabel, sgb.x + (sgb.w / 2), sgb.y + 26, "center", fontFamily);

        const bdayStr = sengoData.birthday ? `${sengoData.birthday}` : (isEs ? "Desconocido" : "unknown");
        const skinStr = sengoData.skinName ? `${sengoData.skinName}` : (isEs ? "Desconocida" : "Unknown");
        const topPPStr = skillData.topPlayPP ? `${skillData.topPlayPP}` : "0";
        const snipesCount = sengoData.nationalTopsCount || "0";
        const snipesMade = sengoData.snipesMade || "0";
        const bdayLabel = isEs ? "Cumpleaños" : "Birthday";
        const topsLabel = isEs ? "N° Tops nacionales" : "National Tops";

        const sengoText = `${topsLabel}: ${snipesCount} ${countryCode}        Top pp: ${topPPStr}        ${bdayLabel}: ${bdayStr}        Snipes: ${snipesMade}        Skin: ${skinStr}`;
        drawCustomText(ctx, fonts.sengoContent, sengoText, sgb.x + (sgb.w / 2), sgb.y + 58, "center", fontFamily);
    }

    // 8. FOOTER: BRANDING & FECHA
    if (cards.footer?.visible !== false) {
        const today = new Date().toISOString().split("T")[0];
        drawCustomText(ctx, fonts.footerBrand, "Sengo", 580, 695, "right", fontFamily);
        drawCustomText(ctx, fonts.footerDate, today, 630, 695, "left", fontFamily);
    }

    const buffer = canvas.toBuffer("image/png");
    setWithLimit(cardBufferCache, cacheKey, { buffer, timestamp: Date.now() }, MAX_CARD_CACHE_SIZE);
    return buffer;
}

/**
 * Genera el embed de Discord para la tarjeta.
 */
function doOsuCardEmbed(message, imageName = "card.png") {
    const embedColor = getEmbedColor(message);
    return new EmbedBuilder()
        .setColor(embedColor)
        .setImage(`attachment://${imageName}`);
}

module.exports = {
    renderOsuCard,
    doOsuCardEmbed,
    clearCardCache
};
