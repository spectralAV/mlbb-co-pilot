param(
  [ValidateSet("ranked_lobby", "classic_lobby", "ranked_choose_lane", "draft_role_select", "draft_pick", "post_match")]
  [string]$Screen = "ranked_lobby",

  [ValidateSet("solo", "duo", "trio", "five_man", "unknown")]
  [string]$Queue = "unknown",

  [ValidateSet("jungle", "exp", "gold", "mid", "roam", "flex", "unknown")]
  [string]$Role = "unknown",

  [ValidateSet("swap", "fill", "role_jungle", "role_exp", "role_gold", "role_mid", "role_roam", "role_flex", "unknown")]
  [string]$IconState = "unknown",

  [string]$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
)

$ErrorActionPreference = "Stop"

$adb = Get-Command adb -ErrorAction Stop
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$rawDir = Join-Path $ProjectRoot "data\recognition-samples\raw"
$cropDir = Join-Path $ProjectRoot "data\recognition-samples\crops\$Screen\$Queue\$Role\$stamp"
$mapFile = switch ($Screen) {
  "ranked_choose_lane" { "region-map-ranked-choose-lane-2856x1280.json" }
  default { "region-map-ranked-lobby-2856x1280.json" }
}
$mapPath = Join-Path $ProjectRoot "data\recognition-samples\$mapFile"

New-Item -ItemType Directory -Force -Path $rawDir, $cropDir | Out-Null

$rawPath = Join-Path $rawDir "$Screen-$Queue-$Role-$IconState-$stamp.png"
& $adb.Source shell screencap -p /sdcard/mlbb-copilot-recognition.png
& $adb.Source pull /sdcard/mlbb-copilot-recognition.png $rawPath | Out-Null
& $adb.Source shell rm /sdcard/mlbb-copilot-recognition.png

Add-Type -AssemblyName System.Drawing
$map = Get-Content -LiteralPath $mapPath -Raw | ConvertFrom-Json
$image = [System.Drawing.Image]::FromFile($rawPath)

function Save-Crop {
  param(
    [System.Drawing.Image]$Image,
    [object]$Region,
    [string]$Path
  )

  $x = [Math]::Max(0, [int]([double]$Region[0] * $Image.Width))
  $y = [Math]::Max(0, [int]([double]$Region[1] * $Image.Height))
  $w = [Math]::Min($Image.Width - $x, [int]([double]$Region[2] * $Image.Width))
  $h = [Math]::Min($Image.Height - $y, [int]([double]$Region[3] * $Image.Height))
  if ($w -le 0 -or $h -le 0) { return }

  $bitmap = New-Object System.Drawing.Bitmap($w, $h)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.DrawImage($Image, 0, 0, (New-Object System.Drawing.Rectangle($x, $y, $w, $h)), [System.Drawing.GraphicsUnit]::Pixel)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

try {
  foreach ($property in $map.regions.PSObject.Properties) {
    $name = $property.Name
    $r = $property.Value
    Save-Crop -Image $image -Region $r -Path (Join-Path $cropDir "$name.png")
  }

  if ($map.PSObject.Properties.Name -contains "regionGroups") {
    foreach ($groupProperty in $map.regionGroups.PSObject.Properties) {
      $groupName = $groupProperty.Name
      $index = 0
      foreach ($region in $groupProperty.Value) {
        Save-Crop -Image $image -Region $region -Path (Join-Path $cropDir ("{0}_{1:D2}.png" -f $groupName, $index))
        $index++
      }
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
  iconState = $IconState
  capturedAt = (Get-Date).ToString("o")
  rawPath = $rawPath
  cropDir = $cropDir
  regionMap = $mapPath
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $cropDir "manifest.json") -Encoding UTF8
$manifest
