param(
  [string]$ProjectRoot = "",
  [string]$OutputPath = "",
  [int]$Size = 32,
  [switch]$BigOnly,
  [string]$ConfirmedSamplesAfter = "20260521-185000"
)

$ErrorActionPreference = "Stop"

if (-not $ProjectRoot) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

if (-not $OutputPath) {
  $OutputPath = Join-Path $ProjectRoot "data\recognition-samples\lane-icon-vector-templates.json"
}

$roles = @("exp", "jungle", "mid", "roam", "gold")
$samplesRoot = Join-Path $ProjectRoot "data\recognition-samples\crops"

Add-Type -AssemblyName System.Drawing

function Convert-ToLaneIconVector {
  param(
    [string]$Path,
    [int]$Size = 32
  )

  $source = [System.Drawing.Image]::FromFile($Path)
  $sourceBitmap = New-Object System.Drawing.Bitmap($source)
  $minX = $sourceBitmap.Width
  $minY = $sourceBitmap.Height
  $maxX = -1
  $maxY = -1
  $scanMarginX = [Math]::Max(1, [int]($sourceBitmap.Width * 0.16))
  $scanMarginY = [Math]::Max(1, [int]($sourceBitmap.Height * 0.16))

  try {
    for ($sy = $scanMarginY; $sy -lt ($sourceBitmap.Height - $scanMarginY); $sy++) {
      for ($sx = $scanMarginX; $sx -lt ($sourceBitmap.Width - $scanMarginX); $sx++) {
        $sourcePixel = $sourceBitmap.GetPixel($sx, $sy)
        $sourceBrightness = ($sourcePixel.R * 0.299 + $sourcePixel.G * 0.587 + $sourcePixel.B * 0.114) / 255.0
        $sourceCyanBias = [Math]::Max(0.0, (($sourcePixel.G + $sourcePixel.B) / 510.0) - ($sourcePixel.R / 255.0 * 0.55))
        if ([Math]::Max($sourceBrightness, $sourceCyanBias) -gt 0.42) {
          $minX = [Math]::Min($minX, $sx)
          $minY = [Math]::Min($minY, $sy)
          $maxX = [Math]::Max($maxX, $sx)
          $maxY = [Math]::Max($maxY, $sy)
        }
      }
    }
  } finally {
    $sourceBitmap.Dispose()
  }

  if ($maxX -lt $minX -or $maxY -lt $minY) {
    $minX = 0
    $minY = 0
    $maxX = $source.Width - 1
    $maxY = $source.Height - 1
  }

  $padX = [Math]::Max(1, [int](($maxX - $minX + 1) * 0.12))
  $padY = [Math]::Max(1, [int](($maxY - $minY + 1) * 0.12))
  $minX = [Math]::Max(0, $minX - $padX)
  $minY = [Math]::Max(0, $minY - $padY)
  $maxX = [Math]::Min($source.Width - 1, $maxX + $padX)
  $maxY = [Math]::Min($source.Height - 1, $maxY + $padY)

  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  try {
    $srcRect = New-Object System.Drawing.Rectangle($minX, $minY, ($maxX - $minX + 1), ($maxY - $minY + 1))
    $destRect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $graphics.DrawImage($source, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  } finally {
    $graphics.Dispose()
    $source.Dispose()
  }

  $values = New-Object System.Collections.Generic.List[double]
  $rowProjection = New-Object double[] $Size
  $colProjection = New-Object double[] $Size
  $foreground = 0
  $sum = 0.0

  try {
    for ($y = 0; $y -lt $Size; $y++) {
      for ($x = 0; $x -lt $Size; $x++) {
        $pixel = $bitmap.GetPixel($x, $y)
        $brightness = ($pixel.R * 0.299 + $pixel.G * 0.587 + $pixel.B * 0.114) / 255.0
        $cyanBias = [Math]::Max(0.0, (($pixel.G + $pixel.B) / 510.0) - ($pixel.R / 255.0 * 0.55))
        $value = [Math]::Max($brightness, $cyanBias)
        if ($value -gt 0.38) {
          $foreground++
          $rowProjection[$y] += 1.0
          $colProjection[$x] += 1.0
        }
        $values.Add($value)
        $sum += $value
      }
    }
  } finally {
    $bitmap.Dispose()
  }

  for ($i = 0; $i -lt $Size; $i++) {
    $rowValue = $rowProjection[$i] / $Size
    $colValue = $colProjection[$i] / $Size
    $values.Add($rowValue)
    $values.Add($colValue)
    $sum += $rowValue + $colValue
  }

  $mean = $sum / [Math]::Max(1, $values.Count)
  $norm = 0.0
  $centered = New-Object System.Collections.Generic.List[double]
  foreach ($value in $values) {
    $centeredValue = $value - $mean
    $centered.Add($centeredValue)
    $norm += $centeredValue * $centeredValue
  }

  $norm = [Math]::Sqrt($norm)
  if ($norm -lt 0.000001) { $norm = 1.0 }

  $vector = foreach ($value in $centered) {
    [Math]::Round($value / $norm, 6)
  }

  [ordered]@{
    path = $Path
    foregroundPixels = $foreground
    vector = @($vector)
  }
}

function Add-Sample {
  param(
    [System.Collections.Generic.List[object]]$Samples,
    [string]$Role,
    [string]$Path,
    [string]$Source
  )

  if (-not (Test-Path -LiteralPath $Path)) { return }
  $vector = Convert-ToLaneIconVector -Path $Path -Size $Size
  if ($vector.foregroundPixels -lt 24) { return }
  $Samples.Add([ordered]@{
    role = $Role
    source = $Source
    path = $Path
    foregroundPixels = $vector.foregroundPixels
    vector = $vector.vector
  })
}

function Test-ConfirmedIconCrop {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $image = [System.Drawing.Image]::FromFile($Path)
  $bitmap = New-Object System.Drawing.Bitmap($image)
  $edgePixels = 0

  try {
    for ($y = 0; $y -lt $bitmap.Height; $y++) {
      for ($x = 0; $x -lt $bitmap.Width; $x++) {
        $nearEdge = $x -lt 4 -or $y -lt 4 -or $x -ge ($bitmap.Width - 4) -or $y -ge ($bitmap.Height - 4)
        if (-not $nearEdge) { continue }
        $pixel = $bitmap.GetPixel($x, $y)
        $cyanEdge = $pixel.B -gt 120 -and $pixel.G -gt 95 -and $pixel.R -lt 80
        if ($cyanEdge) { $edgePixels++ }
      }
    }
  } finally {
    $bitmap.Dispose()
    $image.Dispose()
  }

  $edgePixels -ge 8
}

$samples = New-Object System.Collections.Generic.List[object]

Get-ChildItem -Path (Join-Path $samplesRoot "ranked_choose_lane") -Recurse -Filter "manifest.json" -ErrorAction SilentlyContinue | ForEach-Object {
  $dir = $_.Directory.FullName
  foreach ($role in $roles) {
    Add-Sample -Samples $samples -Role $role -Path (Join-Path $dir "$($role)_icon.png") -Source "choose_lane"
  }
}

if (-not $BigOnly) {
  Get-ChildItem -Path (Join-Path $samplesRoot "ranked_lanes_confirmed") -Recurse -Filter "manifest.json" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($ConfirmedSamplesAfter -and $_.Directory.Name -lt $ConfirmedSamplesAfter) { return }
    $manifest = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
    $selectedRoles = @($manifest.selectedRoles)
    if ($selectedRoles.Count -eq 0) { return }

    for ($i = 0; $i -lt $selectedRoles.Count; $i++) {
      $role = [string]$selectedRoles[$i]
      if ($roles -notcontains $role) { continue }
      $iconPath = Join-Path $_.Directory.FullName ("accepted_lane_icons_{0:D2}.png" -f $i)
      Add-Sample -Samples $samples -Role $role -Path $iconPath -Source "confirmed_lanes"
    }
  }
}

$templates = [ordered]@{}
foreach ($role in $roles) {
  $roleSamples = @($samples | Where-Object { $_.role -eq $role })
  if ($roleSamples.Count -eq 0) { continue }

  $sum = New-Object double[] ($Size * $Size)
  foreach ($sample in $roleSamples) {
    for ($i = 0; $i -lt $sum.Length; $i++) {
      $sum[$i] += [double]$sample.vector[$i]
    }
  }

  $norm = 0.0
  for ($i = 0; $i -lt $sum.Length; $i++) {
    $sum[$i] = $sum[$i] / $roleSamples.Count
    $norm += $sum[$i] * $sum[$i]
  }
  $norm = [Math]::Sqrt($norm)
  if ($norm -lt 0.000001) { $norm = 1.0 }

  $meanVector = for ($i = 0; $i -lt $sum.Length; $i++) {
    [Math]::Round($sum[$i] / $norm, 6)
  }

  $templates[$role] = [ordered]@{
    sampleCount = $roleSamples.Count
    sources = @($roleSamples | ForEach-Object { $_.source } | Sort-Object -Unique)
    vector = @($meanVector)
  }
}

$output = [ordered]@{
  schema = "mlbb_lane_icon_vector_templates.v1"
  vectorSize = $Size
  roles = $roles
  generatedAt = (Get-Date).ToString("o")
  confirmedSamplesAfter = $ConfirmedSamplesAfter
  templates = $templates
  exemplars = @($samples | ForEach-Object {
    [ordered]@{
      role = $_.role
      source = $_.source
      path = $_.path
      foregroundPixels = $_.foregroundPixels
      vector = $_.vector
    }
  })
  samples = @($samples | ForEach-Object {
    [ordered]@{
      role = $_.role
      source = $_.source
      path = $_.path
      foregroundPixels = $_.foregroundPixels
    }
  })
}

$outputDir = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$output | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
$output
