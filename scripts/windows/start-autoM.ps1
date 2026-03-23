param(
  [string]$RepoRoot = 'C:\autoM'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-StartupLog {
  param(
    [string]$Message
  )

  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Write-Host $line
  Add-Content -Path $script:BootLogPath -Value $line
}

function Test-ProcessCommandLine {
  param(
    [string]$Pattern
  )

  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Pattern*" } |
    Select-Object -First 1
}

function Start-LoggedProcess {
  param(
    [string]$Name,
    [string[]]$Arguments,
    [string]$OutLogPath,
    [string]$ErrLogPath,
    [string]$CommandPattern
  )

  if (Test-ProcessCommandLine -Pattern $CommandPattern) {
    Write-StartupLog "$Name already running."
    return
  }

  Start-Process `
    -FilePath 'npm.cmd' `
    -ArgumentList $Arguments `
    -WorkingDirectory $RepoRoot `
    -RedirectStandardOutput $OutLogPath `
    -RedirectStandardError $ErrLogPath | Out-Null

  Write-StartupLog "$Name started."
}

function Wait-ForHealth {
  param(
    [string]$Uri,
    [int]$Attempts = 30,
    [int]$DelaySeconds = 2
  )

  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      Invoke-RestMethod -Uri $Uri -TimeoutSec 5 | Out-Null
      return $true
    } catch {
      Start-Sleep -Seconds $DelaySeconds
    }
  }

  return $false
}

if (-not (Test-Path $RepoRoot)) {
  throw "Repository root not found: $RepoRoot"
}

Set-Location -LiteralPath $RepoRoot

$logsRoot = Join-Path $RepoRoot 'var\logs\startup'
New-Item -ItemType Directory -Force -Path $logsRoot | Out-Null

$script:BootLogPath = Join-Path $logsRoot 'boot.log'
$serverOut = Join-Path $logsRoot 'server.out.log'
$serverErr = Join-Path $logsRoot 'server.err.log'
$opsOut = Join-Path $logsRoot 'ops.out.log'
$opsErr = Join-Path $logsRoot 'ops.err.log'
$funnelOut = Join-Path $logsRoot 'funnel.out.log'
$funnelErr = Join-Path $logsRoot 'funnel.err.log'

Write-StartupLog "Starting autoM from $RepoRoot."
Write-StartupLog 'Building shared packages before process start.'

npm run build:packages *> $script:BootLogPath
if ($LASTEXITCODE -ne 0) {
  throw "Shared package build failed. See $script:BootLogPath."
}

Start-LoggedProcess `
  -Name 'Server' `
  -Arguments @('run', 'dev:server') `
  -OutLogPath $serverOut `
  -ErrLogPath $serverErr `
  -CommandPattern 'run dev:server'

if (Wait-ForHealth -Uri 'http://127.0.0.1:4010/health') {
  Write-StartupLog 'Server health check passed.'
} else {
  Write-StartupLog 'Server health check did not respond within the wait window.'
}

Start-LoggedProcess `
  -Name 'Ops UI' `
  -Arguments @('run', 'dev:ops') `
  -OutLogPath $opsOut `
  -ErrLogPath $opsErr `
  -CommandPattern 'run dev:ops'

if (-not (Test-ProcessCommandLine -Pattern 'funnel --bg 4010')) {
  Write-StartupLog 'Starting Tailscale Funnel.'
  & tailscale funnel --bg 4010 *> $funnelOut
  if ($LASTEXITCODE -ne 0) {
    $tailMessage = 'Tailscale Funnel failed to start. See funnel logs.'
    Add-Content -Path $script:BootLogPath -Value $tailMessage
    throw $tailMessage
  }
  Write-StartupLog 'Tailscale Funnel is active.'
} else {
  Write-StartupLog 'Tailscale Funnel already running.'
}

Write-StartupLog 'Startup sequence complete.'
