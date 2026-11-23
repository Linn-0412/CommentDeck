# アイコンの元画像(1024px)を作り、tauri icon で各サイズを生成する
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/make-icon.ps1
# デザイン: オレンジ → 琥珀のグラデーション角丸に、白いコメントの吹き出し 2 つ
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$src = Join-Path $PSScriptRoot 'icon-source.png'
$s = 1024

function New-RoundedRect([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

$bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)

$m = $s * 0.03
$bg = New-RoundedRect $m $m ($s - 2 * $m) ($s - 2 * $m) ($s * 0.22)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.PointF(0, 0)), (New-Object System.Drawing.PointF($s, $s)),
    [System.Drawing.Color]::FromArgb(255, 255, 122, 69), [System.Drawing.Color]::FromArgb(255, 255, 183, 3))
$g.FillPath($brush, $bg)

$white = [System.Drawing.Brushes]::White
function Bubble([single]$x, [single]$y, [single]$w, [single]$h, [bool]$tailLeft) {
    $p = New-RoundedRect $x $y $w $h ($h * 0.32)
    $g.FillPath($white, $p)
    # しっぽ
    $tx = if ($tailLeft) { $x + $w * 0.16 } else { $x + $w * 0.84 }
    $dir = if ($tailLeft) { -1 } else { 1 }
    $tail = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF(($tx - $w * 0.07), ($y + $h - 2))),
        (New-Object System.Drawing.PointF(($tx + $w * 0.07), ($y + $h - 2))),
        (New-Object System.Drawing.PointF(($tx + $dir * $w * 0.10), ($y + $h + $h * 0.30))))
    $g.FillPolygon($white, $tail)
    $p.Dispose()
}
function Line([single]$x, [single]$y, [single]$w, [single]$h, $color) {
    $b = New-Object System.Drawing.SolidBrush($color)
    $p = New-RoundedRect $x $y $w $h ($h / 2)
    $g.FillPath($b, $p)
    $b.Dispose(); $p.Dispose()
}

# 上の吹き出し(左しっぽ)と下の吹き出し(右しっぽ)
Bubble ($s * 0.15) ($s * 0.20) ($s * 0.58) ($s * 0.25) $true
Line ($s * 0.22) ($s * 0.285) ($s * 0.40) ($s * 0.07) ([System.Drawing.Color]::FromArgb(255, 255, 122, 69))
Bubble ($s * 0.27) ($s * 0.53) ($s * 0.58) ($s * 0.25) $false
Line ($s * 0.34) ($s * 0.615) ($s * 0.30) ($s * 0.07) ([System.Drawing.Color]::FromArgb(255, 255, 160, 40))

$g.Dispose(); $brush.Dispose(); $bg.Dispose()
$bmp.Save($src, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"wrote $src"

Push-Location $root
npx tauri icon $src -o src-tauri/icons
Pop-Location
