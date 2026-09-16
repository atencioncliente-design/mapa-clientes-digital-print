# Sirve la carpeta del proyecto en http://localhost:8843 para poder probar
# el mapa en local (abrir index.html con doble clic NO funciona: el
# navegador bloquea la carga de data.json por seguridad al usar file://).
# Uso: doble clic en "Ver-Mapa-Local.bat" (está un nivel arriba, en la carpeta del proyecto).

$Root = Split-Path -Parent $PSScriptRoot
$Port = 8843

Add-Type -AssemblyName System.Net.HttpListener -ErrorAction SilentlyContinue

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try {
    $listener.Start()
} catch {
    Write-Output "No se pudo abrir el puerto $Port (¿ya hay un servidor local abierto? Cierra esta ventana y prueba otra vez, o abre http://localhost:$Port en el navegador si ya estaba corriendo)."
    Start-Sleep -Seconds 5
    exit
}

Write-Output "Sirviendo '$Root' en http://localhost:$Port/"
Write-Output "Deja esta ventana abierta mientras pruebas el mapa. Ciérrala cuando termines."
Start-Process "http://localhost:$Port/"

$mime = @{
    ".html" = "text/html; charset=utf-8"; ".js" = "application/javascript; charset=utf-8"
    ".css" = "text/css; charset=utf-8"; ".json" = "application/json; charset=utf-8"
    ".png" = "image/png"; ".jpg" = "image/jpeg"; ".svg" = "image/svg+xml"
    ".webmanifest" = "application/manifest+json"; ".ico" = "image/x-icon"
}

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
        $path = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
        if ($path -eq "/") { $path = "/index.html" }
        $fsPath = [System.IO.Path]::GetFullPath((Join-Path $Root ($path.TrimStart("/"))))
        if (-not $fsPath.StartsWith([System.IO.Path]::GetFullPath($Root))) { $res.StatusCode = 403; $res.Close(); continue }
        if (Test-Path $fsPath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($fsPath).ToLower()
            $ct = $mime[$ext]; if (-not $ct) { $ct = "application/octet-stream" }
            $res.ContentType = $ct
            $bytes = [System.IO.File]::ReadAllBytes($fsPath)
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $res.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
            $res.OutputStream.Write($msg, 0, $msg.Length)
        }
    } catch {
        try { $res.StatusCode = 500 } catch {}
    } finally {
        $res.Close()
    }
}
