# Paso 1: exporta las hojas "Empresas" y "Contactos" del Excel a JSON.
# Uso: .\1-extract.ps1 -XlsxPath "C:\ruta\a\tu_excel.xlsx"

param(
    [Parameter(Mandatory = $true)][string]$XlsxPath
)

$cacheDir = Join-Path $PSScriptRoot ".cache"
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open((Resolve-Path $XlsxPath).Path, [Type]::Missing, $true)

function Export-SheetToJson($sheetName, $outFile) {
    $ws = $wb.Worksheets.Item($sheetName)
    $used = $ws.UsedRange
    $arr = $used.Value2
    $rows = $arr.GetLength(0)
    $cols = $arr.GetLength(1)

    $headers = @()
    for ($c = 1; $c -le $cols; $c++) {
        $h = $arr[1, $c]
        if ($null -eq $h) { $h = "col$c" }
        $headers += [string]$h
    }

    $records = New-Object System.Collections.Generic.List[object]
    for ($r = 2; $r -le $rows; $r++) {
        $obj = [ordered]@{}
        for ($c = 1; $c -le $cols; $c++) {
            $v = $arr[$r, $c]
            if ($null -eq $v) { $obj[$headers[$c-1]] = "" }
            elseif ($v -is [double]) { $obj[$headers[$c-1]] = $v }
            else { $obj[$headers[$c-1]] = [string]$v }
        }
        $records.Add($obj)
    }

    $records | ConvertTo-Json -Depth 5 -Compress | Set-Content -Path $outFile -Encoding UTF8
    Write-Output "Exported $sheetName -> $outFile ($($records.Count) filas, $cols columnas)"
}

Export-SheetToJson "Empresas" (Join-Path $cacheDir "empresas.json")
Export-SheetToJson "Contactos" (Join-Path $cacheDir "contactos.json")

$wb.Close($false)
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
[GC]::Collect()
