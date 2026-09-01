const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { EmbedBuilder } = require("discord.js");
const { createCanvas, loadImage, registerFont } = require("canvas");
const { getEmbedColor } = require("./osuViewHelpers.js");
const { getSupabaseClient } = require("../db/database.js");
const OsuScoreModel = require("../models/OsuScoreModel.js");
const BirthdayModel = require("../models/BirthdayModel.js");

// Registrar fuentes del sistema para coincidir con la tipografía de Milin
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

const FONT_FAMILY = '"SegoeCustom", "ArialCustom", "Segoe UI", Arial, sans-serif';

/**
 * Descarga una imagen remota de forma segura y devuelve un Image object de canvas.
 */
async function fetchImageSafe(url) {
    if (!url) return null;
    try {
        const res = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 8000,
            headers: { "User-Agent": "SengoBot/CardGenerator" }
        });
        return await loadImage(Buffer.from(res.data));
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
    ctx.lineTo(x + radius.tl);
    ctx.quadraticCurveTo(x, y, x + radius.tl, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
}

/**
 * Consulta datos del ecosistema de Sengo (DB Turso & Supabase).
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
        if (supabase) {
            const { data: sUser } = await supabase.from("users").select("*").eq("osu_id", String(userId)).maybeSingle();
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
        }
    } catch (e) {
        console.warn("[CARD] Error al consultar usuario en Supabase:", e.message);
    }

    try {
        const tops = await OsuScoreModel.getUserNationalTops(userId, 0, countryCode || "VE").catch(() => []);
        data.nationalTopsCount = Array.isArray(tops) ? tops.length : 0;
        if (tops && tops.length > 0) {
            data.topScore = tops[0];
        }

        const snipesHistory = await OsuScoreModel.getUserSnipesHistory(userId).catch(() => null);
        if (snipesHistory) {
            data.snipesMade = (snipesHistory.made || []).length;
            data.snipesReceived = (snipesHistory.received || []).length;
        }
    } catch (e) {
        console.warn("[CARD] Error al consultar snipes en Sengo:", e.message);
    }

    return data;
}

/**
 * Analiza skills del jugador a partir de sus mejores puntuaciones.
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

        const bpm = Number(s.beatmap?.bpm || 180);
        const sr = Number(s.beatmap?.difficulty_rating || 5.5);
        const ar = Number(s.beatmap?.ar || 9.0);
        const cs = Number(s.beatmap?.cs || 4.0);

        let aimBase = sr * 7.5;
        if (modsStr.includes("HR")) aimBase *= 1.15;
        if (modsStr.includes("HD")) aimBase *= 1.08;

        let speedBase = (bpm / 200) * (sr * 6.8);
        if (modsStr.includes("DT") || modsStr.includes("NC")) speedBase *= 1.25;

        let accBase = Math.max(0, (accPct - 85) * 5.5);

        let readingBase = 32.0;
        if (modsStr.includes("HD")) readingBase += 18.0;
        if (modsStr.includes("FL")) readingBase += 35.0;
        if (modsStr.includes("EZ")) readingBase += 30.0;
        if (ar < 9.0) readingBase += (9.0 - ar) * 8.0;
        else if (ar > 10.3) readingBase += (ar - 10.3) * 12.0;
        if (cs >= 4.5) readingBase += (cs - 4.0) * 6.0;

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
 * Genera el título dinámico de 2 líneas
 */
function generateCardTitle(skills, modStats, pp, user, sengoData) {
    let prefix = "Novice";
    if (pp > 16000) prefix = "Legendary";
    else if (pp > 11000) prefix = "Expert";
    else if (pp > 6500) prefix = "Advanced";
    else if (pp > 3500) prefix = "Seasoned";
    else if (pp > 1500) prefix = "Intermediate";
    else if (pp > 500) prefix = "Competent";

    let descriptor = "Versatile";
    if (modStats.NM >= 55) descriptor = "Mod-Hating";
    else if (modStats.DT >= 40) descriptor = "Speedy";
    else if (modStats.HR >= 35) descriptor = "Ant-Clicking";
    else if (modStats.HD >= 45) descriptor = "HD abusing";
    else if (modStats.FL >= 5) descriptor = "Blindsighted";
    else if (modStats.EZ >= 10) descriptor = "Patient";
    else if (modStats.NM <= 15) descriptor = "Mod-Loving";

    let suffix = "All-Rounder";
    const rankedMaps = Number(user.ranked_and_approved_beatmapset_count || 0);
    const snipesCount = Number(sengoData.nationalTopsCount || 0);

    if (snipesCount >= 100) {
        suffix = "National Nemesis";
    } else if (snipesCount >= 10) {
        suffix = "Snipe Menace";
    } else if (rankedMaps >= 1) {
        suffix = "Beatmap Crafter";
    } else if (skills.reading > skills.aim && skills.reading > skills.speed) {
        suffix = "Sightread Demon";
    } else if (skills.aim >= skills.speed && skills.aim >= skills.acc) {
        suffix = "Whack-A-Mole";
    } else if (skills.speed >= skills.aim && skills.speed >= skills.acc) {
        suffix = "speedtypist";
    } else {
        suffix = "Rhythm-Incarnate";
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
        let globalToken = null;
        try {
            const tokenData = JSON.parse(fs.readFileSync("./osu_api_extended_token.json", "utf8"));
            globalToken = tokenData.access_token;
        } catch {}

        if (globalToken) {
            const res = await axios.get(`https://osu.ppy.sh/api/v2/users/${userId}/scores/pinned?mode=osu&limit=1`, {
                headers: {
                    "Authorization": `Bearer ${globalToken}`,
                    "x-api-version": "20240728"
                },
                timeout: 5000
            });
            if (res.data && res.data.length > 0) {
                return res.data[0];
            }
        }
    } catch {}

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

const { renderOsuCard, doOsuCardEmbed } = require("./osuCardViews.js");

/**
 * Renderiza la tarjeta de perfil en Canvas (compatibilidad hacia atrás para s.yo).
 */
async function renderYoCard(user, topScores = []) {
    return renderOsuCard(user, topScores);
}

/**
 * Genera el embed para la imagen YO.png o la imagen generada.
 * @param {any} message El mensaje u objeto de interacción de Discord
 * @param {string} imageName Nombre del archivo adjunto (por defecto YO.png)
 * @returns {EmbedBuilder}
 */
function doYoEmbed(message, imageName = "YO.png") {
    return doOsuCardEmbed(message, imageName);
}

module.exports = {
    doYoEmbed,
    renderYoCard
};

