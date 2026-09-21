/**
 * services/commandRegistry.js
 * 
 * Registro dinámico y declarativo de comandos y flags para Sengo.
 * Permite descubrir comandos del filesystem, exponer descripciones semánticas
 * para TypeSafe Jev y construir argumentos y flags de forma modular sin hardcoding.
 * 
 * ponytail: 0 dependencias externas, usa fs y path nativos de Node.
 */

const fs = require('fs');
const path = require('path');

/**
 * Diccionario modular de manejadores de flags.
 * Cada manejador extrae y formatea los flags correspondientes a partir de las respuestas de Jev y las entidades.
 */
const FLAG_HANDLERS = {
    // 1. Modos de juego (-std, -taiko, -fruits, -mania)
    gamemode: (answers) => {
        const mode = answers.gamemode?.choice;
        if (!mode || mode === 'default') return null;
        if (mode === 'osu') return '-std';
        if (mode === 'taiko') return '-taiko';
        if (mode === 'fruits') return '-fruits';
        if (mode === 'mania') return '-mania';
        return null;
    },

    // 2. Servidores privados (-gatari, -droid)
    server: (answers) => {
        const srv = answers.server?.choice;
        if (srv && srv !== 'default') {
            return `-${srv}`;
        }
        return null;
    },

    // 3. Modalidad de cliente y puntuación (-lazer, -stable)
    client_mode: (answers) => {
        const cm = answers.client_mode?.choice;
        if (cm === 'lazer') return '-lazer';
        if (cm === 'classic') return '-stable';
        return null;
    },

    // 4. No Choke (-nochoke)
    nochoke: (answers) => {
        return answers.is_nochoke?.noul > 0.50 ? '-nochoke' : null;
    },

    // 5. Criterios de ordenamiento métrico
    sort_metric: (answers) => {
        const sort = answers.sort_metric?.choice;
        if (sort && sort !== 'none') {
            if (sort === 'recent') return '-recent';
            if (sort === 'combo') return '-c';
            if (sort === 'stars') return '-sr';
            if (sort === 'length') return '-dur';
            return `-${sort}`;
        }
        if (answers.is_recent_sort?.noul > 0.70) {
            return '-recent';
        }
        return null;
    },

    // 6. Orden invertido (-rev)
    reverse: (answers) => {
        return answers.is_reverse?.noul > 0.60 ? '-rev' : null;
    },

    // 7. Formato lista compacta (-list)
    list: (answers) => {
        return answers.is_list?.noul > 0.70 ? '-list' : null;
    },

    // 8. Solo jugadas pasadas (-ps)
    pass_only: (answers) => {
        return answers.is_pass_only?.noul > 0.50 ? '-ps' : null;
    },

    // 9. Vista detallada (-d)
    detailed: (answers) => {
        return answers.is_detailed?.noul > 0.70 ? '-d' : null;
    },

    // 10. Estadísticas promedio del top (-promedio)
    promedio: (answers) => {
        return answers.is_promedio?.noul > 0.65 ? '-promedio' : null;
    },

    // 11. Habilidad cinética en top (-aim, -speed, -reading, -acc, -stamina, -skill)
    top_skill: (answers, entities) => {
        if (!entities.cleanText.match(/\b(skills?|habilidad(es)?)\b/i)) return null;
        const sk = answers.skill_filter?.choice;
        if (sk && sk !== 'none') {
            return sk === 'all' ? '-skill' : `-${sk}`;
        }
        return null;
    },

    // 12. Rework en top (-rework <q>)
    top_rework: (answers, entities) => {
        if (!entities.cleanText.match(/\breworks?\b/i) && !entities.reworkQuery) return null;
        const args = ['-rework'];
        if (entities.reworkQuery) args.push(entities.reworkQuery);
        return args;
    },

    // 13. Habilidad en comando skills
    skills_breakdown: (answers, entities) => {
        const args = [];
        let sk = answers.skill_filter?.choice;
        if (!sk || sk === 'none') {
            const skillMatch = entities.cleanText.match(/\b(aim|speed|reading|stamina|acc|accuracy|precision)\b/i);
            if (skillMatch) {
                sk = skillMatch[1].toLowerCase();
                if (sk === 'accuracy' || sk === 'precision') sk = 'acc';
            }
        }
        if (entities.cleanText.match(/\b(?:top|mejores)\b/i)) {
            args.push('-top');
        }
        if (sk && sk !== 'none' && sk !== 'all') {
            args.push(`-${sk}`);
        }
        if (entities.cleanText.match(/\b(?:servidor|server|srv|guild)\b/i)) {
            args.push('-server');
        }
        if (answers.snipes_filter?.choice === 'national' || entities.cleanText.match(/\b(?:nacional|nac|national)\b/i)) {
            args.push('-nacional');
        }
        return args.length > 0 ? args : null;
    },

    // 14. Filtros de snipes
    snipes_filter: (answers, entities) => {
        const args = [];
        if (answers.snipes_filter?.choice === 'nemesis' || entities.cleanText.match(/\b(?:n[eé]mesis|victima|v[ií]ctima)\b/i)) {
            args.push('-nemesis');
        }
        if (entities.targetVictim) {
            args.push('-victima', entities.targetVictim);
        }
        if (answers.snipes_filter?.choice === 'national' || entities.cleanText.match(/\b(?:nacional|nac|national)\b/i)) {
            args.push('-nacional');
        }
        if (answers.snipes_filter?.choice === 'top' || entities.cleanText.match(/\b(?:top|mejores)\b/i)) {
            args.push('-top');
        }
        return args.length > 0 ? args : null;
    },

    // 15. Presets y opciones de Card
    card_preset: (answers, entities) => {
        const args = [];
        const preset = answers.card_preset?.choice;
        if (preset && preset !== 'none') {
            args.push(`-${preset}`);
        }
        if (entities.cleanText.match(/\b(?:embed)\b/i)) {
            args.push('-embed');
        } else if (entities.cleanText.match(/\b(?:userpage|bbcode|up)\b/i)) {
            args.push('-userpage');
        }
        if (answers.is_force?.noul > 0.60 || entities.cleanText.match(/\b(?:force|forzar|refrescar|actualizar)\b/i)) {
            args.push('-force');
        }
        return args.length > 0 ? args : null;
    },

    // 16. Estilos y opciones de Recommend
    recommend_style: (answers, entities) => {
        const args = [];
        const style = answers.recommend_style?.choice;
        if (style && style !== 'none' && style !== 'played') {
            args.push(`-${style}`);
        }
        if (style === 'played' || entities.cleanText.match(/\b(?:jugados?|played)\b/i)) {
            args.push('-jugados');
        }
        if (answers.is_force?.noul > 0.60 || entities.cleanText.match(/\b(?:force|forzar|refrescar|nuevos?)\b/i)) {
            args.push('-force');
        }
        if (entities.ppRange) {
            args.push('-pp', entities.ppRange);
        } else if (entities.ppThreshold) {
            args.push('-g', entities.ppThreshold);
        }
        if (entities.userTag) {
            args.push('-usertag', entities.userTag);
        } else if (entities.cleanText.match(/\b(?:tags?|etiquetas?)\b/i)) {
            args.push('-usertag');
        }
        return args.length > 0 ? args : null;
    },

    // 17. Opciones de Render
    render_options: (answers, entities) => {
        const args = [];
        if (entities.renderSkin) args.push('-skin', entities.renderSkin);
        if (entities.renderResolution) args.push('-res', entities.renderResolution);
        if (entities.cleanText.match(/\b(?:config|configuraci[oó]n|preset)\b/i)) args.push('-config');
        if (entities.cleanText.match(/\bskip\b/i)) args.push('-skip');
        return args.length > 0 ? args : null;
    },

    // 18. Opciones de Rework
    rework_options: (answers, entities) => {
        const args = [];
        const view = answers.rework_view?.choice;
        if (view === 'list' || entities.cleanText.match(/\b(?:lista|listado|disponibles)\b/i)) {
            args.push('-lista');
        } else if (view === 'top' || entities.cleanText.match(/\b(?:top|mejores)\b/i)) {
            args.push('-top');
        } else if (view === 'profile' || entities.cleanText.match(/\b(?:perfil|stats|comparar)\b/i)) {
            args.push('-o');
        }
        if (entities.reworkQuery) {
            args.push('-rework', entities.reworkQuery);
        }
        const engineMatch = entities.cleanText.match(/\b(sengo|rust|native)\b/i);
        if (engineMatch) {
            args.push(`-${engineMatch[1].toLowerCase()}`);
        }
        if (entities.cleanText.match(/\b(?:bench|benchmark)\b/i)) {
            args.push('-bench');
        }
        return args.length > 0 ? args : null;
    },

    // 19. Opciones de Torneos
    torneo_options: (answers, entities) => {
        const args = [];
        const b = answers.torneo_breakdown?.choice;
        if (b === 'recommend' || entities.cleanText.match(/\b(?:rec|recomendar?|sugiere|sugerir)\b/i)) {
            args.push('-rec');
        } else if (b === 'tags') args.push('-tag');
        else if (b === 'modo') args.push('-modo');
        else if (b === 'estado') args.push('-estado');
        else if (b === 'pasados') args.push('-pasados');
        return args.length > 0 ? args : null;
    },

    // 20. Opciones de Mapper
    mapper_options: (answers, entities) => {
        const args = [];
        const text = entities.cleanText;
        if (text.match(/\b(?:top|mejores|ranking|clasificaci[oó]n)\b/i)) {
            args.push('-top');
        }
        if (text.match(/\b(?:nacional|pa[ií]s|country)\b/i)) {
            args.push('-nacional');
        }
        if (text.match(/\b(?:servidor|server|guild)\b/i)) {
            args.push('-server');
        }
        if (text.match(/\b(?:global|mundial|todos)\b/i)) {
            args.push('-global');
        }
        if (text.match(/\b(?:kudos|kudosus)\b/i)) args.push('-kudos');
        if (text.match(/\b(?:gd|gds|guest\s*diffs?)\b/i)) args.push('-gd');
        if (text.match(/\b(?:ranked|rankeds|rankeados)\b/i)) args.push('-ranked');
        if (text.match(/\b(?:loved|amados)\b/i)) args.push('-loved');
        if (text.match(/\b(?:followers|seguidores)\b/i)) args.push('-followers');
        if (text.match(/\b(?:graveyard|abandonados)\b/i)) args.push('-graveyard');
        if (text.match(/\b(?:bn|bns|nominators?)\b/i)) args.push('-bn');
        if (text.match(/\b(?:card|tarjeta)\b/i)) args.push('-card');
        if (text.match(/\b(?:activos?|abiertos?|open|active)\b/i)) args.push('-activo');
        if (text.match(/\b(?:track|seguir|seguimiento|rastrear)\b/i)) {
            args.push('-track');
            if (text.match(/\b(?:quitar|borrar|remove|delete)\b/i)) args.push('-quitar');
        }
        return args.length > 0 ? args : null;
    },

    // 21. Opciones de Skin
    skin_options: (answers, entities) => {
        const args = [];
        if (answers.skin_action?.choice === 'delete' || entities.cleanText.match(/\b(?:borrar|delete|eliminar)\b/i)) {
            args.push('-delete');
        }
        if (entities.cleanText.match(/\b(?:colocar|set|poner)\b/i)) {
            args.push('-set');
        }
        return args.length > 0 ? args : null;
    },

    // 22. Opciones de Queue
    queue_options: (answers, entities) => {
        const args = [];
        const qAct = answers.queue_action?.choice;
        if (qAct === 'open') args.push('-abrir');
        else if (qAct === 'close') args.push('-cerrar');
        else if (qAct === 'delete') args.push('-delete');
        if (entities.cleanText.match(/\b(?:servidor|server)\b/i)) args.push('-server');
        return args.length > 0 ? args : null;
    },

    // 23. Opciones de Twins
    twins_options: (answers, entities) => {
        const args = [];
        if (entities.cleanText.match(/\b(?:rango|nivel|rank|close)\b/i)) args.push('-rank');
        if (entities.cleanText.match(/\b(?:por pp|pp)\b/i)) args.push('-pp');
        const sk = answers.skill_filter?.choice;
        if (sk && sk !== 'none' && sk !== 'all') args.push('-skill', sk);
        return args.length > 0 ? args : null;
    },

    // 24. Opciones de Amigos
    amigos_options: (answers, entities) => {
        const args = [];
        if (entities.cleanText.match(/\b(?:track|rastrear|seguimiento)\b/i)) args.push('-track');
        if (entities.cleanText.match(/\b(?:sengo|vinculados)\b/i)) args.push('-sengo');
        return args.length > 0 ? args : null;
    },

    // 25. Opciones de Nacional
    nacional_options: (answers, entities) => {
        const args = [];
        if (entities.regionalFilter) args.push('-regional', entities.regionalFilter);
        if (entities.cleanText.match(/\b(?:tops?|mejores jugadas|mejores scores)\b/i)) args.push('-tops');
        if (entities.cleanText.match(/\b(?:acc|precisi[oó]n|accuracy)\b/i)) args.push('-acc');
        return args.length > 0 ? args : null;
    },

    // 26. Opciones de Mapset
    mapset: (answers, entities) => {
        if (answers.is_mapset?.noul > 0.60 || entities.cleanText.match(/\b(?:mapset|set|pack|[aá]lbum)\b/i)) {
            return '-mapset';
        }
        return null;
    },

    // 27. Filtrar por amigos (-friends)
    friends: (answers, entities) => {
        if (answers.is_friends?.noul > 0.60 || entities.cleanText.match(/\b(?:amigos|friends|amigo)\b/i)) {
            return '-friends';
        }
        return null;
    },

    // 28. Filtro de estrellas
    star_rating: (answers, entities) => {
        return entities.starRatingFilter || null;
    },

    // 29. Filtro de estrellas condicional (-sr <cond>)
    star_rating_cond: (answers, entities) => {
        if (entities.starRatingFilter) {
            return ['-sr', entities.starRatingFilter.replace('*', '')];
        }
        return null;
    },

    // 30. Umbral de PP (-g <pp>)
    pp_threshold: (answers, entities) => {
        if (entities.ppThreshold) {
            return ['-g', entities.ppThreshold];
        }
        return null;
    },

    // 31. Número de página (-p <page>)
    page: (answers, entities) => {
        if (entities.pageNumber) {
            return ['-p', String(entities.pageNumber)];
        }
        return null;
    },

    // 32. Índice de score (-i <idx>)
    score_index: (answers, entities) => {
        if (entities.scoreIndex) {
            return ['-i', String(entities.scoreIndex)];
        }
        return null;
    },

    recent_index: (answers, entities) => {
        if (entities.scoreIndex) {
            return `-i${entities.scoreIndex}`;
        }
        return null;
    },

    // 32.1 Opciones de cumpleaños
    cumple_options: (answers, entities) => {
        const action = answers.cumple_action?.choice;
        if (action === 'siguiente') return 'siguiente';
        if (action === 'anterior') return 'anterior';
        if (action === 'lista') return 'lista';
        if (action === 'quitar') return 'quitar';

        const text = entities.cleanText;
        if (text.match(/\b(?:siguiente|pr[oó]ximo|next)\b/i)) {
            return 'siguiente';
        }
        if (text.match(/\b(?:anterior|pasado|prev|previo)\b/i)) {
            return 'anterior';
        }
        if (text.match(/\b(?:lista|listado|todos)\b/i)) {
            return 'lista';
        }
        if (text.match(/\b(?:quitar|borrar|eliminar|remove)\b/i)) {
            return 'quitar';
        }
        if (text.match(/\b(?:canal|channel)\b/i)) {
            return 'canal';
        }
        if (text.match(/\b(?:rol|role)\b/i)) {
            return 'rol';
        }
        const dateMatch = text.match(/\b(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\b/);
        if (dateMatch) {
            return dateMatch[1];
        }
        return null;
    },

    // 33. Filtro de mods
    mods: (answers, entities) => {
        if (entities.explicitPlusMods) {
            return entities.explicitPlusMods;
        }
        if (entities.modContainFilter) {
            return ['-mx', entities.modContainFilter];
        }
        const mod = answers.mods_filter?.choice;
        if (mod && mod !== 'none') {
            const modMap = {
                dt: '+DT', hr: '+HR', hd: '+HD', ez: '+EZ', fl: '+FL', nomod: '+NM',
                hdhr: '+HDHR', hddt: '+HDDT', dthr: '+DTHR', ezfl: '+EZFL'
            };
            return modMap[mod] || null;
        }
        return null;
    },

    // 34. Código de país (-pais <XX>)
    country: (answers, entities) => {
        if (entities.countryCode) {
            return ['-pais', entities.countryCode];
        }
        return null;
    },

    // 35. Enlace o ID de Beatmap
    beatmap: (answers, entities) => {
        if (entities.beatmapUrl) return entities.beatmapUrl;
        if (entities.beatmapId) return `https://osu.ppy.sh/b/${entities.beatmapId}`;
        return null;
    },

    // 36. Jugadores en comando entre
    entre_players: (answers, entities) => {
        if (entities.comparePlayers && entities.comparePlayers.length === 2) {
            return [entities.comparePlayers[0], entities.comparePlayers[1]];
        }
        return null;
    },

    // 37. Región en comando regional
    regional_param: (answers, entities) => {
        return entities.regionalFilter || null;
    },

    // 38. Nombre de usuario objetivo
    target_user: (answers, entities) => {
        return entities.targetUsername && !entities.targetDiscordId ? entities.targetUsername : null;
    },

    // 39. Mención de usuario de Discord (<@ID>)
    target_mention: (answers, entities) => {
        return entities.targetDiscordId ? `<@${entities.targetDiscordId}>` : null;
    },

    // 40. Comando objetivo para el menú de ayuda (help <cmd>)
    help_target: (answers, entities) => {
        const text = entities.cleanText;
        const match = text.match(/\b(?:ayuda|help|gu[ií]a|c[oó]mo\s+usar?|c[oó]mo\s+se\s+usa|info)(?:\s+(?:con\s+el\s+comando|con\s+el|con|del\s+comando|de\s+el\s+comando|de\s+comando|el\s+comando|del\s+bot|de\s+la|del|de|sobre|para|el|la))?\s+([a-zA-Z0-9_\-]+)\b/i);
        if (match) {
            const candidate = match[1].toLowerCase().trim();
            const ignoredWords = new Set(['comando', 'comandos', 'bot', 'sengo', 'general', 'todo', 'todos', 'aqui', 'porfa', 'favor', 'del', 'de', 'el', 'la', 'los', 'las']);
            if (!ignoredWords.has(candidate)) {
                return ALIAS_MAP[candidate] || candidate;
            }
        }
        return null;
    }
};

/**
 * Definiciones declarativas de comandos de Sengo, asociando cada comando con sus flags válidos y su intención semántica para Jev.
 */
const COMMAND_DEFINITIONS = {
    top: {
        intent: "Consultar mejores jugadas (top plays, mejores puntuaciones, récords personales, mejores scores)",
        category: "osu",
        flags: [
            'gamemode', 'server', 'client_mode', 'nochoke', 'sort_metric', 'reverse',
            'list', 'detailed', 'promedio', 'top_skill', 'top_rework', 'pp_threshold',
            'star_rating', 'page', 'score_index', 'mods', 'country', 'target_user', 'target_mention'
        ]
    },
    r: {
        intent: "Consultar la jugada más reciente (última partida jugada, r, rs, recent play)",
        category: "osu",
        aliases: ['recent', 'rs'],
        flags: [
            'gamemode', 'server', 'client_mode', 'pass_only', 'list', 'detailed',
            'star_rating_cond', 'pp_threshold', 'recent_index', 'mods', 'target_user', 'target_mention'
        ]
    },
    osu: {
        intent: "Ver perfil general, estadísticas globales o tarjeta de usuario (osu, perfil, stats)",
        category: "osu",
        aliases: ['perfil', 'profile', 'o'],
        flags: ['gamemode', 'server', 'promedio', 'detailed', 'target_user', 'target_mention']
    },
    c: {
        intent: "Comparar puntuación en un beatmap específico o último mapa (c, compare)",
        category: "osu",
        aliases: ['compare', 'comparar'],
        flags: ['gamemode', 'server', 'client_mode', 'pass_only', 'list', 'beatmap', 'mods', 'target_user', 'target_mention']
    },
    skills: {
        intent: "Ver habilidades cinéticas, radar, desglose de skills (aim, speed, reading, stamina) o mejores jugadas por habilidad en el top (skills)",
        category: "osu",
        flags: ['gamemode', 'skills_breakdown', 'score_index', 'country', 'target_user', 'target_mention']
    },
    card: {
        intent: "Generar tarjeta gráfica o imagen Canvas de perfil (card)",
        category: "osu",
        aliases: ['tarjeta'],
        flags: ['gamemode', 'server', 'card_preset', 'target_user', 'target_mention']
    },
    recommend: {
        intent: "Recomendar beatmaps para jugar o farmear pp (recommend, rec)",
        category: "osu",
        aliases: ['rec'],
        flags: ['gamemode', 'recommend_style', 'mods', 'target_user', 'target_mention']
    },
    snipes: {
        intent: "Ver snipes, primer lugar (#1s) o historial de snipes (snipes)",
        category: "osu",
        flags: ['gamemode', 'snipes_filter', 'detailed', 'star_rating_cond', 'target_user', 'target_mention']
    },
    render: {
        intent: "Renderizar o grabar video de replay de osu! (render, o!rdr)",
        category: "osu",
        flags: ['render_options']
    },
    rework: {
        intent: "Consultar cambios de pp o impacto con reworks de osu! (rework)",
        category: "osu",
        flags: ['gamemode', 'rework_options', 'target_user', 'target_mention']
    },
    lb: {
        intent: "Ver la tabla de clasificación o leaderboard de un beatmap o mapa, o leaderboard nacional/por país de un mapa (lb, leaderboard, tabla del mapa)",
        category: "osu",
        aliases: ['leaderboard', 'lbm', 'lbc', 'lbt', 'lbp'],
        flags: ['gamemode', 'server', 'client_mode', 'friends', 'country', 'page', 'beatmap', 'mods']
    },
    nacional: {
        intent: "Ver ranking nacional de jugadores de un país o mejores jugadas registradas en el país (nacional, ranking nacional de jugadores)",
        category: "osu",
        flags: ['gamemode', 'nacional_options', 'star_rating_cond', 'country', 'page']
    },
    regional: {
        intent: "Ver ranking regional (regional)",
        category: "osu",
        flags: ['gamemode', 'regional_param']
    },
    torneos: {
        intent: "Consultar torneos de osu! activos o información de torneos (torneos)",
        category: "osu",
        flags: ['torneo_options']
    },
    mapper: {
        intent: "Consultar creadores de mapas, estadísticas de mapper, o ranking/top nacional o global de mappers (mapper, mappers)",
        category: "osu",
        aliases: ['mappers'],
        flags: ['gamemode', 'mapper_options', 'country', 'target_user', 'target_mention']
    },
    skin: {
        intent: "Buscar o descargar skins de osu! (skin)",
        category: "osu",
        flags: ['gamemode', 'skin_options', 'target_user', 'target_mention']
    },
    queue: {
        intent: "Ver cola de mapas para testear o modear (queue)",
        category: "osu",
        flags: ['gamemode', 'queue_options', 'target_user', 'target_mention']
    },
    twins: {
        intent: "Buscar gemelos de estadísticas o jugadores similares (twins, twin)",
        category: "osu",
        aliases: ['twin'],
        flags: ['gamemode', 'twins_options', 'country', 'list', 'mods', 'target_user', 'target_mention']
    },
    amigos: {
        intent: "Ver lista o estado de amigos vinculados de osu! (amigos)",
        category: "osu",
        flags: ['amigos_options']
    },
    entre: {
        intent: "Ver o comparar jugadores entre dos rangos o posiciones de pp (entre)",
        category: "osu",
        flags: ['gamemode', 'server', 'entre_players']
    },
    m: {
        intent: "Ver información, dificultad o enlace de un beatmap (m, map)",
        category: "osu",
        aliases: ['map'],
        flags: ['gamemode', 'mapset', 'beatmap']
    },
    bg: {
        intent: "Obtener o descargar el fondo o background de un beatmap (bg)",
        category: "osu",
        flags: ['beatmap']
    },
    sim: {
        intent: "Simular pp y dificultad de un beatmap con mods o precisión (sim)",
        category: "osu",
        flags: ['gamemode', 'beatmap', 'mods']
    },
    subir: {
        intent: "Calcular qué jugada o pp necesita para subir de rango o posición",
        category: "osu",
        flags: ['gamemode', 'target_user', 'target_mention']
    },
    gap: {
        intent: "Calcular diferencia de pp o posiciones con otro jugador",
        category: "osu",
        flags: ['gamemode', 'server', 'target_user', 'target_mention']
    },
    daily: {
        intent: "Consultar el desafío o reto diario de osu! (reto del día, daily)",
        category: "osu",
        flags: ['gamemode']
    },
    link: {
        intent: "Vincular o enlazar cuenta de osu! con OAuth (link, vincular)",
        category: "osu",
        flags: ['target_user']
    },
    track: {
        intent: "Rastrear o hacer seguimiento de actividad de un jugador (track)",
        category: "osu",
        flags: ['target_user', 'target_mention']
    },
    digitos: {
        intent: "Ver estadísticas por dígitos de ranking (digitos)",
        category: "osu",
        flags: ['target_user', 'target_mention']
    },
    lazer: {
        intent: "Consultar scores o ranking de osu! lazer (lazer)",
        category: "osu",
        flags: ['target_user', 'target_mention']
    },
    classic: {
        intent: "Consultar scores o modo classic de osu! (classic)",
        category: "osu",
        flags: ['target_user', 'target_mention']
    },
    droid: {
        intent: "Consultar scores o perfil de osu! droid (droid)",
        category: "osu",
        flags: ['target_user', 'target_mention']
    },
    pais: {
        intent: "Asignar autorol de país de Discord en el servidor osu! Latinoamérica (pais, autorol país)",
        category: "moderation",
        flags: []
    },
    bcv: {
        intent: "Consultar la tasa del dólar oficial BCV en Venezuela (bcv, tasa bcv, dolar bcv)",
        category: "utils",
        flags: []
    },
    binance: {
        intent: "Consultar el precio o tasa de Binance P2P USDT (binance, tasa binance)",
        category: "utils",
        flags: []
    },
    brecha: {
        intent: "Consultar la brecha cambiaria entre dólar paralelo y BCV (brecha)",
        category: "utils",
        flags: []
    },
    ping: {
        intent: "Medir la latencia o ping del bot (ping)",
        category: "utils",
        flags: []
    },
    help: {
        intent: "Ver la ayuda de comandos o lista de funciones del bot (help, ayuda)",
        category: "general",
        flags: ['help_target']
    },
    invite: {
        intent: "Obtener el enlace de invitación para añadir el bot (invite, invitar)",
        category: "general",
        flags: []
    },
    acerca: {
        intent: "Información acerca del bot, creadores o versión (acerca, about)",
        category: "about",
        flags: []
    },
    language: {
        intent: "Cambiar o consultar el idioma del bot (language, idioma)",
        category: "general",
        flags: []
    },
    roll: {
        intent: "Lanzar un dado o número aleatorio (roll, dado)",
        category: "utils",
        flags: []
    },
    github: {
        intent: "Ver el repositorio de GitHub o código fuente del bot (github)",
        category: "webhook",
        flags: []
    },
    bug: {
        intent: "Reportar un error o bug del bot (bug)",
        category: "utils",
        flags: []
    },
    sugerencia: {
        intent: "Enviar una sugerencia para el bot (sugerencia)",
        category: "utils",
        flags: []
    },
    cumple: {
        intent: "Ver, consultar o registrar cumpleaños del servidor (cumple, cumpleaños, siguiente cumpleaños)",
        category: "moderation",
        flags: ['cumple_options', 'target_mention']
    },
    fumo: {
        intent: "Ver una foto o imagen de fumo (fumo)",
        category: "meme",
        flags: []
    },
    yuri: {
        intent: "Ver una imagen de anime yuri (yuri)",
        category: "meme",
        flags: []
    },
    laburo: {
        intent: "Meme de laburo o chamba (laburo)",
        category: "meme",
        flags: []
    }
};

/**
 * Mapa bidireccional y dinámico de alias hacia nombres canónicos de comando.
 * Se inicializa con atajos frecuentes y se sincroniza automáticamente al escanear commands/chat.
 */
const ALIAS_MAP = {
    recent: 'r',
    rs: 'r',
    r: 'r',
    compare: 'c',
    comparar: 'c',
    compara: 'c',
    leaderboard: 'lb',
    tarjeta: 'card',
    perfil: 'osu',
    profile: 'osu',
    ayuda: 'help',
    invitar: 'invite',
    idioma: 'language',
    maniatop: 'top',
    taikotop: 'top',
    ctbtop: 'top',
    osutop: 'top'
};

/**
 * Escanea dinámicamente el directorio commands/chat para descubrir comandos,
 * asociar sus alias, inferir sus flags y mantener paridad automática con nuevas funciones.
 */
function scanChatCommands() {
    const chatDir = path.join(__dirname, '../commands/chat');
    if (!fs.existsSync(chatDir)) return;

    const categories = fs.readdirSync(chatDir);
    for (const cat of categories) {
        const catPath = path.join(chatDir, cat);
        if (!fs.statSync(catPath).isDirectory() || cat.startsWith('#')) continue;

        const files = fs.readdirSync(catPath);
        for (const file of files) {
            if (!file.endsWith('.js') || file === 'ai.js') continue;
            const cmdName = path.basename(file, '.js');

            try {
                const cmdModule = require(path.join(catPath, file));
                const aliases = cmdModule.run?.alias ? Object.keys(cmdModule.run.alias) : [];

                for (const alias of aliases) {
                    const cleanAlias = alias.toLowerCase();
                    if (!COMMAND_DEFINITIONS[cleanAlias]) {
                        ALIAS_MAP[cleanAlias] = cmdName;
                    }
                }

                if (COMMAND_DEFINITIONS[cmdName]) {
                    if (aliases.length > 0) {
                        COMMAND_DEFINITIONS[cmdName].aliases = [
                            ...new Set([...(COMMAND_DEFINITIONS[cmdName].aliases || []), ...aliases])
                        ];
                    }
                    if (Array.isArray(cmdModule.run?.flags) || Array.isArray(cmdModule.flags)) {
                        COMMAND_DEFINITIONS[cmdName].flags = cmdModule.run?.flags || cmdModule.flags;
                    }
                    continue;
                }

                // Descubrir nuevo comando dinámicamente
                const header = cmdModule.description?.header || cmdModule.run?.description?.header || `Comando ${cmdName}`;
                const usage = (cmdModule.description?.usage || cmdModule.run?.description?.usage || '').toLowerCase();
                
                // Detectar flags dinámicamente a partir de flags explícitos, usage y categoría
                let detectedFlags = [];
                if (Array.isArray(cmdModule.run?.flags) || Array.isArray(cmdModule.flags)) {
                    detectedFlags = cmdModule.run?.flags || cmdModule.flags;
                } else if (cat === 'osu') {
                    detectedFlags = ['gamemode', 'server', 'client_mode', 'mods', 'target_user', 'target_mention'];
                    if (usage.includes('-nochoke') || usage.includes('-nc')) detectedFlags.push('nochoke');
                    if (usage.includes('-bpm') || usage.includes('-acc') || usage.includes('-c') || usage.includes('-sr')) detectedFlags.push('sort_metric');
                    if (usage.includes('-rev')) detectedFlags.push('reverse');
                    if (usage.includes('-list')) detectedFlags.push('list');
                    if (usage.includes('-ps') || usage.includes('pasad')) detectedFlags.push('pass_only');
                    if (usage.includes('-d') || usage.includes('-detail')) detectedFlags.push('detailed');
                    if (usage.includes('-promedio')) detectedFlags.push('promedio');
                    if (usage.includes('-pais') || usage.includes('-country')) detectedFlags.push('country');
                    if (usage.includes('-regional')) detectedFlags.push('regional');
                    if (usage.includes('-friends') || usage.includes('-amigos')) detectedFlags.push('friends');
                    if (usage.includes('-pp')) detectedFlags.push('pp_threshold');
                    if (usage.includes('-sr') || usage.includes('-diff')) detectedFlags.push('star_rating_cond');
                } else {
                    if (usage.includes('@') || usage.includes('<usuario>') || usage.includes('<user_id>')) {
                        detectedFlags.push('target_mention');
                    }
                }

                COMMAND_DEFINITIONS[cmdName] = {
                    intent: `Comando ${cmdName}: ${header}`,
                    category: cat,
                    aliases: aliases,
                    flags: detectedFlags
                };
            } catch {}
        }
    }

    // Asegurar que los comandos canónicos principales apunten a sí mismos y tengan prioridad
    for (const cmd of Object.keys(COMMAND_DEFINITIONS)) {
        ALIAS_MAP[cmd.toLowerCase()] = cmd;
    }
    ALIAS_MAP['recent'] = 'r';
    ALIAS_MAP['rs'] = 'r';
    ALIAS_MAP['mappers'] = 'mapper';
}

// Inicializar escaneo dinámico de comandos al cargar el módulo
scanChatCommands();

/**
 * Genera el objeto de criterios para la pregunta 'command' de TypeSafe Jev a partir del registro.
 */
function getJevCommandCriteria() {
    const criteria = {};
    for (const [cmdName, def] of Object.entries(COMMAND_DEFINITIONS)) {
        criteria[cmdName] = def.intent;
    }
    criteria.none = "Ninguna acción de comando reconocida, charla casual, saludo o mensaje no relacionado";
    return criteria;
}

/**
 * Ejecuta dinámicamente los flags asociados a un comando según su definición en el registro.
 * @param {string} commandName - Nombre del comando canónico o alias
 * @param {object} jevAnswers - Respuestas estructuradas de Jev
 * @param {object} entities - Entidades extraídas
 * @returns {string[]} Lista ordenada de argumentos CLI
 */
function executeCommandFlags(commandName, jevAnswers, entities) {
    const canonicalName = ALIAS_MAP[commandName?.toLowerCase()] || commandName;
    const def = COMMAND_DEFINITIONS[canonicalName];
    if (!def || !Array.isArray(def.flags)) {
        return [];
    }

    const args = [];
    let prependedTarget = null;

    for (const flagKey of def.flags) {
        const handler = FLAG_HANDLERS[flagKey];
        if (!handler) continue;

        const result = handler(jevAnswers, entities);
        if (!result) continue;

        // Si es el usuario objetivo o mención, va al inicio
        if (flagKey === 'target_user' || flagKey === 'target_mention') {
            if (!prependedTarget) {
                prependedTarget = result;
            }
            continue;
        }

        if (Array.isArray(result)) {
            args.push(...result);
        } else {
            args.push(result);
        }
    }

    if (prependedTarget) {
        args.unshift(prependedTarget);
    }

    return args;
}

module.exports = {
    COMMAND_DEFINITIONS,
    FLAG_HANDLERS,
    ALIAS_MAP,
    getJevCommandCriteria,
    executeCommandFlags,
    scanChatCommands
};
