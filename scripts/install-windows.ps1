# AI-Worker Windows Installer
# Downloads the latest build from Cloudflare R2 and runs the NSIS installer.
# Bypasses Windows SmartScreen "Mark of the Web" by downloading via PowerShell (Invoke-WebRequest)
# rather than a browser, preventing the Zone.Identifier alternate data stream from being attached.
#
# How to run: Right-click this file -> "Run with PowerShell"

$ErrorActionPreference = "Stop"

$R2Base = "https://downloads.aiworker.app"
$TempDir = [System.IO.Path]::GetTempPath()
$ManifestUrl = "$R2Base/latest.yml"

Write-Host "🚀 AI-Worker Installer" -ForegroundColor Cyan
Write-Host "Fetching latest version info..."

try {
    $ManifestContent = Invoke-WebRequest -Uri $ManifestUrl -UseBasicParsing | Select-Object -ExpandProperty Content
} catch {
    Write-Host "❌ Could not fetch version info. Check your internet connection." -ForegroundColor Red
    pause
    exit 1
}

# Parse the path: field from the yaml
$ExeFile = ($ManifestContent -split "`n" | Where-Object { $_ -match "^path:" } | Select-Object -First 1) -replace "path:\s*", "" -replace "\s", ""

if (-not $ExeFile) {
    Write-Host "❌ Could not determine the latest build file." -ForegroundColor Red
    pause
    exit 1
}

$DownloadUrl = "$R2Base/$ExeFile"
$DestPath = Join-Path $TempDir $ExeFile

Write-Host "📦 Downloading $ExeFile..."
Invoke-WebRequest -Uri $DownloadUrl -OutFile $DestPath -UseBasicParsing

# Remove the Zone.Identifier alternate data stream (Mark of the Web) if it was attached
try {
    Unblock-File -Path $DestPath
} catch {}

Write-Host "🔧 Running installer..."
Write-Host "   (Follow the on-screen installation prompts)"
Start-Process -FilePath $DestPath -Wait

Write-Host ""
Write-Host "✅ AI-Worker has been installed!" -ForegroundColor Green
Write-Host "   You can now launch it from the Start Menu or Desktop shortcut."
pause
