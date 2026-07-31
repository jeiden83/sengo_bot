param(
    [string]$Key = "__WORKER_KEY__",
    [string]$Country = "__WORKER_COUNTRY__",
    [string]$Server = "https://sengo-bot.onrender.com"
)

if (-not $Key -or $Key -eq "__WORKER_KEY__") {
    Write-Host "Error: Se requiere especificar la clave de trabajador (Key)." -ForegroundColor Red
    exit 1
}

if (-not $Country -or $Country -eq "__WORKER_COUNTRY__") {
    Write-Host "Error: Se requiere especificar el codigo de pais (Country)." -ForegroundColor Red
    exit 1
}

$Host.UI.RawUI.WindowTitle = "Sengo Worker - " + $Country
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host (" SENGO BOT - Worker de Poblamiento (" + $Country + ")") -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host (" Key: " + $Key) -ForegroundColor Gray
Write-Host (" Servidor: " + $Server) -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

$processed = 0
$totalSaved = 0
$startTime = Get-Date

while ($true) {
    $reqTime = (Get-Date).ToString("HH:mm:ss")
    Write-Host ("[" + $reqTime + "] Obteniendo lote de mapas desde el servidor...") -ForegroundColor Gray

    $batchUrl = $Server + "/api/worker/batch?key=" + $Key + "&country=" + $Country
    
    $batchRes = $null
    try {
        $batchRes = Invoke-RestMethod -Uri $batchUrl -Method Get -ErrorAction Stop
    } catch {
        $connErr = $_.Exception.Message
        Write-Host (" Error de conexion al obtener lote: " + $connErr + ". Reintentando en 10s...") -ForegroundColor Red
        Start-Sleep -Seconds 10
        continue
    }

    if ($batchRes.status -eq "completed") {
        Write-Host (" El pais " + $Country + " ha sido poblado al 100%! No quedan mapas pendientes.") -ForegroundColor Green
        break
    }

    if ($batchRes.status -eq "stopped") {
        Write-Host (" El poblamiento de " + $Country + " ha sido detenido por el Administrador.") -ForegroundColor Red
        break
    }

    if ($batchRes.error) {
        $errText = $batchRes.error
        Write-Host (" Error del servidor: " + $errText) -ForegroundColor Red
        break
    }

    $maps = $batchRes.maps
    $token = $batchRes.supporterToken
    if (-not $maps -or $maps.Count -eq 0) {
        Write-Host " Sin mas mapas pendientes en este momento." -ForegroundColor Green
        break
    }

    $timeStr = (Get-Date).ToString("HH:mm:ss")
    $mapsCount = $maps.Count
    Write-Host ("[" + $timeStr + "] Lote de " + $mapsCount + " mapas recibido. Raspando...") -ForegroundColor White

    $scoresToSubmit = @()

    for ($i = 0; $i -lt $maps.Count; $i++) {
        $bId = $maps[$i]
        $osuUrl = "https://osu.ppy.sh/api/v2/beatmaps/" + $bId + "/scores?mode=osu&type=country"
        
        try {
            $headers = @{
                "Authorization" = "Bearer " + $token
                "x-api-version" = "20220705"
                "User-Agent" = "osu-api-extended v3.4.7"
            }
            $osuRes = Invoke-RestMethod -Uri $osuUrl -Headers $headers -Method Get -ErrorAction Stop
            
            if ($osuRes.scores -and $osuRes.scores.Count -gt 0) {
                $top1 = $osuRes.scores[0]
                
                $modsStr = "NM"
                if ($top1.mods -and $top1.mods.Count -gt 0) {
                    $modList = @()
                    foreach ($m in $top1.mods) {
                        if ($m.acronym) { $modList += $m.acronym } else { $modList += $m }
                    }
                    if ($modList.Count -gt 0) { $modsStr = $modList -join "" }
                }

                $scorePp = 0
                if ($top1.pp) { $scorePp = $top1.pp }

                $scoreAcc = 0
                if ($top1.accuracy) { $scoreAcc = $top1.accuracy }

                $scoreEndedAt = $top1.created_at
                if ($top1.ended_at) { $scoreEndedAt = $top1.ended_at }

                $itemObj = @{
                    beatmap_id = $bId
                    user_id = $top1.user_id
                    username = $top1.user.username
                    score = $top1.total_score
                    pp = $scorePp
                    accuracy = $scoreAcc
                    mods = $modsStr
                    ended_at = $scoreEndedAt
                    max_combo = $top1.max_combo
                    perfect = ([bool]$top1.perfect)
                    rank = $top1.rank
                }
                $scoresToSubmit += [PSCustomObject]$itemObj
            }
            $processed++
            $elapsed = ((Get-Date) - $startTime).TotalSeconds
            $speed = 0
            if ($elapsed -gt 0) { $speed = [math]::Round($processed / $elapsed, 2) }
            $currIdx = $i + 1
            Write-Host (" Progress: " + $currIdx + "/" + $mapsCount + " | Total Procesados: " + $processed + " | Velocidad: " + $speed + " mapas/s") -ForegroundColor Green
        } catch {
            $errMessage = $_.Exception.Message
            Write-Host (" Error en mapa " + $bId + ": " + $errMessage) -ForegroundColor DarkYellow
        }

        Start-Sleep -Milliseconds 2500
    }

    $submitUrl = $Server + "/api/worker/submit"
    $payloadObj = @{
        key = $Key
        country = $Country
        scores = $scoresToSubmit
    }
    $bodyJson = $payloadObj | ConvertTo-Json -Depth 5
    
    try {
        $submitCount = $scoresToSubmit.Count
        Write-Host (" Enviando lote de " + $submitCount + " récords al servidor...") -ForegroundColor Gray
        $submitRes = Invoke-RestMethod -Uri $submitUrl -Method Post -Body $bodyJson -ContentType "application/json" -ErrorAction Stop
        $savedCount = $submitRes.saved
        $totalSaved += $savedCount
        Write-Host (" Lote enviado a Sengo. Records guardados: " + $savedCount + " (Total acumulado: " + $totalSaved + ")") -ForegroundColor Cyan
    } catch {
        $subErr = $_.Exception.Message
        Write-Host (" Error al enviar lote al servidor: " + $subErr) -ForegroundColor Red
    }
}
