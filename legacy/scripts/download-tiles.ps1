$outDir = "d:\Github\main-website-lazycat\public\mahjong-tiles"
$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

$tiles = @{
    "MJt4-.svg" = "6/66/MJt4-.svg"
    "MJt5-.svg" = "7/72/MJt5-.svg"
    "MJt6-.svg" = "8/86/MJt6-.svg"
    "MJt7-.svg" = "6/6c/MJt7-.svg"
    "MJt8-.svg" = "6/66/MJt8-.svg"
    "MJt9-.svg" = "f/f5/MJt9-.svg"
    "MJs1-.svg" = "e/e8/MJs1-.svg"
    "MJs2-.svg" = "9/97/MJs2-.svg"
    "MJs3-.svg" = "1/1f/MJs3-.svg"
    "MJs4-.svg" = "b/b1/MJs4-.svg"
    "MJs6-.svg" = "6/63/MJs6-.svg"
    "MJs7-.svg" = "8/8a/MJs7-.svg"
    "MJs8-.svg" = "b/be/MJs8-.svg"
    "MJs9-.svg" = "f/f3/MJs9-.svg"
    "MJw1-.svg" = "3/32/MJw1-.svg"
    "MJw2-.svg" = "7/70/MJw2-.svg"
    "MJw3-.svg" = "d/d0/MJw3-.svg"
    "MJw4-.svg" = "6/6b/MJw4-.svg"
    "MJw5-.svg" = "4/4b/MJw5-.svg"
    "MJw6-.svg" = "4/4c/MJw6-.svg"
    "MJw7-.svg" = "c/c0/MJw7-.svg"
    "MJw8-.svg" = "d/d3/MJw8-.svg"
    "MJw9-.svg" = "a/a9/MJw9-.svg"
    "MJf1-.svg" = "9/90/MJf1-.svg"
    "MJf3-.svg" = "5/54/MJf3-.svg"
    "MJf4-.svg" = "d/df/MJf4-.svg"
    "MJd1-.svg" = "2/20/MJd1-.svg"
    "MJd3-.svg" = "5/52/MJd3-.svg"
    "MJh1-.svg" = "1/14/MJh1-.svg"
    "MJh2-.svg" = "e/e0/MJh2-.svg"
    "MJh3-.svg" = "2/25/MJh3-.svg"
    "MJh4-.svg" = "b/b7/MJh4-.svg"
    "MJh5-.svg" = "8/8b/MJh5-.svg"
    "MJh6-.svg" = "b/b3/MJh6-.svg"
    "MJh7-.svg" = "b/b6/MJh7-.svg"
    "MJh8-.svg" = "9/9c/MJh8-.svg"
}

$ok = 0; $fail = 0
foreach ($entry in $tiles.GetEnumerator()) {
    $filename = $entry.Key
    $wikiPath = $entry.Value
    $dest = Join-Path $outDir $filename
    
    if ((Test-Path $dest) -and (Get-Item $dest).Length -gt 200) {
        Write-Host "SKIP $filename (already exists)"
        $ok++
        continue
    }
    
    $url = "https://upload.wikimedia.org/wikipedia/commons/$wikiPath"
    try {
        Invoke-WebRequest -Uri $url -OutFile $dest -UserAgent $ua -ErrorAction Stop
        $size = [math]::Round((Get-Item $dest).Length / 1024, 1)
        Write-Host "OK $filename ($size KB)"
        $ok++
    } catch {
        Write-Host "FAIL $filename : $($_.Exception.Message)"
        $fail++
    }
    Start-Sleep -Seconds 3
}

Write-Host "`nDone: $ok downloaded, $fail failed"
