/**
 * models/SkillsModel.js
 * Motor analítico de descomposición de habilidades y cinemática de mapas de osu!.
 * Soporta los 4 modos: osu! (Standard), Taiko, Catch (Fruits) y Mania.
 */

/**
 * Función de mapeo asintótico calibrada para normalizar la maestría a escala 0-100.
 * Satura hacia 99-100 en desempeños sobrehumanos y escala de forma fluida en rangos intermedios.
 */
function mapToSkillCurve(val) {
    if (!val || val <= 0) return 0;
    const factor = Math.pow(8.0 / (val / 72.0 + 8.0), 10);
    return Math.min(100, Math.max(0, -101.0 * factor + 101.0));
}

/**
 * Calcula el Acc PP estimado a partir del OD, precisión y cantidad de objetos.
 * Basado en la formulación de rendimiento de osu! estándar.
 */
function estimateAccPP(od, accPct, totalHits, isHR, isEZ, isDT, isHT) {
    const acc = Math.max(0, Math.min(100, accPct)) / 100;
    if (acc < 0.8) return 0;
    // ponytail: Cálculo nativo del OD efectivo según ventana de impacto 300 (HitWindow300)
    let hitWindow300 = 80 - 6 * od;
    if (isEZ) hitWindow300 = 80 - 6 * (od * 0.5);
    if (isHR) hitWindow300 = 80 - 6 * Math.min(10, od * 1.4);

    if (isDT) hitWindow300 /= 1.5;
    if (isHT) hitWindow300 /= 0.75;

    const effOD = Math.max(0, Math.min(11.1, (80 - hitWindow300) / 6));
    const nObjects = Math.max(1, totalHits || 1000);
    const lengthBonus = Math.min(1.15, Math.pow(nObjects / 1500, 0.3));
    return Math.pow(1.52163, effOD) * Math.pow((acc - 0.8) / 0.2, 2.4) * lengthBonus * 2.83;
}

// ponytail: Fórmulas analíticas de descomposición de habilidades para Taiko, Catch y Mania
function calculateTaikoSkillsForScore(s) {
    const pp = Number(s.pp || 0);
    const accuracy = Number(s.accuracy != null ? s.accuracy : 0.98);
    const accPct = accuracy <= 1 ? accuracy * 100 : accuracy;

    const modsList = Array.isArray(s.mods)
        ? s.mods.map(m => (typeof m === "string" ? m : m.acronym || "")).filter(Boolean)
        : (typeof s.mods === "string" ? s.mods.match(/.{1,2}/g) || [] : []);
    const upperMods = modsList.map(m => m.toUpperCase());
    const modsSet = new Set(upperMods);

    const isDT = modsSet.has("DT") || modsSet.has("NC");
    const isHT = modsSet.has("HT") || modsSet.has("DC");
    const isHR = modsSet.has("HR");
    const isEZ = modsSet.has("EZ");
    const isHD = modsSet.has("HD");
    const isFL = modsSet.has("FL");

    const bpm = Number(s.beatmap?.bpm || 180);
    const od = Number(s.beatmap?.accuracy || 7.0);
    const circles = Number(s.beatmap?.count_circles || 0);
    const hitLength = Math.max(20, Number(s.beatmap?.hit_length || 100));

    const effBPM = bpm * (isDT ? 1.5 : (isHT ? 0.75 : 1.0));
    const effLen = hitLength / (isDT ? 1.5 : (isHT ? 0.75 : 1.0));
    const density = circles / Math.max(1, effLen);

    let effOD = od;
    if (isHR) effOD = Math.min(10, od * 1.4);
    if (isEZ) effOD = od * 0.5;
    if (isDT) effOD = Math.min(11.1, effOD * 1.11);
    const lengthBonus = Math.min(1.2, Math.pow(circles / 1200, 0.25));
    const rawAccPP = Math.pow(1.42, effOD) * Math.pow(Math.max(0, (accPct - 80) / 20), 2.6) * lengthBonus * 2.6;

    const strainPP = Math.max(1, Math.pow(Math.max(0, Math.pow(pp, 1.1) - Math.pow(Math.min(rawAccPP, pp * 0.4), 1.1)), 1 / 1.1));

    const bpmSpeedFactor = Math.max(0, Math.min(1.0, (effBPM - 160) / 100));
    const densityFactor = Math.max(0, Math.min(1.0, (density - 3.5) / 4.0));
    const circleBonus = circles >= 1000 ? Math.min(0.3, (circles - 800) / 2000) : 0;
    const staminaShare = Math.max(0.2, Math.min(0.85, (bpmSpeedFactor * 0.55) + (densityFactor * 0.45) + circleBonus));
    const rawStaminaPP = strainPP * staminaShare;

    const colorShare = Math.max(0.15, Math.min(0.75, 1.0 - staminaShare * 0.7 + (isHD ? 0.08 : 0)));
    const rawColorPP = strainPP * colorShare;

    const stars = Number(s.beatmap?.difficulty_rating || 5.0);
    const rhythmFactor = Math.max(0.2, Math.min(0.9, (stars / 9.0) * 0.7 + (effOD / 10) * 0.3));
    const rawRhythmPP = (rawStaminaPP * 0.4 + rawColorPP * 0.4) * rhythmFactor * (isFL ? 1.25 : 1.0);

    const playStamina = mapToSkillCurve(rawStaminaPP / 3.0);
    const playColor = mapToSkillCurve(rawColorPP / 2.6);
    const playRhythm = mapToSkillCurve(rawRhythmPP / 2.4);
    const playAcc = mapToSkillCurve(rawAccPP / 1.2);

    return {
        skills: { stamina: playStamina, color: playColor, rhythm: playRhythm, acc: playAcc },
        scaledRaw: {
            stamina: rawStaminaPP / 3.0,
            color: rawColorPP / 2.6,
            rhythm: rawRhythmPP / 2.4,
            acc: rawAccPP / 1.2
        }
    };
}

function calculateCatchSkillsForScore(s) {
    const pp = Number(s.pp || 0);
    const accuracy = Number(s.accuracy != null ? s.accuracy : 1.0);
    const accPct = accuracy <= 1 ? accuracy * 100 : accuracy;

    const modsList = Array.isArray(s.mods)
        ? s.mods.map(m => (typeof m === "string" ? m : m.acronym || "")).filter(Boolean)
        : (typeof s.mods === "string" ? s.mods.match(/.{1,2}/g) || [] : []);
    const upperMods = modsList.map(m => m.toUpperCase());
    const modsSet = new Set(upperMods);

    const isDT = modsSet.has("DT") || modsSet.has("NC");
    const isHT = modsSet.has("HT") || modsSet.has("DC");
    const isHR = modsSet.has("HR");
    const isEZ = modsSet.has("EZ");
    const isHD = modsSet.has("HD");
    const isFL = modsSet.has("FL");

    const cs = Number(s.beatmap?.cs || 4.0);
    const ar = Number(s.beatmap?.ar || 9.0);
    const bpm = Number(s.beatmap?.bpm || 180);
    const circles = Number(s.beatmap?.count_circles || 0);
    const sliders = Number(s.beatmap?.count_sliders || 0);
    const hitLength = Math.max(20, Number(s.beatmap?.hit_length || 100));

    const effBPM = bpm * (isDT ? 1.5 : (isHT ? 0.75 : 1.0));
    const effLen = hitLength / (isDT ? 1.5 : (isHT ? 0.75 : 1.0));
    const effCS = isHR ? Math.min(10, cs * 1.3) : (isEZ ? cs * 0.5 : cs);
    const plateScale = Math.max(0.6, effCS / 4.0);

    let effAR = ar;
    if (isHR) effAR = Math.min(10, ar * 1.4);
    if (isEZ) effAR = ar * 0.5;
    if (isDT) effAR = ar <= 5 ? (5 + (ar * 0.75)) : (5 + (ar - 5) * 0.75 * (2 / 3) + 2.5);

    const dropletLoss = Math.max(0, 100 - accPct);
    const precisionFactor = Math.pow(Math.max(0, 1 - (dropletLoss * 1.5)), 3);
    const rawPrecisionPP = (pp * 0.28) * precisionFactor * Math.min(1.2, Math.pow((circles + sliders) / 1000, 0.2));

    const movementShare = 0.55 * plateScale;
    const rawMovementPP = pp * movementShare;

    const hyperSpeedFactor = Math.max(0, Math.min(1.2, (effBPM - 170) / 90)) * (isDT ? 1.25 : 1.0);
    const rawSpeedPP = pp * (0.35 + hyperSpeedFactor * 0.25);

    let readingMult = 1.0;
    if (isHD) readingMult *= 1.22;
    if (isFL) readingMult *= 1.60;
    if (isEZ) readingMult *= 1.45;
    if (effAR > 10.0) readingMult *= (1 + (effAR - 10.0) * 0.12);
    else if (effAR < 8.5) readingMult *= (1 + (8.5 - effAR) * 0.09);
    const rawReadingPP = (rawMovementPP * 0.45 + rawSpeedPP * 0.45) * readingMult;

    const playMovement = mapToSkillCurve(rawMovementPP / 4.2);
    const playSpeed = mapToSkillCurve(rawSpeedPP / 3.2);
    const playPrecision = mapToSkillCurve(rawPrecisionPP / 1.1);
    const playReading = mapToSkillCurve(rawReadingPP / 3.4);

    return {
        skills: { movement: playMovement, speed: playSpeed, acc: playPrecision, reading: playReading },
        scaledRaw: {
            movement: rawMovementPP / 4.2,
            speed: rawSpeedPP / 3.2,
            acc: rawPrecisionPP / 1.1,
            reading: rawReadingPP / 3.4
        }
    };
}

function calculateManiaSkillsForScore(s) {
    const pp = Number(s.pp || 0);
    const accuracy = Number(s.accuracy != null ? s.accuracy : 0.98);
    const accPct = accuracy <= 1 ? accuracy * 100 : accuracy;

    const modsList = Array.isArray(s.mods)
        ? s.mods.map(m => (typeof m === "string" ? m : m.acronym || "")).filter(Boolean)
        : (typeof s.mods === "string" ? s.mods.match(/.{1,2}/g) || [] : []);
    const upperMods = modsList.map(m => m.toUpperCase());
    const modsSet = new Set(upperMods);

    const isDT = modsSet.has("DT") || modsSet.has("NC");
    const isHT = modsSet.has("HT") || modsSet.has("DC");
    const isHD = modsSet.has("HD");
    const isFL = modsSet.has("FL");

    const cs = Number(s.beatmap?.cs || 4);
    const od = Number(s.beatmap?.accuracy || 8.0);
    const bpm = Number(s.beatmap?.bpm || 160);
    const circles = Number(s.beatmap?.count_circles || 0);
    const sliders = Number(s.beatmap?.count_sliders || 0);
    const totalObj = Math.max(1, circles + sliders);
    const hitLength = Math.max(20, Number(s.beatmap?.hit_length || 100));

    const effBPM = bpm * (isDT ? 1.5 : (isHT ? 0.75 : 1.0));
    const effLen = hitLength / (isDT ? 1.5 : (isHT ? 0.75 : 1.0));
    const nps = totalObj / effLen;

    const lnRatio = sliders / totalObj;

    const accFactor = Math.pow(Math.max(0, (accPct - 85) / 15), 3);
    const rawAccPP = (pp * 0.25) * accFactor * Math.pow(1.15, od);

    const speedRatio = Math.max(0.1, 1.0 - lnRatio * 0.8);
    const npsFactor = Math.max(0.2, Math.min(1.3, (nps - 6) / 10));
    const rawStreamPP = pp * (0.45 * speedRatio + npsFactor * 0.2);

    const chordDensity = Math.max(0.2, Math.min(1.2, (totalObj / (effBPM * (effLen / 60))) / 1.5));
    const rawJackPP = pp * (0.40 * chordDensity + (cs >= 7 ? 0.15 : 0));

    const lnFactor = Math.min(1.5, lnRatio * 2.8 + 0.15);
    const rawTechPP = pp * (0.35 * lnFactor + (isHD ? 0.1 : 0) + (isFL ? 0.15 : 0));

    const playStream = mapToSkillCurve(rawStreamPP / 4.0);
    const playJack = mapToSkillCurve(rawJackPP / 3.8);
    const playAcc = mapToSkillCurve(rawAccPP / 1.5);
    const playTech = mapToSkillCurve(rawTechPP / 3.2);

    return {
        skills: { stream: playStream, jack: playJack, acc: playAcc, tech: playTech },
        scaledRaw: {
            stream: rawStreamPP / 4.0,
            jack: rawJackPP / 3.8,
            acc: rawAccPP / 1.5,
            tech: rawTechPP / 3.2
        },
        keymode: `${cs}K`
    };
}

/**
 * Analiza skills del jugador a partir de sus mejores puntuaciones mediante
 * descomposición cinético-analítica de PP y curva de saturación de maestría.
 * Soporta modos: osu (Standard), taiko, fruits (Catch) y mania.
 */
function analyzeSkills(scores, returnBreakdown = false, mode = "osu") {
    let normMode = (mode || "osu").toLowerCase();
    if (normMode === "std") normMode = "osu";
    if (normMode === "catch" || normMode === "ctb") normMode = "fruits";

    const MODE_SKILLS = {
        osu: ["aim", "speed", "acc", "reading"],
        taiko: ["stamina", "color", "rhythm", "acc"],
        fruits: ["movement", "speed", "acc", "reading"],
        mania: ["stream", "jack", "acc", "tech"]
    };
    const skillKeys = MODE_SKILLS[normMode] || MODE_SKILLS.osu;

    if (!scores || scores.length === 0) {
        const defaultStats = {
            modStats: { NM: 100 },
            topPlayPP: 0,
            mode: normMode,
            skillKeys
        };
        skillKeys.forEach(k => {
            defaultStats[k] = k === "acc" ? 50.00 : 35.00;
            if (returnBreakdown) {
                const capKey = k.charAt(0).toUpperCase() + k.slice(1);
                defaultStats[`top${capKey}`] = [];
            }
        });
        return defaultStats;
    }

    let dtWeight = 0, hrWeight = 0, hdWeight = 0, flWeight = 0, nmWeight = 0, ezWeight = 0, htWeight = 0;
    const rawSums = {};
    skillKeys.forEach(k => { rawSums[k] = 0; });
    let totalWeight = 0;
    const scoredPlays = [];
    const keyCounts = {};

    const AIM_NERF = 3.7;
    const SPEED_NERF = 2.5;
    const ACC_NERF = 1.1;
    const READING_NERF = 2.4;

    for (let i = 0; i < scores.length; i++) {
        const s = scores[i];
        const weight = Math.pow(0.95, i);
        totalWeight += weight;

        const modsList = Array.isArray(s.mods)
            ? s.mods.map(m => (typeof m === "string" ? m : m.acronym || "")).filter(Boolean)
            : (typeof s.mods === "string" ? s.mods.match(/.{1,2}/g) || [] : []);
        const upperMods = modsList.map(m => m.toUpperCase());
        const modsSet = new Set(upperMods);

        // ponytail: ponderación exponencial con decaimiento de PP (0.95^i) para reflejar la maestría real en mods sin sesgo de jugadas de relleno del fondo
        const gameplayMods = upperMods.filter(m => m !== "CL" && m !== "NM" && m !== "NF" && m !== "SD" && m !== "PF");
        if (gameplayMods.length === 0) nmWeight += weight;
        if (modsSet.has("DT") || modsSet.has("NC")) dtWeight += weight;
        if (modsSet.has("HT") || modsSet.has("DC")) htWeight += weight;
        if (modsSet.has("HR")) hrWeight += weight;
        if (modsSet.has("HD")) hdWeight += weight;
        if (modsSet.has("FL")) flWeight += weight;
        if (modsSet.has("EZ")) ezWeight += weight;

        let playSkills = {};
        let scaledRaw = {};

        if (normMode === "taiko") {
            const res = calculateTaikoSkillsForScore(s);
            playSkills = res.skills;
            scaledRaw = res.scaledRaw;
        } else if (normMode === "fruits") {
            const res = calculateCatchSkillsForScore(s);
            playSkills = res.skills;
            scaledRaw = res.scaledRaw;
        } else if (normMode === "mania") {
            const res = calculateManiaSkillsForScore(s);
            playSkills = res.skills;
            scaledRaw = res.scaledRaw;
            if (res.keymode) {
                keyCounts[res.keymode] = (keyCounts[res.keymode] || 0) + weight;
            }
        } else {
            // osu! Standard
            const pp = Number(s.pp || 0);
            const accuracy = Number(s.accuracy != null ? s.accuracy : 0.98);
            const accPct = accuracy <= 1 ? accuracy * 100 : accuracy;

            const isDT = modsSet.has("DT") || modsSet.has("NC");
            const isHT = modsSet.has("HT") || modsSet.has("DC");
            const isHR = modsSet.has("HR");
            const isHD = modsSet.has("HD");
            const isEZ = modsSet.has("EZ");
            const isFL = modsSet.has("FL");

            const bpm = Number(s.beatmap?.bpm || 180);
            const ar = Number(s.beatmap?.ar || 9.0);
            const od = Number(s.beatmap?.accuracy || 8.0);
            const circles = Number(s.beatmap?.count_circles || 0);
            const sliders = Number(s.beatmap?.count_sliders || 0);
            const totalObj = Math.max(1, circles + sliders);

            const effBPM = bpm * (isDT ? 1.5 : (isHT ? 0.75 : 1.0));
            const effLen = Math.max(20, Number(s.beatmap?.hit_length || 100)) / (isDT ? 1.5 : (isHT ? 0.75 : 1.0));

            const beats = (effLen / 60) * effBPM;
            const notesPerBeat = beats > 0 ? (totalObj / beats) : 1.5;
            const circleRatio = circles / totalObj;

            // 1. Acc PP estimado
            let rawAccPP = estimateAccPP(od, accPct, totalObj, isHR, isEZ, isDT, isHT);
            rawAccPP = Math.min(rawAccPP, pp * 0.28);

            // 2. Strain PP total
            const strainPP = Math.max(1, Math.pow(Math.max(0, Math.pow(pp, 1.1) - Math.pow(rawAccPP, 1.1)), 1 / 1.1));

            // 3. Descomposición rítmica en Aim y Speed calibrada con sengo-pp
            // ponytail: formulación física continua basada en el intervalo dt entre notas (BPM efectivo y densidad rítmica).
            // Evita colapsos a 0 en mapas rápidos con descansos y permite hasta 66% de speed en streams extremos (>300 BPM).
            const circlesPerBeat = beats > 0 ? (circles / beats) : 1.0;
            const bpmFactor = Math.max(0, (effBPM - 148) / 105);
            const rhythmDensity = Math.max(0.40, Math.min(1.4, (circlesPerBeat + circleRatio) / 1.7));

            // Aceleración de tapping a velocidades altas (>220 BPM)
            let highBpmMultiplier = 1.0;
            if (effBPM > 220) {
                highBpmMultiplier += Math.pow((effBPM - 220) / 75, 1.25) * 0.70;
            }

            // Stamina en maratones de streams continuos
            const staminaBonus = (circles >= 750 && effBPM >= 170)
                ? Math.min(0.20, (circles - 600) / 1400) * bpmFactor
                : 0;

            // Fracción base según el BPM efectivo
            let baselineFraction = 0.04 + Math.max(0, (effBPM - 155) / 145) * 0.22;
            if (isHR) baselineFraction *= 0.82;
            if (isEZ && !isDT) baselineFraction *= 0.70;
            if (isHT) baselineFraction *= 0.40;

            let speedFraction = baselineFraction + (bpmFactor * 0.18 * rhythmDensity * highBpmMultiplier) + staminaBonus;

            // Deathstreams en maratones EZ (ej: Ice Angel, Crimsonic dimension)
            const isEZStreamHeavy = isEZ && !isDT && circles >= 1500 && circleRatio >= 0.80 && effBPM >= 145;
            if (isEZStreamHeavy) {
                speedFraction = Math.max(speedFraction, 0.22);
            }

            // Mapas cortos de jump farm puros (<60s y pocos círculos)
            if (circles < 300 && effLen < 60 && circlesPerBeat < 1.15) {
                speedFraction = Math.min(0.12, speedFraction * 0.45);
            }
            if (isHR && circlesPerBeat < 1.15) {
                speedFraction = Math.min(0.14, speedFraction * 0.70);
            }

            // Mapas de slider jumps largos con baja proporción de círculos
            if (sliders >= 350 && circleRatio < 0.65) {
                speedFraction *= 0.75;
            }

            // Techo dinámico de speed strain (hasta 66% en mapas extremos de 330 BPM)
            const maxAllowed = Math.min(0.66, 0.35 + Math.max(0, (effBPM - 190) / 180) * 0.31);
            speedFraction = Math.max(0.04, Math.min(maxAllowed, speedFraction));

            let aimFraction = Math.max(0.25, 1.0 - (speedFraction * 0.72));
            if (isHR) aimFraction = Math.min(1.0, aimFraction + 0.05);
            if (isHD) aimFraction = Math.min(1.0, aimFraction + 0.02);
            if (isEZStreamHeavy) {
                aimFraction = 0.11;
            } else if (isEZ) {
                aimFraction = Math.max(0.15, aimFraction * 0.72);
            }

            const rawAimPP = strainPP * aimFraction;
            const rawSpeedPP = strainPP * speedFraction;

            // 4. Reading PP calibrado para todos los mods rankeables (HD, FL, EZ, HT, DT, HR, NM)
            const clockRate = isDT ? 1.5 : (isHT ? 0.75 : 1.0);
            let baseAR = ar;
            if (isHR) baseAR = Math.min(10, ar * 1.4);
            if (isEZ) baseAR = ar * 0.5;

            // Approach time exacto en milisegundos según el estándar de osu!
            const baseMs = baseAR <= 5 ? (1800 - 120 * baseAR) : (1200 - 150 * (baseAR - 5));
            const effMs = baseMs / clockRate;
            const effAR = effMs > 1200 ? ((1800 - effMs) / 120) : (5 + (1200 - effMs) / 150);

            const nps = totalObj / effLen;

            // Estrellas de lectura estimadas (readingStars):
            let estimatedReadingStars = 0.5;
            if (isEZ) {
                // En EZ la densidad es masiva; AR baja (<5) genera superposición densa de notas
                estimatedReadingStars = 3.2 + Math.max(0, 5.0 - effAR) * 0.18;
                if (isHD) estimatedReadingStars += 0.40;
                if (isHT) estimatedReadingStars += 0.35;
            } else if (isHD) {
                // Con Hidden las notas desaparecen mientras aparecen otras
                const densityFactor = Math.min(1.0, nps / 6.0);
                estimatedReadingStars = 1.6 + densityFactor * 0.9;
                if (effAR < 9.0) estimatedReadingStars += (9.0 - effAR) * 0.20;
                else if (effAR > 10.3) estimatedReadingStars = Math.max(0.7, estimatedReadingStars - (effAR - 10.3) * 0.45);
            } else if (effAR < 8.0) {
                // Baja AR sin EZ (ej: mapas clásicos viejos o AR baja con HT/NM)
                estimatedReadingStars = 0.9 + (8.0 - effAR) * 0.35;
                if (isHT) estimatedReadingStars += 0.30;
            } else {
                // Mapas normales NM/HR/DT (a mayor AR menor lectura de superposición)
                estimatedReadingStars = Math.max(0.3, 1.1 - Math.max(0, effAR - 9.0) * 0.30);
            }

            // Dificultad de Flashlight (FL): memorización y haz visual reducido
            let estimatedFLStars = 0;
            if (isFL) {
                const combo = Number(s.max_combo || totalObj);
                estimatedFLStars = 2.2 + Math.min(2.5, Math.log10(Math.max(10, combo)) * 1.2);
                if (isHD) estimatedFLStars += 0.50;
            }

            const effectiveReadingStars = Math.max(estimatedReadingStars, estimatedFLStars * 0.95);

            // Escalamiento exponencial a PP de lectura calibrado con sengo-pp:
            const lengthReadingBonus = Math.min(1.35, Math.pow(totalObj / 600, 0.25));
            const accMultiplier = Math.pow(Math.max(0.5, accPct / 100), 2.5);

            const rawReadingPP = Math.pow(effectiveReadingStars, 3.75) * 1.35 * lengthReadingBonus * accMultiplier;

            playSkills = {
                aim: mapToSkillCurve(rawAimPP / AIM_NERF),
                speed: mapToSkillCurve(rawSpeedPP / SPEED_NERF),
                acc: mapToSkillCurve(rawAccPP / ACC_NERF),
                reading: mapToSkillCurve(rawReadingPP / READING_NERF)
            };

            scaledRaw = {
                aim: rawAimPP / AIM_NERF,
                speed: rawSpeedPP / SPEED_NERF,
                acc: rawAccPP / ACC_NERF,
                reading: rawReadingPP / READING_NERF
            };
        }

        s.skills = playSkills;

        if (returnBreakdown) {
            scoredPlays.push({
                score: s,
                ...playSkills
            });
        }

        skillKeys.forEach(k => {
            rawSums[k] += (scaledRaw[k] || 0) * weight;
        });
    }

    const total = scores.length;
    const topPlayPP = Math.round(Number(scores[0]?.pp || 0));

    const weightDivisor = totalWeight > 0 ? totalWeight : total;
    const result = {
        topPlayPP,
        mode: normMode,
        skillKeys,
        modStats: {
            DT: Math.round((dtWeight / weightDivisor) * 100),
            HD: Math.round((hdWeight / weightDivisor) * 100),
            HR: Math.round((hrWeight / weightDivisor) * 100),
            NM: Math.round((nmWeight / weightDivisor) * 100),
            FL: Math.round((flWeight / weightDivisor) * 100),
            EZ: Math.round((ezWeight / weightDivisor) * 100),
            HT: Math.round((htWeight / weightDivisor) * 100)
        }
    };

    skillKeys.forEach(k => {
        const avg = totalWeight > 0 ? (rawSums[k] / totalWeight) : 35.0;
        result[k] = Number(mapToSkillCurve(avg).toFixed(2));
    });

    if (normMode === "mania") {
        const dominant = Object.entries(keyCounts).sort((a, b) => b[1] - a[1])[0];
        if (dominant) {
            result.keymodeInfo = {
                mode: dominant[0],
                pct: Math.round((dominant[1] / weightDivisor) * 100)
            };
        }
    }

    if (returnBreakdown) {
        skillKeys.forEach(k => {
            const capKey = k.charAt(0).toUpperCase() + k.slice(1);
            result[`top${capKey}`] = scoredPlays.slice().sort((a, b) => (b[k] || 0) - (a[k] || 0)).slice(0, 6);
        });
    }

    return result;
}

/**
 * Realiza el desglose completo de habilidades para el comando .skills,
 * calculando las estrellas exactas con mods para el Top 3 de cada habilidad.
 */
async function analyzeSkillsBreakdown(scores, mode = "osu") {
    const base = analyzeSkills(scores, true, mode);
    const skillKeys = base.skillKeys || ["aim", "speed", "acc", "reading"];
    if (!scores || scores.length === 0) {
        const emptyResult = { ...base, averageStars: {} };
        skillKeys.forEach(k => {
            const capKey = k.charAt(0).toUpperCase() + k.slice(1);
            emptyResult[`top${capKey}`] = [];
            emptyResult.averageStars[k] = 0;
        });
        return emptyResult;
    }

    const { getBeatmap, getBeatmap_osu } = require('../commands/utils/osu.js');
    const ppEngine = require('../utils/ppEngine.js');
    const engine = ppEngine.getEngine();

    const AIM_NERF = 3.7;
    const SPEED_NERF = 2.5;
    const ACC_NERF = 1.1;
    const READING_NERF = 2.4;

    // Recolectar candidatos: Top 10 por habilidad analítica + Top 20 jugadas por PP global
    const candidateScoreMap = new Map();
    skillKeys.forEach(k => {
        const capKey = k.charAt(0).toUpperCase() + k.slice(1);
        (base[`top${capKey}`] || []).slice(0, 10).forEach(item => {
            if (item.score?.beatmap?.id) {
                candidateScoreMap.set(item.score.beatmap.id, item.score);
            }
        });
    });
    scores.slice(0, 20).forEach(s => {
        if (s.beatmap?.id) candidateScoreMap.set(s.beatmap.id, s);
    });

    const MODE_INT = { osu: 0, taiko: 1, fruits: 2, catch: 2, ctb: 2, mania: 3 };
    const targetModeInt = MODE_INT[base.mode] ?? 0;

    const calculatedData = new Map();
    await Promise.all(Array.from(candidateScoreMap.entries()).map(async ([bmId, score]) => {
        try {
            const beatmap = await getBeatmap(bmId);
            const map = await getBeatmap_osu(score.beatmap.beatmapset_id, bmId, beatmap);
            if (targetModeInt !== 0 && typeof map.convert === "function") {
                map.convert(targetModeInt);
            }
            const modsList = Array.isArray(score.mods)
                ? score.mods.map(m => (typeof m === "string" ? m : m.acronym || "")).filter(m => m !== "CL" && Boolean(m))
                : (typeof score.mods === "string" ? score.mods.match(/.{1,2}/g) || [] : []);
            const diffAttrs = new engine.Difficulty({ mods: modsList, lazer: true, mode: targetModeInt }).calculate(map);

            const playData = {
                stars: diffAttrs.stars
            };

            // ponytail: Para osu! standard, calculamos exactamente el Aim, Speed, Acc y Reading PP reales con sengo-pp
            if (targetModeInt === 0) {
                const perf = new engine.Performance({
                    mods: modsList,
                    lazer: true,
                    mode: targetModeInt,
                    combo: score.max_combo,
                    accuracy: typeof score.accuracy === "number" && score.accuracy <= 1 ? score.accuracy * 100 : (score.accuracy || 100)
                }).calculate(diffAttrs);

                playData.aim = mapToSkillCurve(perf.ppAim / AIM_NERF);
                playData.speed = mapToSkillCurve(perf.ppSpeed / SPEED_NERF);
                playData.acc = mapToSkillCurve(perf.ppAcc / ACC_NERF);
                playData.speedPP = perf.ppSpeed;
                playData.aimPP = perf.ppAim;
                playData.accPP = perf.ppAcc;

                // ponytail: Soporte nativo para Reading y Flashlight de sengo-pp en todos los mods rankeables (EZ, FL, HD, HT, DT, HR)
                const sengoReadingPP = Math.max(perf.ppReading || 0, (perf.ppFlashlight || 0));
                playData.reading = mapToSkillCurve(sengoReadingPP / READING_NERF);
                playData.readingPP = sengoReadingPP;
                playData.readingStars = diffAttrs.readingStars || diffAttrs.flashlightStars || 0;
            }

            calculatedData.set(bmId, playData);
            map.free();
        } catch (err) {
            calculatedData.set(bmId, {
                stars: Number(score.beatmap?.difficulty_rating || 0)
            });
        }
    }));

    const allEvaluated = [];
    candidateScoreMap.forEach((sc, bmId) => {
        const sengo = calculatedData.get(bmId);
        const item = {
            score: sc,
            aim: sengo?.aim ?? sc.skills?.aim ?? 0,
            speed: sengo?.speed ?? sc.skills?.speed ?? 0,
            acc: sengo?.acc ?? sc.skills?.acc ?? 0,
            reading: sengo?.reading ?? sc.skills?.reading ?? 0,
            stars: sengo?.stars ?? Number(sc.beatmap?.difficulty_rating || 0)
        };
        if (targetModeInt !== 0 && sc.skills) {
            Object.assign(item, sc.skills);
        }
        allEvaluated.push(item);
    });

    const avgStars = (list) => {
        if (!list || list.length === 0) return 0;
        const sum = list.reduce((acc, curr) => acc + (curr.stars || 0), 0);
        return Number((sum / list.length).toFixed(2));
    };

    const finalResult = {
        ...base,
        averageStars: {}
    };

    skillKeys.forEach(k => {
        const capKey = k.charAt(0).toUpperCase() + k.slice(1);
        const sorted = allEvaluated
            .slice()
            .sort((a, b) => (b[k] || 0) - (a[k] || 0))
            .slice(0, 3);
        finalResult[`top${capKey}`] = sorted;
        finalResult.averageStars[k] = avgStars(sorted);
    });

    return finalResult;
}

/**
 * Analiza el perfil de push/choke y precisión del jugador sobre sus top scores.
 * Determina:
 * - targetPushAcc: meta de accuracy entre su promedio y la media de su máximo en esos mapas,
 *   para instigar a que pushee sin sentirse incómodo.
 * - isChokePusher: detecta jugadores que juegan dificultades más altas sin buscar necesariamente FCs perfectos.
 * - pushStars: estrellas promedio de las dificultades altas que el jugador suele pushear.
 */
function analyzePlayerPushProfile(topScores, gamemode = "osu") {
    if (!Array.isArray(topScores) || topScores.length === 0) {
        return {
            avgAcc: 0.98,
            maxAcc: 1.0,
            targetPushAcc: 0.985,
            nonFcRate: 0.5,
            isChokePusher: false,
            avgPlayedStars: 5.0,
            pushStars: 5.5
        };
    }

    const sample = topScores.slice(0, 35);
    const chokePlays = [];
    const allAccs = [];
    const allStars = [];
    let nonFcCount = 0;

    sample.forEach(s => {
        const rawAcc = Number(s.accuracy != null ? s.accuracy : 0.98);
        const acc = rawAcc <= 1 ? rawAcc : rawAcc / 100;
        allAccs.push(acc);

        const misses = Number(s.statistics?.miss ?? s.statistics?.count_miss ?? 0);
        const isPerfect = s.perfect === true || s.legacy_perfect === true;
        const rank = s.rank || '';
        const isNonFc = misses > 0 || !isPerfect || ['A', 'B', 'C', 'D'].includes(rank);

        if (isNonFc) {
            nonFcCount++;
            chokePlays.push({ acc, score: s });
        }

        const sr = Number(s.beatmap?.difficulty_rating || 0);
        if (sr > 0) allStars.push(sr);
    });

    const nonFcRate = nonFcCount / sample.length;
    allAccs.sort((a, b) => a - b);
    allStars.sort((a, b) => a - b);

    const avgAcc = allAccs.reduce((a, b) => a + b, 0) / allAccs.length;
    const maxAcc = allAccs[allAccs.length - 1];
    const avgPlayedStars = allStars.length > 0 ? (allStars.reduce((a, b) => a + b, 0) / allStars.length) : 5.0;
    
    // ponytail: estrellas en dificultades push (top 30% más alto de mapas jugados)
    const topTierSrCount = Math.max(1, Math.floor(allStars.length * 0.30));
    const pushStars = allStars.slice(-topTierSrCount).reduce((a, b) => a + b, 0) / topTierSrCount;

    // Detectar si el jugador suele pushear dificultades altas con chokes/baja acc
    const isChokePusher = nonFcRate >= 0.55;

    // ponytail: para calcular targetPushAcc, si es choke pusher o tiene acc moderada,
    // calcular entre el promedio y la media de su máximo en sus mapas push para instigar sin frustrar
    let targetPushAcc;
    if (isChokePusher && chokePlays.length >= 5) {
        const chokeAccs = chokePlays.map(p => p.acc).sort((a, b) => a - b);
        const chokeAvg = chokeAccs.reduce((a, b) => a + b, 0) / chokeAccs.length;
        const chokeP85 = chokeAccs[Math.floor(chokeAccs.length * 0.85)] || chokeAccs[chokeAccs.length - 1];
        targetPushAcc = Number((chokeAvg + (chokeP85 - chokeAvg) * 0.50).toFixed(4));
    } else {
        const p85Acc = allAccs[Math.floor(allAccs.length * 0.85)] || maxAcc;
        targetPushAcc = Number((avgAcc + (p85Acc - avgAcc) * 0.45).toFixed(4));
    }

    return {
        avgAcc: Number(avgAcc.toFixed(4)),
        maxAcc: Number(maxAcc.toFixed(4)),
        targetPushAcc: Math.min(1.0, Math.max(0.85, targetPushAcc)),
        nonFcRate: Number(nonFcRate.toFixed(2)),
        isChokePusher,
        avgPlayedStars: Number(avgPlayedStars.toFixed(2)),
        pushStars: Number(pushStars.toFixed(2))
    };
}

/**
 * Estima las métricas cinéticas y requerimientos mecánicos de un mapa candidato.
 * Funciona con los campos estándar de base de datos o API (bpm, hit_length, max_combo, ar, od, cs).
 */
function estimateMapSkills(map, activeMod = "NM", gamemode = "osu") {
    const isDT = activeMod.includes("DT") || activeMod.includes("NC");
    const isHT = activeMod.includes("HT") || activeMod.includes("DC");
    const isHR = activeMod.includes("HR");
    const isEZ = activeMod.includes("EZ");
    const isHD = activeMod.includes("HD");
    const isFL = activeMod.includes("FL");

    const bpm = Number(map.bpm || 180);
    const effBPM = bpm * (isDT ? 1.5 : (isHT ? 0.75 : 1.0));
    const hitLength = Math.max(20, Number(map.hit_length || map.total_length || 100)) / (isDT ? 1.5 : (isHT ? 0.75 : 1.0));
    const maxCombo = Number(map.max_combo || 500);

    const beats = (hitLength / 60) * effBPM;
    const notesPerBeat = beats > 0 ? (maxCombo / beats) : 1.5;

    const tags = ((map.user_tags || []).concat(map.tags || [])).map(t => String(t).toLowerCase());
    const hasStreamTag = tags.some(t => t.includes('stream') || t.includes('speed') || t.includes('burst') || t.includes('stamina'));
    const hasJumpTag = tags.some(t => t.includes('jump') || t.includes('aim') || t.includes('cross-screen'));

    let ar = Number(map.ar || 9.0);
    let effAR = ar;
    if (isHR) effAR = Math.min(10, ar * 1.4);
    if (isEZ) effAR = ar * 0.5;
    if (isDT) effAR = ar <= 5 ? (5 + (ar * 0.75)) : (5 + (ar - 5) * 0.75 * (2 / 3) + 2.5);

    let od = Number(map.od || map.accuracy || 8.0);
    let effOD = od;
    if (isHR) effOD = Math.min(10, od * 1.4);
    if (isEZ) effOD = od * 0.5;
    if (isDT) effOD = Math.min(11.1, effOD * 1.11);

    const normMode = (gamemode || "osu").toLowerCase();

    if (normMode === "taiko") {
        // Exigencia de Taiko: Densidad rítmica, BPM y color switching
        const density = maxCombo / Math.max(1, hitLength);
        const staminaReq = Math.min(100, Math.max(10, (effBPM - 150) * 0.6 + density * 8));
        const colorReq = Math.min(100, Math.max(10, density * 12 + (isHD ? 15 : 0)));
        return {
            mode: "taiko",
            effBPM: Math.round(effBPM),
            effOD: Number(effOD.toFixed(1)),
            density: Number(density.toFixed(2)),
            staminaReq: Math.round(staminaReq),
            colorReq: Math.round(colorReq)
        };
    } else if (normMode === "fruits" || normMode === "catch" || normMode === "ctb") {
        // Exigencia de Catch: Escala de plato y saltos rápidos (hyperdashes)
        const cs = Number(map.cs || 4.0);
        const effCS = isHR ? Math.min(10, cs * 1.3) : (isEZ ? cs * 0.5 : cs);
        const speedFactor = Math.max(0, Math.min(100, (effBPM - 160) * 0.7 + (notesPerBeat * 15)));
        const movementReq = Math.min(100, Math.max(10, effCS * 12 + speedFactor * 0.5));
        return {
            mode: "fruits",
            effBPM: Math.round(effBPM),
            effAR: Number(effAR.toFixed(1)),
            effCS: Number(effCS.toFixed(1)),
            movementReq: Math.round(movementReq),
            speedReq: Math.round(speedFactor)
        };
    } else if (normMode === "mania") {
        // Exigencia de Mania: Keymode (4K, 7K), NPS y Long Notes
        const cs = Math.round(Number(map.cs || 4));
        const nps = maxCombo / hitLength;
        const streamReq = Math.min(100, Math.max(10, nps * 9));
        return {
            mode: "mania",
            keymode: `${cs}K`,
            effBPM: Math.round(effBPM),
            nps: Number(nps.toFixed(2)),
            streamReq: Math.round(streamReq),
            effOD: Number(effOD.toFixed(1))
        };
    }

    // osu! Standard
    let streamDensity = Math.max(0, Math.min(1.0, (notesPerBeat - 1.40) / 0.80));
    if (hasStreamTag) streamDensity = Math.min(1.0, streamDensity + 0.3);
    if (hasJumpTag && !hasStreamTag) streamDensity = Math.max(0, streamDensity - 0.25);

    const bpmFactor = Math.max(0, Math.min(1.0, (effBPM - 160) / 80));
    const speedDominance = Math.max(0, Math.min(1.0, (streamDensity * 0.65) + (bpmFactor * 0.35)));

    let readingRequirement = 45;
    if (isHD) readingRequirement += 15;
    if (isEZ) readingRequirement += 30;
    if (isFL) readingRequirement += 35;
    if (effAR < 8.5) readingRequirement += (8.5 - effAR) * 8;
    if (effAR > 10.2) readingRequirement += (effAR - 10.2) * 12;

    return {
        mode: "osu",
        speedDominance: Number(speedDominance.toFixed(3)),
        streamDensity: Number(streamDensity.toFixed(3)),
        notesPerBeat: Number(notesPerBeat.toFixed(2)),
        effBPM: Math.round(effBPM),
        effAR: Number(effAR.toFixed(1)),
        effOD: Number(effOD.toFixed(1)),
        readingReq: Math.min(100, Math.round(readingRequirement)),
        stars: Number(map.stars || 5.0)
    };
}

/**
 * Guarda o actualiza las métricas de habilidad analítica de un usuario en Supabase.
 * @param {object} params Datos del usuario y resultado del desglose de habilidades
 * @returns {Promise<object>} Resultado de la operación
 */
async function saveUserSkills({ osuUser, skillsBreakdown, gamemode, discordId = null }) {
    try {
        const { getSupabaseClient } = require("../db/database.js");
        const supabase = getSupabaseClient();
        if (!supabase) {
            console.warn("[SkillsModel.saveUserSkills] Cliente de Supabase no disponible");
            return { success: false, error: "Supabase client not available" };
        }

        const osuId = String(osuUser.id || osuUser.osu_id);
        const username = osuUser.username || "Desconocido";
        const rawCountry = osuUser.country_code || osuUser.country?.code || "XX";
        const countryCode = String(rawCountry).toUpperCase();
        const mode = gamemode || skillsBreakdown?.mode || osuUser.playmode || "osu";

        const stats = osuUser.statistics || {};
        const pp = Number(stats.pp != null ? stats.pp : (osuUser.pp || 0));
        const globalRank = Number(stats.global_rank != null ? stats.global_rank : (osuUser.global_rank || 0));
        const countryRank = Number(stats.country_rank != null ? stats.country_rank : (osuUser.country_rank || 0));

        const aim = Number(skillsBreakdown?.aim || 0);
        const speed = Number(skillsBreakdown?.speed || 0);
        const acc = Number(skillsBreakdown?.acc || 0);
        const reading = Number(skillsBreakdown?.reading || 0);
        const stamina = Number(skillsBreakdown?.stamina || 0);
        const topPlayPP = Number(skillsBreakdown?.topPlayPP || 0);

        const record = {
            osu_id: osuId,
            discord_id: discordId ? String(discordId) : null,
            username,
            country_code: countryCode,
            gamemode: mode,
            pp,
            global_rank: globalRank,
            country_rank: countryRank,
            aim,
            speed,
            acc,
            reading,
            stamina,
            top_play_pp: topPlayPP,
            skills_data: {
                modStats: skillsBreakdown?.modStats || {},
                averageStars: skillsBreakdown?.averageStars || {},
                keymodeInfo: skillsBreakdown?.keymodeInfo || null
            },
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from("user_skills")
            .upsert(record, { onConflict: "osu_id,gamemode" })
            .select()
            .maybeSingle();

        if (error) {
            console.error(`[SkillsModel.saveUserSkills] Error al guardar habilidades de ${username}:`, error.message);
            return { success: false, error: error.message };
        }

        return { success: true, data };
    } catch (err) {
        console.error("[SkillsModel.saveUserSkills] Error inesperado:", err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Consulta la tabla de clasificación de habilidades por país en Supabase.
 * @param {object} params Filtros de país, modo, habilidad y paginación
 * @returns {Promise<object>} Lista de jugadores y conteo total
 */
async function getCountrySkillsLeaderboard({ countryCode = "VE", gamemode = "osu", skill = "aim", limit = 10, offset = 0 } = {}) {
    try {
        const { getSupabaseClient } = require("../db/database.js");
        const supabase = getSupabaseClient();
        if (!supabase) {
            return { players: [], totalCount: 0, error: "Supabase client not available" };
        }

        const validSkills = ["aim", "speed", "acc", "reading", "stamina", "pp"];
        const normalizedSkill = validSkills.includes(skill?.toLowerCase()) ? skill.toLowerCase() : "aim";
        const normalizedCountry = String(countryCode || "VE").trim().toUpperCase();
        const normalizedMode = String(gamemode || "osu").trim().toLowerCase();

        const { data, count, error } = await supabase
            .from("user_skills")
            .select("*", { count: "exact" })
            .eq("country_code", normalizedCountry)
            .eq("gamemode", normalizedMode)
            .order(normalizedSkill, { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            console.error("[SkillsModel.getCountrySkillsLeaderboard] Error al consultar leaderboard:", error.message);
            return { players: [], totalCount: 0, error: error.message };
        }

        return {
            players: data || [],
            totalCount: count || 0,
            countryCode: normalizedCountry,
            gamemode: normalizedMode,
            skill: normalizedSkill
        };
    } catch (err) {
        console.error("[SkillsModel.getCountrySkillsLeaderboard] Error inesperado:", err.message);
        return { players: [], totalCount: 0, error: err.message };
    }
}

/**
 * Consulta las habilidades almacenadas para un usuario específico.
 */
async function getUserSkills({ osuId, gamemode = "osu" }) {
    try {
        const { getSupabaseClient } = require("../db/database.js");
        const supabase = getSupabaseClient();
        if (!supabase) return null;

        const { data, error } = await supabase
            .from("user_skills")
            .select("*")
            .eq("osu_id", String(osuId))
            .eq("gamemode", gamemode)
            .maybeSingle();

        if (error) throw error;
        return data;
    } catch (err) {
        console.error("[SkillsModel.getUserSkills] Error al consultar usuario:", err.message);
        return null;
    }
}

module.exports = {
    mapToSkillCurve,
    estimateAccPP,
    calculateTaikoSkillsForScore,
    calculateCatchSkillsForScore,
    calculateManiaSkillsForScore,
    analyzeSkills,
    analyzeSkillsBreakdown,
    analyzePlayerPushProfile,
    estimateMapSkills,
    saveUserSkills,
    getCountrySkillsLeaderboard,
    getUserSkills
};

