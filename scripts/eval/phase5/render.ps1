param([string]$OutDir)
Add-Type -AssemblyName System.Drawing
$fams = (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }
$hand = if ($fams -contains "Ink Free") { "Ink Free" } else { "Comic Sans MS" }
$hindi = if ($fams -contains "Nirmala UI") { "Nirmala UI" } else { "Mangal" }
function NewPage { $b = New-Object System.Drawing.Bitmap 1240, 1754; $g = [System.Drawing.Graphics]::FromImage($b); $g.SmoothingMode = "AntiAlias"; $g.TextRenderingHint = "AntiAliasGridFit"; $g.Clear([System.Drawing.Color]::FromArgb(250,248,240)); $lp = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(185,205,225)), 1; for ($y=120; $y -lt 1700; $y+=52) { $g.DrawLine($lp,60,$y,1180,$y) }; return @($b,$g) }
$ink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(30,40,110))
$f = New-Object System.Drawing.Font $hand, 26
$fh = New-Object System.Drawing.Font $hindi, 24
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(30,40,110)), 3
$strike = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(20,20,60)), 4

# ---- page 1
$b,$g = NewPage
$g.DrawString("Name: Test Student    Roll No: 17    Page 1 / 3", $f, $ink, 130, 40)
$g.DrawString("1.  x = 4", $f, $ink, 124, 140); $g.DrawLine($strike, 118, 158, 330, 170)
$g.DrawString("     x = 5", $f, $ink, 124, 195)
$g.DrawString("Rough work", $f, $ink, 880, 140); $g.DrawString("2 x 3 = 6", $f, $ink, 880, 190); $g.DrawString("6 + 4 = 10", $f, $ink, 880, 240)
$g.DrawString("2.  (the figure)", $f, $ink, 124, 330)
$g.DrawPolygon($pen, @((New-Object System.Drawing.Point 300,560), (New-Object System.Drawing.Point 600,560), (New-Object System.Drawing.Point 450,390)))
$g.DrawString("A", $f, $ink, 440, 350); $g.DrawString("B", $f, $ink, 270, 565); $g.DrawString("C", $f, $ink, 605, 565)
$g.DrawString("3.  " + [string]::Join("", [char[]](0x092F,0x0939,0x0020,0x090F,0x0915,0x0020,0x0909,0x0924,0x094D,0x0924,0x0930,0x0020,0x0939,0x0948)), $fh, $ink, 124, 700)
$g.DrawString("4.  The main causes of the war were many.", $f, $ink, 124, 820)
$g.DrawString("First, the alliance system divided Europe into two", $f, $ink, 190, 872)
$g.DrawString("armed camps so a small conflict could spread.", $f, $ink, 190, 924)
$g.DrawString("contd.", $f, $ink, 1000, 1640)
$b.Save((Join-Path $OutDir "page1.png"), [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose()

# ---- page 2 (the essay carries on with no question number)
$b,$g = NewPage
$g.DrawString("Name: Test Student    Roll No: 17    Page 2 / 3", $f, $ink, 130, 40)
$g.DrawString("Second, the assassination of Archduke Franz Ferdinand", $f, $ink, 190, 140)
$g.DrawString("in 1914 gave Austria a reason to attack Serbia.", $f, $ink, 190, 192)
$g.DrawString("Third, militarism meant every country was building", $f, $ink, 190, 244)
$g.DrawString("up its army and navy.   contd.", $f, $ink, 190, 296)
$b.Save((Join-Path $OutDir "page2.png"), [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose()

# ---- page 3
$b,$g = NewPage
$g.DrawString("Name: Test Student    Roll No: 17    Page 3 / 3", $f, $ink, 130, 40)
$g.DrawString("In conclusion, these causes together made a large", $f, $ink, 190, 140)
$g.DrawString("war very likely by the summer of 1914.", $f, $ink, 190, 192)
$b.Save((Join-Path $OutDir "page3.png"), [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose()
Write-Output "ok"
