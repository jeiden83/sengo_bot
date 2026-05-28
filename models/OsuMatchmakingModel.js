const fetch = require("node-fetch");

let cachedPoolId = null;
let cachedPoolIdTimestamp = 0;

/**
 * Obtiene el ID del pool activo de Ranked Play dinámicamente mediante redirección.
 */
async function getActivePoolId() {
    const now = Date.now();
    if (cachedPoolId && (now - cachedPoolIdTimestamp) < 3600000) { // 1 hora de cache
        return cachedPoolId;
    }
    try {
        const res = await fetch("https://osu.ppy.sh/rankings/ranked-play/osu", {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
            }
        });
        const match = res.url.match(/\/ranked-play\/[a-z]+\/(\d+)/);
        if (match) {
            cachedPoolId = parseInt(match[1], 10);
            cachedPoolIdTimestamp = now;
            return cachedPoolId;
        }
    } catch (e) {
        console.error("[MODEL] Error al obtener el ID del pool activo, usando default 38:", e);
    }
    return cachedPoolId || 38;
}

/**
 * Parsea la página de clasificación de Ranked Play de la web de osu!.
 */
function parseRankedPlayLeaderboard(html) {
    const players = [];
    const blocks = html.split('class="ranking-page-grid-item"');
    
    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        
        const rankMatch = block.match(/ranking-page-grid-item__col[^>]*>\s*#(\d+)\s*<\/div>/);
        const rank = rankMatch ? parseInt(rankMatch[1], 10) : null;
        
        const countryMatch = block.match(/country=([A-Z]{2})/);
        const countryCode = countryMatch ? countryMatch[1] : null;
        
        const userMatch = block.match(/data-user-id="(\d+)"\s+href="https:\/\/osu\.ppy\.sh\/users\/\d+\/osu"\s*>\s*<span[^>]*>\s*([^<]+)\s*<\/span>/);
        let userId = null;
        let username = null;
        if (userMatch) {
            userId = userMatch[1];
            username = userMatch[2].trim();
        } else {
            const userMatch2 = block.match(/href="https:\/\/osu\.ppy\.sh\/users\/(\d+)\/osu"\s*>\s*<span[^>]*>\s*([^<]+)\s*<\/span>/);
            if (userMatch2) {
                userId = userMatch2[1];
                username = userMatch2[2].trim();
            }
        }
        
        const numberCols = [...block.matchAll(/ranking-page-grid-item__col--number[^>]*>\s*([0-9,]+)\s*<\/div>/g)];
        const wins = numberCols[0] ? parseInt(numberCols[0][1].replace(/,/g, ''), 10) : 0;
        const plays = numberCols[1] ? parseInt(numberCols[1][1].replace(/,/g, ''), 10) : 0;
        
        const ratingMatch = block.match(/ranking-page-grid-item__col--number-focus[^>]*>[\s\S]*?<span[^>]*>\s*([0-9,]+)(\*?)\s*<\/span>/);
        let rating = 0;
        let isProvisional = false;
        if (ratingMatch) {
            rating = parseInt(ratingMatch[1].replace(/,/g, ''), 10);
            isProvisional = ratingMatch[2] === '*';
        }
        
        if (userId && username) {
            players.push({
                rank,
                countryCode,
                userId,
                username,
                wins,
                plays,
                rating,
                isProvisional
            });
        }
    }
    return players;
}

/**
 * Obtiene el total de páginas de osu! desde el HTML.
 */
function parseMaxOsuPages(html) {
    const pageMatches = [...html.matchAll(/page=(\d+)/g)];
    const pages = pageMatches.map(m => parseInt(m[1], 10));
    return pages.length > 0 ? Math.max(...pages) : 1;
}

/**
 * Obtiene los jugadores y el máximo de páginas de la tabla de clasificación.
 */
async function fetchRankedPlayLeaderboard(page = 1) {
    const poolId = await getActivePoolId();
    const url = `https://osu.ppy.sh/rankings/ranked-play/osu/${poolId}?page=${page}`;
    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        }
    });
    if (!res.ok) {
        throw new Error(`Error en respuesta de osu! al obtener leaderboard: ${res.statusText}`);
    }
    const html = await res.text();
    const players = parseRankedPlayLeaderboard(html);
    const maxPages = parseMaxOsuPages(html);
    return { players, maxPages };
}

module.exports = {
    getActivePoolId,
    parseRankedPlayLeaderboard,
    parseMaxOsuPages,
    fetchRankedPlayLeaderboard
};
