param(
  [ValidateSet("ranked_lobby", "classic_lobby", "draft_role_select", "draft_pick", "post_match")]
  [string]$Screen = "ranked_lobby",

  [ValidateSet("solo", "duo", "trio", "five_man", "unknown")]
  [string]$Queue = "unknown",

  [ValidateSet("jungle", "exp", "gold", "mid", "roam", "unknown")]
  [string]$Role = "unknown",

  [string]$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
)

$ErrorActionPreference = "Stop"

$adb = Get-Command adb -ErrorAction Stop
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$rawDir = Join-Path $ProjectRoot "data\recognition-samples\raw"
$cropDir = Join-Path $ProjectRoot "data\recognition-samples\crops\$Screen\$Queue\$Role\$stamp"
$mapPath = Join-Path $ProjectRoot "data\recognition-samples\region-map-ranked-lobby-2856x1280.json"

New-Item -ItemType Directory -Force -Path $rawDir, $cropDir | Out-Null

$rawPath = Join-Path $rawDir "$Screen-$Queue-$Role-$stamp.png"
& $adb.Source shell screencap -p /sdcard/mlbb-copilot-recognition.png
& $adb.Source pull /sdcard/mlbb-copilot-recognition.png $rawPath | Out-Null
& $adb.Source shell rm /sdcard/mlbb-copilot-recognition.png

Add-Type -AssemblyName System.Drawing
$map = Get-Content -LiteralPath $mapPath -Raw | ConvertFrom-Json
$image = [System.Drawing.Image]::FromFile($rawPath)

try {
  foreach ($property in $map.regions.PSObject.Properties) {
    $name = $property.Name
    $r = $property.Value
    $x = [Math]::Max(0, [int]([double]$r[0] * $image.Width))
    $y = [Math]::Max(0, [int]([double]$r[1] * $image.Height))
    $w = [Math]::Min($image.Width - $x, [int]([double]$r[2] * $image.Width))
    $h = [Math]::Min($image.Height - $y, [int]([double]$r[3] * $image.Height))
    if ($w -le 0 -or $h -le 0) { continue }

    $bitmap = New-Object System.Drawing.Bitmap($w, $h)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.DrawImage($image, 0, 0, (New-Object System.Drawing.Rectangle($x, $y, $w, $h)), [System.Drawing.GraphicsUnit]::Pixel)
      $bitmap.Save((Join-Path $cropDir "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }
} finally {
  $image.Dispose()
}

$manifest = [ordered]@{
  ok = $true
  screen = $Screen
  queue = $Queue
  role = $Role
  capturedAt = (Get-Date).ToString("o")
  rawPath = $rawPath
  cropDir = $cropDir
  regionMap = $mapPath
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $cropDir "manifest.json") -Encoding UTF8
$manifest
