param(
  [string]$RepoRoot = 'C:\autoM',
  [string]$TaskName = 'autoM Startup'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$startupScript = Join-Path $RepoRoot 'scripts\windows\start-autoM.ps1'
if (-not (Test-Path $startupScript)) {
  throw "Startup script not found: $startupScript"
}

$shell = New-Object -ComObject WScript.Shell

function New-AutoMShortcut {
  param(
    [string]$ShortcutPath,
    [switch]$Hidden
  )

  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = (Get-Command powershell.exe).Source
  $shortcut.Arguments = if ($Hidden) {
    "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startupScript`" -RepoRoot `"$RepoRoot`""
  } else {
    "-NoProfile -ExecutionPolicy Bypass -File `"$startupScript`" -RepoRoot `"$RepoRoot`""
  }
  $shortcut.WorkingDirectory = $RepoRoot
  $shortcut.Description = 'Start autoM, Tailscale Funnel, and the local UI at logon.'
  $shortcut.Save()
}

function New-AutoMUrlShortcut {
  param(
    [string]$ShortcutPath,
    [string]$Url
  )

  @(
    '[InternetShortcut]'
    "URL=$Url"
    'IconFile=%SystemRoot%\system32\SHELL32.dll'
    'IconIndex=13'
  ) | Set-Content -Path $ShortcutPath -Encoding ASCII
}

$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$startupScript`" -RepoRoot `"$RepoRoot`""
$taskCreated = $false

try {
  & schtasks.exe /Create /TN $TaskName /SC ONLOGON /RL LIMITED /TR $taskCommand /F *> $null
  if ($LASTEXITCODE -eq 0) {
    $taskCreated = $true
    Write-Host "Registered scheduled task: $TaskName"
  }
} catch {
  $taskCreated = $false
}

if (-not $taskCreated) {
  $startupFolder = [Environment]::GetFolderPath('Startup')
  if (-not (Test-Path $startupFolder)) {
    throw "Startup folder not found: $startupFolder"
  }

  $shortcutPath = Join-Path $startupFolder 'autoM Start.lnk'
  New-AutoMShortcut -ShortcutPath $shortcutPath -Hidden
  Write-Host "Created startup shortcut: $shortcutPath"
}

$desktopFolder = [Environment]::GetFolderPath('Desktop')
if (Test-Path $desktopFolder) {
  $desktopShortcut = Join-Path $desktopFolder 'autoM Start.lnk'
  New-AutoMShortcut -ShortcutPath $desktopShortcut
  Write-Host "Created desktop shortcut: $desktopShortcut"

  $desktopUiShortcut = Join-Path $desktopFolder 'autoM UI.url'
  New-AutoMUrlShortcut -ShortcutPath $desktopUiShortcut -Url 'http://localhost:4173/'
  Write-Host "Created desktop shortcut: $desktopUiShortcut"
}

Write-Host "Startup launcher is ready."
