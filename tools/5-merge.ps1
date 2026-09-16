# Paso 5: junta clientes.json + geocode_cache.json en data/data.json,
# el archivo final que carga la web app.
# Uso: .\5-merge.ps1

$Dir = Join-Path $PSScriptRoot ".cache"
$OutFile = Join-Path $PSScriptRoot "..\data\data.json"

$clients = Get-Content (Join-Path $Dir "clientes.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$cache = Get-Content (Join-Path $Dir "geocode_cache.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$cacheMap = @{}
foreach ($p in $cache.PSObject.Properties) { $cacheMap[$p.Name] = $p.Value }

function Lookup($q) {
    if ($q -and $cacheMap.ContainsKey($q)) { $e = $cacheMap[$q]; if ($e.found) { return $e } }
    return $null
}

$geocoded = 0; $viaFallback = 0
$out = New-Object System.Collections.Generic.List[object]
foreach ($c in $clients) {
    $lat = $null; $lng = $null
    $entry = Lookup $c.geocodeQuery

    if (-not $entry -and $c.calidad -eq "VERDE") {
        $cp = $c.cp; $ciudad = $c.ciudad; $prov = $c.provincia; $pais = $c.pais
        $fb1 = $null
        if ($cp -and $ciudad) { $fb1 = "$cp $ciudad, $prov, $pais" } elseif ($ciudad) { $fb1 = "$ciudad, $prov, $pais" }
        $fb2 = $null
        if ($ciudad -and $prov) { $fb2 = "$ciudad, $prov, $pais" }
        $entry = Lookup $fb1
        if (-not $entry) { $entry = Lookup $fb2 }
        if ($entry) { $viaFallback++ }
    }

    if ($entry) { $lat = $entry.lat; $lng = $entry.lon; $geocoded++ }

    $out.Add([ordered]@{
        id = $c.id; nombre = $c.nombre; clasificacion = $c.clasificacion; estado = $c.estado
        direccion = $c.direccion; cp = $c.cp; ciudad = $c.ciudad; provincia = $c.provincia
        pais = $c.pais; calidad = $c.calidad; nif = $c.nif; telefono = $c.telefono
        email = $c.email; web = $c.web; personas = $c.personas; lat = $lat; lng = $lng
    })
}

$out | ConvertTo-Json -Depth 6 -Compress | Set-Content -Path $OutFile -Encoding UTF8
Write-Output "data/data.json actualizado: $($out.Count) clientes, $geocoded con coordenadas ($viaFallback por direccion aproximada)."
