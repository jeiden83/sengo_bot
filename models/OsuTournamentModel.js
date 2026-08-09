const { getSupabaseClient } = require('../db/database.js');
const { v2 } = require('osu-api-extended');
const OsuUserModel = require('./OsuUserModel.js');
const https = require('https');

/**
 * Busca torneos en la base de datos aplicando diversos filtros.
 * 
 * @param {Object} filters
 * @param {string|string[]} [filters.status] - Estado(s) del torneo ('open', 'in_progress', 'completed', 'unknown')
 * @param {string} [filters.gameMode] - Modo de juego ('osu', 'mania', 'taiko', 'fruits')
 * @param {number} [filters.rank] - Rango global del jugador para filtrar torneos aptos
 * @param {string} [filters.tag] - Palabra clave/etiqueta para filtrar
 * @param {number} [filters.limit] - Límite de torneos a retornar
 * @returns {Promise<Array>} Lista de torneos encontrados
 */
async function searchTournaments(filters = {}) {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    let query = supabase.from('tournaments').select('*');

    // 1. Filtrar por estado
    if (filters.status) {
        if (Array.isArray(filters.status)) {
            query = query.in('reg_status', filters.status);
        } else {
            query = query.eq('reg_status', filters.status);
        }
    }

    // 2. Filtrar por modo de juego
    if (filters.gameMode) {
        query = query.eq('game_mode', filters.gameMode);
    }

    // 3. Filtrar por rango (torneos donde el rango del jugador sea válido)
    if (filters.rank !== undefined && filters.rank !== null) {
        const rank = parseInt(filters.rank, 10);
        if (!isNaN(rank)) {
            // Un torneo es apto si:
            // - Es rango abierto (is_open_range = true)
            // - O si el rango está entre rank_min y rank_max
            //   (rank_min <= rank AND (rank_max >= rank OR rank_max IS NULL))
            query = query.or(`is_open_range.eq.true,and(rank_min.lte.${rank},or(rank_max.gte.${rank},rank_max.is.null))`);
        }
    }

    // 4. Filtrar por etiqueta/tag
    if (filters.tag) {
        // En PostgreSQL, tags es un array de texto (TEXT[])
        // Usamos overlaps para buscar si contiene el tag (en minúsculas)
        const cleanTag = filters.tag.toLowerCase().trim().replace(/[-_]/g, ' ').replace(/\s+/g, ' ');
        query = query.overlaps('tags', [cleanTag]);
    }

    // 5. Ordenar por fecha de creación desc
    query = query.order('created_at', { ascending: false });

    // 6. Límite de resultados
    if (filters.limit) {
        query = query.limit(filters.limit);
    }

    const { data, error } = await query;
    if (error) {
        console.error('[DB] Error al buscar torneos:', error);
        throw error;
    }
    return data || [];
}

/**
 * Heurística de conversión de rangos a números enteros.
 */
function parseRankNumber(str) {
    if (!str) return null;
    let clean = str.toLowerCase().trim();
    if (clean === 'open' || clean === 'inf' || clean === 'infinity' || clean === 'any' || clean === '∞') {
        return Infinity;
    }
    
    let multiplier = 1;
    if (clean.endsWith('k')) {
        multiplier = 1000;
        clean = clean.slice(0, -1);
    }
    
    if (multiplier === 1000) {
        clean = clean.replace(',', '.');
        let num = parseFloat(clean);
        return isNaN(num) ? null : Math.round(num * multiplier);
    } else {
        clean = clean.replace(/[,.]/g, '');
        let num = parseInt(clean, 10);
        return isNaN(num) ? null : num;
    }
}

/**
 * Parsea rangos especificados por dígitos en osu! (ej: "6 Digit", "4-5 digit", "5digit+", "6-digit").
 */
function parseDigitRankFromText(text) {
    if (!text) return null;
    
    // 1. Rango de dígitos compuesto: ej. "4-5 digit", "5-6 digit", "4/5 digit", "4 to 5 digit", "4 & 5 digit", "4-5digit"
    const digitRangeRegex = /\b([1-7])\s*(?:-|to|\/|and|&)\s*([1-7])\s*[-\s]?digits?\b/i;
    const rangeMatch = text.match(digitRangeRegex);
    if (rangeMatch) {
        const d1 = parseInt(rangeMatch[1], 10);
        const d2 = parseInt(rangeMatch[2], 10);
        const minD = Math.min(d1, d2);
        const maxD = Math.max(d1, d2);
        const rankMin = minD === 1 ? 1 : Math.pow(10, minD - 1);
        const rankMax = maxD >= 6 ? Infinity : Math.pow(10, maxD) - 1;
        return { rankMin, rankMax, isOpen: false };
    }

    // 2. Dígito único: ej. "6 digit", "6-digit", "6digit", "6digit+", "5 digit", "4digit"
    const singleDigitRegex = /\b([1-7])\s*[-\s]?digits?(\+)?\b/i;
    const singleMatch = text.match(singleDigitRegex);
    if (singleMatch) {
        const d = parseInt(singleMatch[1], 10);
        const hasPlus = !!singleMatch[2] || /\b(plus|and above|and lower|and higher|and under|\+)\b/i.test(text);

        let rankMin = null;
        let rankMax = null;

        if (d === 1) {
            rankMin = 1;
            rankMax = hasPlus ? Infinity : 9;
        } else if (d === 2) {
            rankMin = 10;
            rankMax = hasPlus ? Infinity : 99;
        } else if (d === 3) {
            rankMin = 100;
            rankMax = hasPlus ? Infinity : 999;
        } else if (d === 4) {
            rankMin = 1000;
            rankMax = hasPlus ? Infinity : 9999;
        } else if (d === 5) {
            rankMin = 10000;
            rankMax = hasPlus ? Infinity : 99999;
        } else if (d === 6) {
            rankMin = 100000;
            rankMax = Infinity; // Para 6 dígitos, comprende desde 100.000 hasta ∞ (#100.000 - #∞)
        } else if (d === 7) {
            rankMin = 1000000;
            rankMax = Infinity;
        }

        if (rankMin !== null) {
            return { rankMin, rankMax, isOpen: false };
        }
    }

    return null;
}

/**
 * Parsea rangos numéricos explícitos en texto (ej: "#10k - #50k", "100k+", "under 50k", "< 50k", "6.5k-∞").
 */
function parseNumericRankFromText(text) {
    if (!text) return null;

    // A) Rango numérico explícito: #10k - #50k, 100k - inf, 10.000 - 50.000, 100k-500k, 6.5k-∞
    const rangeRegex = /#?([0-9.,]+[kK]?)\s*(?:-|to|und)\s*#?([0-9.,]+[kK]?|inf|infinity|∞)/i;
    const match = text.match(rangeRegex);
    if (match) {
        const minVal = parseRankNumber(match[1]);
        let maxVal = parseRankNumber(match[2]);
        if (match[2].toLowerCase() === '999k') maxVal = 999999;
        else if (match[2].toLowerCase() === '99k') maxVal = 99999;
        else if (match[2].toLowerCase() === '9k') maxVal = 9999;

        if (minVal !== null && maxVal !== null && minVal < 2000000 && maxVal <= Infinity) {
            if (match[1].includes('k') || match[2].includes('k') || 
                match[0].includes('#') || match[1].includes('.') || 
                match[1].includes(',') || match[2].includes('.') || 
                match[2].includes(',') || match[2].toLowerCase().includes('inf') ||
                match[2].includes('∞')) {
                return { rankMin: minVal, rankMax: maxVal, isOpen: false };
            }
        }
    }

    // B) Límite inferior abierto con + (ej. 100k+, #100k+, 100k and above)
    const plusMatch = text.match(/#?([0-9.,]+[kK]?)\s*(?:\+|and above|and lower|>)\b/i);
    if (plusMatch) {
        const val = parseRankNumber(plusMatch[1]);
        if (val !== null && val < 2000000 && (plusMatch[1].includes('k') || plusMatch[0].includes('#') || plusMatch[1].includes('.') || plusMatch[1].includes(','))) {
            return { rankMin: val, rankMax: Infinity, isOpen: false };
        }
    }

    // C) Límite superior (ej. under 50k, < 50k, top 50k, #50k and under) -> Rango de 1 a 50.000
    const underMatch = text.match(/(?:top|<|under)\s*#?([0-9.,]+[kK]?)\b|#?([0-9.,]+[kK]?)\s*(?:and better|and higher|and under|& under|and below)\b/i);
    if (underMatch) {
        const valStr = underMatch[1] || underMatch[2];
        const val = parseRankNumber(valStr);
        if (val !== null && val < 2000000 && (valStr.includes('k') || underMatch[0].includes('#') || valStr.includes('.') || valStr.includes(','))) {
            return { rankMin: 1, rankMax: val, isOpen: false };
        }
    }

    return null;
}

/**
 * Parseo de metadatos básicos usando expresiones regulares sobre el BBCode.
 */
function parseRegexMetadata(title, rawBody) {
    const titleLower = title.toLowerCase();
    const bodyLower = rawBody.toLowerCase();
    
    // 1. MODO DE JUEGO
    let gameMode = 'osu';
    if (/\b(mania|o!m)\b/i.test(title) || /\b(4k|7k)\b/i.test(title)) {
        gameMode = 'mania';
    } else if (/\b(taiko|o!t)\b/i.test(title)) {
        gameMode = 'taiko';
    } else if (/\b(catch|ctb|fruits|o!c)\b/i.test(title)) {
        gameMode = 'fruits';
    } else if (/\b(std|standard|o!std)\b/i.test(title)) {
        gameMode = 'osu';
    } else {
        if (/\b(mania|o!m)\b/i.test(rawBody) || /\b(4k|7k)\b/i.test(rawBody)) {
            gameMode = 'mania';
        } else if (/\b(taiko|o!t)\b/i.test(rawBody)) {
            gameMode = 'taiko';
        } else if (/\b(catch|ctb|fruits|o!c)\b/i.test(rawBody)) {
            gameMode = 'fruits';
        }
    }
    
    // 2. FORMATO DE EQUIPO
    let format = '1v1';
    const formatRegexes = [
        /\b(1v1|2v2|3v3|4v4|5v5|6v6|8v8)\b/i,
        /\b(solo|teams? of \d+|team size \d+)\b/i
    ];
    for (const regex of formatRegexes) {
        const match = title.match(regex) || rawBody.match(regex);
        if (match) {
            format = match[1] || match[0];
            break;
        }
    }
    
    // 3. RANGOS GLOBAL
    let rankMin = null;
    let rankMax = null;
    let isOpen = false;
    
    // Prioridad 1: Título del torneo
    if (/\b(open rank|open-rank|no rank limit|open division)\b/i.test(titleLower)) {
        isOpen = true;
        rankMin = 1;
        rankMax = Infinity;
    }

    if (!isOpen && rankMin === null) {
        const titleNumeric = parseNumericRankFromText(title);
        if (titleNumeric) {
            rankMin = titleNumeric.rankMin;
            rankMax = titleNumeric.rankMax;
            isOpen = titleNumeric.isOpen;
        }
    }

    if (!isOpen && rankMin === null) {
        const titleDigit = parseDigitRankFromText(title);
        if (titleDigit) {
            rankMin = titleDigit.rankMin;
            rankMax = titleDigit.rankMax;
            isOpen = titleDigit.isOpen;
        }
    }

    // Prioridad 2: Cuerpo del post
    if (!isOpen && rankMin === null) {
        if (/\b(open rank|open-rank|no rank limit|open division)\b/i.test(bodyLower)) {
            isOpen = true;
            rankMin = 1;
            rankMax = Infinity;
        }
    }

    if (!isOpen && rankMin === null) {
        const lines = rawBody.split('\n');
        const rankKeywords = ['rank', 'rango', 'limit', 'bws', 'ceil', 'ceiling', 'digit', 'digits', 'range', 'restriction', 'eligibility'];
        for (const line of lines) {
            const lineLower = line.toLowerCase();
            if (rankKeywords.some(kw => lineLower.includes(kw))) {
                const lineNumeric = parseNumericRankFromText(line);
                if (lineNumeric) {
                    rankMin = lineNumeric.rankMin;
                    rankMax = lineNumeric.rankMax;
                    isOpen = lineNumeric.isOpen;
                    break;
                }
                const lineDigit = parseDigitRankFromText(line);
                if (lineDigit) {
                    rankMin = lineDigit.rankMin;
                    rankMax = lineDigit.rankMax;
                    isOpen = lineDigit.isOpen;
                    break;
                }
            }
        }
    }

    if (!isOpen && rankMin === null) {
        const bodyNumeric = parseNumericRankFromText(rawBody);
        if (bodyNumeric) {
            rankMin = bodyNumeric.rankMin;
            rankMax = bodyNumeric.rankMax;
            isOpen = bodyNumeric.isOpen;
        } else {
            const bodyDigit = parseDigitRankFromText(rawBody);
            if (bodyDigit) {
                rankMin = bodyDigit.rankMin;
                rankMax = bodyDigit.rankMax;
                isOpen = bodyDigit.isOpen;
            }
        }
    }

    if (!isOpen && rankMin === null) {
        if (/\b(open)\b/i.test(titleLower) && !titleLower.includes('regs open') && !titleLower.includes('reg open')) {
            isOpen = true;
            rankMin = 1;
            rankMax = Infinity;
        }
    }
    
    // 4. ESTADO DE REGISTRO
    let regStatus = 'unknown';
    if (/\b(regs? open|registration open|registros abiertos|inscripciones abiertas|signups? open|player regs open)\b/i.test(titleLower) || 
        /\b(regs? open|registration open|registros abiertos|inscripciones abiertas|signups? open)\b/i.test(bodyLower)) {
        regStatus = 'open';
    } else if (/\b(regs? closed|registration closed|registros cerrados|inscripciones cerradas|signups? closed|bracket stage|matches begin)\b/i.test(titleLower) || 
               /\b(regs? closed|registration closed|registros cerrados|inscripciones cerradas|signups? closed)\b/i.test(bodyLower)) {
        regStatus = 'closed';
    }
    
    // 5. ENLACES CLAVE
    const links = {
        discord: null,
        mainsheet: null,
        registration: null,
        twitch: null,
        challonge: null,
        rules: null
    };
    
    const bbcodeUrlRegex = /\[url=([^\]]+)\]([^\[]+)\[\/url\]/gi;
    let match;
    while ((match = bbcodeUrlRegex.exec(rawBody)) !== null) {
        const url = match[1].trim();
        const label = match[2].toLowerCase().trim();
        if (url.includes('discord.gg') || url.includes('discord.com/invite')) {
            links.discord = url;
        } else if (url.includes('docs.google.com/spreadsheets') || label.includes('sheet') || label.includes('planilla') || label.includes('mainsheet')) {
            if (url.includes('docs.google.com/spreadsheets')) links.mainsheet = url;
        } else if (url.includes('docs.google.com/forms') || url.includes('forms.gle') || label.includes('register') || label.includes('registration') || label.includes('inscrip') || label.includes('signup') || label.includes('sign up')) {
            links.registration = url;
        } else if (url.includes('twitch.tv')) {
            links.twitch = url;
        } else if (url.includes('challonge.com')) {
            links.challonge = url;
        } else if (url.includes('docs.google.com/document') || label.includes('rules') || label.includes('reglas')) {
            links.rules = url;
        }
    }

    const imagemapRegex = /\[imagemap\]([\s\S]+?)\[\/imagemap\]/gi;
    let imgMapMatch;
    while ((imgMapMatch = imagemapRegex.exec(rawBody)) !== null) {
        const lines = imgMapMatch[1].split('\n');
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            const urlPart = parts.find(p => p.startsWith('http://') || p.startsWith('https://'));
            if (urlPart) {
                const label = parts.slice(parts.indexOf(urlPart) + 1).join(' ').toLowerCase();
                if (urlPart.includes('discord.gg') || urlPart.includes('discord.com/invite')) {
                    links.discord = urlPart;
                } else if (urlPart.includes('docs.google.com/spreadsheets') || label.includes('sheet') || label.includes('planilla') || label.includes('mainsheet')) {
                    links.mainsheet = urlPart;
                } else if (urlPart.includes('docs.google.com/forms') || urlPart.includes('forms.gle') || label.includes('register') || label.includes('registration') || label.includes('inscrip') || label.includes('signup')) {
                    links.registration = urlPart;
                } else if (urlPart.includes('twitch.tv')) {
                    links.twitch = urlPart;
                } else if (urlPart.includes('challonge.com')) {
                    links.challonge = urlPart;
                } else if (urlPart.includes('docs.google.com/document') || label.includes('rules') || label.includes('reglas')) {
                    links.rules = urlPart;
                }
            }
        }
    }

    if (!links.discord) {
        const discMatch = rawBody.match(/https?:\/\/(?:www\.)?(?:discord\.gg|discord\.com\/invite)\/[a-zA-Z0-9]+/i);
        if (discMatch) links.discord = discMatch[0];
    }
    if (!links.mainsheet) {
        const sheetMatch = rawBody.match(/https?:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9-_]+/i);
        if (sheetMatch) links.mainsheet = sheetMatch[0];
    }
    if (!links.registration) {
        const formMatch = rawBody.match(/https?:\/\/(?:docs\.google\.com\/forms|forms\.gle)\/[a-zA-Z0-9-_]+/i);
        if (formMatch) links.registration = formMatch[0];
    }
    if (!links.challonge) {
        const challongeMatch = rawBody.match(/https?:\/\/(?:www\.)?challonge\.com\/[a-zA-Z0-9-_]+/i);
        if (challongeMatch) links.challonge = challongeMatch[0];
    }
    if (!links.twitch) {
        const twitchMatch = rawBody.match(/https?:\/\/(?:www\.)?twitch\.tv\/[a-zA-Z0-9-_]+/i);
        if (twitchMatch) links.twitch = twitchMatch[0];
    }

    return {
        gameMode,
        format,
        rankMin: rankMin || 1,
        rankMax: rankMax === Infinity ? null : rankMax,
        isOpenRange: isOpen || (rankMin === 1 && rankMax === Infinity),
        regStatus,
        links
    };
}

function cleanAndNormalizeTags(tagsArray) {
    if (!tagsArray || !Array.isArray(tagsArray)) return [];
    return [...new Set(
        tagsArray
            .map(t => String(t)
                .toLowerCase()
                .trim()
                .replace(/[-_]/g, ' ')
                .replace(/\s+/g, ' ')
            )
            .filter(t => t.length > 0)
    )];
}

/**
 * Consulta a Groq para extraer información detallada estructurada.
 */
function parseWithGroq(title, rawBody, attempt = 1) {
    return new Promise((resolve) => {
        const GROQ_API_KEY = process.env.GROQ_API_KEY;
        if (!GROQ_API_KEY) {
            return resolve({ prizes: null, schedule: null, rules: null, tags: [], status: 'unknown' });
        }
        const currentDate = new Date().toISOString().split('T')[0];
        const truncatedBody = rawBody.substring(0, 3000);

        const prompt = `
Analiza el siguiente post de foro de un torneo de osu! (título y cuerpo en formato BBCode) y extrae de forma resumida y amigable los siguientes datos en español:
1. Premios (prizes): Resumen de los premios para los primeros lugares de forma concisa.
2. Cronograma (schedule): Lista de fechas clave (fase de registros, qualifiers, rondas, etc.).
3. Reglas (rules): Un resumen corto de las reglas más importantes (formato, tolerancia, desconexiones, etc.) en forma de puntos (bullets).
4. Etiquetas (tags): Una lista (array de strings de 3 a 8 palabras clave en minúsculas) para buscar y clasificar el torneo. Por ejemplo: región (latam, balkan, vn, us, global), formato (1v1, 2v2, 4v4, draft), restricciones (bws, badge-limit, rank-limit), modo (std, mania, taiko, catch), etc. Genera al menos 4 etiquetas relevantes.
5. Estado (status): Determina si el torneo actualmente está:
   - "open": Las inscripciones/registros están abiertos hoy (${currentDate}).
   - "in_progress": El registro ya cerró, pero el torneo se está jugando activamente hoy (${currentDate}) (ej. brackets, qualifiers, rondas, etc.).
   - "completed": El torneo ya finalizó completamente.
   - "unknown": No se puede determinar con certeza.

Devuelve estrictamente un objeto JSON válido (sin formato markdown adicional ni bloques de código \`\`\`json) con las siguientes propiedades exactas:
{
  "prizes": "texto descriptivo de los premios",
  "schedule": "texto con el cronograma y fechas",
  "rules": "resumen corto de las reglas principales",
  "tags": ["tag1", "tag2", "tag3"],
  "status": "open" | "in_progress" | "completed" | "unknown"
}

Título del Torneo: "${title}"

Cuerpo BBCode del Torneo:
${truncatedBody}
`;

        const payload = JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0.2
        });

        const options = {
            hostname: 'api.groq.com',
            port: 443,
            path: '/openai/v1/chat/completions',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', async () => {
                try {
                    const jsonRes = JSON.parse(data);

                    if (jsonRes.error && jsonRes.error.code === 'rate_limit_exceeded') {
                        if (attempt <= 3) {
                            console.log(`   └─ ⚠️ Límite de tokens de Groq alcanzado. Esperando 15s antes de reintentar (Intento ${attempt}/3)...`);
                            await new Promise(r => setTimeout(r, 15000));
                            return resolve(parseWithGroq(title, rawBody, attempt + 1));
                        } else {
                            console.error(`   └─ ❌ Límite de reintentos de Groq superado para este torneo.`);
                            return resolve({ prizes: null, schedule: null, rules: null, tags: [], status: 'unknown' });
                        }
                    }

                    if (jsonRes.choices && jsonRes.choices[0] && jsonRes.choices[0].message) {
                        const contentText = jsonRes.choices[0].message.content;
                        const parsedResult = JSON.parse(contentText.trim());
                        resolve({
                            prizes: parsedResult.prizes || null,
                            schedule: parsedResult.schedule || null,
                            rules: parsedResult.rules || null,
                            tags: cleanAndNormalizeTags(parsedResult.tags),
                            status: ['open', 'in_progress', 'completed', 'unknown'].includes(parsedResult.status) ? parsedResult.status : 'unknown'
                        });
                    } else {
                        resolve({ prizes: null, schedule: null, rules: null, tags: [], status: 'unknown' });
                    }
                } catch {
                    resolve({ prizes: null, schedule: null, rules: null, tags: [], status: 'unknown' });
                }
            });
        });

        req.on('error', () => {
            resolve({ prizes: null, schedule: null, rules: null, tags: [], status: 'unknown' });
        });

        req.write(payload);
        req.end();
    });
}

/**
 * Sincroniza los últimos torneos publicados en el foro de osu!
 * y los añade a la base de datos si no existen.
 * 
 * @param {number} limit - Límite de temas recientes a verificar en el foro.
 * @returns {Promise<Array>} Lista de torneos nuevos sincronizados.
 */
async function syncLatestTournaments(limit = 10) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        console.warn('[Tournament Sync] Cliente de Supabase no disponible para sincronizar torneos.');
        return { newTournaments: [], updatedTournaments: [] };
    }

    try {
        await OsuUserModel.NewloadToken();

        // 1. Obtener la lista de temas del foro (sección 55)
        const listResult = await v2.forums.topics.list({ id: 55, limit });
        if (!listResult || !listResult.topics || listResult.topics.length === 0) {
            return { newTournaments: [], updatedTournaments: [] };
        }

        const topicIds = listResult.topics.map(t => t.id);

        // 2. Verificar cuáles ya existen en la base de datos
        const { data: existingTournaments, error: checkError } = await supabase
            .from('tournaments')
            .select('*')
            .in('id', topicIds);

        if (checkError) {
            console.error('[Tournament Sync] Error al verificar torneos existentes:', checkError.message);
            return { newTournaments: [], updatedTournaments: [] };
        }

        const existingMap = {};
        if (existingTournaments) {
            for (const t of existingTournaments) {
                existingMap[t.id] = t;
            }
        }

        console.log(`[Tournament Sync] Verificando ${listResult.topics.length} torneos en el foro...`);
        const syncedNewTournaments = [];
        const syncedUpdatedTournaments = [];

        for (const topic of listResult.topics) {
            try {
                const existingRecord = existingMap[topic.id];
                const isNew = !existingRecord;
                let shouldProcess = isNew;

                if (!isNew) {
                    // Si ya existe, comprobamos si la fecha de actualización de la API es diferente
                    const apiUpdated = new Date(topic.updated_at || topic.created_at).getTime();
                    const dbUpdated = new Date(existingRecord.updated_at || existingRecord.created_at).getTime();
                    if (apiUpdated !== dbUpdated) {
                        shouldProcess = true;
                    }
                }

                if (!shouldProcess) continue;

                // Obtener detalles del tema (para el primer post)
                const details = await v2.forums.topics.details({ id: topic.id });
                if (!details.posts || details.posts.length === 0) continue;

                const firstPost = details.posts[0];
                const rawBody = firstPost.body?.raw || '';

                // Extraer metadatos básicos con Regex
                const meta = parseRegexMetadata(topic.title, rawBody);

                // Obtener datos avanzados usando Groq si está configurado
                let aiData = { prizes: null, schedule: null, rules: null, tags: [], status: 'unknown' };
                const GROQ_API_KEY = process.env.GROQ_API_KEY;
                if (GROQ_API_KEY) {
                    try {
                        aiData = await parseWithGroq(topic.title, rawBody);
                    } catch (groqErr) {
                        console.error(`[Tournament Sync] Error al consultar Groq para el tema ${topic.id}:`, groqErr.message);
                    }
                }

                const finalStatus = aiData.status !== 'unknown' ? aiData.status : meta.regStatus;

                const tournamentRecord = {
                    id: topic.id,
                    title: topic.title,
                    creator_id: topic.user_id,
                    game_mode: meta.gameMode,
                    team_format: meta.format,
                    rank_min: meta.rankMin,
                    rank_max: meta.rankMax,
                    is_open_range: meta.isOpenRange,
                    reg_status: finalStatus,
                    discord_url: meta.links.discord,
                    mainsheet_url: meta.links.mainsheet,
                    registration_url: meta.links.registration,
                    twitch_url: meta.links.twitch,
                    challonge_url: meta.links.challonge,
                    rules_url: meta.links.rules,
                    prizes: aiData.prizes,
                    schedule: aiData.schedule,
                    rules_summary: aiData.rules,
                    tags: aiData.tags,
                    created_at: topic.created_at,
                    updated_at: topic.updated_at || new Date().toISOString(),
                    last_synced_at: new Date().toISOString()
                };

                // Si no es nuevo, verificar si realmente cambió algo que afecte al embed/datos
                let hasChanged = true;
                if (!isNew) {
                    hasChanged = hasTournamentChanged(tournamentRecord, existingRecord);
                }

                if (hasChanged) {
                    const { error: insertError } = await supabase
                        .from('tournaments')
                        .upsert(tournamentRecord, { onConflict: 'id' });

                    if (insertError) {
                        console.error(`[Tournament Sync] Error al guardar el torneo ${topic.id} en Supabase:`, insertError.message);
                    } else {
                        console.log(`[Tournament Sync] ✅ Torneo "${topic.title}" (ID: ${topic.id}) guardado/actualizado exitosamente.`);
                        if (isNew) {
                            syncedNewTournaments.push(tournamentRecord);
                        } else {
                            syncedUpdatedTournaments.push(tournamentRecord);
                        }
                    }
                } else {
                    // Si no cambió la información, de todos modos actualizamos la fecha de updated_at y last_synced_at en DB
                    // para evitar volver a procesarlo inútilmente en la próxima iteración.
                    await supabase
                        .from('tournaments')
                        .update({
                            updated_at: topic.updated_at || existingRecord.updated_at,
                            last_synced_at: new Date().toISOString()
                        })
                        .eq('id', topic.id);
                }

                // Pequeña espera para no saturar APIs
                await new Promise(r => setTimeout(r, GROQ_API_KEY ? 2000 : 200));
            } catch (topicErr) {
                console.error(`[Tournament Sync] Error al procesar el torneo ${topic.id}:`, topicErr);
            }
        }

        return {
            newTournaments: syncedNewTournaments,
            updatedTournaments: syncedUpdatedTournaments
        };
    } catch (err) {
        console.error('[Tournament Sync] Error general en syncLatestTournaments:', err);
        return { newTournaments: [], updatedTournaments: [] };
    }
}

/**
 * Compara dos registros de torneo para ver si la información relevante ha cambiado.
 * @param {Object} recordA
 * @param {Object} recordB
 * @returns {boolean}
 */
function hasTournamentChanged(recordA, recordB) {
    const fields = [
        'title', 'game_mode', 'team_format', 'rank_min', 'rank_max', 'is_open_range', 'reg_status',
        'discord_url', 'mainsheet_url', 'registration_url', 'twitch_url', 'challonge_url', 'rules_url',
        'prizes', 'schedule', 'rules_summary'
    ];
    for (const field of fields) {
        if (recordA[field] !== recordB[field]) return true;
    }
    // Comparar tags
    const tagsA = recordA.tags || [];
    const tagsB = recordB.tags || [];
    if (tagsA.length !== tagsB.length) return true;
    for (let i = 0; i < tagsA.length; i++) {
        if (tagsA[i] !== tagsB[i]) return true;
    }
    return false;
}

/**
 * Obtiene el último torneo guardado en la base de datos.
 * @returns {Promise<Object|null>} El torneo más reciente o null.
 */
async function getLatestTournament() {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    const { data, error } = await supabase
        .from('tournaments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error('[DB] Error al obtener el último torneo:', error);
        throw error;
    }
    return data;
}

/**
 * Guarda o actualiza el registro de un embed de torneo enviado.
 */
async function saveSentMessage(tournamentId, guildId, channelId, messageId) {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    const { data, error } = await supabase
        .from('tournament_feed_messages')
        .upsert({
            tournament_id: tournamentId,
            guild_id: guildId,
            channel_id: channelId,
            message_id: messageId,
            created_at: new Date().toISOString()
        }, { onConflict: 'tournament_id,guild_id' })
        .select()
        .maybeSingle();

    if (error) {
        console.error('[DB] Error al guardar mensaje de feed de torneo:', error);
    }
    return data;
}

/**
 * Obtiene todos los mensajes de feed enviados para un torneo específico.
 */
async function getSentMessages(tournamentId) {
    const supabase = getSupabaseClient();
    if (!supabase) return [];

    const { data, error } = await supabase
        .from('tournament_feed_messages')
        .select('*')
        .eq('tournament_id', tournamentId);

    if (error) {
        console.error('[DB] Error al obtener mensajes de feed de torneo:', error);
        return [];
    }
    return data || [];
}

/**
 * Elimina el registro de un mensaje de feed de torneo.
 */
async function deleteSentMessage(tournamentId, guildId) {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    const { data, error } = await supabase
        .from('tournament_feed_messages')
        .delete()
        .eq('tournament_id', tournamentId)
        .eq('guild_id', guildId);

    if (error) {
        console.error('[DB] Error al eliminar mensaje de feed de torneo:', error);
    }
    return data;
}

module.exports = {
    searchTournaments,
    syncLatestTournaments,
    getLatestTournament,
    saveSentMessage,
    getSentMessages,
    deleteSentMessage,
    parseRegexMetadata
};
