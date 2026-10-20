# Build script: inlines libraries, Korean font and app code into dist/index.html
# and writes the PWA files (manifest, service worker, icons) to dist/.
# Usage:  powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$src = Join-Path $root 'src'
$vendor = Join-Path $root 'vendor'
$dist = Join-Path $root 'dist'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Read-Text($path) { return [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8) }
function Write-Text($path, $text) { [IO.File]::WriteAllText($path, $text, $utf8) }
# Make library code safe to place inside an HTML <script> element
function Protect-Script($code) { return $code.Replace('</script', '<\/script').Replace('"<!--"', '"<\!--"') }

$version = (Read-Text (Join-Path $root 'VERSION')).Trim()
Write-Host "Building version $version"

New-Item -ItemType Directory -Force $dist | Out-Null
New-Item -ItemType Directory -Force (Join-Path $dist 'icons') | Out-Null

$html = Read-Text (Join-Path $src 'index.template.html')
$app = (Read-Text (Join-Path $src 'app.js')).Replace('__APP_VERSION__', $version)
$samples = Read-Text (Join-Path $src 'samples.js')
$style = Read-Text (Join-Path $src 'style.css')
$font = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $vendor 'NanumGothic-Regular.ttf')))

$html = $html.Replace('/*__STYLE__*/', $style)
$html = $html.Replace('/*__FONT__*/', $font)
$html = $html.Replace('/*__SAMPLES__*/', (Protect-Script $samples))
$html = $html.Replace('/*__APP__*/', (Protect-Script $app))
$html = $html.Replace('/*__VENDOR_XLSX__*/', (Protect-Script (Read-Text (Join-Path $vendor 'xlsx.full.min.js'))))
$html = $html.Replace('/*__VENDOR_JSPDF__*/', (Protect-Script (Read-Text (Join-Path $vendor 'jspdf.umd.min.js'))))
$html = $html.Replace('/*__VENDOR_JSZIP__*/', (Protect-Script (Read-Text (Join-Path $vendor 'jszip.min.js'))))
Write-Text (Join-Path $dist 'index.html') $html

Write-Text (Join-Path $dist 'sw.js') ((Read-Text (Join-Path $src 'sw.js')).Replace('__APP_VERSION__', $version))
Write-Text (Join-Path $dist 'manifest.webmanifest') (Read-Text (Join-Path $src 'manifest.webmanifest'))

# Icons (drawn with System.Drawing; regenerated every build)
Add-Type -AssemblyName System.Drawing
function New-Icon($size, $maskable, $path) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.TextRenderingHint = 'AntiAliasGridFit'
    $blue = [System.Drawing.Color]::FromArgb(29, 78, 216)
    $brush = New-Object System.Drawing.SolidBrush($blue)
    if ($maskable) {
        $g.FillRectangle($brush, 0, 0, $size, $size)
    } else {
        $g.Clear([System.Drawing.Color]::Transparent)
        $r = [int]($size * 0.22)
        $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
        $gp.AddArc(0, 0, $r, $r, 180, 90)
        $gp.AddArc($size - $r - 1, 0, $r, $r, 270, 90)
        $gp.AddArc($size - $r - 1, $size - $r - 1, $r, $r, 0, 90)
        $gp.AddArc(0, $size - $r - 1, $r, $r, 90, 90)
        $gp.CloseFigure()
        $g.FillPath($brush, $gp)
    }
    $scale = 0.62
    if ($maskable) { $scale = 0.46 }
    $font = New-Object System.Drawing.Font('Malgun Gothic', [float]($size * $scale), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = 'Center'
    $sf.LineAlignment = 'Center'
    $rect = New-Object System.Drawing.RectangleF(0, [float]($size * 0.03), $size, $size)
    $g.DrawString([string][char]0x20A9, $font, [System.Drawing.Brushes]::White, $rect, $sf)
    $g.Dispose()
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}
New-Icon 192 $false (Join-Path $dist 'icons\icon-192.png')
New-Icon 512 $false (Join-Path $dist 'icons\icon-512.png')
New-Icon 512 $true (Join-Path $dist 'icons\maskable-512.png')

$size = [math]::Round((Get-Item (Join-Path $dist 'index.html')).Length / 1MB, 2)
Write-Host "Done: dist\index.html ($size MB), sw.js, manifest.webmanifest, icons\"
