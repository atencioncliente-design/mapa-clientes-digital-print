# Paso 3: geocodifica las direcciones nuevas contra OpenStreetMap (Nominatim).
# Respeta el limite de 1 peticion/segundo del servicio gratuito, por eso tarda.
# Se puede parar y volver a lanzar: recuerda lo ya hecho en geocode_cache.json.
# Uso: .\3-geocode.ps1

$Dir = Join-Path $PSScriptRoot ".cache"
$queuePath = Join-Path $Dir "geocode_queue.json"
$cachePath = Join-Path $Dir "geocode_cache.json"

$queries = Get-Content $queuePath -Raw -Encoding UTF8 | ConvertFrom-Json
$cache = @{}
if (Test-Path $cachePath) {
    $existing = Get-Content $cachePath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($p in $existing.PSObject.Properties) { $cache[$p.Name] = $p.Value }
}

$headers = @{ "User-Agent" = "MapaClientesDigitalPrint/1.0 (uso interno, geocodificacion puntual)" }
$processedSinceSave = 0
$total = $queries.Count
$doneCount = 0

foreach ($q in $queries) {
    $doneCount++
    if ($cache.ContainsKey($q)) { continue }

    $url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=0&q=" + [System.Uri]::EscapeDataString($q)
    try {
        $resp = Invoke-RestMethod -Uri $url -Headers $headers -Method Get -TimeoutSec 15
        if ($resp -and $resp.Count -gt 0) { $cache[$q] = @{ lat = [double]$resp[0].lat; lon = [double]$resp[0].lon; found = $true } }
        else { $cache[$q] = @{ lat = $null; lon = $null; found = $false } }
    } catch {
        $cache[$q] = @{ lat = $null; lon = $null; found = $false; error = $_.Exception.Message }
    }

    $processedSinceSave++
    if ($processedSinceSave -ge 20) {
        $cache | ConvertTo-Json -Depth 4 -Compress | Set-Content -Path $cachePath -Encoding UTF8
        $processedSinceSave = 0
        Write-Output "Progreso: $doneCount / $total"
    }
    Start-Sleep -Milliseconds 1100
}

$cache | ConvertTo-Json -Depth 4 -Compress | Set-Content -Path $cachePath -Encoding UTF8
Write-Output "LISTO. En cache: $($cache.Count) / $total"
