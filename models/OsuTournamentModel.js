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
    if (clean === 'open' || clean === 'inf' || clean === 'infinity' || clean === 'any') {
        return Infinity;
    }
    
    let multiplier = 1;
    if (clean.endsWith('k')) {
        multiplier = 1000;
        clean = clean.slice(0, -1);
    }
    
    clean = clean.replace(/[,.]/g, '');
    let num = parseInt(clean, 10);
    return isNaN(num) ? null : num * multiplier;
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
    
    if (/\b(open rank|open-rank|no rank limit|open division)\b/i.test(titleLower) || 
        /\b(open rank|open-rank|no rank limit|open division)\b/i.test(bodyLower)) {
        isOpen = true;
        rankMin = 1;
        rankMax = Infinity;
    }
    
    if (!isOpen) {
        const rangeRegex = /#?([0-9.,]+[kK]?)\s*(?:-|to|und)\s*#?([0-9.,]+[kK]?|inf|infinity)/i;
        const titleMatch = title.match(rangeRegex);
        if (titleMatch) {
            const minVal = parseRankNumber(titleMatch[1]);
            const maxVal = parseRankNumber(titleMatch[2]);
            if (minVal !== null && maxVal !== null && minVal < 2000000 && maxVal < 2000000) {
                if (titleMatch[1].includes('k') || titleMatch[2].includes('k') || 
                    titleMatch[0].includes('#') || titleMatch[1].includes('.') || 
                    titleMatch[1].includes(',') || titleMatch[2].includes('.') || 
                    titleMatch[2].includes(',')) {
                    rankMin = minVal;
                    rankMax = maxVal;
                }
            }
        }
        
        if (rankMin === null) {
            const underMatch = title.match(/#?([0-9.,]+[kK]?)\s*(?:and under|& under|and below|and lower|under|<)\b/i);
            if (underMatch) {
                const val = parseRankNumber(underMatch[1]);
                if (val !== null) {
                    rankMin = val;
                    rankMax = Infinity;
                }
            }
        }
        
        if (rankMin === null) {
            const lines = rawBody.split('\n');
            const rankKeywords = ['rank', 'rango', 'limit', 'bws', 'ceil', 'ceiling'];
            for (const line of lines) {
                const lineLower = line.toLowerCase();
                if (rankKeywords.some(kw => lineLower.includes(kw))) {
                    const lineMatch = line.match(rangeRegex);
                    if (lineMatch) {
                        const minVal = parseRankNumber(lineMatch[1]);
                        const maxVal = parseRankNumber(lineMatch[2]);
                        if (minVal !== null && maxVal !== null && minVal < 2000000 && maxVal < 2000000) {
                            rankMin = minVal;
                            rankMax = maxVal;
                            break;
                        }
                    }
                    const lineUnderMatch = line.match(/#?([0-9.,]+[kK]?)\s*(?:and under|& under|and below|and lower|under|<)\b/i);
                    if (lineUnderMatch) {
                        const val = parseRankNumber(lineUnderMatch[1]);
                        if (val !== null) {
                            rankMin = val;
                            rankMax = Infinity;
                            break;
                        }
                    }
                    const infMatch = line.match(/#?([0-9.,]+[kK]?)\s*-\s*(?:inf|infinity)\b/i);
                    if (infMatch) {
                        const val = parseRankNumber(infMatch[1]);
                        if (val !== null) {
                            rankMin = val;
                            rankMax = Infinity;
                            break;
                        }
                    }
                }
            }
        }
        
        if (rankMin === null) {
            if (/\b(open)\b/i.test(titleLower) && !titleLower.includes('regs open') && !titleLower.includes('reg open')) {
                isOpen = true;
                rankMin = 1;
                rankMax = Infinity;
            }
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
        return [];
    }

    try {
        await OsuUserModel.NewloadToken();

        // 1. Obtener la lista de temas del foro (sección 55)
        const listResult = await v2.forums.topics.list({ id: 55, limit });
        if (!listResult || !listResult.topics || listResult.topics.length === 0) {
            return [];
        }

        const topicIds = listResult.topics.map(t => t.id);

        // 2. Verificar cuáles ya existen en la base de datos
        const { data: existingTournaments, error: checkError } = await supabase
            .from('tournaments')
            .select('id')
            .in('id', topicIds);

        if (checkError) {
            console.error('[Tournament Sync] Error al verificar torneos existentes:', checkError.message);
            return [];
        }

        const existingIds = new Set(existingTournaments?.map(t => t.id) || []);
        const newTopics = listResult.topics.filter(t => !existingIds.has(t.id));

        if (newTopics.length === 0) {
            return [];
        }

        console.log(`[Tournament Sync] Se encontraron ${newTopics.length} nuevos torneos en el foro. Procesando...`);
        const syncedTournaments = [];

        for (const topic of newTopics) {
            try {
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

                const { error: insertError } = await supabase
                    .from('tournaments')
                    .upsert(tournamentRecord, { onConflict: 'id' });

                if (insertError) {
                    console.error(`[Tournament Sync] Error al guardar el torneo ${topic.id} en Supabase:`, insertError.message);
                } else {
                    console.log(`[Tournament Sync] ✅ Torneo "${topic.title}" (ID: ${topic.id}) guardado exitosamente.`);
                    syncedTournaments.push(tournamentRecord);
                }

                // Pequeña espera para no saturar APIs
                await new Promise(r => setTimeout(r, GROQ_API_KEY ? 2000 : 200));
            } catch (topicErr) {
                console.error(`[Tournament Sync] Error al procesar el torneo ${topic.id}:`, topicErr);
            }
        }

        return syncedTournaments;
    } catch (err) {
        console.error('[Tournament Sync] Error general en syncLatestTournaments:', err);
        return [];
    }
}

module.exports = {
    searchTournaments,
    syncLatestTournaments
};
