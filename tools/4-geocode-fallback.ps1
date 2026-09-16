# Paso 4 (opcional pero recomendado): para las direcciones que no se
# encontraron con el texto completo, reintenta con "CP Ciudad, Provincia"
# y luego solo "Ciudad, Provincia". Recupera bastantes mas ubicaciones.
# Uso: .\4-geocode-fallback.ps1

$Dir = Join-Path $PSScriptRoot ".cache"
$clients = Get-Content (Join-Path $Dir "clientes.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$cachePath = Join-Path $Dir "geocode_cache.json"
$cacheRaw = Get-Content $cachePath -Raw -Encoding UTF8 | ConvertFrom-Json
$cache = @{}
foreach ($p in $cacheRaw.PSObject.Properties) { $cache[$p.Name] = $p.Value }

$headers = @{ "User-Agent" = "MapaClientesDigitalPrint/1.0 (uso interno, geocodificacion puntual)" }

function TryGeocode($q) {
    if ($cache.ContainsKey($q)) { return $cache[$q] }
    $url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=0&q=" + [System.Uri]::EscapeDataString($q)
    try {
        $resp = Invoke-RestMethod -Uri $url -Headers $headers -Method Get -TimeoutSec 15
        if ($resp -and $resp.Count -gt 0) { $result = @{ lat = [double]$resp[0].lat; lon = [double]$resp[0].lon; found = $true } }
        else { $result = @{ lat = $null; lon = $null; found = $false } }
    } catch {
        $result = @{ lat = $null; lon = $null; found = $false; error = $_.Exception.Message }
    }
    $cache[$q] = $result
    Start-Sleep -Milliseconds 1100
    return $result
}

$fixed = 0; $checked = 0; $saveCounter = 0

foreach ($c in $clients) {
    $q = $c.geocodeQuery
    if (-not $q) { continue }
    if (-not $cache.ContainsKey($q)) { continue }
    if ($cache[$q].found) { continue }
    if ($c.calidad -ne "VERDE") { continue }

    $checked++
    $cp = $c.cp; $ciudad = $c.ciudad; $prov = $c.provincia; $pais = $c.pais
    $fb1 = $null
    if ($cp -and $ciudad) { $fb1 = "$cp $ciudad, $prov, $pais" } elseif ($ciudad) { $fb1 = "$ciudad, $prov, $pais" }
    $fb2 = $null
    if ($ciudad -and $prov) { $fb2 = "$ciudad, $prov, $pais" }

    $r1 = $null
    if ($fb1) { $r1 = TryGeocode $fb1 }
    if ($r1 -and $r1.found) { $fixed++ }
    elseif ($fb2 -and $fb2 -ne $fb1) {
        $r2 = TryGeocode $fb2
        if ($r2.found) { $fixed++ }
    }

    $saveCounter++
    if ($saveCounter -ge 15) {
        $cache | ConvertTo-Json -Depth 4 -Compress | Set-Content -Path $cachePath -Encoding UTF8
        $saveCounter = 0
        Write-Output "Progreso reintento: comprobadas=$checked recuperadas=$fixed"
    }
}

$cache | ConvertTo-Json -Depth 4 -Compress | Set-Content -Path $cachePath -Encoding UTF8
Write-Output "LISTO. comprobadas=$checked recuperadas=$fixed"
