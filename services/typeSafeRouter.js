/**
 * services/typeSafeRouter.js
 * 
 * Enrutador de Lenguaje Natural para Sengo basado en Jev (TypeSafe AI - System One).
 * Evalúa intenciones de los usuarios con latencia ultrabaja (~100-300ms) sin alucinaciones.
 * Utiliza el registro modular de comandos y flags (commandRegistry.js) para construir
 * y mapear dinámicamente comandos y modificadores de Sengo.
 * 
 * ponytail: 0 dependencias externas añadidas, usa fetch nativo de Node 22 y AbortSignal.timeout.
 */

const { getJevCommandCriteria, executeCommandFlags, ALIAS_MAP } = require('./commandRegistry.js');

const TYPESAFE_API_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 3500;
const MIN_CONFIDENCE_THRESHOLD = 0.50;

/**
 * Define el esquema de preguntas SystemOne para clasificar intenciones de osu! y Sengo
 */
function buildJevQuestions() {
    return {
        // 1. Comando principal generado dinámicamente desde el registro de comandos
        command: {
            type: "choice",
            instructions: "¿Qué acción o comando de Sengo desea ejecutar el usuario?",
            criteria: getJevCommandCriteria()
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
            instructions: "¿El usuario solicita explícitamente ordenar sus jugadas por alguna métrica específica distinta del PP (ej: ordenado por bpm, por estrellas, menor combo)? Si sólo pide ver su top o filtrar por mods/país sin pedir ordenamiento, responder 'none'.",
            criteria: {
                none: "Sin ordenamiento especial o por defecto (ordenado por PP; o sólo pide filtrar por mods, país o rango sin ordenar)",
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
            instructions: "¿El usuario especifica algún mod específico de juego (como DT, HR, HD, EZ, FL, NoMod, HDHR, HDDT)?",
            criteria: {
                none: "No especifica ningún mod o filtro de mods",
                dt: "Double Time, DT, NC, Nightcore, acelerado",
                hr: "Hard Rock, HR, difícil",
                hd: "Hidden, HD, oculto",
                ez: "Easy, EZ, fácil",
                fl: "Flashlight, FL, linterna",
                nomod: "NoMod, NM, sin mods",
                hdhr: "Hidden + Hard Rock, HDHR",
                hddt: "Hidden + Double Time, HDDT, HDNC",
                dthr: "Double Time + Hard Rock, DTHR",
                ezfl: "Easy + Flashlight, EZFL"
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
        },
        // 24. Acción de cumpleaños
        cumple_action: {
            type: "choice",
            instructions: "¿Qué acción o consulta de cumpleaños solicita el usuario?",
            criteria: {
                none: "Consulta general de cumpleaños o no aplica",
                siguiente: "Siguiente o próximo cumpleaños a celebrarse",
                anterior: "Cumpleaños anterior o más reciente en el pasado",
                lista: "Ver lista o listado de todos los cumpleaños del servidor",
                quitar: "Quitar o borrar su fecha de cumpleaños"
            }
        }
    };
}

/**
 * Extracción determinística exhaustiva de entidades (menciones, links, índices numéricos, páginas, países, PP, SR, resoluciones, skins, etc.)
 */
function extractEntities(rawText) {
    let cleanText = (rawText || '').trim();
    if (cleanText.includes('\n')) {
        const lines = cleanText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        cleanText = [...new Set(lines)].join(' ');
    }

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
            const regex = new RegExp(`\\b(?:la|el)?\\s*${word}\\s+(?:play|jugada|score|puntuaci[oó]n|mapa)\\b`, 'i');
            if (regex.test(cleanText)) {
                scoreIndex = val;
                break;
            }
        }
    }

    // Si el usuario pregunta por un elemento singular superlativo ("el mapa con más...", "la mejor play...", "la play con mayor...")
    if (!scoreIndex) {
        const singularSuperlative = /\b(?:el|la)\s+(?:mapa|play|jugada|score|puntuaci[oó]n)\s+(?:con\s+m[aá]s|con\s+mayor|con\s+menos|m[aá]s\s+\w+|mejor)\b/i;
        if (singularSuperlative.test(cleanText)) {
            scoreIndex = 1;
        }
    }

    // 4. Extraer número de página (ej: "página 2", "pagina 3", "page 4", "p2")
    let pageNumber = null;
    const pageMatch = cleanText.match(/\b(?:p[aá]gina|page|pag|p)\s*(\d{1,2})\b/i);
    if (pageMatch && !cleanText.match(/#\d+/)) {
        pageNumber = parseInt(pageMatch[1], 10);
    }

    // 5. Extraer mods explícitos en formato +MODS o frases en lenguaje natural (ej: +HDDT, +HR, "filtrado por hdhr", "en hdhr", "con mods dthr", "sin mods", "nomod")
    let explicitPlusMods = null;
    let modContainFilter = null;

    const validModPairs = new Set([
        'NF', 'EZ', 'TD', 'HD', 'HR', 'SD', 'DT', 'HT', 'NC', 'FL', 'AT', 'SO', 'AP', 'PF',
        '4K', '5K', '6K', '7K', '8K', '9K', 'RN', 'CN', 'RD', 'FI', 'MR', 'CL', 'RX', 'NM'
    ]);

    const isValidModString = (str) => {
        if (!str) return false;
        const upper = str.toUpperCase();
        if (upper === 'NM' || upper === 'NOMOD') return true;
        if (upper.length < 2 || upper.length % 2 !== 0) return false;
        for (let i = 0; i < upper.length; i += 2) {
            if (!validModPairs.has(upper.slice(i, i + 2))) return false;
        }
        return true;
    };

    // A) +MODS explícito (ej: +HDHR, +DT, +NM)
    const plusModMatch = cleanText.match(/\+([A-Za-z0-9]{2,8})\b/);
    if (plusModMatch && isValidModString(plusModMatch[1])) {
        explicitPlusMods = `+${plusModMatch[1].toUpperCase() === 'NOMOD' ? 'NM' : plusModMatch[1].toUpperCase()}`;
    }

    // B) Mods en lenguaje natural (ej: "filtrado por hdhr", "filtro de hdhr", "con mods hdhr", "en hdhr", "mods dthr")
    if (!explicitPlusMods) {
        if (/\b(?:sin\s+mods?|sin\s+ning[uú]n\s+mod|nomod)\b/i.test(cleanText)) {
            explicitPlusMods = '+NM';
        } else {
            const natModMatch = cleanText.match(/\b(?:filtrad[oa]s?\s+(?:por|con|de)|filtrar\s+(?:por|con)|filtro\s+(?:de|por)?|con\s+(?:los\s+)?mods?|con\s+|mods?\s+|en\s+)([A-Za-z0-9]{2,8})\b/i);
            if (natModMatch && isValidModString(natModMatch[1])) {
                const upper = natModMatch[1].toUpperCase();
                explicitPlusMods = `+${upper === 'NOMOD' ? 'NM' : upper}`;
            } else {
                // Standalone multi-mod o par conocido al final o entre palabras (ej: "top hdhr", "rs hddt")
                const words = cleanText.split(/\s+/);
                for (const w of words) {
                    const cleanW = w.replace(/[^a-zA-Z0-9]/g, '');
                    if (cleanW.length >= 4 && isValidModString(cleanW)) {
                        explicitPlusMods = `+${cleanW.toUpperCase()}`;
                        break;
                    }
                }
            }
        }
    }

    // 6. Extraer filtro de contención de mods (ej: "que tenga DT", "que contenga HD", "incluya HR")
    if (!explicitPlusMods) {
        const containModMatch = cleanText.match(/\b(?:que\s+tenga|que\s+incluya|que\s+contenga|contenga|incluya)\s+([A-Za-z]{2,8})\b/i);
        if (containModMatch && isValidModString(containModMatch[1])) {
            modContainFilter = containModMatch[1].toUpperCase();
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
    const COUNTRY_NAMES = {
        'chile': 'CL',
        'mexico': 'MX', 'méxico': 'MX',
        'venezuela': 'VE',
        'argentina': 'AR',
        'colombia': 'CO',
        'españa': 'ES', 'spain': 'ES',
        'peru': 'PE', 'perú': 'PE',
        'brasil': 'BR', 'brazil': 'BR',
        'uruguay': 'UY',
        'estados unidos': 'US', 'usa': 'US',
        'bolivia': 'BO',
        'costa rica': 'CR',
        'cuba': 'CU',
        'ecuador': 'EC',
        'el salvador': 'SV',
        'guatemala': 'GT',
        'honduras': 'HN',
        'nicaragua': 'NI',
        'panama': 'PA', 'panamá': 'PA',
        'paraguay': 'PY',
        'puerto rico': 'PR',
        'reino unido': 'GB',
        'canada': 'CA', 'canadá': 'CA',
        'australia': 'AU',
        'nueva zelanda': 'NZ'
    };

    const VALID_ISO_CODES = new Set(Object.values(COUNTRY_NAMES));
    const OSU_MOD_ACRONYMS = new Set([
        'HD', 'HR', 'DT', 'NC', 'FL', 'EZ', 'HT', 'SO', 'NF', 'RX', 'AP', 'CL', 'NM', 'SD', 'PF', 'AT', 'TD'
    ]);

    // A) Coincidencia por nombre completo de país (inambiguo, sin riesgo de colisión con mods)
    for (const [countryName, code] of Object.entries(COUNTRY_NAMES)) {
        const regex = new RegExp(`\\b${countryName}\\b`, 'i');
        if (regex.test(cleanText)) {
            countryCode = code;
            break;
        }
    }

    // B) Coincidencia por código ISO de 2 letras precedido explícitamente por palabra de país (ej: "pais ar", "país cl", "country mx")
    if (!countryCode) {
        const explicitIsoMatch = cleanText.match(/\b(?:pais|pa[ií]s|country)\s+([a-zA-Z]{2})\b/i);
        if (explicitIsoMatch) {
            const candidate = explicitIsoMatch[1].toUpperCase();
            if (VALID_ISO_CODES.has(candidate)) {
                countryCode = candidate;
            }
        }
    }

    // C) Coincidencia por código ISO de 2 letras con preposiciones comunes (de|del|en|para) pero excluyendo estrictamente siglas de mods
    if (!countryCode) {
        const prepIsoMatch = cleanText.match(/\b(?:de|del|en|para)\s+([a-zA-Z]{2})\b/i);
        if (prepIsoMatch) {
            const candidate = prepIsoMatch[1].toUpperCase();
            if (VALID_ISO_CODES.has(candidate) && !OSU_MOD_ACRONYMS.has(candidate)) {
                countryCode = candidate;
            }
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

    // 17. Extraer nombre de usuario objetivo de la consulta (ej: "top de mrekk", "play reciente de milin", "perfil de chicony")
    let targetUsername = null;
    const nonUsernames = new Set([
        'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'un', 'una', 'el', 'la', 'los', 'las', 'este', 'esta',
        'chile', 'venezuela', 'mexico', 'argentina', 'colombia', 'españa', 'peru', 'brasil', 'uruguay', 'bolivia', 'ecuador',
        'osu', 'game', 'juego', 'pass', 'passes', 'fail', 'fails', 'lista', 'list',
        'std', 'taiko', 'fruits', 'mania', 'gatari', 'droid', 'bancho', 'lazer', 'stable',
        'mapa', 'mapas', 'beatmap', 'beatmaps', 'canal', 'servidor', 'server', 'guild',
        'cumple', 'cumpleaños', 'mappers', 'mapper', 'torneo', 'torneos',
        'mayor', 'menor', 'mas', 'menos', 'aim', 'speed', 'reading', 'stamina', 'acc', 'accuracy',
        'precision', 'bpm', 'combo', 'stars', 'pp', 'duracion', 'tiempo', 'fecha', 'ranking',
        'clasificacion', 'clasificación', 'leaderboard', 'tabla', 'posiciones', 'puestos', 'nacional', 'general', 'global',
        'filtrado', 'filtrada', 'filtrados', 'filtradas', 'filtro', 'filtros', 'filtrar',
        'mods', 'mod', 'hdhr', 'hddt', 'dthr', 'ezfl', 'ezhd', 'nomod', 'nm',
        'hd', 'hr', 'dt', 'ez', 'fl', 'nc', 'ht', 'nf', 'so', 'rx', 'ap', 'cl'
    ]);

    const isSelfRef = /\b(?:mis?|yo|m[ií]as?|propias?)\s+(?:plays?|jugadas?|partidas?|scores?|top|perfil|cuenta)\b/i.test(cleanText);
    if (!isSelfRef) {
        const userMatch = cleanText.match(/\b(?:top|reciente|recent|play|partida|jugada|rs|perfil|profile|stats|osu|tarjeta|card|snipes|comparar?|c|scores?|plays?|r)\s+(?:de|del usuario|del jugador|de la cuenta)?\s+([a-zA-Z0-9_\[\]\-]+)/i);
        if (userMatch) {
            const candidate = userMatch[1].trim();
            if (!nonUsernames.has(candidate.toLowerCase())) {
                targetUsername = candidate;
            }
        }
    }
    if (!targetUsername) {
        const fallbackMatch = cleanText.match(/\b(?:de|del usuario|del jugador)\s+([a-zA-Z0-9_\[\]\-]{2,15})\b/i);
        if (fallbackMatch) {
            const candidate = fallbackMatch[1].trim();
            if (!nonUsernames.has(candidate.toLowerCase())) {
                targetUsername = candidate;
            }
        }
    }

    // 18. Extraer texto entre comillas (ej: "jeiden desbaneame", 'agrega soporte para ctb')
    let quotedText = null;
    const quoteMatch = cleanText.match(/["'“«]([^"'”»]+)["'”»]/);
    if (quoteMatch) {
        quotedText = quoteMatch[1].trim();
    }

    // 19. Extraer texto de sugerencia o reporte de bug
    let reportText = null;
    if (quotedText) {
        reportText = quotedText;
    } else {
        const reportPrefixMatch = cleanText.match(/\b(?:sugerencia|sugerir|bug|error|fallo|reporte|reportar)(?:\s+(?:que\s+dice|que\s+diga|que\s+contenga|con\s+el\s+texto|con\s+texto|de|que))?\s*[:\-]?\s*(.+)$/i);
        if (reportPrefixMatch) {
            let candidate = reportPrefixMatch[1].trim();
            candidate = candidate.replace(/^["'“«]|["'”»]$/g, '').trim();
            if (candidate) {
                reportText = candidate;
            }
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
        targetUsername,
        quotedText,
        reportText
    };
}

/**
 * Traduce las respuestas estructuradas de Jev y las entidades extraídas en el comando canónico de Sengo y todos sus flags
 * utilizando el registro dinámico de comandos y flags.
 */
function translateJevToSengoCommand(jevAnswers, entities) {
    if (!jevAnswers || !jevAnswers.command) return null;

    const cmdDecision = jevAnswers.command.choice || 'none';
    const confidence = jevAnswers.command.confidence ?? 1.0;

    // Si no reconoció comando o la confianza es inferior al umbral mínimo, no intervenir
    if (cmdDecision === 'none' || confidence < MIN_CONFIDENCE_THRESHOLD) {
        return null;
    }

    const sengoCommand = ALIAS_MAP[cmdDecision.toLowerCase()] || cmdDecision;
    const sengoArgs = executeCommandFlags(sengoCommand, jevAnswers, entities);

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

    // Enrutamiento determinista de alta prioridad para solicitudes explícitas de sugerencias o reportes de bugs
    const isSuggestion = /\b(?:haz|hacer|crear|mandar|enviar|tengo|dejar?)\s+(?:una\s+)?sugerencia\b/i.test(entities.cleanText) ||
                         /^(?:sugerir|sugerencia)\b/i.test(entities.cleanText);
    if (isSuggestion) {
        const payload = entities.reportText || entities.quotedText;
        if (payload) {
            return {
                command: 'sugerencia',
                args: [payload],
                fullCommandString: `s.sugerencia ${payload}`,
                confidence: 1.0
            };
        }
    }

    const isBug = /\b(?:reportar?|notificar?|mandar?|enviar?)\s+(?:un\s+)?(?:bug|error|fallo)\b/i.test(entities.cleanText) ||
                  /^(?:reporte|bug)\b/i.test(entities.cleanText);
    if (isBug) {
        const payload = entities.reportText || entities.quotedText;
        if (payload) {
            return {
                command: 'bug',
                args: [payload],
                fullCommandString: `s.bug ${payload}`,
                confidence: 1.0
            };
        }
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
