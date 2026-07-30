const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const crypto = require('crypto');
const { getSupabaseClient } = require('../db/database.js');
const OsuUserModel = require('../models/OsuUserModel.js');
const TursoDB = require('../db/turso.js');

// Sesiones activas y llaves de trabajadores en memoria
const activeSessions = new Map(); // countryCode -> { countryCode, isStopped: false, activeWorkers: Set }
const activeWorkerKeys = new Map(); // workerKey -> { discordId, username, countryCode, createdAt }

class PopulationService {
    /**
     * Genera o recupera una Worker Key para un colaborador y país
     */
    static async createWorkerSession(discordId, username, countryCode) {
        const country = countryCode.toUpperCase();
        
        // Verificar si el país está 100% completado en Supabase
        const isScraped = await OsuUserModel.isCountryScraped(country);
        if (isScraped) {
            return { error: 'COMPLETED', message: `El país **${country}** ya ha sido poblado al 100%.` };
        }

        // Verificar si hay token Supporter disponible para ese país
        const supporterData = await OsuUserModel.getSupporterTokenForCountry(country);
        if (!supporterData || !supporterData.token) {
            return { error: 'NO_SUPPORTER', message: `No hay ningún usuario **Supporter** de ${country} registrado en el pool del bot.` };
        }

        // Crear clave única
        const key = `sengo_wk_${crypto.randomBytes(4).toString('hex')}`;
        activeWorkerKeys.set(key, {
            discordId,
            username,
            countryCode: country,
            createdAt: Date.now()
        });

        if (!activeSessions.has(country)) {
            activeSessions.set(country, {
                countryCode: country,
                isStopped: false,
                activeWorkers: new Set()
            });
        }
        
        const session = activeSessions.get(country);
        session.isStopped = false; // Resetear stop si inicia nueva sesión
        session.activeWorkers.add(username);

        return {
            key,
            countryCode: country,
            supporterUser: supporterData.username
        };
    }

    /**
     * Entrega el siguiente lote de 100 beatmaps no poblados para el país
     */
    static async getNextBatch(key, countryCode) {
        const country = countryCode ? countryCode.toUpperCase() : 'MX';
        const session = activeSessions.get(country);

        if (session && session.isStopped) {
            return { status: 'stopped', message: 'Poblamiento detenido por el administrador.' };
        }

        const isScraped = await OsuUserModel.isCountryScraped(country);
        if (isScraped) {
            return { status: 'completed', message: 'País completado al 100%.' };
        }

        // Obtener Token Supporter activo del pool
        const supporterData = await OsuUserModel.getSupporterTokenForCountry(country);
        if (!supporterData || !supporterData.token) {
            return { error: 'Sin supporter token disponible para este país.' };
        }

        const supabase = getSupabaseClient();
        if (!supabase) {
            return { error: 'Error de conexión con la base de datos.' };
        }

        // Buscar beatmaps que aún no tienen top_scores registrados para este país en Turso
        // Primero tomamos una muestra de beatmap_ids de ranked_beatmaps
        const { data: maps } = await supabase
            .from('ranked_beatmaps')
            .select('beatmap_id')
            .gt('beatmap_id', 0)
            .order('beatmap_id', { ascending: false })
            .limit(300);

        if (!maps || maps.length === 0) {
            return { status: 'completed', maps: [] };
        }

        // Consultar cuáles de estos 300 mapas ya están en Turso para el país
        const pendingMapIds = [];
        for (const m of maps) {
            try {
                const existing = await TursoDB.getTopScoreForBeatmap(m.beatmap_id, country);
                if (!existing) {
                    pendingMapIds.push(m.beatmap_id);
                }
            } catch (e) {
                pendingMapIds.push(m.beatmap_id);
            }
            if (pendingMapIds.length >= 100) break;
        }

        if (pendingMapIds.length === 0) {
            // Si en esta muestra no hay pendientes, marcar país como completado
            await OsuUserModel.setCountryScraped(country, true);
            return { status: 'completed', maps: [] };
        }

        return {
            status: 'ok',
            supporterToken: supporterData.token,
            maps: pendingMapIds
        };
    }

    /**
     * Recibe e inserta los récords #1 raspados en la base de datos Turso 'sengo-db'
     */
    static async submitBatch(key, countryCode, scores) {
        const country = countryCode ? countryCode.toUpperCase() : 'MX';
        if (!Array.isArray(scores)) {
            return { saved: 0 };
        }

        let savedCount = 0;
        for (const s of scores) {
            try {
                await TursoDB.saveTopScore({
                    beatmap_id: s.beatmap_id,
                    country_code: country,
                    user_id: s.user_id,
                    username: s.username,
                    score: s.score || 0,
                    pp: s.pp || 0,
                    accuracy: s.accuracy || 0,
                    mods: s.mods || 'NM',
                    ended_at: s.ended_at || new Date().toISOString(),
                    max_combo: s.max_combo || 0,
                    perfect: s.perfect || false,
                    rank: s.rank || ''
                });
                savedCount++;
            } catch (e) {
                console.error(`Error guardando mapa ${s.beatmap_id} en Turso:`, e.message);
            }
        }

        return { saved: savedCount };
    }

    /**
     * Detiene inmediatamente el poblamiento de un país (Kill Switch de Owner)
     */
    static stopCountry(countryCode) {
        const country = countryCode.toUpperCase();
        if (!activeSessions.has(country)) {
            activeSessions.set(country, { countryCode: country, isStopped: true, activeWorkers: new Set() });
        } else {
            const session = activeSessions.get(country);
            session.isStopped = true;
            session.activeWorkers.clear();
        }

        // Invalidar Worker Keys de este país
        for (const [k, v] of activeWorkerKeys.entries()) {
            if (v.countryCode === country) {
                activeWorkerKeys.delete(k);
            }
        }

        return true;
    }

    /**
     * Genera la lista completa de estados de países (Poblado, En Proceso, Disponible, Sin Supporter)
     */
    static async getCountryStatusList() {
        const supabase = getSupabaseClient();
        if (!supabase) return [];

        // 1. Obtener todos los tokens Supporters en Supabase
        const { data: supporters } = await supabase
            .from('oauth_tokens')
            .select('country_code, username')
            .eq('is_supporter', true);

        const supporterMap = new Map();
        if (supporters) {
            for (const s of supporters) {
                if (s.country_code) {
                    supporterMap.set(s.country_code.toUpperCase(), s.username);
                }
            }
        }

        // 2. Obtener países marcados como completados
        const { data: scraped } = await supabase
            .from('scraped_countries')
            .select('country_code, is_scraped');

        const scrapedMap = new Map();
        if (scraped) {
            for (const sc of scraped) {
                scrapedMap.set(sc.country_code.toUpperCase(), sc.is_scraped);
            }
        }

        // Países principales soportados por Sengo
        const defaultCountries = ['MX', 'VE', 'AR', 'CO', 'CL', 'EC', 'PE', 'PR', 'BO', 'CA', 'DO', 'BR', 'ES'];
        const list = [];

        for (const code of defaultCountries) {
            const isScraped = scrapedMap.get(code) || false;
            const hasSupporter = supporterMap.has(code);
            const supporterUser = supporterMap.get(code) || null;
            const session = activeSessions.get(code);
            const isProcessing = session && !session.isStopped && session.activeWorkers.size > 0;

            let status = 'NO_SUPPORTER';
            if (isScraped) {
                status = 'COMPLETED';
            } else if (isProcessing) {
                status = 'PROCESSING';
            } else if (hasSupporter) {
                status = 'AVAILABLE';
            }

            list.push({
                code,
                status,
                hasSupporter,
                supporterUser,
                workersCount: session ? session.activeWorkers.size : 0
            });
        }

        return list;
    }

    /**
     * Retorna el script de PowerShell en texto plano
     */
    static getPowerShellScript() {
        return `param(
    [Parameter(Mandatory=$true)][string]$Key,
    [Parameter(Mandatory=$true)][string]$Country,
    [string]$Server = "https://sengo-bot.onrender.com"
)

$Host.UI.RawUI.WindowTitle = "Sengo Worker - $Country"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 🎮 SENGO BOT - Worker de Poblamiento ($Country)" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 🔑 Key: $Key" -ForegroundColor Gray
Write-Host " 🌐 Servidor: $Server" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

$processed = 0
$totalSaved = 0
$startTime = Get-Date

while ($true) {
    try {
        $batchUrl = "$Server/api/worker/batch?key=$Key&country=$Country"
        $batchRes = Invoke-RestMethod -Uri $batchUrl -Method Get -ErrorAction Stop

        if ($batchRes.status -eq "completed") {
            Write-Host "🎉 ¡El país $Country ha sido poblado al 100%! No quedan mapas pendientes." -ForegroundColor Green
            break
        }

        if ($batchRes.status -eq "stopped") {
            Write-Host "🛑 El poblamiento de $Country ha sido detenido por el Administrador." -ForegroundColor Red
            break
        }

        if ($batchRes.error) {
            Write-Host "❌ Error del servidor: $($batchRes.error)" -ForegroundColor Red
            break
        }

        $maps = $batchRes.maps
        $token = $batchRes.supporterToken
        if (-not $maps -or $maps.Count -eq 0) {
            Write-Host "✅ Sin más mapas pendientes en este momento." -ForegroundColor Green
            break
        }

        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 📥 Lote de $($maps.Count) mapas recibido. Raspando..." -ForegroundColor White

        $scoresToSubmit = @()

        for ($i = 0; $i -lt $maps.Count; $i++) {
            $bId = $maps[$i]
            $osuUrl = "https://osu.ppy.sh/api/v2/beatmaps/$bId/scores?mode=osu&type=country"
            
            try {
                $headers = @{
                    "Authorization" = "Bearer $token"
                    "x-api-version" = "20220705"
                    "User-Agent" = "osu-api-extended v3.4.7"
                }
                $osuRes = Invoke-RestMethod -Uri $osuUrl -Headers $headers -Method Get -ErrorAction Stop
                
                if ($osuRes.scores -and $osuRes.scores.Count -gt 0) {
                    $top1 = $osuRes.scores[0]
                    $scoresToSubmit += @{
                        beatmap_id = $bId
                        user_id = $top1.user_id
                        username = $top1.user.username
                        score = $top1.total_score
                        pp = if ($top1.pp) { $top1.pp } else { 0 }
                        accuracy = if ($top1.accuracy) { $top1.accuracy } else { 0 }
                        mods = if ($top1.mods) { ($top1.mods | ForEach-Object { if ($_.acronym) { $_.acronym } else { $_ } }) -join "" } else { "NM" }
                        ended_at = if ($top1.ended_at) { $top1.ended_at } else { $top1.created_at }
                        max_combo = $top1.max_combo
                        perfect = [bool]$top1.perfect
                        rank = $top1.rank
                    }
                }
                $processed++
                $elapsed = ((Get-Date) - $startTime).TotalSeconds
                $speed = if ($elapsed -gt 0) { [math]::Round($processed / $elapsed, 2) } else { 0 }
                Write-Host " Progress: $($i+1)/$($maps.Count) | Total Procesados: $processed | Velocidad: $speed mapas/s" -ForegroundColor Green
            } catch {
                Write-Host " ⚠️ Error en mapa $bId: $($_.Exception.Message)" -ForegroundColor DarkYellow
            }

            Start-Sleep -Milliseconds 1800
        }

        $submitUrl = "$Server/api/worker/submit"
        $bodyJson = @{ key = $Key; country = $Country; scores = $scoresToSubmit } | ConvertTo-Json -Depth 5
        $submitRes = Invoke-RestMethod -Uri $submitUrl -Method Post -Body $bodyJson -ContentType "application/json" -ErrorAction Stop

        $totalSaved += $submitRes.saved
        Write-Host " 💾 Lote enviado a Sengo. Récords guardados: $($submitRes.saved) (Total acumulado: $totalSaved)" -ForegroundColor Cyan

    } catch {
        Write-Host " ❌ Error de conexión: $($_.Exception.Message). Reintentando en 10s..." -ForegroundColor Red
        Start-Sleep -Seconds 10
    }
}
`;
    }
}

module.exports = PopulationService;
