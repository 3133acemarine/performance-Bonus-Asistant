# Minimal static web server for local use (no install required).
# Serves the dist folder at http://localhost:8080/ . Service workers (PWA install,
# offline) work on localhost without HTTPS. Press Ctrl+C to stop.
# Usage:  powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8080] [-NoBrowser]
param(
    [int]$Port = 8080,
    [string]$Root = (Join-Path $PSScriptRoot 'dist'),
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
if (-not (Test-Path (Join-Path $rootFull 'index.html'))) {
    Write-Host "dist\index.html not found. Run build.ps1 first." -ForegroundColor Red
    exit 1
}
$mime = @{
    '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
    '.webmanifest' = 'application/manifest+json; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
    '.png' = 'image/png'; '.ico' = 'image/x-icon'; '.svg' = 'image/svg+xml'; '.txt' = 'text/plain; charset=utf-8'
}
$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)
try { $listener.Start() } catch {
    Write-Host "Cannot listen on port $Port (already in use?). Try: serve.ps1 -Port 8081" -ForegroundColor Red
    exit 1
}
Write-Host ""
Write-Host "  Serving $rootFull" -ForegroundColor Green
Write-Host "  Open    $prefix   (Chrome / Edge)" -ForegroundColor Green
Write-Host "  Stop    Ctrl+C (or close this window)"
Write-Host ""
if (-not $NoBrowser) { Start-Process $prefix }
try {
    while ($listener.IsListening) {
        $task = $listener.GetContextAsync()
        while (-not $task.AsyncWaitHandle.WaitOne(300)) { }
        $ctx = $task.GetAwaiter().GetResult()
        $req = $ctx.Request; $res = $ctx.Response
        try {
            $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
            if ($path.EndsWith('/')) { $path += 'index.html' }
            $full = [IO.Path]::GetFullPath((Join-Path $rootFull $path.TrimStart('/')))
            if (-not $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $full -PathType Leaf)) {
                $res.StatusCode = 404
                $bytes = [Text.Encoding]::UTF8.GetBytes('Not Found')
            } else {
                $ext = [IO.Path]::GetExtension($full).ToLower()
                $ct = $mime[$ext]; if (-not $ct) { $ct = 'application/octet-stream' }
                $res.ContentType = $ct
                $bytes = [IO.File]::ReadAllBytes($full)
            }
            # Always revalidate so a replaced file (new version) is picked up
            $res.Headers['Cache-Control'] = 'no-cache'
            $res.Headers['X-Content-Type-Options'] = 'nosniff'
            $res.ContentLength64 = $bytes.Length
            if ($req.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
            Write-Host ("{0} {1} {2}" -f (Get-Date -Format 'HH:mm:ss'), $res.StatusCode, $req.Url.AbsolutePath)
        } catch {
            Write-Host "Error: $_" -ForegroundColor Yellow
        } finally {
            try { $res.Close() } catch { }
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
