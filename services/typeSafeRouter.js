/**
 * services/typeSafeRouter.js
 * 
 * Enrutador de Lenguaje Natural para Sengo basado en Jev (TypeSafe AI - System One).
 * Evalúa intenciones de los usuarios con latencia ultrabaja (~100-300ms) sin alucinaciones.
 * 
 * ponytail: 0 dependencias añadidas, usa fetch nativo de Node 22 y AbortSignal.timeout.
 */

const TYPESAFE_API_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 3500;

/**
 * Define el esquema de preguntas SystemOne para clasificar intenciones de osu!
 */
function buildJevQuestions() {
    return {
        // 1. Comando principal
        command: {
            type: "choice",
            instructions: "¿Qué acción o comando de Sengo desea ejecutar el usuario?",
            criteria: {
                top: "Consultar mejores jugadas (top plays, mejores puntuaciones, récords personales, mejores scores)",
                recent: "Consultar la jugada más reciente (última partida jugada, rs, recent play)",
                profile: "Ver perfil general, estadísticas globales o tarjeta de usuario (osu, perfil, stats)",
                compare: "Comparar puntuación en un beatmap específico o último mapa (c, compare)",
                recommend: "Recomendar beatmaps para jugar o farmear pp (recommend, rec)",
                subir: "Calcular qué jugada o pp necesita para subir de rango o posición",
                skills: "Ver habilidades cinéticas, radar o desglose de skills",
                gap: "Calcular diferencia de pp o posiciones con otro jugador",
                daily: "Consultar el desafío o reto diario de osu! (reto del día, daily)",
                leaderboard: "Ver la tabla de clasificación o ranking de un mapa (lb, leaderboard)",
                map: "Ver información, dificultad o enlace de un beatmap (m, map)",
                bg: "Obtener o descargar el fondo o background de un beatmap (bg)",
                card: "Generar tarjeta gráfica o imagen Canvas de perfil (card)",
                link: "Vincular o enlazar cuenta de osu! con OAuth (link, vincular)",
                rework: "Consultar cambios de pp o impacto con reworks de osu! (rework)",
                snipes: "Ver snipes, primer lugar (#1s) o historial de snipes (snipes)",
                render: "Renderizar o grabar video de replay de osu! (render, o!rdr)",
                sim: "Simular pp y dificultad de un beatmap con mods o precisión (sim)",
                skin: "Buscar o descargar skins de osu! (skin)",
                torneos: "Consultar torneos de osu! activos o información de torneos (torneos)",
                track: "Rastrear o hacer seguimiento de actividad de un jugador (track)",
                twins: "Buscar gemelos de estadísticas o jugadores similares (twins, twin)",
                amigos: "Ver lista o estado de amigos vinculados de osu! (amigos)",
                nacional: "Ver ranking nacional o jugadores top de un país (nacional)",
                regional: "Ver ranking regional (regional)",
                pais: "Ver información o top de un país (pais)",
                mapper: "Ver estadísticas de mapas creados por un mapper (mapper)",
                queue: "Ver cola de mapas para testear o modear (queue)",
                digitos: "Ver estadísticas por dígitos de ranking (digitos)",
                entre: "Ver jugadores entre dos rangos o posiciones de pp (entre)",
                lazer: "Consultar scores o ranking de osu! lazer (lazer)",
                classic: "Consultar scores o modo classic de osu! (classic)",
                droid: "Consultar scores o perfil de osu! droid (droid)",
                bcv: "Consultar la tasa del dólar oficial BCV en Venezuela (bcv, tasa bcv, dolar bcv)",
                binance: "Consultar el precio o tasa de Binance P2P USDT (binance, tasa binance)",
                brecha: "Consultar la brecha cambiaria entre dólar paralelo y BCV (brecha)",
                ping: "Medir la latencia o ping del bot (ping)",
                help: "Ver la ayuda de comandos o lista de funciones del bot (help, ayuda)",
                invite: "Obtener el enlace de invitación para añadir el bot (invite, invitar)",
                acerca: "Información acerca del bot, creadores o versión (acerca, about)",
                language: "Cambiar o consultar el idioma del bot (language, idioma)",
                roll: "Lanzar un dado o número aleatorio (roll, dado)",
                github: "Ver el repositorio de GitHub o código fuente del bot (github)",
                bug: "Reportar un error o bug del bot (bug)",
                sugerencia: "Enviar una sugerencia para el bot (sugerencia)",
                cumple: "Ver o celebrar cumpleaños de usuarios (cumple, cumpleaños)",
                fumo: "Ver una foto o imagen de fumo (fumo)",
                yuri: "Ver una imagen de anime yuri (yuri)",
                laburo: "Meme de laburo o chamba (laburo)",
                none: "Ninguna acción de comando reconocida, charla casual, saludo o mensaje no relacionado"
            }
        },
        // 2. Modo de juego
        gamemode: {
            type: "choice",
            instructions: "¿Qué modo de juego de osu! especificó explícitamente el usuario en su mensaje?",
            criteria: {
                osu: "Standard, std, normal, círculos, osu",
                taiko: "Taiko, tambores",
                fruits: "Catch the Beat, ctb, frutas, catch",
                mania: "Mania, teclas, 4k, 7k",
                default: "No especificó ningún modo (usar modo principal o estándar)"
            }
        },
        // 3. Flag de orden reciente en top (s.top -recent)
        is_recent_sort: {
            type: "noul",
            instructions: "¿El usuario pide ver sus mejores jugadas ordenadas por las más recientes en el tiempo?"
        },
        // 4. Flag de formato lista (s.top -list)
        is_list: {
            type: "noul",
            instructions: "¿El usuario pide ver una lista compacta de jugadas en vez de un embed individual?"
        },
        // 5. Flag de solo jugadas pasadas en recent (s.rs -ps)
        is_pass_only: {
            type: "noul",
            instructions: "¿El usuario pide específicamente solo jugadas pasadas (pass / completadas sin fail)?"
        },
        // 6. Filtro de mods
        mods_filter: {
            type: "choice",
            instructions: "¿El usuario especifica algún mod específico de juego (como DT, HR, HD, EZ, FL)?",
            criteria: {
                none: "No especifica ningún mod o filtro de mods",
                dt: "Double Time, DT, NC, Nightcore, acelerado",
                hr: "Hard Rock, HR, difícil",
                hd: "Hidden, HD, oculto",
                ez: "Easy, EZ, fácil",
                fl: "Flashlight, FL, linterna",
                nomod: "NoMod, NM, sin mods"
            }
        }
    };
}

/**
 * Extracción determinística de entidades (menciones, links, índices numéricos)
 */
function extractEntities(rawText) {
    let cleanText = (rawText || '').trim();

    // Extraer menciones de Discord: <@123456789> o <@!123456789>
    let targetDiscordId = null;
    const mentionMatch = cleanText.match(/<@!?(\d+)>/);
    if (mentionMatch) {
        targetDiscordId = mentionMatch[1];
        cleanText = cleanText.replace(mentionMatch[0], '').trim();
    }

    // Extraer links de beatmaps: osu.ppy.sh/b/123 o /beatmaps/123
    let beatmapId = null;
    const mapMatch = cleanText.match(/osu\.ppy\.sh\/(?:b|beatmaps)\/(\d+)/i);
    if (mapMatch) {
        beatmapId = mapMatch[1];
    }

    // Extraer índice numérico (ej: "mi top 5", "#3")
    let scoreIndex = null;
    const indexMatch = cleanText.match(/(?:#|top\s+)(\d{1,2})\b/i);
    if (indexMatch) {
        scoreIndex = parseInt(indexMatch[1], 10);
    }

    return { cleanText, targetDiscordId, beatmapId, scoreIndex };
}

/**
 * Traduce las respuestas estructuradas de Jev en comando y flags canónicas de Sengo
 */
function translateJevToSengoCommand(jevAnswers, entities) {
    if (!jevAnswers || !jevAnswers.command) return null;

    const cmdDecision = jevAnswers.command.choice || 'none';
    const confidence = jevAnswers.command.confidence ?? 1.0;

    // Si no reconoció comando o la confianza es baja, no intervenir
    if (cmdDecision === 'none' || confidence < 0.65) {
        return null;
    }

    const COMMAND_MAP = {
        top: 'top',
        recent: 'rs',
        profile: 'osu',
        compare: 'c',
        recommend: 'recommend',
        subir: 'subir',
        skills: 'skills',
        gap: 'gap',
        daily: 'daily',
        leaderboard: 'lb',
        map: 'm',
        bg: 'bg',
        card: 'card',
        link: 'link',
        rework: 'rework',
        snipes: 'snipes',
        render: 'render',
        sim: 'sim',
        skin: 'skin',
        torneos: 'torneos',
        track: 'track',
        twins: 'twins',
        amigos: 'amigos',
        nacional: 'nacional',
        regional: 'regional',
        pais: 'pais',
        mapper: 'mapper',
        queue: 'queue',
        digitos: 'digitos',
        entre: 'entre',
        lazer: 'lazer',
        classic: 'classic',
        droid: 'droid',
        bcv: 'bcv',
        binance: 'binance',
        brecha: 'brecha',
        ping: 'ping',
        help: 'help',
        invite: 'invite',
        acerca: 'acerca',
        language: 'language',
        roll: 'roll',
        github: 'github',
        bug: 'bug',
        sugerencia: 'sugerencia',
        cumple: 'cumple',
        fumo: 'fumo',
        yuri: 'yuri',
        laburo: 'laburo'
    };

    const sengoCommand = COMMAND_MAP[cmdDecision] || cmdDecision;
    const sengoArgs = [];

    // Mapeo de modo de juego
    const mode = jevAnswers.gamemode?.choice;
    if (mode && mode !== 'default') {
        if (mode === 'osu') sengoArgs.push('-std');
        else if (mode === 'taiko') sengoArgs.push('-taiko');
        else if (mode === 'fruits') sengoArgs.push('-fruits');
        else if (mode === 'mania') sengoArgs.push('-mania');
    }

    // Flags condicionales según el comando
    if (sengoCommand === 'top') {
        if (jevAnswers.is_recent_sort?.noul > 0.70) {
            sengoArgs.push('-recent');
        }
        if (jevAnswers.is_list?.noul > 0.70) {
            sengoArgs.push('-list');
        }
        if (entities.scoreIndex) {
            sengoArgs.push(String(entities.scoreIndex));
        }
    } else if (sengoCommand === 'rs') {
        if (jevAnswers.is_pass_only?.noul > 0.50) {
            sengoArgs.push('-ps');
        }
    }

    // Filtro de mods
    const mod = jevAnswers.mods_filter?.choice;
    if (mod && mod !== 'none') {
        if (mod === 'dt') sengoArgs.push('+DT');
        else if (mod === 'hr') sengoArgs.push('+HR');
        else if (mod === 'hd') sengoArgs.push('+HD');
        else if (mod === 'ez') sengoArgs.push('+EZ');
        else if (mod === 'fl') sengoArgs.push('+FL');
        else if (mod === 'nomod') sengoArgs.push('+NM');
    }

    // Enlace o ID de beatmap detectado
    if (entities.beatmapId && ['m', 'bg', 'c', 'lb', 'sim'].includes(sengoCommand)) {
        sengoArgs.push(`https://osu.ppy.sh/b/${entities.beatmapId}`);
    }

    // Flag especial para render (-skip)
    if (sengoCommand === 'render' && entities.cleanText.toLowerCase().includes('skip')) {
        sengoArgs.push('-skip');
    }

    // Entidad de usuario mencionada
    if (entities.targetDiscordId) {
        sengoArgs.unshift(`<@${entities.targetDiscordId}>`);
    }

    return {
        command: sengoCommand,
        args: sengoArgs,
        fullCommandString: `s.${sengoCommand}${sengoArgs.length > 0 ? ' ' + sengoArgs.join(' ') : ''}`,
        confidence: confidence
    };
}

/**
 * Consulta la API de TypeSafe AI (Jev) para interpretar el texto en lenguaje natural
 * @param {string} userInput - Texto emitido por el usuario
 * @returns {Promise<{command: string, args: string[], fullCommandString: string, confidence: number}|null>}
 */
async function parseNaturalLanguage(userInput) {
    const apiKey = process.env.TYPESAFE_API_KEY;
    if (!apiKey) {
        return null;
    }

    const entities = extractEntities(userInput);
    if (!entities.cleanText || entities.cleanText.length < 3) {
        return null;
    }

    const payload = {
        model: "jev-latest",
        state: entities.cleanText,
        questions: buildJevQuestions()
    };

    try {
        const response = await fetch(TYPESAFE_API_ENDPOINT, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });

        if (!response.ok) {
            console.error(`[TYPESAFE] Error HTTP ${response.status} de la API de TypeSafe AI.`);
            return null;
        }

        const data = await response.json();
        return translateJevToSengoCommand(data.answers, entities);
    } catch (err) {
        if (err.name === 'TimeoutError') {
            console.warn("[TYPESAFE] Tiempo de espera agotado al consultar TypeSafe Jev.");
        } else {
            console.error("[TYPESAFE] Error al comunicarse con TypeSafe Jev:", err.message);
        }
        return null;
    }
}

module.exports = {
    parseNaturalLanguage,
    buildJevQuestions,
    extractEntities,
    translateJevToSengoCommand
};
