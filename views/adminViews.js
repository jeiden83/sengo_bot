const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { EmbedBuilder } = require("discord.js");
const { createCanvas, loadImage, registerFont } = require("canvas");
const { getEmbedColor } = require("./osuViewHelpers.js");
const { getSupabaseClient } = require("../db/database.js");
const OsuScoreModel = require("../models/OsuScoreModel.js");
const BirthdayModel = require("../models/BirthdayModel.js");

// Registrar fuentes Poppins
const fontDir = path.join(process.cwd(), "assets/fonts");
if (fs.existsSync(path.join(fontDir, "Poppins-Regular.ttf"))) {
    registerFont(path.join(fontDir, "Poppins-Regular.ttf"), { family: "Poppins", weight: "normal", style: "normal" });
}
if (fs.existsSync(path.join(fontDir, "Poppins-SemiBold.ttf"))) {
    registerFont(path.join(fontDir, "Poppins-SemiBold.ttf"), { family: "Poppins", weight: "600", style: "normal" });
}
if (fs.existsSync(path.join(fontDir, "Poppins-Bold.ttf"))) {
    registerFont(path.join(fontDir, "Poppins-Bold.ttf"), { family: "Poppins", weight: "bold", style: "normal" });
}
if (fs.existsSync(path.join(fontDir, "Poppins-Italic.ttf"))) {
    registerFont(path.join(fontDir, "Poppins-Italic.ttf"), { family: "Poppins", weight: "normal", style: "italic" });
}
if (fs.existsSync(path.join(fontDir, "Poppins-BoldItalic.ttf"))) {
    registerFont(path.join(fontDir, "Poppins-BoldItalic.ttf"), { family: "Poppins", weight: "bold", style: "italic" });
}
if (fs.existsSync(path.join(fontDir, "Poppins-SemiBoldItalic.ttf"))) {
    registerFont(path.join(fontDir, "Poppins-SemiBoldItalic.ttf"), { family: "Poppins", weight: "600", style: "italic" });
}

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
function drawImageCover(ctx, img, x, y, w, h) {
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
        sy = (img.height - sh) / 2;
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
    const maxSkill = Math.max(skills.aim, skills.speed, skills.acc, skills.reading);
    if (pp > 16000 || maxSkill >= 80) prefix = "Legendary";
    else if (pp > 11000 || maxSkill >= 68) prefix = "Expert";
    else if (pp > 6500 || maxSkill >= 50) prefix = "Advanced";
    else if (pp > 3500 || maxSkill >= 38) prefix = "Seasoned";
    else if (pp > 1500 || maxSkill >= 26) prefix = "Intermediate";
    else if (pp > 500) prefix = "Competent";

    let descriptor = "Versatile";
    if (modStats.NM >= 55) descriptor = "Mod-Hating";
    else if (modStats.DT >= 40) descriptor = "Speedy";
    else if (modStats.HR >= 35) descriptor = "Ant-Clicking";
    else if (modStats.HD >= 45) descriptor = "HD-Abusing";
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
    if (g === "S" || g === "SH") return "#fbbf24";
    if (g === "A") return "#22c55e";
    if (g === "B") return "#3b82f6";
    if (g === "C") return "#a855f7";
    return "#ef4444";
}

/**
 * Renderiza la tarjeta de perfil en Canvas estilo YO (1300 x 720)
 * @param {any} user Datos del usuario de osu!
 * @param {Array} topScores Top scores del usuario
 * @returns {Promise<Buffer>} Buffer PNG de la imagen
 */
async function renderYoCard(user, topScores = []) {
    const width = 1300;
    const height = 720;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const countryCode = (user.country_code || user.country?.code || "VE").toUpperCase();
    const stats = user.statistics || {};
    const level = stats.level || { current: 100, progress: 0 };
    const globalRank = stats.global_rank ? `${Number(stats.global_rank).toLocaleString("de-DE")}` : "-";
    const countryRank = stats.rank?.country ? `${Number(stats.rank.country).toLocaleString("de-DE")}` : "-";
    const pp = Number(stats.pp || 0);
    const medalsCount = user.user_achievements ? user.user_achievements.length : 0;
    const totalMedals = 352;
    const medalsPct = Math.round((medalsCount / totalMedals) * 100);

    const sengoData = await fetchSengoData(user.id, countryCode);
    const skillData = analyzeSkills(topScores);
    const title = generateCardTitle(skillData, skillData.modStats, pp, user, sengoData);
    const pinnedPlay = await fetchPinnedScore(user.id, topScores);

    // 1. FONDO PRINCIPAL OSCURO VIOLETA
    ctx.fillStyle = "#0f0917";
    ctx.fillRect(0, 0, width, height);

    // Patrón sutil de puntos (Dotted background)
    ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
    const dotSpacing = 24;
    for (let x = 12; x < width; x += dotSpacing) {
        for (let y = 12; y < height; y += dotSpacing) {
            ctx.beginPath();
            ctx.arc(x, y, 1.3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // 2. CABECERA: TÍTULO SUPERIOR + HITCIRCLE
    ctx.fillStyle = "#ffffff";
    ctx.font = 'italic bold 28px "Poppins", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(title.line1, 550, 42);
    ctx.fillText(title.line2, 550, 78);

    // Hitcircle de osu!
    const circleX = 870;
    const circleY = 48;
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(circleX, circleY, 32, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#cbd5e1";
    ctx.beginPath();
    ctx.arc(circleX, circleY, 18, 0, Math.PI * 2);
    ctx.fill();

    // 3. BLOQUE IZQUIERDO: AVATAR + PROGRESIÓN
    const avatarX = 135;
    const avatarY = 118;
    const avatarSize = 270;

    // Avatar
    ctx.save();
    roundRect(ctx, avatarX, avatarY, avatarSize, avatarSize, 20);
    ctx.clip();
    const avatarImg = await fetchImageSafe(user.avatar_url);
    if (avatarImg) {
        drawImageCover(ctx, avatarImg, avatarX, avatarY, avatarSize, avatarSize);
    } else {
        ctx.fillStyle = "#2e1065";
        ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
    }
    ctx.restore();

    // Contenedor Level & Medals
    const progY = 405;
    const progH = 160;
    ctx.fillStyle = "rgba(20, 12, 32, 0.85)";
    roundRect(ctx, avatarX, progY, avatarSize, progH, 20, true);

    // Level
    ctx.fillStyle = "#ffffff";
    ctx.font = 'italic bold 24px "Poppins", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(`lvl ${level.current || 100}`, avatarX + (avatarSize / 2), progY + 42);

    const lvlBarX = avatarX + 15;
    const lvlBarW = avatarSize - 30;
    const lvlBarY = progY + 54;
    const lvlProg = Math.min(100, Math.max(0, level.progress || 0));

    ctx.fillStyle = "#2e253c";
    roundRect(ctx, lvlBarX, lvlBarY, lvlBarW, 8, 4, true);
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, lvlBarX, lvlBarY, Math.max(8, (lvlBarW * lvlProg) / 100), 8, 4, true);

    // Medals
    ctx.fillStyle = "#ffffff";
    ctx.font = 'italic bold 22px "Poppins", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(`Medals ${medalsPct}% ${medalsCount}/${totalMedals}`, avatarX + (avatarSize / 2), progY + 115);

    const medalBarY = progY + 128;
    ctx.fillStyle = "#2e253c";
    roundRect(ctx, lvlBarX, medalBarY, lvlBarW, 8, 4, true);

    const medalGrad = ctx.createLinearGradient(lvlBarX, 0, lvlBarX + lvlBarW, 0);
    medalGrad.addColorStop(0, "#60a5fa");
    medalGrad.addColorStop(0.5, "#ec4899");
    medalGrad.addColorStop(1, "#a855f7");
    ctx.fillStyle = medalGrad;
    roundRect(ctx, lvlBarX, medalBarY, Math.max(8, (lvlBarW * medalsPct) / 100), 8, 4, true);

    // 4. BLOQUE CENTRO-IZQUIERDA: TARJETA DE PERFIL Y RANKINGS
    const rankBoxX = 425;
    const rankBoxY = 118;
    const rankBoxSize = 270;

    ctx.fillStyle = "rgba(20, 12, 32, 0.85)";
    roundRect(ctx, rankBoxX, rankBoxY, rankBoxSize, rankBoxSize, 20, true);

    // Bandera y Nombre
    const flagW = 82;
    const flagH = 54;
    const flagX = rankBoxX + 18;
    const flagY = rankBoxY + 18;

    const flagUrl = `https://flagcdn.com/w160/${countryCode.toLowerCase()}.png`;
    const flagImg = await fetchImageSafe(flagUrl);
    if (flagImg) {
        ctx.save();
        roundRect(ctx, flagX, flagY, flagW, flagH, 8);
        ctx.clip();
        ctx.drawImage(flagImg, flagX, flagY, flagW, flagH);
        ctx.restore();
    }

    ctx.fillStyle = "#ffffff";
    ctx.font = 'bold 44px "Poppins", sans-serif';
    ctx.textAlign = "left";
    ctx.fillText(user.username, rankBoxX + 112, flagY + 42);

    // Global Rank
    ctx.fillStyle = "#cbd5e1";
    ctx.font = 'italic 22px "Poppins", sans-serif';
    ctx.textAlign = "center";
    const rankCenterX = rankBoxX + (rankBoxSize / 2);
    ctx.fillText("Global Rank", rankCenterX, rankBoxY + 115);

    ctx.fillStyle = "#ffffff";
    ctx.font = 'bold 54px "Poppins", sans-serif';
    ctx.fillText(globalRank, rankCenterX, rankBoxY + 168);

    // Country Rank
    ctx.fillStyle = "#cbd5e1";
    ctx.font = 'italic 22px "Poppins", sans-serif';
    ctx.fillText("Country", rankCenterX, rankBoxY + 208);

    ctx.fillStyle = "#ffffff";
    ctx.font = 'bold 50px "Poppins", sans-serif';
    ctx.fillText(countryRank, rankCenterX, rankBoxY + 254);

    // 5. BLOQUE SUPERIOR DERECHO: PINNED PLAY CARD
    const playBoxX = 715;
    const playBoxY = 118;
    const playBoxW = 450;
    const playBoxH = 270;

    ctx.save();
    roundRect(ctx, playBoxX, playBoxY, playBoxW, playBoxH, 20);
    ctx.clip();

    const coverUrl = pinnedPlay?.beatmapset?.covers?.["cover@2x"] || pinnedPlay?.beatmapset?.covers?.cover || "https://jeiden.s-ul.eu/3ssHl9Gd";
    const mapCoverImg = await fetchImageSafe(coverUrl);
    if (mapCoverImg) {
        drawImageCover(ctx, mapCoverImg, playBoxX, playBoxY, playBoxW, playBoxH);
    } else {
        ctx.fillStyle = "#1e1b4b";
        ctx.fillRect(playBoxX, playBoxY, playBoxW, playBoxH);
    }

    const playGrad = ctx.createLinearGradient(playBoxX, 0, playBoxX + playBoxW, 0);
    playGrad.addColorStop(0, "rgba(12, 8, 20, 0.88)");
    playGrad.addColorStop(0.55, "rgba(12, 8, 20, 0.70)");
    playGrad.addColorStop(1, "rgba(12, 8, 20, 0.45)");
    ctx.fillStyle = playGrad;
    ctx.fillRect(playBoxX, playBoxY, playBoxW, playBoxH);

    const mapTitle = pinnedPlay?.beatmapset?.title || "Ange du Blanc Pur";
    const mapArtist = pinnedPlay?.beatmapset?.artist || "ke-ji feat. Nanahira";
    const mapDiff = pinnedPlay?.beatmap?.version || "BMD's Absolution";
    const mapSR = pinnedPlay?.beatmap?.difficulty_rating ? Number(pinnedPlay.beatmap.difficulty_rating).toFixed(2) : "7.68";
    const scoreVal = pinnedPlay ? Number(pinnedPlay.total_score || pinnedPlay.score || 0).toLocaleString("de-DE") : "32.219.611";
    const scoreAcc = pinnedPlay ? (Number(pinnedPlay.accuracy || 0.96) * 100).toFixed(2) : "96.12";
    const scoreCombo = pinnedPlay?.max_combo ? `${pinnedPlay.max_combo}x` : "262x";
    const scoreGrade = pinnedPlay?.rank || "A";

    ctx.fillStyle = "#ffffff";
    ctx.font = 'italic 600 20px "Poppins", sans-serif';
    ctx.textAlign = "left";
    ctx.fillText(`${mapTitle} by ${mapArtist}`.slice(0, 42), playBoxX + 16, playBoxY + 34);

    ctx.font = 'italic 600 22px "Poppins", sans-serif';
    ctx.fillText(`${mapDiff} ${mapSR}`.slice(0, 28), playBoxX + 16, playBoxY + 76);

    ctx.fillStyle = "#cbd5e1";
    ctx.font = 'italic 17px "Poppins", sans-serif';
    ctx.textAlign = "right";
    ctx.fillText(`${scoreVal} Score`, playBoxX + playBoxW - 16, playBoxY + 76);

    ctx.fillStyle = getGradeColor(scoreGrade);
    ctx.font = 'bold 74px "Poppins", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(scoreGrade, playBoxX + 80, playBoxY + 175);

    const mods = Array.isArray(pinnedPlay?.mods)
        ? pinnedPlay.mods.map(m => (typeof m === "string" ? m : m.acronym || "")).filter(Boolean)
        : ["HD", "DT"];
    
    let modX = playBoxX + 20;
    for (const mod of mods.slice(0, 3)) {
        ctx.fillStyle = mod === "DT" || mod === "NC" ? "#f87171" : (mod === "HD" ? "#a3e635" : "#38bdf8");
        roundRect(ctx, modX, playBoxY + 205, 52, 32, 16, true);
        ctx.fillStyle = "#000000";
        ctx.font = 'bold 15px "Poppins", sans-serif';
        ctx.textAlign = "center";
        ctx.fillText(mod, modX + 26, playBoxY + 227);
        modX += 60;
    }

    ctx.fillStyle = "#cbd5e1";
    ctx.font = 'italic 18px "Poppins", sans-serif';
    ctx.textAlign = "right";
    ctx.fillText(`${scoreAcc}%`, playBoxX + playBoxW - 16, playBoxY + 155);
    ctx.fillText(`${scoreCombo}`, playBoxX + playBoxW - 16, playBoxY + 225);

    ctx.restore();

    // 6. BLOQUE MEDIO: ESTADÍSTICAS Y 4 BARRAS DE SKILLS
    const statsBoxX = 425;
    const statsBoxY = 405;
    const statsBoxW = 740;
    const statsBoxH = 160;

    ctx.fillStyle = "rgba(20, 12, 32, 0.85)";
    roundRect(ctx, statsBoxX, statsBoxY, statsBoxW, statsBoxH, 20, true);

    ctx.fillStyle = "#ffffff";
    ctx.font = 'italic 500 18px "Poppins", sans-serif';
    ctx.textAlign = "left";
    ctx.fillText(`Total Score: ${Number(stats.total_score || 64030148109).toLocaleString()}`, statsBoxX + 22, statsBoxY + 42);
    ctx.fillText(`Accuracy: ${Number(stats.hit_accuracy || 98.12).toFixed(2)}%`, statsBoxX + 42, statsBoxY + 90);
    ctx.fillText(`Playcount ${Number(stats.play_count || 41795).toLocaleString()}`, statsBoxX + 42, statsBoxY + 138);

    const skillsList = [
        { label: "ACC", val: skillData.acc, x: statsBoxX + 325 },
        { label: "AIM", val: skillData.aim, x: statsBoxX + 430 },
        { label: "SPEED", val: skillData.speed, x: statsBoxX + 535 },
        { label: "READING", val: skillData.reading, x: statsBoxX + 645 }
    ];

    const pillarW = 24;
    const pillarH = 65;
    const pillarY = statsBoxY + 40;

    skillsList.forEach(s => {
        ctx.fillStyle = "#ffffff";
        ctx.font = 'bold 22px "Poppins", sans-serif';
        ctx.textAlign = "center";
        ctx.fillText(String(s.val), s.x, statsBoxY + 30);

        ctx.fillStyle = "#261b33";
        roundRect(ctx, s.x - (pillarW / 2), pillarY, pillarW, pillarH, 4, true);

        const fillRatio = Math.min(1, Math.max(0.08, s.val / 100));
        const fillH = pillarH * fillRatio;
        ctx.fillStyle = "#ffffff";
        roundRect(ctx, s.x - (pillarW / 2), pillarY + pillarH - fillH, pillarW, fillH, 4, true);

        ctx.fillStyle = "#ffffff";
        ctx.font = 'italic bold 18px "Poppins", sans-serif';
        ctx.fillText(s.label, s.x, statsBoxY + 138);
    });

    // 7. BLOQUE INFERIOR: ECOSISTEMA SENGO Y LOCAL STATS
    const sengoBoxX = 135;
    const sengoBoxY = 580;
    const sengoBoxW = 1030;
    const sengoBoxH = 75;

    ctx.fillStyle = "rgba(20, 12, 32, 0.85)";
    roundRect(ctx, sengoBoxX, sengoBoxY, sengoBoxW, sengoBoxH, 18, true);

    ctx.fillStyle = "#e2e8f0";
    ctx.font = 'italic 17px "Poppins", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("Sengo ecosystem & local stats", sengoBoxX + (sengoBoxW / 2), sengoBoxY + 26);

    const bdayStr = sengoData.birthday ? `${sengoData.birthday}` : "unknown";
    const skinStr = sengoData.skinName ? `${sengoData.skinName}` : "Unknown";
    const topPPStr = skillData.topPlayPP ? `${skillData.topPlayPP}` : "666";
    const snipesCount = sengoData.nationalTopsCount || "0";
    const snipesMade = sengoData.snipesMade || "0";

    ctx.fillStyle = "#ffffff";
    ctx.font = 'italic 17px "Poppins", sans-serif';
    ctx.fillText(
        `#1 ${snipesCount} ${countryCode}        Top pp: ${topPPStr}        Birthday: ${bdayStr}        Snipes: ${snipesMade}        Skin: ${skinStr}`,
        sengoBoxX + (sengoBoxW / 2),
        sengoBoxY + 58
    );

    // 8. FOOTER: BRANDING & FECHA
    const today = new Date().toISOString().split("T")[0];
    ctx.fillStyle = "#ffffff";
    ctx.font = 'italic bold 26px "Poppins", sans-serif';
    ctx.textAlign = "right";
    ctx.fillText("SengoBot", 580, 700);

    ctx.fillStyle = "#cbd5e1";
    ctx.font = 'italic 22px "Poppins", sans-serif';
    ctx.textAlign = "left";
    ctx.fillText(today, 630, 700);

    return canvas.toBuffer("image/png");
}

/**
 * Genera el embed para la imagen YO.png o la imagen generada.
 * @param {any} message El mensaje u objeto de interacción de Discord
 * @param {string} imageName Nombre del archivo adjunto (por defecto YO.png)
 * @returns {EmbedBuilder}
 */
function doYoEmbed(message, imageName = "YO.png") {
    const embedColor = getEmbedColor(message);
    return new EmbedBuilder()
        .setColor(embedColor)
        .setImage(`attachment://${imageName}`);
}

module.exports = {
    doYoEmbed,
    renderYoCard
};
