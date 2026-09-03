$ErrorActionPreference = "Stop"

$wrapperDirectory = $PSScriptRoot
$binary = Join-Path $wrapperDirectory "workshop-evaluator.exe"
$checksum = "$binary.sha256"

if (-not (Test-Path -PathType Leaf $binary) -or -not (Test-Path -PathType Leaf $checksum)) {
    throw "Pinned workshop-evaluator binary or checksum is missing."
}

$expected = ((Get-Content -Raw $checksum).Trim() -split "\s+")[0].ToLowerInvariant()
$actual = (Get-FileHash -Algorithm SHA256 $binary).Hash.ToLowerInvariant()
if ($actual -ne $expected) {
    throw "Pinned workshop-evaluator checksum does not match."
}

& $binary @args
exit $LASTEXITCODE
