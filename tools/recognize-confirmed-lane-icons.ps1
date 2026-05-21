param(
  [Parameter(Mandatory = $true)]
  [string]$CropDir,

  [string]$ProjectRoot = "",
  [string]$TemplatesPath = "",
  [double]$MinScore = 0.42
)

$ErrorActionPreference = "Stop"

if (-not $ProjectRoot) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

if (-not $TemplatesPath) {
  $TemplatesPath = Join-Path $ProjectRoot "data\recognition-samples\lane-icon-vector-templates.json"
}

if (-not (Test-Path -LiteralPath $TemplatesPath)) {
  throw "Template file not found: $TemplatesPath. Run tools\build-lane-icon-vector-templates.ps1 first."
}

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
    $value / $norm
  }

  [ordered]@{
    foregroundPixels = $foreground
    vector = @($vector)
  }
}

function Get-CosineScore {
  param(
    $A,
    $B
  )

  $left = @($A)
  $right = @($B)
  $score = 0.0
  $count = [Math]::Min($left.Count, $right.Count)
  for ($i = 0; $i -lt $count; $i++) {
    $score += ([double]$left[$i]) * ([double]$right[$i])
  }
  $score
}

$templatesData = Get-Content -LiteralPath $TemplatesPath -Raw | ConvertFrom-Json
$size = [int]$templatesData.vectorSize
$templateVectors = @{}
foreach ($property in $templatesData.templates.PSObject.Properties) {
  $templateVectors[$property.Name] = [double[]]@($property.Value.vector | ForEach-Object { [double]$_ })
}

$exemplars = @()
if ($templatesData.PSObject.Properties.Name -contains "exemplars") {
  $exemplars = @($templatesData.exemplars)
}

$results = New-Object System.Collections.Generic.List[object]
$slotLimit = $null
$manifestPath = Join-Path $CropDir "manifest.json"
if (Test-Path -LiteralPath $manifestPath) {
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $selectedRoles = @($manifest.selectedRoles)
  if ($selectedRoles.Count -gt 0) {
    $slotLimit = $selectedRoles.Count
  }
}

$iconFiles = Get-ChildItem -LiteralPath $CropDir -Filter "accepted_lane_icons_*.png" |
  Where-Object { $_.BaseName -match "^accepted_lane_icons_\d+$" } |
  Sort-Object Name

foreach ($file in $iconFiles) {
  $slotIndex = [int]($file.BaseName -replace "^accepted_lane_icons_", "")
  if ($null -ne $slotLimit -and $slotIndex -ge $slotLimit) { continue }

  $vector = Convert-ToLaneIconVector -Path $file.FullName -Size $size
  if ($vector.foregroundPixels -lt 24) { continue }

  if ($exemplars.Count -gt 0) {
    $exemplarScores = foreach ($exemplar in $exemplars) {
      [pscustomobject][ordered]@{
        role = $exemplar.role
        source = $exemplar.source
        path = $exemplar.path
        score = [Math]::Round((Get-CosineScore -A ([object[]]@($vector.vector)) -B ([object[]]@($exemplar.vector))), 4)
      }
    }

    $bestExemplarByRole = $exemplarScores |
      Group-Object role |
      ForEach-Object {
        $sortedGroup = @($_.Group | Sort-Object score -Descending)
        $sortedGroup[0]
      }

    $scores = foreach ($item in $bestExemplarByRole) {
      [pscustomobject][ordered]@{
        role = $item.role
        score = $item.score
        source = $item.source
        path = $item.path
      }
    }
  } else {
    $scores = foreach ($role in $templateVectors.Keys) {
      [pscustomobject][ordered]@{
        role = $role
        score = [Math]::Round((Get-CosineScore -A ([object[]]@($vector.vector)) -B ([object[]]@($templateVectors[$role]))), 4)
      }
    }
  }

  $best = @($scores | Sort-Object score -Descending)[0]
  $results.Add([ordered]@{
    slot = $file.BaseName
    path = $file.FullName
    foregroundPixels = $vector.foregroundPixels
    role = if ($best.score -ge $MinScore) { $best.role } else { "unknown" }
    score = $best.score
    scores = @($scores | Sort-Object score -Descending)
  })
}

$resultArray = @($results.ToArray())
$recognizedRoles = foreach ($result in $resultArray) {
  $result.role
}

$output = [ordered]@{
  schema = "mlbb_confirmed_lane_icon_recognition.v1"
  cropDir = (Resolve-Path -LiteralPath $CropDir).Path
  templatesPath = (Resolve-Path -LiteralPath $TemplatesPath).Path
  minScore = $MinScore
  recognizedRoles = @($recognizedRoles)
  results = @($resultArray)
}

$output | ConvertTo-Json -Depth 12
