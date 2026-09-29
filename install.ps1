# Install every package of this family into the DSH web profile.
# Usage: ./install.ps1       (honours $env:DSH_ROOT, defaults to ~/DeepSeek_harness)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dshRoot = if ($env:DSH_ROOT) { $env:DSH_ROOT } else { Join-Path $HOME 'DeepSeek_harness' }
$dsh = Join-Path $dshRoot 'node_modules\.bin\dsh.cmd'
if (-not (Test-Path $dsh)) { throw "dsh CLI not found at $dsh; set DSH_ROOT to your install root" }
foreach ($sub in @('dsh-skill-sets')) {
  $path = Join-Path $root $sub
  "== $sub"
  & $dsh plugin --profile web add $path
}
