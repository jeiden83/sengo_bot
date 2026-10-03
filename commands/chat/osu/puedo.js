const { getBeatmap_osu, findBeatmapInChannel } = require("../../utils/osu.js");
const BeatmapModel = require("../../../models/BeatmapModel.js");
const OsuUserModel = require("../../../models/OsuUserModel.js");
const OsuScoreModel = require("../../../models/OsuScoreModel.js");
const SkillsModel = require("../../../models/SkillsModel.js");
const ppEngine = require("../../../utils/ppEngine.js");
const { doOsuPuedoEmbed } = require("../../../views/osuPuedoViews.js");
const { t } = require("../../../utils/i18n.js");

function parsePuedoArgs(args) {
    const options = {
        beatmapId: null,
        mods: null,
        targetUser: null,
        mode: null
    };

    const argsList = Array.isArray(args) ? args : String(args || '').split(/\s+/);

    for (let i = 0; i < argsList.length; i++) {
        const arg = argsList[i];
        if (typeof arg !== 'string') continue;
        const clean = arg.trim();
        const lower = clean.toLowerCase();

        // 1. Beatmap URL con modo específico (#osu/123, #taiko/123, etc.)
        const modeUrlMatch = clean.match(/osu\.ppy\.sh\/beatmapsets\/\d+#(osu|taiko|fruits|mania)\/(\d+)/i);
        if (modeUrlMatch) {
            options.beatmapId = modeUrlMatch[2];
            if (!options.mode) options.mode = modeUrlMatch[1].toLowerCase();
            continue;
        }

        // Beatmap URL clásico o ID directo en URL
        const urlMatch = clean.match(/osu\.ppy\.sh\/b(?:eatmaps)?\/(\d+)/i) ||
                         clean.match(/osu\.ppy\.sh\/beatmapsets\/\d+#\w+\/(\d+)/i);
        if (urlMatch) {
            options.beatmapId = urlMatch[1];
            continue;
        }

        const setMatch = clean.match(/osu\.ppy\.sh\/(?:beatmapsets|s)\/(\d+)/i);
        if (setMatch) {
            options.beatmapId = `set/${setMatch[1]}`;
            continue;
        }

        // 2. Mods (+HDDT / + HDDT / -mods HDDT / -m HDDT)
        if (clean.startsWith('+') && !/^\+\d+$/.test(clean)) {
            let modStr = clean.slice(1).trim();
            if (!modStr && i + 1 < argsList.length && !argsList[i + 1].startsWith('-') && !argsList[i + 1].startsWith('+')) {
                modStr = argsList[++i].trim();
            }
            if (modStr) {
                const sanitized = modStr.toUpperCase().replace(/[^A-Z0-9]/g, '');
                options.mods = options.mods ? `${options.mods}${sanitized}` : sanitized;
            }
            continue;
        }
        if ((lower === '-mods' || (lower === '-m' && !/^\d+$/.test(argsList[i + 1] || ''))) && i + 1 < argsList.length) {
            const sanitized = argsList[i + 1].toUpperCase().replace(/[^A-Z0-9]/g, '');
            options.mods = options.mods ? `${options.mods}${sanitized}` : sanitized;
            i++;
            continue;
        }

        // 3. Modos (-modo / -mode)
        if ((lower === '-modo' || lower === '-mode') && i + 1 < argsList.length) {
            options.mode = argsList[i + 1].toLowerCase();
            i++;
            continue;
        }
        if (lower === '-ctb' || lower === '-catch' || lower === '-fruits') { options.mode = 'fruits'; continue; }
        if (lower === '-taiko') { options.mode = 'taiko'; continue; }
        if (lower === '-mania') { options.mode = 'mania'; continue; }
        if (lower === '-std' || lower === '-osu') { options.mode = 'osu'; continue; }

        // 4. Usuario o mención explícita (-u, -user, perfil osu! o ID)
        if ((lower === '-u' || lower === '-user' || lower === '--user') && i + 1 < argsList.length) {
            options.targetUser = argsList[++i].trim();
            continue;
        }

        const profileMatch = clean.match(/osu\.ppy\.sh\/u(?:sers)?\/([^\/\s\?#]+)/i);
        if (profileMatch) {
            try {
                options.targetUser = decodeURIComponent(profileMatch[1]);
            } catch {
                options.targetUser = profileMatch[1];
            }
            continue;
        }

        if (/^<@!?\d+>$/.test(clean)) {
            const idMatch = clean.match(/\d+/);
            if (idMatch) options.targetUser = idMatch[0];
            continue;
        }

        if (/^\d{17,20}$/.test(clean)) {
            options.targetUser = clean;
            continue;
        }

        // Si es número de 1 a 10 dígitos y no tenemos ID de mapa aún, asignar como mapa
        if (/^\d{1,10}$/.test(clean) && !options.beatmapId) {
            options.beatmapId = clean;
            continue;
        }

        // Si no empieza con -, +, y no es beatmap ni flag conocida, interpretar como nombre de usuario
        if (!clean.startsWith('-') && !clean.startsWith('+') && !options.targetUser) {
            options.targetUser = clean;
        }
    }

    return options;
}

function extractModAcronyms(mods) {
    if (!mods) return [];
    if (typeof mods === 'string') {
        const clean = mods.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (clean === 'NM' || clean === 'NOMOD' || clean === '') return [];
        return clean.match(/.{1,2}/g) || [];
    }
    if (Array.isArray(mods)) {
        return mods.map(m => {
            if (typeof m === 'string') return m.toUpperCase();
            if (m && typeof m === 'object' && m.acronym) return m.acronym.toUpperCase();
            return '';
        }).filter(Boolean);
    }
    return [];
}

function evaluateScoreCompatibility(score, targetModsStr = 'NM') {
    if (!score) return { isExactMatch: false, isCompatiblePass: false, scoreMods: [], scoreHasNF: false };
    const targetMods = extractModAcronyms(targetModsStr);
    const scoreMods = extractModAcronyms(score.mods);

    const isEvaluatingNM = targetMods.length === 0;
    const targetHasRX = targetMods.includes('RX');
    const targetHasAP = targetMods.includes('AP');
    const targetHasEZ = targetMods.includes('EZ');
    const targetHasHT = targetMods.includes('HT');
    const targetHasDT = targetMods.includes('DT') || targetMods.includes('NC');
    const targetHasHR = targetMods.includes('HR');
    const targetHasFL = targetMods.includes('FL');

    const scoreHasRX = scoreMods.includes('RX');
    const scoreHasAP = scoreMods.includes('AP');
    const scoreHasAT = scoreMods.includes('AT');
    const scoreHasCN = scoreMods.includes('CN');
    const scoreHasEZ = scoreMods.includes('EZ');
    const scoreHasHT = scoreMods.includes('HT');
    const scoreHasDT = scoreMods.includes('DT') || scoreMods.includes('NC');
    const scoreHasHR = scoreMods.includes('HR');
    const scoreHasFL = scoreMods.includes('FL');
    const scoreHasNF = scoreMods.includes('NF');

    // 1. Modos asistidos o automatizados (RX, AP, AT, CN)
    const isAssistedMismatch = (!targetHasRX && scoreHasRX) || (!targetHasAP && scoreHasAP) || scoreHasAT || scoreHasCN;
    if (isAssistedMismatch) {
        return { isExactMatch: false, isCompatiblePass: false, isAssistedMismatch: true, scoreMods, scoreHasNF };
    }

    // 2. Modos de reducción de dificultad (EZ, HT)
    const isReductionMismatch = (!targetHasEZ && scoreHasEZ) || (!targetHasHT && scoreHasHT);
    if (isReductionMismatch) {
        return { isExactMatch: false, isCompatiblePass: false, isReductionMismatch: true, scoreMods, scoreHasNF };
    }

    // 3. Modos de velocidad (DT/NC)
    if (targetHasDT && !scoreHasDT) {
        return { isExactMatch: false, isCompatiblePass: false, isSpeedMismatch: true, scoreMods, scoreHasNF };
    }

    // 4. Modos de precisión/dificultad (HR)
    if (targetHasHR && !scoreHasHR) {
        return { isExactMatch: false, isCompatiblePass: false, isDifficultyMismatch: true, scoreMods, scoreHasNF };
    }

    // 5. Modos de memoria (FL)
    if (targetHasFL && !scoreHasFL) {
        return { isExactMatch: false, isCompatiblePass: false, isMemoryMismatch: true, scoreMods, scoreHasNF };
    }

    const filterCosmetics = mList => mList.filter(m => !['NF', 'SO', 'SD', 'PF', 'CL'].includes(m)).sort().join('');
    const isExactMatch = filterCosmetics(targetMods) === filterCosmetics(scoreMods);

    return {
        isExactMatch,
        isCompatiblePass: true,
        isAssistedMismatch: false,
        isReductionMismatch: false,
        scoreMods,
        scoreHasNF
    };
}

function calculateProbabilities({ user, topScores, beatmap, bestScore, activeModsStr = 'NM', diffAttrs, perfAttrs = null, scoreCompatibility = null, mapAttrs = null }) {
    const mode = beatmap.mode || 'osu';
    const pushProfile = SkillsModel.analyzePlayerPushProfile(topScores, mode);
    const userSkills = SkillsModel.analyzeSkills(topScores, false, mode);
    const mapSkills = SkillsModel.estimateMapSkills(beatmap, activeModsStr, mode);

    const activeMods = extractModAcronyms(activeModsStr);
    const hasDT = activeMods.includes('DT') || activeMods.includes('NC');
    const hasHT = activeMods.includes('HT') || activeMods.includes('DC');
    const hasHR = activeMods.includes('HR');
    const hasEZ = activeMods.includes('EZ');
    const hasHD = activeMods.includes('HD');
    const hasFL = activeMods.includes('FL');

    const clockRate = mapAttrs?.clockRate ?? (hasDT ? 1.5 : (hasHT ? 0.75 : 1.0));
    const baseBPM = Number(beatmap.bpm || 180);
    const mapBPM = Math.round(mapAttrs ? baseBPM * mapAttrs.clockRate : (mapSkills.effBPM || baseBPM));
    const mapSR = Number(diffAttrs?.stars || beatmap.difficulty_rating || 5.0);
    const mapCombo = diffAttrs?.maxCombo || beatmap.max_combo || 500;

    let effAR = Number(mapAttrs?.ar != null ? mapAttrs.ar : (mapSkills.effAR || beatmap.ar || 9.0));
    let effOD = Number(mapAttrs?.od != null ? mapAttrs.od : (mapSkills.effOD || beatmap.accuracy || 8.0));
    let effCS = Number(mapAttrs?.cs != null ? mapAttrs.cs : (mapSkills.effCS || beatmap.cs || 4.0));
    let effHP = Number(mapAttrs?.hp != null ? mapAttrs.hp : (mapSkills.effHP || beatmap.drain || beatmap.hp || 5.0));

    if (!mapAttrs) {
        let baseAR = Number(beatmap.ar ?? 9.0);
        let baseOD = Number(beatmap.accuracy ?? beatmap.od ?? 8.0);
        let baseCS = Number(beatmap.cs ?? 4.0);
        let baseHP = Number(beatmap.drain ?? beatmap.hp ?? 5.0);

        if (hasHR) {
            baseAR = Math.min(10.0, baseAR * 1.4);
            baseOD = Math.min(10.0, baseOD * 1.4);
            baseCS = Math.min(10.0, baseCS * 1.3);
            baseHP = Math.min(10.0, baseHP * 1.4);
        } else if (hasEZ) {
            baseAR *= 0.5;
            baseOD *= 0.5;
            baseCS *= 0.5;
            baseHP *= 0.5;
        }

        const baseArMs = baseAR <= 5 ? (1800 - 120 * baseAR) : (1200 - 150 * (baseAR - 5));
        const effArMs = baseArMs / clockRate;
        effAR = effArMs > 1200 ? ((1800 - effArMs) / 120) : (5 + (1200 - effArMs) / 150);

        const baseOdMs = 80 - 6 * baseOD;
        const effOdMs = baseOdMs / clockRate;
        effOD = Math.max(0, Math.min(11.1, (80 - effOdMs) / 6));
        effCS = baseCS;
        effHP = baseHP;
    }

    const effArMs = Math.round(effAR <= 5 ? (1800 - 120 * effAR) : (1200 - 150 * (effAR - 5)));
    const hitLength = Math.max(20, Math.floor(Number(beatmap.hit_length || beatmap.total_length || 100) / clockRate));

    // Analizar historial de lectura del jugador y familiaridad con FL
    const playerARHistory = [];
    let playerHasFLInTops = false;
    for (const s of (topScores || [])) {
        const sMods = extractModAcronyms(s.mods);
        if (sMods.includes('FL')) playerHasFLInTops = true;

        const sIsHR = sMods.includes('HR');
        const sIsEZ = sMods.includes('EZ');
        const sIsDT = sMods.includes('DT') || sMods.includes('NC');
        const sIsHT = sMods.includes('HT') || sMods.includes('DC');
        const sClock = sIsDT ? 1.5 : (sIsHT ? 0.75 : 1.0);

        let sBaseAR = Number(s.beatmap?.ar != null ? s.beatmap.ar : 9.0);
        if (sIsHR) sBaseAR = Math.min(10.0, sBaseAR * 1.4);
        else if (sIsEZ) sBaseAR *= 0.5;

        const sArMs = sBaseAR <= 5 ? (1800 - 120 * sBaseAR) : (1200 - 150 * (sBaseAR - 5));
        const sEffMs = sArMs / sClock;
        const sEffAR = sEffMs > 1200 ? ((1800 - sEffMs) / 120) : (5 + (1200 - sEffMs) / 150);

        playerARHistory.push(sEffAR);
    }

    const sortedARs = [...playerARHistory].sort((a, b) => b - a);
    const maxProvenAR = sortedARs.length > 0 ? sortedARs[0] : 9.0;
    const top10Idx = Math.min(sortedARs.length - 1, Math.floor(sortedARs.length * 0.1));
    const p90AR = sortedARs.length > 0 ? sortedARs[top10Idx] : 9.0;
    const readingSkill = Number(userSkills.reading || 10);
    const readingComfort = Math.max(9.0, Math.min(10.5, p90AR + (readingSkill >= 50 ? 0.4 : 0.2)));

    // Determinar balance y arquetipo del mapa (Jumps / Aim vs Streams / Stamina)
    let aimWeight = 0.5;
    let speedWeight = 0.5;

    if (perfAttrs && ((perfAttrs.ppAim || 0) > 0 || (perfAttrs.ppSpeed || 0) > 0)) {
        const totalPP = (perfAttrs.ppAim || 0) + (perfAttrs.ppSpeed || 0);
        aimWeight = Math.max(0.1, Math.min(0.95, (perfAttrs.ppAim || 0) / totalPP));
        speedWeight = 1.0 - aimWeight;
    } else if (diffAttrs && diffAttrs.aim != null && diffAttrs.speed != null) {
        const total = (diffAttrs.aim + diffAttrs.speed) || 1;
        aimWeight = Math.max(0.1, Math.min(0.9, diffAttrs.aim / total));
        speedWeight = 1.0 - aimWeight;
    } else if (mapSkills.speedDominance != null) {
        speedWeight = Math.max(0.1, Math.min(0.9, mapSkills.speedDominance));
        aimWeight = 1.0 - speedWeight;
    }

    let mapArchetypeKey = 'puedo.archetype_hybrid';
    if (aimWeight >= 0.65) mapArchetypeKey = 'puedo.archetype_jumps';
    else if (aimWeight <= 0.58) mapArchetypeKey = 'puedo.archetype_streams';

    const topSRs = topScores.map(s => (SkillsModel.estimateScoreEffectiveStars ? SkillsModel.estimateScoreEffectiveStars(s, mode) : Number(s.beatmap?.difficulty_rating || 0))).filter(sr => sr > 0);
    const avgTopSR = topSRs.length > 0 ? (topSRs.reduce((a, b) => a + b, 0) / topSRs.length) : pushProfile.avgPlayedStars;

    let playedBefore = false;
    let passedBefore = false;
    let usedNF = false;
    let flMemorized = false;
    let prevScore = null;

    if (bestScore) {
        prevScore = bestScore;
        const scoreMods = extractModAcronyms(bestScore.mods);
        usedNF = scoreMods.includes('NF');
        const isPassedRaw = bestScore.passed !== false && !['F'].includes(bestScore.rank);

        if (hasFL && scoreMods.includes('FL') && isPassedRaw) {
            flMemorized = true;
        }

        const compat = scoreCompatibility || evaluateScoreCompatibility(bestScore, activeModsStr);
        if (compat.isCompatiblePass) {
            playedBefore = true;
            passedBefore = isPassedRaw;
        } else {
            playedBefore = false;
            passedBefore = false;
        }
    }

    // --- CÁLCULO DE PROBABILIDAD DE PASS (Diferenciado de FC) ---
    // ponytail: El FC está fuertemente acotado por pushStars (top plays), pero el Pass
    // en osu! es mucho más accesible (+0.8★ a +1.8★), especialmente en mapas de jumps para jugadores con buen aim.
    let userAimVal = 50;
    let userSpeedVal = 40;
    if (mode === 'osu') {
        userAimVal = Number(userSkills.aim || 50);
        userSpeedVal = Number(userSkills.speed || 40);
    } else if (mode === 'taiko') {
        userSpeedVal = Number(userSkills.stamina || 45);
        userAimVal = Number(userSkills.color || 45);
    } else if (mode === 'fruits' || mode === 'catch') {
        userAimVal = Number(userSkills.movement || 50);
        userSpeedVal = Number(userSkills.consistency || 40);
    } else if (mode === 'mania') {
        userSpeedVal = Number(userSkills.speed || 40);
        userAimVal = Number(userSkills.stamina || 45);
    }

    const aimBonus = Math.max(-0.4, Math.min(1.2, ((userAimVal - 35) / 25) * 0.8));
    const speedBonus = Math.max(-0.6, Math.min(1.2, ((userSpeedVal - 35) / 25) * 0.6));

    // Techo dinámico de pass adaptado a la composición del mapa y skills del jugador
    const effectivePassRating = pushProfile.pushStars + 0.75 + (aimWeight * aimBonus) + (speedWeight * speedBonus);

    // Delta respecto al techo real de pass del jugador
    const passDelta = mapSR - effectivePassRating;

    let passProb = 50;
    if (passDelta <= -1.0) passProb = 95;
    else if (passDelta <= -0.5) passProb = 88 + ((-0.5 - passDelta) / 0.5) * 7;
    else if (passDelta <= 0) passProb = 75 + ((-passDelta) / 0.5) * 13;
    else if (passDelta <= 0.4) passProb = 55 - (passDelta / 0.4) * 20;
    else if (passDelta <= 0.8) passProb = 35 - ((passDelta - 0.4) / 0.4) * 20;
    else if (passDelta <= 1.3) passProb = 15 - ((passDelta - 0.8) / 0.5) * 10;
    else passProb = Math.max(1, 5 - (passDelta - 1.3) * 4);

    // Factor Speed / BPM basado en el percentil 85 ponderado de los top plays del jugador
    const estimatedComfortBPM = pushProfile.comfortBpm || Math.round(160 + userSpeedVal * 1.2);
    if (mapBPM > estimatedComfortBPM) {
        const bpmOver = mapBPM - estimatedComfortBPM;
        const streamFactor = speedWeight >= 0.5 ? 1.2 : 0.6;
        const bpmPenalty = Math.min(35, (bpmOver / 30) * 18 * streamFactor);
        passProb -= bpmPenalty;
    } else {
        passProb += Math.min(6, ((estimatedComfortBPM - mapBPM) / 40) * 4);
    }

    // Factor HP Drain (HP bajo <=4 es muy tolerante para pasar, HP >=6.5 es estricto)
    if (effHP <= 4.0) passProb += (4.0 - effHP) * 3;
    else if (effHP >= 6.5) passProb -= (effHP - 6.5) * 4;

    // Factor Longitud (mapas cortos de jumps acumulan menos fatiga)
    if (hitLength < 90) passProb += 5;
    else if (hitLength > 240) passProb -= 4;

    // --- CÁLCULO DE PROBABILIDAD DE FC (Base antes de barreras de lectura/FL) ---
    // ponytail: El techo de consistencia (FC) se modela a partir de fcStars (jugadas limpias con 0-1 misses
    // ponderadas al 0.95^i) modulado por el arquetipo del mapa (Aim vs Speed).
    const baseFcStars = pushProfile.fcStars || (pushProfile.pushStars - (pushProfile.isChokePusher ? 0.6 : 0.3));
    const fcAimBonus = Math.max(-0.4, Math.min(0.8, ((userAimVal - 45) / 25) * 0.5));
    const fcSpeedBonus = Math.max(-0.4, Math.min(0.8, ((userSpeedVal - 45) / 25) * 0.5));
    const effectiveFcRating = baseFcStars + (aimWeight * fcAimBonus) + (speedWeight * fcSpeedBonus);

    // Delta continuo respecto al techo de consistencia (FC) real del jugador
    const fcDelta = mapSR - effectiveFcRating;

    let fcProb = 50;
    if (fcDelta <= -1.2) {
        fcProb = 88 + Math.min(7, (-1.2 - fcDelta) * 5); // 88% a 95%
    } else if (fcDelta <= -0.6) {
        fcProb = 72 + ((-0.6 - fcDelta) / 0.6) * 16; // 72% a 88%
    } else if (fcDelta <= 0.0) {
        fcProb = 48 + ((-fcDelta) / 0.6) * 24; // 48% a 72%
    } else if (fcDelta <= 0.3) {
        fcProb = 28 - (fcDelta / 0.3) * 20; // 28% a 48%
    } else if (fcDelta <= 0.7) {
        fcProb = 12 - ((fcDelta - 0.3) / 0.4) * 16; // 12% a 28%
    } else if (fcDelta <= 1.2) {
        fcProb = 2.5 - ((fcDelta - 0.7) / 0.5) * 9.5; // 2.5% a 12%
    } else {
        fcProb = Math.max(0.1, 2.5 - (fcDelta - 1.2) * 2.0); // < 2.5%
    }

    // Factor de consistencia continuo según longitud/combo del mapa (curva suave sin escalones bruscos)
    const comboFactor = Math.max(0.55, Math.min(1.1, 1.05 - (Math.max(0, mapCombo - 500) / 3500) * 0.5));
    fcProb *= comboFactor;

    if (pushProfile.isChokePusher) fcProb *= 0.88;

    if (mapBPM > estimatedComfortBPM + 10) {
        const bpmOver = mapBPM - estimatedComfortBPM;
        const bpmPenalty = Math.min(0.65, (bpmOver / 30) * 0.4 * (speedWeight >= 0.5 ? 1.0 : 0.6));
        fcProb *= (1.0 - bpmPenalty);
    }

    // Historial previo en el mapa específico
    if (playedBefore && prevScore) {
        const misses = Number(prevScore.statistics?.count_miss ?? prevScore.statistics?.miss ?? 0);
        const isFc = prevScore.perfect === true || prevScore.legacy_perfect === true || misses === 0;
        const comboRatio = (prevScore.max_combo || prevScore.combo || 0) / Math.max(1, mapCombo);

        if (isFc) {
            // Ya tiene un FC previo verificado en este mapa: probabilidad muy alta de repetir
            fcProb = Math.max(fcProb, 82);
        } else if (misses <= 2 && comboRatio >= 0.80) {
            // Choke probado en el pasado (1-2 misses en tramo final)
            fcProb = Math.max(fcProb, Math.min(75, fcProb * 1.6 + 15));
        } else if (misses > 20 || comboRatio < 0.25 || (prevScore.accuracy != null && prevScore.accuracy < 0.85)) {
            // Desempeño previo muy distante de FC (baja acc, combo muy quebrado)
            const comboFactorPrev = Math.max(0.05, Math.min(0.8, Math.pow(comboRatio, 0.75)));
            const accVal = (prevScore.accuracy != null ? (prevScore.accuracy <= 1 ? prevScore.accuracy : prevScore.accuracy / 100) : 0.8);
            const accFactorPrev = Math.pow(Math.max(0.4, accVal), 2.5);
            fcProb *= Math.max(0.01, comboFactorPrev * accFactorPrev);
        } else if (misses >= 5 || comboRatio < 0.50) {
            fcProb *= 0.65;
        }
    }

    // --- BARRERA DE LECTURA (LOW AR / ALTA DENSIDAD / EZ & HIGH AR) ---
    let arExtreme = false;
    let arOver = 0;
    let readingNote = null;

    let readingDemand = 10;
    let isReadingHeavy = false;

    if (hasEZ) {
        isReadingHeavy = true;
        // En EZ el tiempo de aparición es muy alto (AR <= 5) y las notas se apilan masivamente
        readingDemand = 60 + Math.max(0, 5.0 - effAR) * 12;
        if (hasHD) readingDemand += 15;
    } else if (hasHD) {
        if (effAR <= 8.5) {
            isReadingHeavy = true;
            readingDemand = 38 + (8.5 - effAR) * 10;
        }
    } else if (effAR < 7.5) {
        isReadingHeavy = true;
        readingDemand = 30 + (7.5 - effAR) * 12;
    }

    if (isReadingHeavy) {
        const readingGap = readingSkill - readingDemand;
        if (readingGap < -20) {
            // Jugador sin lectura para procesar esta densidad (ej: jugador de nomod de alta AR)
            const penaltyFactor = Math.max(0.12, Math.pow(0.5, Math.abs(readingGap) / 25));
            passProb *= penaltyFactor;
            fcProb *= Math.max(0.01, penaltyFactor * 0.25);
            readingNote = 'poor';
        } else if (readingGap < 0) {
            const penalty = Math.min(22, (Math.abs(readingGap) / 20) * 14);
            passProb -= penalty;
            fcProb *= Math.max(0.15, 1 - (Math.abs(readingGap) / 20) * 0.45);
            readingNote = 'challenging';
        } else {
            // El jugador es especialista o tiene solidez en lectura (ej: Milin con reading 65.7)
            passProb += Math.min(6, (readingGap / 25) * 5);
            readingNote = 'good';
        }
    }

    if (effAR >= 10.6) {
        // AR extremo (<= 350ms de tiempo de reacción)
        if (maxProvenAR < effAR - 0.2) {
            arExtreme = true;
            if (effAR >= 11.0) {
                // AR 11.0 (300ms): si no se tiene dominio de AR 11, la reacción física hace casi imposible pasar
                const readingGap = Math.max(0.5, effAR - maxProvenAR);
                const penaltyFactor = Math.max(0.01, Math.pow(0.2, readingGap));
                passProb = Math.max(1, Math.min(4, Math.round(passProb * penaltyFactor)));
                fcProb = 0.0;
            } else {
                const readingGap = Math.max(0.3, effAR - maxProvenAR);
                const penaltyFactor = Math.max(0.05, Math.pow(0.35, readingGap * 2.0));
                passProb *= penaltyFactor;
                fcProb *= Math.max(0.01, penaltyFactor * 0.5);
            }
        }
    } else if (effAR > readingComfort + 0.3) {
        arOver = effAR - readingComfort;
        const penalty = Math.min(45, (arOver / 0.5) * 15);
        passProb -= penalty;
        fcProb *= Math.max(0.05, 1 - (arOver / 0.5) * 0.4);
    }

    // --- FACTOR FLASHLIGHT (FL) - EXIGE MEMORIZACIÓN ---
    if (hasFL) {
        if (!flMemorized) {
            if (!playerHasFLInTops) {
                // Jugador normal sin memorización en este mapa:
                // FL reduce el campo visual masivamente. A más de 3.5★ o más de 120x, es fail garantizado
                if (mapSR >= 3.8 || mapCombo > 120) {
                    passProb = 1;
                    fcProb = 0.0;
                } else {
                    passProb = Math.min(passProb, 8);
                    fcProb = Math.min(fcProb, 0.2);
                }
            } else {
                // Jugador con experiencia en FL, pero sin memorizar este mapa en particular
                passProb = Math.min(passProb, 12);
                fcProb = Math.min(fcProb, 0.5);
            }
        }
    }

    // Historial previo compatible
    if (passedBefore && !usedNF) {
        passProb = Math.max(90, Math.min(99, passProb + 35));
    } else if (playedBefore && usedNF) {
        const prevAcc = (prevScore.accuracy || 0.8) * (prevScore.accuracy <= 1 ? 100 : 1);
        if (prevAcc >= 92) passProb = Math.max(70, passProb + 25);
        else if (prevAcc >= 85) passProb = Math.max(45, passProb + 10);
        else passProb = Math.min(passProb, 35);
    }

    passProb = Math.max(1, Math.min(99, Math.round(passProb)));
    fcProb = Math.max(0.0, Math.min(95, Number(fcProb.toFixed(1))));

    const prevScoreMods = prevScore ? extractModAcronyms(prevScore.mods) : [];
    const prevScoreModsStr = prevScoreMods.length > 0 ? `+${prevScoreMods.join('')}` : 'NM';

    return {
        passProb,
        fcProb,
        playedBefore,
        passedBefore,
        usedNF,
        prevScore: prevScore ? {
            rank: prevScore.rank,
            acc: ((prevScore.accuracy != null ? (prevScore.accuracy <= 1 ? prevScore.accuracy * 100 : prevScore.accuracy) : 0)).toFixed(2) + '%',
            combo: `${prevScore.max_combo || prevScore.combo || 0}x/${mapCombo}x`,
            mods: prevScoreMods,
            modsStr: prevScoreModsStr,
            isCompatiblePass: scoreCompatibility ? scoreCompatibility.isCompatiblePass : true,
            isAssistedMismatch: scoreCompatibility ? scoreCompatibility.isAssistedMismatch : false,
            isReductionMismatch: scoreCompatibility ? scoreCompatibility.isReductionMismatch : false,
            isSpeedMismatch: scoreCompatibility ? scoreCompatibility.isSpeedMismatch : false
        } : null,
        map: {
            sr: mapSR,
            bpm: mapBPM,
            combo: mapCombo,
            ar: Number(effAR.toFixed(1)),
            od: Number(effOD.toFixed(1)),
            cs: Number(effCS.toFixed(1)),
            hp: Number(effHP.toFixed(1)),
            archetypeKey: mapArchetypeKey,
            aimWeight: Number(aimWeight.toFixed(2)),
            speedWeight: Number(speedWeight.toFixed(2))
        },
        factors: {
            pushStars: pushProfile.pushStars,
            fcStars: pushProfile.fcStars || pushProfile.pushStars,
            effectivePassRating: Number(effectivePassRating.toFixed(2)),
            effectiveFcRating: Number(effectiveFcRating.toFixed(2)),
            userAim: userAimVal,
            userSpeed: userSpeedVal,
            userReading: readingSkill,
            readingDemand: Math.round(readingDemand),
            isReadingHeavy,
            readingNote,
            estimatedComfortBPM: Math.round(estimatedComfortBPM),
            bpmOver: Math.max(0, mapBPM - Math.round(estimatedComfortBPM)),
            avgAcc: pushProfile.avgAcc,
            hasFL,
            flMemorized,
            arExtreme,
            arOver,
            arMs: effArMs,
            readingComfort: Number(readingComfort.toFixed(1)),
            maxProvenAR: Number(maxProvenAR.toFixed(1))
        }
    };
}

async function run(messages, args) {
    const { message, res, reply, logger } = messages;
    const locale = message.locale || 'es';

    const options = parsePuedoArgs(args);
    let targetBeatmapId = options.beatmapId;

    // Si hay un mensaje referenciado (reply)
    if (message.reference && message.reference.messageId) {
        try {
            const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
            if (repliedMsg && repliedMsg.embeds && repliedMsg.embeds.length > 0) {
                const embed = repliedMsg.embeds[0];
                const { parsePlayEmbed } = require("./rework.js");
                const playFromReply = parsePlayEmbed(embed);
                if (playFromReply && playFromReply.beatmapId) {
                    if (!targetBeatmapId) targetBeatmapId = playFromReply.beatmapId;
                    if (!options.mods && playFromReply.mods && playFromReply.mods.length > 0) {
                        options.mods = playFromReply.mods.join('');
                    }
                } else if (embed.url) {
                    const match = embed.url.match(/osu\.ppy\.sh\/b(?:eatmaps)?\/(\d+)/) ||
                                  embed.url.match(/osu\.ppy\.sh\/beatmapsets\/\d+#(?:osu|taiko|fruits|mania)\/(\d+)/);
                    if (match && !targetBeatmapId) targetBeatmapId = match[1];
                }
            }
        } catch (e) {}
    }

    // Si aún no tenemos ID de mapa, buscar en el canal
    if (!targetBeatmapId) {
        const channelResult = reply
            ? await findBeatmapInChannel(reply, true)
            : await findBeatmapInChannel(message, false);

        if (channelResult && channelResult.beatmap_url) {
            const rawUrl = String(channelResult.beatmap_url);
            const match = rawUrl.match(/b(?:eatmaps)?\/(\d+)/) ||
                          rawUrl.match(/#(?:\w+)\/(\d+)/) ||
                          rawUrl.match(/^(\d+)$/);
            if (match) {
                targetBeatmapId = match[1];
            } else if (!rawUrl.startsWith('set/')) {
                targetBeatmapId = rawUrl;
            }
        }
    }

    if (!targetBeatmapId) {
        return t(locale, 'puedo.err_no_map') || '❌ No se encontró ningún beatmap para analizar. Especifica un link o responde a un mensaje con un mapa.';
    }

    await OsuUserModel.NewloadToken();

    // Resolver usuario de osu!
    let osuUser = null;
    let targetGamemode = options.mode;

    try {
        if (options.targetUser) {
            let target = options.targetUser;
            // Si es un ID de Discord (mención o 17-20 dígitos)
            if (/^\d{17,20}$/.test(target)) {
                let linked = await OsuUserModel.getLinkedUser(res?.User, target);
                if (!linked || !linked.osu_id) {
                    const oauthRec = await OsuUserModel.getOAuthTokenRecord(target);
                    if (oauthRec && oauthRec.osu_id) {
                        linked = { osu_id: oauthRec.osu_id, username: oauthRec.username, main_gamemode: 'osu' };
                    }
                }
                if (linked && (linked.osu_id || linked.username)) {
                    target = String(linked.osu_id || linked.username);
                    if (!targetGamemode && linked.main_gamemode) targetGamemode = linked.main_gamemode;
                } else {
                    return t(locale, 'general.err_discord_user_not_linked') || '❌ El usuario de Discord especificado no tiene su cuenta de osu! vinculada.';
                }
            }
            osuUser = await OsuUserModel.getOsuUser({ username: [target], gamemode: targetGamemode || 'osu', server: 'bancho' });
        } else {
            // Intentar con usuario vinculado del autor
            const authorDiscordId = message.author?.id;
            let linked = authorDiscordId ? await OsuUserModel.getLinkedUser(res?.User, authorDiscordId) : null;
            if (!linked || !linked.osu_id) {
                const oauthRec = authorDiscordId ? await OsuUserModel.getOAuthTokenRecord(authorDiscordId) : null;
                if (oauthRec && oauthRec.osu_id) {
                    linked = { osu_id: oauthRec.osu_id, username: oauthRec.username, main_gamemode: 'osu' };
                }
            }

            if (linked && (linked.osu_id || linked.username)) {
                if (!targetGamemode && linked.main_gamemode) targetGamemode = linked.main_gamemode;
                osuUser = await OsuUserModel.getOsuUser({ username: [String(linked.osu_id || linked.username)], gamemode: targetGamemode || 'osu', server: 'bancho' });
            }

            // Fallback: si no está vinculado, intentar con el username de Discord del autor
            if (!osuUser || typeof osuUser === 'string' || !osuUser.id) {
                if (message.author?.username) {
                    const fallbackUser = await OsuUserModel.getOsuUser({ username: [message.author.username], gamemode: targetGamemode || 'osu', server: 'bancho' }).catch(() => null);
                    if (fallbackUser && typeof fallbackUser !== 'string' && fallbackUser.id) {
                        osuUser = fallbackUser;
                    }
                }
            }
        }
    } catch (e) {
        console.error('[s.puedo] Error al resolver usuario:', e);
    }

    if (!osuUser || typeof osuUser === 'string' || !osuUser.id) {
        return t(locale, 'puedo.err_no_user') || '❌ No se encontró tu cuenta de osu! vinculada ni el usuario especificado. Usa `s.link` para vincular tu cuenta.';
    }

    // Obtener información del beatmap
    let beatmapData = null;
    let actualBeatmapId = targetBeatmapId;

    if (String(targetBeatmapId).startsWith('set/')) {
        const setId = targetBeatmapId.replace('set/', '');
        const setDetails = await BeatmapModel.getBeatmapset(setId).catch(() => null);
        if (setDetails && setDetails.beatmaps && setDetails.beatmaps.length > 0) {
            // Ordenar por SR descendente para tomar la dificultad más alta
            const sorted = [...setDetails.beatmaps].sort((a, b) => (b.difficulty_rating || 0) - (a.difficulty_rating || 0));
            actualBeatmapId = sorted[0].id;
            beatmapData = sorted[0];
            beatmapData.beatmapset = setDetails;
        }
    } else {
        beatmapData = await BeatmapModel.getBeatmap(actualBeatmapId).catch(() => null);
        if (!beatmapData) {
            const setDetails = await BeatmapModel.getBeatmapset(actualBeatmapId).catch(() => null);
            if (setDetails && setDetails.beatmaps && setDetails.beatmaps.length > 0) {
                const sorted = [...setDetails.beatmaps].sort((a, b) => (b.difficulty_rating || 0) - (a.difficulty_rating || 0));
                actualBeatmapId = sorted[0].id;
                beatmapData = sorted[0];
                beatmapData.beatmapset = setDetails;
            }
        }
    }

    if (!beatmapData || !beatmapData.id) {
        return t(locale, 'puedo.err_fetch_map') || '❌ No se pudo obtener la información del mapa seleccionado.';
    }

    const targetMode = targetGamemode || beatmapData.mode || osuUser.playmode || 'osu';
    const cleanMods = options.mods ? options.mods.toUpperCase().replace(/[^A-Z0-9]/g, '') : 'NM';
    const activeModsStr = cleanMods === '' ? 'NM' : cleanMods;

    // Calcular atributos precisos con el motor de PP
    let diffAttrs = null;
    let perfAttrs = null;
    let strains = null;
    let mapAttrs = null;
    try {
        const engine = ppEngine.getEngine();
        const map = await getBeatmap_osu(beatmapData.beatmapset_id || beatmapData.beatmapset?.id, beatmapData.id, beatmapData);
        if (map) {
            try {
                const builder = new engine.BeatmapAttributesBuilder({ map, mods: activeModsStr });
                mapAttrs = builder.build();
            } catch (_) {}

            const diff = new engine.Difficulty({ mods: activeModsStr });
            diffAttrs = diff.calculate(map);
            perfAttrs = new engine.Performance({ mods: activeModsStr, accuracy: 100 }).calculate(diffAttrs);
            try {
                strains = diff.strains(map);
            } catch (_) {}
            map.free();
        }
    } catch (e) {}

    // Obtener top scores y puntuaciones del usuario en el beatmap
    let topScores = [];
    let allUserScores = [];
    let bestScoreFallback = null;

    try {
        [topScores, allUserScores, bestScoreFallback] = await Promise.all([
            OsuScoreModel.getUserTopScores({ username: [String(osuUser.id)], gamemode: targetMode, server: 'bancho' }).catch(() => []),
            OsuScoreModel.getBeatmapUserAllScores({
                username: [String(osuUser.id)],
                beatmap_url: beatmapData.id,
                gamemode: targetMode,
                server: 'bancho'
            }).catch(() => []),
            OsuScoreModel.getUserBeatmapBest(beatmapData.id, osuUser.id, targetMode).catch(() => null)
        ]);
    } catch (e) {
        console.error('[s.puedo] Error al obtener puntuaciones del usuario:', e);
    }

    const candidateScores = [];
    if (Array.isArray(allUserScores)) {
        candidateScores.push(...allUserScores);
    }
    if (bestScoreFallback) {
        const fallbackScore = bestScoreFallback.score || bestScoreFallback;
        if (fallbackScore && fallbackScore.id && !candidateScores.some(s => s.id === fallbackScore.id)) {
            candidateScores.push(fallbackScore);
        }
    }

    let chosenScore = null;
    let chosenCompat = null;

    if (candidateScores.length > 0) {
        const evaluated = candidateScores.map(score => {
            const compat = evaluateScoreCompatibility(score, activeModsStr);
            const isPassedRaw = score.passed !== false && !['F'].includes(score.rank);
            const isPass = compat.isCompatiblePass && isPassedRaw;
            const hasNF = compat.scoreHasNF;
            const scoreVal = Number(score.legacy_total_score || score.total_score || score.score || 0);
            const comboVal = Number(score.max_combo || score.combo || 0);

            let tier = 1;
            if (compat.isCompatiblePass) {
                if (isPass && !hasNF) tier = compat.isExactMatch ? 5.5 : 5;
                else if (isPass && hasNF) tier = 4;
                else tier = 3;
            } else {
                if (isPassedRaw) tier = 2;
                else tier = 1;
            }

            return { score, compat, tier, scoreVal, comboVal };
        });

        evaluated.sort((a, b) => b.tier - a.tier || b.scoreVal - a.scoreVal || b.comboVal - a.comboVal);
        chosenScore = evaluated[0].score;
        chosenCompat = evaluated[0].compat;
    }

    const analysis = calculateProbabilities({
        user: osuUser,
        topScores: Array.isArray(topScores) ? topScores : [],
        beatmap: beatmapData,
        bestScore: chosenScore,
        activeModsStr,
        diffAttrs,
        perfAttrs,
        scoreCompatibility: chosenCompat,
        mapAttrs
    });

    // Calcular If FC PP (rendimiento en caso de FC al 100% y a la acc promedio del jugador)
    if (diffAttrs && perfAttrs) {
        try {
            const engine = ppEngine.getEngine();
            const pp100 = Math.round(perfAttrs.pp || 0);
            const avgAccPct = Math.round((analysis.factors?.avgAcc || 0.98) * 1000) / 10;
            const perfAvg = new engine.Performance({ mods: activeModsStr, accuracy: avgAccPct }).calculate(diffAttrs);
            analysis.ifFc = {
                pp100,
                ppAvg: Math.round(perfAvg.pp || 0),
                accAvg: avgAccPct.toFixed(1)
            };
        } catch (_) {}
    }

    // Generar gráfico panorámico híbrido de diagnóstico
    let graphAttachment = null;
    try {
        const { generatePuedoGraph } = require('../../../utils/puedoGraph.js');
        const graphBuffer = await generatePuedoGraph({
            mapData: beatmapData,
            analysis,
            strains,
            activeModsStr,
            user: osuUser,
            locale
        });
        if (graphBuffer) {
            const { AttachmentBuilder } = require('discord.js');
            graphAttachment = new AttachmentBuilder(graphBuffer, { name: 'puedo_diagnostic.png' });
        }
    } catch (err) {
        console.error('[s.puedo] Error al generar gráfico de diagnóstico:', err);
    }

    const embed = doOsuPuedoEmbed({
        message,
        user: osuUser,
        map: {
            ...beatmapData,
            artist: beatmapData.beatmapset?.artist || beatmapData.artist,
            title: beatmapData.beatmapset?.title || beatmapData.title,
            covers: beatmapData.beatmapset?.covers || beatmapData.covers
        },
        analysis,
        activeModsStr,
        locale,
        hasGraph: Boolean(graphAttachment)
    });

    const responsePayload = {
        embeds: [embed],
        files: graphAttachment ? [graphAttachment] : []
    };

    if (reply && typeof reply.reply === 'function') {
        return await reply.reply(responsePayload);
    }
    return responsePayload;
}

run.description = {
    header: t("es", "commands.puedo.header"),
    body: t("es", "commands.puedo.body"),
    usage: t("es", "commands.puedo.usage")
};
run.alias = {
    "canipass": {},
    "pass": {},
    "fcear": {},
    "canifc": {},
    "puedopasar": {}
};
run.flags = ["+mods", "-mods", "-modo", "-server"];

module.exports = { run, parsePuedoArgs, calculateProbabilities, evaluateScoreCompatibility, extractModAcronyms, description: run.description, alias: run.alias, flags: run.flags };
