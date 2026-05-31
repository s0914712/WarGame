param([string]$f)
$bytes = [System.IO.File]::ReadAllBytes($f)
$txt = [System.Text.Encoding]::UTF8.GetString($bytes)
try { $j = $txt | ConvertFrom-Json } catch { $j = ($txt | ConvertFrom-Json) }
# handle MCP wrapper [{type,text}]
if ($j -is [array] -and $j[0].text) { $j = $j[0].text | ConvertFrom-Json }
$u = $j.units
$blue = $u | Where-Object { $_.side -eq 'blue' }
$us   = $u | Where-Object { $_.side -eq 'us' }
$red  = $u | Where-Object { $_.side -eq 'red' }
"=== BLUE side: $($blue.Count) units | US: $($us.Count) | RED: $($red.Count) ==="
$bt=0; foreach($x in $blue){$bt+=$x.hp.current}
$rt=0; foreach($x in $red){$rt+=$x.hp.current}
"BLUE total HP=$bt   RED total HP=$rt"
""
"--- RED amphibious transports (win-condition targets) ---"
$red | Where-Object { $_.id -match 'LHA|LPD|LST' } | Sort-Object id | ForEach-Object {
  "{0,-12} {1,-9} [{2,7:N2},{3,6:N2}] spd={4,-3} hp={5,4} det={6}" -f $_.id,$_.callsign,$_.position.lng,$_.position.lat,$_.speedKnots,$_.hp.current,$_.detectedByPlayer
}
"--- RED escorts/combatants alive ---"
$red | Where-Object { $_.id -match '055|052D|SSN' } | Sort-Object id | ForEach-Object {
  "{0,-12} {1,-9} [{2,7:N2},{3,6:N2}] hp={4,4} det={5}" -f $_.id,$_.callsign,$_.position.lng,$_.position.lat,$_.hp.current,$_.detectedByPlayer
}
""
"--- MY damaged/lost (blue+us, hp<max) ---"
$blue+$us | Where-Object { $_.hp.current -lt $_.hp.max } | Sort-Object side,id | ForEach-Object {
  "{0,-13} {1,-4} {2,-15} hp={3}/{4}" -f $_.id,$_.side,$_.callsign,$_.hp.current,$_.hp.max
}
