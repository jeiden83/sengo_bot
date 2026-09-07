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

    let dtCount = 0, hrCount = 0, hdCount = 0, flCount = 0, nmCount = 0, ezCount = 0;
    const rawSums = {};
    skillKeys.forEach(k => { rawSums[k] = 0; });
    let totalWeight = 0;
    const scoredPlays = [];
    const keyCounts = {};

    const AIM_NERF = 3.7;
    const SPEED_NERF = 2.5;
    const ACC_NERF = 1.1;
    const READING_NERF = 3.2;

    for (let i = 0; i < scores.length; i++) {
        const s = scores[i];
        const weight = Math.pow(0.95, i);
        totalWeight += weight;

        const modsList = Array.isArray(s.mods)
            ? s.mods.map(m => (typeof m === "string" ? m : m.acronym || "")).filter(Boolean)
            : (typeof s.mods === "string" ? s.mods.match(/.{1,2}/g) || [] : []);
        const upperMods = modsList.map(m => m.toUpperCase());
        const modsSet = new Set(upperMods);

        // ponytail: excluye mods de sistema (CL) y visuales (NM) para no distorsionar NoMod
        const gameplayMods = upperMods.filter(m => m !== "CL" && m !== "NM");
        if (gameplayMods.length === 0) nmCount++;
        if (modsSet.has("DT") || modsSet.has("NC")) dtCount++;
        if (modsSet.has("HR")) hrCount++;
        if (modsSet.has("HD")) hdCount++;
        if (modsSet.has("FL")) flCount++;
        if (modsSet.has("EZ")) ezCount++;

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
                keyCounts[res.keymode] = (keyCounts[res.keymode] || 0) + 1;
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

            // 3. Descomposición rítmica en Aim y Speed calibrada con rosu-pp
            // El strain de velocidad relevante en streams y ráfagas empieza a partir de 165-175 BPM
            const bpmSpeedFactor = Math.max(0, Math.min(1.0, (effBPM - 165) / 55));

            // Densidad rítmica directa (para mapas cortos o con ritmo sostenido constante)
            const shortRhythmDensity = Math.max(0, Math.min(1.0, (notesPerBeat - 1.35) / 0.55));

            // En maratones y mapas largos (Save Me, Lies in Reality, -ELIS-), descansos e intros lentas
            // diluyen notesPerBeat, pero el gran volumen de círculos a BPM sostenido revela streams continuos
            // si el mapa mantiene una densidad rítmica mínima de streams (notesPerBeat >= 1.45)
            const isMarathon = effLen >= 180 || circles >= 500;
            const marathonStreamFactor = (isMarathon && effBPM >= 178 && notesPerBeat >= 1.45)
                ? Math.min(1.0, Math.max(0, (circles - 300) / 500) * bpmSpeedFactor)
                : 0;

            const streamConfidence = Math.max(shortRhythmDensity, marathonStreamFactor);
            const circleStreamBias = Math.max(0, Math.min(1.0, (circleRatio - 0.58) / 0.22));

            // A altas velocidades (218+ BPM), el strain de tapping se incrementa naturalmente
            let highBpmTappingBonus = 0;
            if (isDT && !isEZ) {
                highBpmTappingBonus = Math.max(0, Math.min(0.25, (effBPM - 235) / 80));
            } else if (isDT && isEZ) {
                highBpmTappingBonus = streamConfidence > 0.2 ? Math.max(0, Math.min(0.12, (effBPM - 240) / 80)) * streamConfidence : 0;
            } else if (!isEZ) {
                highBpmTappingBonus = Math.max(0, Math.min(0.20, (effBPM - 218) / 50));
            }

            // Stamina en maratones largas de streams (requiere notesPerBeat >= 1.45)
            const staminaBonus = (circles >= 700 && effBPM >= 180 && notesPerBeat >= 1.45 && !isEZ)
                ? Math.min(0.35, (circles - 500) / 1400) * bpmSpeedFactor * streamConfidence
                : 0;

            // Dominancia de velocidad:
            let speedDominance = (Math.pow(streamConfidence, 0.70) * bpmSpeedFactor * (0.45 + 0.55 * circleStreamBias))
                               + highBpmTappingBonus
                               + staminaBonus;

            // Mapas cortos de saltos puros (<70s o <350 círculos): 100% Aim
            if ((isHR || isEZ) && (circles < 350 || effLen < 70)) {
                speedDominance = 0;
            }

            // En HR con BPM moderado (<205 BPM, ej. Quaver), el CS reducido multiplica la dificultad de Aim sobre Speed
            if (isHR && effBPM < 205) {
                speedDominance *= 0.35;
            } else if (isHR) {
                speedDominance *= 0.65;
            }

            if (isHT) speedDominance *= 0.25; // Castigo de velocidad por reducción drástica de BPM
            if (isEZ) speedDominance *= 0.35; // EZ reduce el speed strain debido al OD relajado y la gran proporción de Reading/Aim

            speedDominance = Math.max(0, Math.min(1.0, speedDominance));

            // Fracción de Strain:
            let baselineSpeed = 0.04;
            if (isHR && (circles < 350 || effLen < 70)) baselineSpeed = 0.025;
            else if (isHR && effBPM < 205) baselineSpeed = 0.03;
            else if (isHR) baselineSpeed = 0.04;
            if (isHT) baselineSpeed = 0.03;
            if (isDT && !isEZ) baselineSpeed = 0.06 + Math.max(0, (effBPM - 225) / 120) * 0.10;
            else if (isDT && isEZ) baselineSpeed = 0.04 + Math.max(0, (effBPM - 230) / 100) * 0.04;
            if (isEZ && !isDT) baselineSpeed = 0.035;

            // En maratones puras de streams sin HR (ej: Save Me, Lies in Reality), la fracción máxima de speed sube
            const maxSpeedFraction = (!isHR && !isHT && circles >= 1000 && effBPM >= 185) ? 0.68 : 0.60;

            let speedFraction = baselineSpeed + (speedDominance * (maxSpeedFraction - baselineSpeed));
            let aimFraction = Math.max(0.18, 1.0 - (speedFraction * 0.85));

            if (isHR) aimFraction = Math.min(1.0, aimFraction + 0.06);
            if (isHD) aimFraction = Math.min(1.0, aimFraction + 0.02);
            if (isEZ) aimFraction = Math.min(1.0, aimFraction + 0.04);

            const rawAimPP = strainPP * aimFraction;
            const rawSpeedPP = strainPP * speedFraction;

            // 4. Reading PP
            let effAR = ar;
            if (isHR) effAR = Math.min(10, ar * 1.4);
            if (isEZ) effAR = ar * 0.5;
            if (isDT) effAR = ar <= 5 ? (5 + (ar * 0.75)) : (5 + (ar - 5) * 0.75 * (2 / 3) + 2.5);

            let readingMultiplier = 1.0;
            if (isHD) readingMultiplier *= 1.18;
            if (isFL) readingMultiplier *= 1.75;
            if (isEZ) readingMultiplier *= 1.65;
            if (effAR < 9.0) readingMultiplier *= (1 + (9.0 - effAR) * 0.08);
            else if (effAR > 10.3) readingMultiplier *= (1 + (effAR - 10.3) * 0.10);

            const rawReadingPP = (rawAimPP * 0.48 + rawSpeedPP * 0.48) * readingMultiplier;

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

    const result = {
        topPlayPP,
        mode: normMode,
        skillKeys,
        modStats: {
            DT: Math.round((dtCount / total) * 100),
            HD: Math.round((hdCount / total) * 100),
            HR: Math.round((hrCount / total) * 100),
            NM: Math.round((nmCount / total) * 100),
            FL: Math.round((flCount / total) * 100),
            EZ: Math.round((ezCount / total) * 100)
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
                pct: Math.round((dominant[1] / total) * 100)
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

    const uniqueMapIds = new Map();
    skillKeys.forEach(k => {
        const capKey = k.charAt(0).toUpperCase() + k.slice(1);
        (base[`top${capKey}`] || []).forEach(item => {
            if (item.score?.beatmap?.id) {
                uniqueMapIds.set(item.score.beatmap.id, item.score);
            }
        });
    });

    const MODE_INT = { osu: 0, taiko: 1, fruits: 2, catch: 2, ctb: 2, mania: 3 };
    const rosuMode = MODE_INT[base.mode] ?? 0;

    const calculatedStars = new Map();
    await Promise.all(Array.from(uniqueMapIds.entries()).map(async ([bmId, score]) => {
        try {
            const beatmap = await getBeatmap(bmId);
            const map = await getBeatmap_osu(score.beatmap.beatmapset_id, bmId, beatmap);
            if (rosuMode !== 0 && typeof map.convert === "function") {
                map.convert(rosuMode);
            }
            const modsList = Array.isArray(score.mods)
                ? score.mods.map(m => (typeof m === "string" ? m : m.acronym || "")).filter(Boolean)
                : (typeof score.mods === "string" ? score.mods.match(/.{1,2}/g) || [] : []);
            const diffAttrs = new engine.Difficulty({ mods: modsList, lazer: true, mode: rosuMode }).calculate(map);
            calculatedStars.set(bmId, diffAttrs.stars);
            map.free();
        } catch (err) {
            calculatedStars.set(bmId, Number(score.beatmap?.difficulty_rating || 0));
        }
    }));

    const attachStarsAndSort = (list, skillKey) => {
        const withStars = (list || []).map(item => ({
            ...item,
            stars: calculatedStars.get(item.score.beatmap.id) ?? Number(item.score.beatmap?.difficulty_rating || 0)
        }));
        return withStars.sort((a, b) => (b[skillKey] || 0) - (a[skillKey] || 0)).slice(0, 3);
    };

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
        const sorted = attachStarsAndSort(base[`top${capKey}`], k);
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

module.exports = {
    mapToSkillCurve,
    estimateAccPP,
    calculateTaikoSkillsForScore,
    calculateCatchSkillsForScore,
    calculateManiaSkillsForScore,
    analyzeSkills,
    analyzeSkillsBreakdown,
    analyzePlayerPushProfile,
    estimateMapSkills
};
