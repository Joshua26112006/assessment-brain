param([string]$Spec, [string]$OutDir)
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force $OutDir | Out-Null
$papers = Get-Content $Spec -Raw -Encoding UTF8 | ConvertFrom-Json
$fams = (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }
$fontName = if ($fams -contains "Ink Free") { "Ink Free" } elseif ($fams -contains "Segoe Script") { "Segoe Script" } else { "Comic Sans MS" }
Write-Output "Using font: $fontName"
$rand = New-Object System.Random 42
foreach ($p in $papers) {
  $bmp = New-Object System.Drawing.Bitmap 1240, 1754
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = "AntiAlias"; $g.TextRenderingHint = "AntiAliasGridFit"
  $g.Clear([System.Drawing.Color]::FromArgb(250, 248, 240))
  $linePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(185, 205, 225)), 1
  for ($y = 120; $y -lt 1700; $y += 52) { $g.DrawLine($linePen, 60, $y, 1180, $y) }
  $marginPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(220, 140, 140)), 2
  $g.DrawLine($marginPen, 110, 0, 110, 1754)
  $ink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(30, 40, 110))
  $font = New-Object System.Drawing.Font $fontName, 26
  $small = New-Object System.Drawing.Font $fontName, 20
  # header like a real sheet: roll number + page in the top-right, name/subject top-left
  $g.DrawString("Name: Test Student    Subject: $($p.subject)", $small, $ink, 130, 40)
  $g.DrawString("Roll No: 17    Page 1 / 1", $small, $ink, 880, 40)
  $y = 128
  foreach ($q in $p.questions) {
    $lines = @($q.answer)
    $y += 26
    $g.DrawString("Q$($q.n).", $font, $ink, 124, ($y - 4 + $rand.Next(-2, 3)))
    if ($lines.Count -eq 0) { $y += 52; continue }
    foreach ($l in $lines) {
      $dx = $rand.Next(-3, 4); $dy = $rand.Next(-3, 4)
      $g.DrawString($l, $font, $ink, (190 + $dx), ($y - 4 + $dy))
      $y += 52
    }
  }
  $file = Join-Path $OutDir "$($p.key).png"
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output "wrote $file (last y=$y)"
}
