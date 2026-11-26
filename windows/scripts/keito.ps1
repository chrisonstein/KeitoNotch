<#
.SYNOPSIS
  Drive the running Keito Notch from a terminal or from Claude: status, start, log, stop.

.DESCRIPTION
  Hands the command to the running app (keito-notch.exe --remote ...), which books it with the same ticket
  rules as its form (same ticket as before -> same project; CSD -> Service Desk with the customer as task)
  and shows the usual toast with Undo. Prints one JSON line: {"ok":..,"message":..,...}.

  Exit codes: 0 done · 1 refused (the message says why; nothing was booked) · 2 no answer from the app
  (outcome unknown: run 'status' before trying again, don't just repeat a 'log').

  Installed next to the app (%LOCALAPPDATA%\Keito Notch\keito.ps1). Source: windows/scripts/keito.ps1;
  the app side is src-tauri/src/remote.rs and src/lib/remote.ts.

.EXAMPLE
  keito.ps1 status
  keito.ps1 start CSD-1234
  keito.ps1 log CSD-1234 30m -Notes "Printer offline" -Date yesterday
  keito.ps1 log -Project "Rollout" -Task "Development" -Duration 1h30
  keito.ps1 stop
  keito.ps1 install-skill
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory, Position = 0)]
  [ValidateSet('status', 'start', 'log', 'stop', 'install-skill')]
  [string]$Command,
  # Jira key (CSD-1234) or link.
  [Parameter(Position = 1)][string]$Ticket,
  # 30m, 1h, 1h30, 1.5h, 1:30 (log only).
  [Parameter(Position = 2)][string]$Duration,
  # YYYY-MM-DD, today or yesterday (log only; default today).
  [string]$Date,
  [string]$Notes,
  # By name, when the ticket rules don't know the project or task (or you want another).
  [string]$Project,
  [string]$Task,
  [int]$TimeoutSec = 30,
  # Print the request instead of sending it.
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
# The reply carries client and task names with accents; the console default (e.g. ibm850) would mangle
# them for whoever reads stdout (Claude, a pipe).
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Out-Reply([hashtable]$Reply, [int]$Code) {
  $Reply | ConvertTo-Json -Compress
  exit $Code
}

if ($Command -eq 'install-skill') {
  # Claude Code picks up skills from ~/.claude/skills/<name>/SKILL.md.
  $source = Join-Path $PSScriptRoot 'claude-skill\SKILL.md'
  if (-not (Test-Path $source)) { $source = Join-Path $PSScriptRoot '..\claude-skill\keito\SKILL.md' }
  if (-not (Test-Path $source)) { Out-Reply @{ ok = $false; message = "SKILL.md not found next to $PSCommandPath" } 1 }
  $target = Join-Path $HOME '.claude\skills\keito'
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  Copy-Item -Force $source (Join-Path $target 'SKILL.md')
  Out-Reply @{ ok = $true; message = "Skill installed in $target; new Claude Code sessions know 'keito'" } 0
}

$id = [guid]::NewGuid().ToString('D').ToLowerInvariant()
$request = [ordered]@{ id = $id; verb = $Command }
foreach ($name in 'Ticket', 'Duration', 'Date', 'Notes', 'Project', 'Task') {
  $value = Get-Variable -Name $name -ValueOnly
  if ($value) { $request[$name.ToLowerInvariant()] = $value }
}
$json = $request | ConvertTo-Json -Compress
if ($DryRun) { $json; exit 0 }

$exe = if ($env:KEITO_NOTCH_EXE) { $env:KEITO_NOTCH_EXE } else { Join-Path $env:LOCALAPPDATA 'Keito Notch\keito-notch.exe' }
if (-not (Test-Path $exe)) { Out-Reply @{ ok = $false; message = "Keito Notch is not installed here ($exe)" } 2 }

$dir = Join-Path $env:LOCALAPPDATA 'ai.keito.notch\remote'
$file = Join-Path $dir "$id.json"
# Answers nobody collected (a script that gave up) don't pile up.
Get-ChildItem -Path $dir -Filter '*.json*' -ErrorAction SilentlyContinue |
  Where-Object LastWriteTime -lt (Get-Date).AddHours(-1) | Remove-Item -ErrorAction SilentlyContinue

# base64url, so quotes and non-ASCII notes survive the command line untouched.
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$wasRunning = [bool](Get-Process -Name 'keito-notch' -ErrorAction SilentlyContinue)
Start-Process -FilePath $exe -ArgumentList '--remote', $b64
# A cold start first loads Keito (and the ticket history) before it answers.
$wait = if ($wasRunning) { $TimeoutSec } else { $TimeoutSec + 30 }
$deadline = (Get-Date).AddSeconds($wait)
while ((Get-Date) -lt $deadline) {
  if (Test-Path $file) {
    $text = (Get-Content -Raw -Encoding utf8 -Path $file).Trim()
    Remove-Item -Path $file -ErrorAction SilentlyContinue
    $text
    $reply = $text | ConvertFrom-Json
    exit $(if ($reply.ok) { 0 } else { 1 })
  }
  Start-Sleep -Milliseconds 200
}
Out-Reply @{ ok = $false; message = "No answer from Keito Notch within $wait s. Outcome unknown: run 'keito.ps1 status' before trying again." } 2
