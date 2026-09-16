# Paso 2: une Empresas + Contactos, filtra pruebas y calcula el texto a geocodificar.
# Uso: .\2-build.ps1

$Dir = Join-Path $PSScriptRoot ".cache"

$empresas = Get-Content (Join-Path $Dir "empresas.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$contactos = Get-Content (Join-Path $Dir "contactos.json") -Raw -Encoding UTF8 | ConvertFrom-Json

# Las propiedades llevan tildes; en Windows PowerShell 5.1 un .ps1 sin BOM
# puede leerlas mal, así que accedemos por POSICIÓN (orden fijo de columnas
# tal y como las exporta 1-extract.ps1), nunca por nombre literal con tilde.
function V($obj, $idx) {
    $props = @($obj.PSObject.Properties)
    return $props[$idx].Value
}

# Empresas: 0 ID Odoo, 1 Empresa, 2 Clasificacion, 3 Es prueba, 4 Estado,
# 5 Num personas, 6 Personas en la empresa, 7 Direccion completa, 8 Calle,
# 9 Calle2, 10 CP, 11 Ciudad, 12 Provincia, 13 Pais, 14 Calidad direccion,
# 15 NIF, 16 Telefono, 17 Email, 18 Web, 22 Comercial, 23 Etiquetas Odoo
# Contactos: 0 ID Odoo, 1 Contacto, 2 Cargo, 3 Empresa, 4 ID empresa,
# 5 Email, 6 Telefono, 8 Es prueba

$contactsByCompany = @{}
foreach ($c in $contactos) {
    if ((V $c 8) -eq "SI") { continue }
    $key = [string](V $c 4)
    if (-not $contactsByCompany.ContainsKey($key)) { $contactsByCompany[$key] = New-Object System.Collections.Generic.List[object] }
    $contactsByCompany[$key].Add(@{ nombre = V $c 1; cargo = V $c 2; email = V $c 5; telefono = V $c 6 })
}

$clients = New-Object System.Collections.Generic.List[object]
$geocodeQueries = New-Object System.Collections.Generic.HashSet[string]

foreach ($e in $empresas) {
    if ((V $e 3) -eq "SI") { continue }
    $clasificacion = V $e 2
    if ($clasificacion -eq "SISTEMA") { continue }

    $idOdoo = V $e 0
    $key = [string]$idOdoo
    $people = @()
    if ($contactsByCompany.ContainsKey($key)) { $people = $contactsByCompany[$key] }

    $quality = V $e 14
    $addr = V $e 7
    $city = V $e 11
    $prov = V $e 12
    $country = V $e 13

    $geocodeQuery = $null
    if ($quality -eq "VERDE" -and $addr -and ([string]$addr).Trim() -ne "") {
        $geocodeQuery = ([string]$addr).Trim()
    } elseif ($quality -and $quality -ne "VERDE" -and $quality -ne "ROJO") {
        $parts = @($city, $prov, $country) | Where-Object { $_ -and ([string]$_).Trim() -ne "" }
        if ($parts.Count -gt 0) { $geocodeQuery = ($parts -join ", ") }
    }
    if ($geocodeQuery) { [void]$geocodeQueries.Add($geocodeQuery) }

    $clients.Add([ordered]@{
        id = [int]$idOdoo; nombre = V $e 1; clasificacion = $clasificacion; estado = V $e 4
        numPersonas = V $e 5; direccion = $addr; calle = V $e 8; calle2 = V $e 9
        cp = V $e 10; ciudad = $city; provincia = $prov; pais = $country; calidad = $quality
        nif = V $e 15; telefono = V $e 16; email = V $e 17; web = V $e 18
        comercial = V $e 22; etiquetas = V $e 23; geocodeQuery = $geocodeQuery; personas = $people
    })
}

$clients | ConvertTo-Json -Depth 6 -Compress | Set-Content -Path (Join-Path $Dir "clientes.json") -Encoding UTF8
$geocodeQueries | ConvertTo-Json -Depth 2 -Compress | Set-Content -Path (Join-Path $Dir "geocode_queue.json") -Encoding UTF8

Write-Output "Clientes: $($clients.Count)  |  Direcciones distintas a geocodificar: $($geocodeQueries.Count)"
