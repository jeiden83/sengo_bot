/**
 * services/typeSafeRouter.js
 * 
 * Enrutador de Lenguaje Natural para Sengo basado en Jev (TypeSafe AI - System One).
 * Evalúa intenciones de los usuarios con latencia ultrabaja (~100-300ms) sin alucinaciones.
 * Detecta y soporta de forma exhaustiva todos los flags, modificadores y entidades
 * para todos los comandos del bot.
 * 
 * ponytail: 0 dependencias añadidas, usa fetch nativo de Node 22 y AbortSignal.timeout.
 */

const TYPESAFE_API_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 3500;
const MIN_CONFIDENCE_THRESHOLD = 0.50;

/**
 * Define el esquema de preguntas SystemOne para clasificar intenciones de osu! y Sengo
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
                entre: "Ver o comparar jugadores entre dos rangos o posiciones de pp (entre)",
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
        // 3. Servidor de osu!
        server: {
            type: "choice",
            instructions: "¿El usuario especifica un servidor de osu! distinto del oficial (Bancho)?",
            criteria: {
                default: "Servidor oficial Bancho o no especificado",
                gatari: "Servidor privado Gatari",
                droid: "Servidor de osu!droid"
            }
        },
        // 4. Modalidad de cliente (Lazer vs Classic)
        client_mode: {
            type: "choice",
            instructions: "¿El usuario especifica la modalidad de cliente o puntuación (Lazer vs Classic/Stable)?",
            criteria: {
                none: "No especificado / modo por defecto",
                lazer: "osu! lazer (puntuación normalizada a 1M)",
                classic: "osu! classic o stable (puntuación clásica)"
            }
        },
        // 5. No Choke
        is_nochoke: {
            type: "noul",
            instructions: "¿El usuario solicita calcular o filtrar por no choke (nochoke, no choke, sin fallos/chokes, unchoke)?"
        },
        // 6. Criterio de ordenamiento métrico
        sort_metric: {
            type: "choice",
            instructions: "¿El usuario solicita ordenar sus jugadas por alguna métrica específica distinta del PP?",
            criteria: {
                none: "Sin ordenamiento especial o por defecto (ordenado por PP)",
                bpm: "BPM, velocidad del mapa, tempo",
                acc: "Precisión, accuracy, acc",
                combo: "Combo máximo, racha",
                stars: "Estrellas, dificultad estelar, star rating, sr",
                ar: "Approach Rate, velocidad de reacción, AR",
                cs: "Circle Size, tamaño de círculos, CS",
                od: "Overall Difficulty, dificultad de timing, OD",
                hp: "HP Drain, drenaje de vida, HP",
                length: "Duración, largo, tiempo del mapa",
                recent: "Fecha más reciente, tiempo, orden cronológico",
                score: "Puntuación estandarizada",
                totalscore: "Puntuación total"
            }
        },
        // 7. Invertir orden
        is_reverse: {
            type: "noul",
            instructions: "¿El usuario pide invertir el orden del listado (al revés, invertido, de menor a mayor, menor primero)?"
        },
        // 8. Formato lista
        is_list: {
            type: "noul",
            instructions: "¿El usuario pide ver una lista compacta de jugadas en vez de un embed individual?"
        },
        // 9. Solo pasadas (pass only)
        is_pass_only: {
            type: "noul",
            instructions: "¿El usuario pide específicamente solo jugadas pasadas (pass / completadas sin fail)?"
        },
        // 10. Vista detallada
        is_detailed: {
            type: "noul",
            instructions: "¿El usuario pide ver la información detallada, completa o con desglose avanzado (detallado, con detalles, detail)?"
        },
        // 11. Panel de estadísticas / promedio
        is_promedio: {
            type: "noul",
            instructions: "¿El usuario pide ver estadísticas globales, promedios de su top o panel de métricas de jugador (promedio, stats de mi top, average, t100)?"
        },
        // 12. Filtro de mods
        mods_filter: {
            type: "choice",
            instructions: "¿El usuario especifica algún mod específico de juego (como DT, HR, HD, EZ, FL, NoMod)?",
            criteria: {
                none: "No especifica ningún mod o filtro de mods",
                dt: "Double Time, DT, NC, Nightcore, acelerado",
                hr: "Hard Rock, HR, difícil",
                hd: "Hidden, HD, oculto",
                ez: "Easy, EZ, fácil",
                fl: "Flashlight, FL, linterna",
                nomod: "NoMod, NM, sin mods"
            }
        },
        // 13. Filtro o vista de habilidades (Skills)
        skill_filter: {
            type: "choice",
            instructions: "¿El usuario consulta o filtra por una habilidad cinética particular?",
            criteria: {
                none: "General o no aplica",
                all: "Todas las habilidades o desglose de skills",
                aim: "Aim, puntería, saltos, jumps",
                speed: "Speed, velocidad, streams, dedos",
                acc: "Accuracy, precisión, ritmo",
                reading: "Reading, lectura, baja velocidad, FL/EZ",
                stamina: "Stamina, resistencia física"
            }
        },
        // 14. Preset y formato de tarjeta (Card)
        card_preset: {
            type: "choice",
            instructions: "¿El usuario solicita un estilo o preset de tarjeta de perfil (card) específico?",
            criteria: {
                none: "Estilo estándar de perfil",
                mapper: "Tarjeta de mapper o creador de mapas",
                player: "Tarjeta de jugador",
                compact: "Tarjeta compacta",
                linea: "Tarjeta en una sola línea o fila",
                panoramica: "Tarjeta panorámica",
                ultra: "Tarjeta ultra",
                mini: "Tarjeta mini"
            }
        },
        // 15. Subtipo de snipes
        snipes_filter: {
            type: "choice",
            instructions: "¿El usuario pide ver algo específico de snipes (némesis, snipes nacionales o top #1s)?",
            criteria: {
                none: "Snipes generales o normales",
                nemesis: "Quién es su némesis o a quién tiene de víctima",
                national: "Snipes nacionales o del país",
                top: "Mejores snipes o top #1s"
            }
        },
        // 16. Estilo de recomendación (Recommend)
        recommend_style: {
            type: "choice",
            instructions: "¿El usuario especifica un estilo de mapa a recomendar o pide incluir mapas jugados?",
            criteria: {
                none: "Recomendación general o balanceada",
                aim: "Mapas de aim, puntería o saltos",
                speed: "Mapas de speed, velocidad o streams",
                tags: "Recomendación basada en etiquetas o tags",
                length: "Mapas largos o maratones",
                rarezas: "Rarezas o mapas inusuales",
                played: "Mapas que ya ha jugado anteriormente"
            }
        },
        // 17. Torneos breakdown o recomendación
        torneo_breakdown: {
            type: "choice",
            instructions: "¿El usuario pide una recomendación de torneo o desglose específico?",
            criteria: {
                none: "Lista o consulta de torneos",
                recommend: "Recomendar torneo para su rango",
                tags: "Desglose por tags",
                modo: "Desglose por modo de juego",
                estado: "Desglose por estado (abiertos, en curso)",
                pasados: "Torneos pasados o finalizados"
            }
        },
        // 18. Acción en cola de modding (Queue)
        queue_action: {
            type: "choice",
            instructions: "¿El usuario desea realizar una acción en su cola de mapas (abrir, cerrar, borrar)?",
            criteria: {
                none: "Ver cola de mapas",
                open: "Abrir o aceptar mapas en la cola",
                close: "Cerrar o pausar la cola",
                delete: "Borrar o eliminar la cola"
            }
        },
        // 19. Acción en skins
        skin_action: {
            type: "choice",
            instructions: "¿El usuario desea borrar o gestionar su skin?",
            criteria: {
                none: "Ver o buscar skin",
                delete: "Borrar o eliminar su skin"
            }
        },
        // 20. Vista de reworks
        rework_view: {
            type: "choice",
            instructions: "¿Qué vista o cálculo de rework solicita el usuario?",
            criteria: {
                none: "Impacto o comparación en perfil",
                list: "Ver la lista de reworks disponibles",
                top: "Ver su top en el rework"
            }
        },
        // 21. Filtro de amigos
        is_friends: {
            type: "noul",
            instructions: "¿El usuario pide ver la clasificación entre sus amigos o amigos agregados?"
        },
        // 22. Forzar actualización / refrescar
        is_force: {
            type: "noul",
            instructions: "¿El usuario pide forzar la actualización, recargar o refrescar los datos en caché?"
        },
        // 23. Mapset completo
        is_mapset: {
            type: "noul",
            instructions: "¿El usuario pide ver la información del mapset o pack completo en vez de una sola dificultad?"
        }
    };
}

/**
 * Extracción determinística exhaustiva de entidades (menciones, links, índices numéricos, páginas, países, PP, SR, resoluciones, skins, etc.)
 */
function extractEntities(rawText) {
    let cleanText = (rawText || '').trim();

    // 1. Extraer menciones de Discord: <@123456789> o <@!123456789>
    let targetDiscordId = null;
    const mentionMatch = cleanText.match(/<@!?(\d+)>/);
    if (mentionMatch) {
        targetDiscordId = mentionMatch[1];
        cleanText = cleanText.replace(mentionMatch[0], '').trim();
    }

    // 2. Extraer links de beatmaps: /beatmaps/123, /b/123 o /beatmapsets/123#mode/456
    let beatmapId = null;
    let beatmapUrl = null;
    const mapSetMatch = cleanText.match(/https?:\/\/osu\.ppy\.sh\/beatmapsets\/\d+#(?:osu|taiko|fruits|mania)\/(\d+)/i);
    const mapDirectMatch = cleanText.match(/https?:\/\/osu\.ppy\.sh\/(?:b|beatmaps)\/(\d+)/i);
    if (mapSetMatch) {
        beatmapId = mapSetMatch[1];
        beatmapUrl = `https://osu.ppy.sh/b/${beatmapId}`;
    } else if (mapDirectMatch) {
        beatmapId = mapDirectMatch[1];
        beatmapUrl = `https://osu.ppy.sh/b/${beatmapId}`;
    }

    // 3. Extraer índice numérico (ej: "#3", "top 5", "play 2", ordinales)
    let scoreIndex = null;
    const indexMatch = cleanText.match(/(?:#|top\s+|play\s+|posici[oó]n\s+|puesto\s+)(\d{1,2})\b/i);
    if (indexMatch) {
        scoreIndex = parseInt(indexMatch[1], 10);
    } else {
        const ordinals = {
            'primera': 1, 'primero': 1, 'primer': 1,
            'segunda': 2, 'segundo': 2,
            'tercera': 3, 'tercero': 3, 'tercer': 3,
            'cuarta': 4, 'cuarto': 4,
            'quinta': 5, 'quinto': 5
        };
        for (const [word, val] of Object.entries(ordinals)) {
            const regex = new RegExp(`\\b(?:la|el)?\\s*${word}\\s+(?:play|jugada|score|puntuaci[oó]n)\\b`, 'i');
            if (regex.test(cleanText)) {
                scoreIndex = val;
                break;
            }
        }
    }

    // 4. Extraer número de página (ej: "página 2", "pagina 3", "page 4", "p2")
    let pageNumber = null;
    const pageMatch = cleanText.match(/\b(?:p[aá]gina|page|pag|p)\s*(\d{1,2})\b/i);
    if (pageMatch && !cleanText.match(/#\d+/)) {
        pageNumber = parseInt(pageMatch[1], 10);
    }

    // 5. Extraer mods explícitos en formato +MODS (ej: +HDDT, +HR, +EZFL)
    let explicitPlusMods = null;
    const plusModMatch = cleanText.match(/\+([A-Za-z0-9]{2,8})\b/);
    if (plusModMatch) {
        explicitPlusMods = `+${plusModMatch[1].toUpperCase()}`;
    }

    // 6. Extraer filtro de contención de mods (ej: "con HD", "que tenga DT")
    let modContainFilter = null;
    const containModMatch = cleanText.match(/\b(?:con|tenga|incluya)\s+([A-Za-z]{2})\b/i);
    if (containModMatch) {
        const candidate = containModMatch[1].toUpperCase();
        const validPairs = new Set(['HD', 'HR', 'DT', 'NC', 'EZ', 'FL', 'HT', 'SO', 'NF']);
        if (validPairs.has(candidate)) {
            modContainFilter = candidate;
        }
    }

    // 7. Extraer umbral o rango de PP (ej: "entre 300 y 400 pp", ">400pp", "500pp")
    let ppThreshold = null;
    let ppRange = null;
    const rangeMatch = cleanText.match(/\b(?:entre\s+)?(\d{2,4})\s*(?:y|-)\s*(\d{2,4})\s*pp\b/i);
    if (rangeMatch) {
        ppRange = `${rangeMatch[1]}-${rangeMatch[2]}`;
    } else {
        const ppMatch = cleanText.match(/(?:de\s+|m[aá]s\s+de\s+|\+|>|>=)(\d{2,4})\s*pp\b/i) || cleanText.match(/\b(\d{2,4})\s*pp\b/i);
        if (ppMatch) {
            ppThreshold = ppMatch[1];
        }
    }

    // 8. Extraer filtro de estrellas / Star Rating (ej: ">7*", "7 estrellas", "de 6.5*", "más de 8 estrellas", "menos de 6*")
    let starRatingFilter = null;
    const srWordMore = cleanText.match(/\b(?:m[aá]s\s+de\s+|mayor\s+(?:a|que)\s+|>\s*|>=?\s*)(\d+(?:\.\d+)?)\s*(?:\*|stars?|estrellas?)\b/i);
    const srWordLess = cleanText.match(/\b(?:menos\s+de\s+|menor\s+(?:a|que)\s+|<\s*|<=?\s*)(\d+(?:\.\d+)?)\s*(?:\*|stars?|estrellas?)\b/i);
    const srDirect = cleanText.match(/([><=]=?\s*\d+(?:\.\d+)?)\s*(?:\*|stars?|estrellas?)/i);
    const srExact = cleanText.match(/\b(\d+(?:\.\d+)?)\s*(?:\*|stars?|estrellas?)\b/i);

    if (srWordMore) {
        starRatingFilter = `>${srWordMore[1]}*`;
    } else if (srWordLess) {
        starRatingFilter = `<${srWordLess[1]}*`;
    } else if (srDirect) {
        let val = srDirect[1].replace(/\s+/g, '');
        starRatingFilter = val.includes('*') ? val : `${val}*`;
    } else if (srExact) {
        starRatingFilter = `${srExact[1]}*`;
    }

    // 9. Extraer código de país o nombre de país
    let countryCode = null;
    const COUNTRY_MAP = {
        'chile': 'CL', 'cl': 'CL',
        'mexico': 'MX', 'méxico': 'MX', 'mx': 'MX',
        'venezuela': 'VE', 've': 'VE',
        'argentina': 'AR', 'ar': 'AR',
        'colombia': 'CO', 'co': 'CO',
        'españa': 'ES', 'spain': 'ES', 'es': 'ES',
        'peru': 'PE', 'perú': 'PE', 'pe': 'PE',
        'brasil': 'BR', 'brazil': 'BR', 'br': 'BR',
        'uruguay': 'UY', 'uy': 'UY',
        'estados unidos': 'US', 'usa': 'US', 'us': 'US',
        'bolivia': 'BO', 'bo': 'BO',
        'costa rica': 'CR', 'cr': 'CR',
        'cuba': 'CU', 'cu': 'CU',
        'ecuador': 'EC', 'ec': 'EC',
        'el salvador': 'SV', 'sv': 'SV',
        'guatemala': 'GT', 'gt': 'GT',
        'honduras': 'HN', 'hn': 'HN',
        'nicaragua': 'NI', 'ni': 'NI',
        'panama': 'PA', 'panamá': 'PA', 'pa': 'PA',
        'paraguay': 'PY', 'py': 'PY',
        'puerto rico': 'PR', 'pr': 'PR',
        'reino unido': 'GB', 'uk': 'GB', 'gb': 'GB',
        'canada': 'CA', 'canadá': 'CA', 'ca': 'CA',
        'australia': 'AU', 'au': 'AU',
        'nueva zelanda': 'NZ', 'nz': 'NZ'
    };
    for (const [countryName, code] of Object.entries(COUNTRY_MAP)) {
        const regex = new RegExp(`\\b(?:de|en|del pa[ií]s|pais|pa[ií]s)\\s+${countryName}\\b`, 'i');
        if (regex.test(cleanText)) {
            countryCode = code;
            break;
        }
    }
    if (!countryCode) {
        const explicitIsoMatch = cleanText.match(/\b(?:pais|pa[ií]s|country)\s+([a-zA-Z]{2})\b/i);
        if (explicitIsoMatch) {
            countryCode = explicitIsoMatch[1].toUpperCase();
        }
    }

    // 10. Extraer filtro regional (ej: "regional Santiago", "región RM", "regional de Valparaíso")
    let regionalFilter = null;
    const regionMatch = cleanText.match(/\b(?:regional|regi[oó]n|region)(?:\s+de)?\s+([a-zA-Z0-9_\-áéíóúÁÉÍÓÚñÑ]+)/i);
    if (regionMatch) {
        regionalFilter = regionMatch[1].trim();
    }

    // 11. Extraer objetivo / víctima de snipes (ej: "contra Akolibed", "víctima mrekk")
    let targetVictim = null;
    const victimMatch = cleanText.match(/\b(?:contra|v[ií]ctima|victima|target|vs|versus)\s+([a-zA-Z0-9_\[\]\-]+)/i);
    if (victimMatch) {
        targetVictim = victimMatch[1];
    }

    // 12. Extraer resolución para render (ej: "1080p", "720p", "1920x1080")
    let renderResolution = null;
    if (cleanText.includes('1080') || cleanText.includes('1920')) {
        renderResolution = '1920x1080';
    } else if (cleanText.includes('720') || cleanText.includes('1280')) {
        renderResolution = '1280x720';
    }

    // 13. Extraer nombre de skin (ej: "skin WhiteCat", "con la skin rafis")
    let renderSkin = null;
    const skinMatch = cleanText.match(/\b(?:con la skin|skin)\s+([a-zA-Z0-9_\-]+)/i);
    if (skinMatch) {
        renderSkin = skinMatch[1];
    }

    // 14. Extraer consulta de rework específica (ej: "rework combo scaling")
    let reworkQuery = null;
    const rewMatch = cleanText.match(/\brework\s+([a-zA-Z0-9_\- ]+)/i);
    if (rewMatch) {
        reworkQuery = rewMatch[1].trim();
    }

    // 15. Extraer usertag para recomendaciones (ej: "usertag streams", "tag jumps")
    let userTag = null;
    const tagMatch = cleanText.match(/\b(?:usertag|tag|estilo)\s+([a-zA-Z0-9_\-\/]+)/i);
    if (tagMatch) {
        userTag = tagMatch[1];
    }

    // 16. Extraer dos jugadores para s.entre (ej: "entre mrekk y akolibed")
    let comparePlayers = null;
    const entreMatch = cleanText.match(/\b(?:entre|vs|versus)\s+([a-zA-Z0-9_\[\]\-]+)\s+(?:y|and|vs|versus)\s+([a-zA-Z0-9_\[\]\-]+)/i);
    if (entreMatch) {
        comparePlayers = [entreMatch[1].trim(), entreMatch[2].trim()];
    }

    // 17. Extraer nombre de usuario objetivo de la consulta (ej: "top de mrekk", "recent de chicony")
    let targetUsername = null;
    const userMatch = cleanText.match(/\b(?:top|recent|rs|perfil|stats|osu|tarjeta|card|snipes|comparar?|c)\s+(?:de|del usuario|del jugador)\s+([a-zA-Z0-9_\[\]\-]+)/i);
    if (userMatch) {
        const candidate = userMatch[1].trim();
        const nonUsernames = new Set([
            'mi', 'mis', 'tu', 'tus', 'su', 'sus',
            'chile', 'venezuela', 'mexico', 'argentina', 'colombia', 'españa', 'peru',
            'std', 'taiko', 'fruits', 'mania', 'gatari', 'droid', 'bancho', 'lazer', 'stable'
        ]);
        if (!nonUsernames.has(candidate.toLowerCase())) {
            targetUsername = candidate;
        }
    }

    return { 
        cleanText, 
        targetDiscordId, 
        beatmapId, 
        beatmapUrl,
        scoreIndex, 
        pageNumber,
        explicitPlusMods, 
        modContainFilter,
        ppThreshold, 
        ppRange,
        starRatingFilter, 
        countryCode,
        regionalFilter,
        targetVictim,
        renderResolution,
        renderSkin,
        reworkQuery,
        userTag,
        comparePlayers,
        targetUsername
    };
}

/**
 * Traduce las respuestas estructuradas de Jev y las entidades extraídas en el comando canónico de Sengo y todos sus flags
 */
function translateJevToSengoCommand(jevAnswers, entities) {
    if (!jevAnswers || !jevAnswers.command) return null;

    const cmdDecision = jevAnswers.command.choice || 'none';
    const confidence = jevAnswers.command.confidence ?? 1.0;

    // Si no reconoció comando o la confianza es inferior al umbral mínimo, no intervenir
    if (cmdDecision === 'none' || confidence < MIN_CONFIDENCE_THRESHOLD) {
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

    // 1. Mapeo de modo de juego (-std, -taiko, -fruits, -mania)
    const mode = jevAnswers.gamemode?.choice;
    if (mode && mode !== 'default') {
        if (mode === 'osu') sengoArgs.push('-std');
        else if (mode === 'taiko') sengoArgs.push('-taiko');
        else if (mode === 'fruits') sengoArgs.push('-fruits');
        else if (mode === 'mania') sengoArgs.push('-mania');
    }

    // 2. Mapeo de servidor (-gatari, -droid)
    const srv = jevAnswers.server?.choice;
    if (srv && srv !== 'default') {
        if (srv === 'gatari') sengoArgs.push('-gatari');
        else if (srv === 'droid') sengoArgs.push('-droid');
    }

    // 3. Modalidad de cliente / puntuación (-lazer, -stable)
    const clientMode = jevAnswers.client_mode?.choice;
    if (clientMode === 'lazer') sengoArgs.push('-lazer');
    else if (clientMode === 'classic') sengoArgs.push('-stable');

    // 4. Flags específicas por comando
    if (sengoCommand === 'top') {
        // No choke (-nochoke)
        if (jevAnswers.is_nochoke?.noul > 0.50) {
            sengoArgs.push('-nochoke');
        }

        // Criterio de ordenamiento métrico
        const sort = jevAnswers.sort_metric?.choice;
        if (sort && sort !== 'none') {
            if (sort === 'recent') sengoArgs.push('-recent');
            else if (sort === 'combo') sengoArgs.push('-c');
            else if (sort === 'stars') sengoArgs.push('-sr');
            else if (sort === 'length') sengoArgs.push('-len');
            else sengoArgs.push(`-${sort}`);
        } else if (jevAnswers.is_recent_sort?.noul > 0.70) {
            sengoArgs.push('-recent');
        }

        // Orden invertido (-rev)
        if (jevAnswers.is_reverse?.noul > 0.60) {
            sengoArgs.push('-rev');
        }

        // Formato lista compacta (-list)
        if (jevAnswers.is_list?.noul > 0.70) {
            sengoArgs.push('-list');
        }

        // Vista detallada (-d)
        if (jevAnswers.is_detailed?.noul > 0.70) {
            sengoArgs.push('-d');
        }

        // Panel de estadísticas / promedio (-promedio)
        if (jevAnswers.is_promedio?.noul > 0.65) {
            sengoArgs.push('-promedio');
        }

        // Filtro de habilidad cinética en top (-aim, -speed, -reading, -acc, -stamina, -skill)
        // Solo aplicar si el usuario mencionó explícitamente habilidades o skills
        if (entities.cleanText.match(/\b(skills?|habilidad(es)?)\b/i)) {
            const sk = jevAnswers.skill_filter?.choice;
            if (sk && sk !== 'none') {
                if (sk === 'all') sengoArgs.push('-skill');
                else sengoArgs.push(`-${sk}`);
            }
        }

        // Filtro o modo rework en top (-rework)
        // Solo aplicar si el usuario mencionó explícitamente rework
        if (entities.cleanText.match(/\breworks?\b/i) || entities.reworkQuery) {
            sengoArgs.push('-rework');
            if (entities.reworkQuery) {
                sengoArgs.push(entities.reworkQuery);
            }
        }

        // Umbral de PP (-g <pp>)
        if (entities.ppThreshold) {
            sengoArgs.push('-g', entities.ppThreshold);
        }

        // Filtro de estrellas (>7*)
        if (entities.starRatingFilter) {
            sengoArgs.push(entities.starRatingFilter);
        }

        // Número de página (-p <page>)
        if (entities.pageNumber) {
            sengoArgs.push('-p', String(entities.pageNumber));
        }

        // Índice numérico (#<index> o <index>)
        if (entities.scoreIndex) {
            sengoArgs.push(String(entities.scoreIndex));
        }

    } else if (sengoCommand === 'rs') {
        // Solo jugadas pasadas (-ps)
        if (jevAnswers.is_pass_only?.noul > 0.50) {
            sengoArgs.push('-ps');
        }
        // Formato lista de recientes (-list)
        if (jevAnswers.is_list?.noul > 0.70) {
            sengoArgs.push('-list');
        }
        // Vista detallada (-d)
        if (jevAnswers.is_detailed?.noul > 0.70) {
            sengoArgs.push('-d');
        }
        // Filtro de estrellas (-sr <cond>)
        if (entities.starRatingFilter) {
            sengoArgs.push('-sr', entities.starRatingFilter.replace('*', ''));
        }
        // Umbral de PP (-g <pp>)
        if (entities.ppThreshold) {
            sengoArgs.push('-g', entities.ppThreshold);
        }
        // Índice específico de recent (-i <n>)
        if (entities.scoreIndex) {
            sengoArgs.push(`-i${entities.scoreIndex}`);
        }

    } else if (sengoCommand === 'osu') {
        // Promedios / stats del perfil (-promedio)
        if (jevAnswers.is_promedio?.noul > 0.65) {
            sengoArgs.push('-promedio');
        }
        // Perfil detallado (-d)
        if (jevAnswers.is_detailed?.noul > 0.70) {
            sengoArgs.push('-d');
        }

    } else if (sengoCommand === 'c') {
        // Solo jugadas pasadas en compare (-ps)
        if (jevAnswers.is_pass_only?.noul > 0.50) {
            sengoArgs.push('-ps');
        }
        // Formato lista en compare (-list)
        if (jevAnswers.is_list?.noul > 0.70) {
            sengoArgs.push('-list');
        }

    } else if (sengoCommand === 'skills') {
        // Habilidad específica en skills (-aim, -speed, -acc, -reading, -stamina, -color, -tech)
        const sk = jevAnswers.skill_filter?.choice;
        if (sk && sk !== 'none' && sk !== 'all') {
            sengoArgs.push(`-${sk}`);
        }
        // Ranking del servidor (-server)
        if (entities.cleanText.match(/\b(?:servidor|server|srv|guild)\b/i)) {
            sengoArgs.push('-server');
        }
        // Ranking nacional (-nacional)
        if (jevAnswers.snipes_filter?.choice === 'national' || entities.cleanText.match(/\b(?:nacional|nac|national)\b/i)) {
            sengoArgs.push('-nacional');
        }

    } else if (sengoCommand === 'card') {
        // Preset de tarjeta (-mapper, -player, -compact, -linea, -panoramica, -ultra, -mini)
        const preset = jevAnswers.card_preset?.choice;
        if (preset && preset !== 'none') {
            sengoArgs.push(`-${preset}`);
        }
        // Formatos de tarjeta (-embed, -userpage)
        if (entities.cleanText.match(/\b(?:embed)\b/i)) {
            sengoArgs.push('-embed');
        } else if (entities.cleanText.match(/\b(?:userpage|bbcode|up)\b/i)) {
            sengoArgs.push('-userpage');
        }
        // Forzar actualización de imagen (-force)
        if (jevAnswers.is_force?.noul > 0.60 || entities.cleanText.match(/\b(?:force|forzar|refrescar|actualizar)\b/i)) {
            sengoArgs.push('-force');
        }

    } else if (sengoCommand === 'recommend') {
        // Estilos de recomendación (-aim, -speed, -tags, -length, -rarezas)
        const style = jevAnswers.recommend_style?.choice;
        if (style && style !== 'none' && style !== 'played') {
            sengoArgs.push(`-${style}`);
        }
        // Incluir mapas ya jugados (-jugados)
        if (style === 'played' || entities.cleanText.match(/\b(?:jugados?|played)\b/i)) {
            sengoArgs.push('-jugados');
        }
        // Forzar nuevas recomendaciones (-force)
        if (jevAnswers.is_force?.noul > 0.60 || entities.cleanText.match(/\b(?:force|forzar|refrescar|nuevos?)\b/i)) {
            sengoArgs.push('-force');
        }
        // Rango o meta de PP (-pp <min-max> o -g <pp>)
        if (entities.ppRange) {
            sengoArgs.push('-pp', entities.ppRange);
        } else if (entities.ppThreshold) {
            sengoArgs.push('-g', entities.ppThreshold);
        }
        // Filtrar por usertag (-usertag <tag>)
        if (entities.userTag) {
            sengoArgs.push('-usertag', entities.userTag);
        } else if (entities.cleanText.match(/\b(?:tags?|etiquetas?)\b/i)) {
            sengoArgs.push('-usertag');
        }

    } else if (sengoCommand === 'snipes') {
        // Némesis (-nemesis)
        if (jevAnswers.snipes_filter?.choice === 'nemesis' || entities.cleanText.match(/\b(?:n[eé]mesis|victima|v[ií]ctima)\b/i)) {
            sengoArgs.push('-nemesis');
        }
        // Víctima / objetivo específico (-victima <user>)
        if (entities.targetVictim) {
            sengoArgs.push('-victima', entities.targetVictim);
        }
        // Snipes nacionales (-nacional)
        if (jevAnswers.snipes_filter?.choice === 'national' || entities.cleanText.match(/\b(?:nacional|nac|national)\b/i)) {
            sengoArgs.push('-nacional');
        }
        // Top #1s (-top)
        if (jevAnswers.snipes_filter?.choice === 'top' || entities.cleanText.match(/\b(?:top|mejores)\b/i)) {
            sengoArgs.push('-top');
        }
        // Vista detallada (-d)
        if (jevAnswers.is_detailed?.noul > 0.70) {
            sengoArgs.push('-d');
        }
        // Filtro de dificultad estelar (-sr <cond>)
        if (entities.starRatingFilter) {
            sengoArgs.push('-sr', entities.starRatingFilter.replace('*', ''));
        }

    } else if (sengoCommand === 'render') {
        // Skin específica (-skin <nombre>)
        if (entities.renderSkin) {
            sengoArgs.push('-skin', entities.renderSkin);
        }
        // Resolución de video (-res <resolucion>)
        if (entities.renderResolution) {
            sengoArgs.push('-res', entities.renderResolution);
        }
        // Configuración de o!rdr (-config)
        if (entities.cleanText.match(/\b(?:config|configuraci[oó]n|preset)\b/i)) {
            sengoArgs.push('-config');
        }
        // Saltarse intro (-skip)
        if (entities.cleanText.match(/\bskip\b/i)) {
            sengoArgs.push('-skip');
        }

    } else if (sengoCommand === 'rework') {
        // Listar reworks (-lista)
        if (jevAnswers.rework_view?.choice === 'list' || entities.cleanText.match(/\b(?:lista|listado|disponibles)\b/i)) {
            sengoArgs.push('-lista');
        }
        // Tops en rework (-top)
        else if (jevAnswers.rework_view?.choice === 'top' || entities.cleanText.match(/\b(?:top|mejores)\b/i)) {
            sengoArgs.push('-top');
        }
        // Comparación de perfil en rework (-o)
        else if (jevAnswers.rework_view?.choice === 'profile' || entities.cleanText.match(/\b(?:perfil|stats|comparar)\b/i)) {
            sengoArgs.push('-o');
        }
        // Consulta o nombre de rework específico (-rework <query>)
        if (entities.reworkQuery) {
            sengoArgs.push('-rework', entities.reworkQuery);
        }
        // Selector de motor de PP (-sengo, -rust, -native)
        const engineMatch = entities.cleanText.match(/\b(sengo|rust|native)\b/i);
        if (engineMatch) {
            sengoArgs.push(`-${engineMatch[1].toLowerCase()}`);
        }
        // Modo benchmark (-bench)
        if (entities.cleanText.match(/\b(?:bench|benchmark)\b/i)) {
            sengoArgs.push('-bench');
        }

    } else if (sengoCommand === 'lb') {
        // Filtrar tabla por amigos (-friends)
        if (jevAnswers.is_friends?.noul > 0.60 || entities.cleanText.match(/\b(?:amigos|friends|amigo)\b/i)) {
            sengoArgs.push('-friends');
        }
        // Número de página (-p <page>)
        if (entities.pageNumber) {
            sengoArgs.push('-p', String(entities.pageNumber));
        }

    } else if (sengoCommand === 'nacional') {
        // Subdivisión regional (-regional <region>)
        if (entities.regionalFilter) {
            sengoArgs.push('-regional', entities.regionalFilter);
        }
        // Mejores jugadas nacionales (-tops)
        if (entities.cleanText.match(/\b(?:tops?|mejores jugadas|mejores scores)\b/i)) {
            sengoArgs.push('-tops');
        }
        // Ranking por precisión (-acc)
        if (entities.cleanText.match(/\b(?:acc|precisi[oó]n|accuracy)\b/i)) {
            sengoArgs.push('-acc');
        }
        // Filtro de dificultad estelar (-sr <cond>)
        if (entities.starRatingFilter) {
            sengoArgs.push('-sr', entities.starRatingFilter.replace('*', ''));
        }
        // Número de página (-p <page>)
        if (entities.pageNumber) {
            sengoArgs.push('-p', String(entities.pageNumber));
        }

    } else if (sengoCommand === 'regional') {
        // Región
        if (entities.regionalFilter) {
            sengoArgs.push(entities.regionalFilter);
        }

    } else if (sengoCommand === 'torneos') {
        // Recomendar torneo (-rec)
        if (jevAnswers.torneo_breakdown?.choice === 'recommend' || entities.cleanText.match(/\b(?:rec|recomendar?|sugiere|sugerir)\b/i)) {
            sengoArgs.push('-rec');
        }
        // Breakdowns por tags, modo, estado o pasados
        const b = jevAnswers.torneo_breakdown?.choice;
        if (b === 'tags') sengoArgs.push('-tag');
        else if (b === 'modo') sengoArgs.push('-modo');
        else if (b === 'estado') sengoArgs.push('-estado');
        else if (b === 'pasados') sengoArgs.push('-pasados');

    } else if (sengoCommand === 'mapper') {
        // BNs activos con requests abiertas (-activo)
        if (entities.cleanText.match(/\b(?:activos?|abiertos?|open|active)\b/i)) {
            sengoArgs.push('-activo');
        }
        // Seguimiento / tracker (-track)
        if (entities.cleanText.match(/\b(?:track|seguir|seguimiento|rastrear)\b/i)) {
            sengoArgs.push('-track');
            if (entities.cleanText.match(/\b(?:servidor|server)\b/i)) sengoArgs.push('-servidor');
            if (entities.cleanText.match(/\b(?:quitar|borrar|remove|delete)\b/i)) sengoArgs.push('-quitar');
        }

    } else if (sengoCommand === 'skin') {
        // Borrar skin (-delete)
        if (jevAnswers.skin_action?.choice === 'delete' || entities.cleanText.match(/\b(?:borrar|delete|eliminar)\b/i)) {
            sengoArgs.push('-delete');
        }
        // Establecer skin (-set)
        if (entities.cleanText.match(/\b(?:colocar|set|poner)\b/i)) {
            sengoArgs.push('-set');
        }

    } else if (sengoCommand === 'queue') {
        // Acciones en cola (-abrir, -cerrar, -delete)
        const qAct = jevAnswers.queue_action?.choice;
        if (qAct === 'open') sengoArgs.push('-abrir');
        else if (qAct === 'close') sengoArgs.push('-cerrar');
        else if (qAct === 'delete') sengoArgs.push('-delete');
        // Colas del servidor (-server)
        if (entities.cleanText.match(/\b(?:servidor|server)\b/i)) {
            sengoArgs.push('-server');
        }

    } else if (sengoCommand === 'twins') {
        // Por rango similar (-rank)
        if (entities.cleanText.match(/\b(?:rango|nivel|rank|close)\b/i)) {
            sengoArgs.push('-rank');
        }
        // Por PP (-pp)
        if (entities.cleanText.match(/\b(?:por pp|pp)\b/i)) {
            sengoArgs.push('-pp');
        }
        // Por habilidad cinética (-skill <habilidad>)
        const sk = jevAnswers.skill_filter?.choice;
        if (sk && sk !== 'none' && sk !== 'all') {
            sengoArgs.push('-skill', sk);
        }
        // Formato lista (-list)
        if (jevAnswers.is_list?.noul > 0.70) {
            sengoArgs.push('-list');
        }

    } else if (sengoCommand === 'amigos') {
        // Tracker de amigos del creador (-track)
        if (entities.cleanText.match(/\b(?:track|rastrear|seguimiento)\b/i)) {
            sengoArgs.push('-track');
        }
        // Flag especial de usuarios vinculados (-sengo)
        if (entities.cleanText.match(/\b(?:sengo|vinculados)\b/i)) {
            sengoArgs.push('-sengo');
        }

    } else if (sengoCommand === 'm') {
        // Información de mapset completo (-mapset)
        if (jevAnswers.is_mapset?.noul > 0.60 || entities.cleanText.match(/\b(?:mapset|set|pack|[aá]lbum)\b/i)) {
            sengoArgs.push('-mapset');
        }

    } else if (sengoCommand === 'entre') {
        // Comparación entre dos jugadores
        if (entities.comparePlayers && entities.comparePlayers.length === 2) {
            sengoArgs.push(entities.comparePlayers[0], entities.comparePlayers[1]);
        }
    }

    // 5. Filtro de mods (Explícito +MODS, contención -mx o clasificado por Jev)
    if (entities.explicitPlusMods) {
        sengoArgs.push(entities.explicitPlusMods);
    } else if (entities.modContainFilter) {
        sengoArgs.push('-mx', entities.modContainFilter);
    } else {
        const mod = jevAnswers.mods_filter?.choice;
        if (mod && mod !== 'none') {
            if (mod === 'dt') sengoArgs.push('+DT');
            else if (mod === 'hr') sengoArgs.push('+HR');
            else if (mod === 'hd') sengoArgs.push('+HD');
            else if (mod === 'ez') sengoArgs.push('+EZ');
            else if (mod === 'fl') sengoArgs.push('+FL');
            else if (mod === 'nomod') sengoArgs.push('+NM');
        }
    }

    // 6. Filtro de país si fue detectado (-pais <CODE>)
    if (entities.countryCode && ['nacional', 'pais', 'skills', 'twins', 'top', 'lb'].includes(sengoCommand)) {
        sengoArgs.push('-pais', entities.countryCode);
    }

    // 7. Enlace o ID de beatmap detectado
    if (entities.beatmapUrl && ['m', 'bg', 'c', 'lb', 'sim'].includes(sengoCommand)) {
        sengoArgs.push(entities.beatmapUrl);
    } else if (entities.beatmapId && ['m', 'bg', 'c', 'lb', 'sim'].includes(sengoCommand)) {
        sengoArgs.push(`https://osu.ppy.sh/b/${entities.beatmapId}`);
    }

    // 8. Nombre de usuario objetivo si se extrajo de la consulta (ej: "top de mrekk")
    if (entities.targetUsername && !entities.targetDiscordId && sengoCommand !== 'entre') {
        sengoArgs.unshift(entities.targetUsername);
    }

    // 9. Entidad de usuario mencionada de Discord (<@ID>)
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
