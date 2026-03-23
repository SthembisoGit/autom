param(
  [string]$TaskName = 'autoM Startup'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

try {
  & schtasks.exe /Delete /TN $TaskName /F | Out-Null
} catch {
  # Ignore; the task may not exist or may never have been created.
}

$startupFolder = [Environment]::GetFolderPath('Startup')
if (Test-Path $startupFolder) {
  $shortcutPath = Join-Path $startupFolder 'autoM Start.lnk'
  if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath -Force
    Write-Host "Removed startup shortcut: $shortcutPath"
  }
}

$desktopFolder = [Environment]::GetFolderPath('Desktop')
if (Test-Path $desktopFolder) {
  $desktopShortcut = Join-Path $desktopFolder 'autoM Start.lnk'
  if (Test-Path $desktopShortcut) {
    Remove-Item $desktopShortcut -Force
    Write-Host "Removed desktop shortcut: $desktopShortcut"
  }

  $desktopUiShortcut = Join-Path $desktopFolder 'autoM UI.url'
  if (Test-Path $desktopUiShortcut) {
    Remove-Item $desktopUiShortcut -Force
    Write-Host "Removed desktop shortcut: $desktopUiShortcut"
  }
}

Write-Host "Startup launcher removed if it existed."
