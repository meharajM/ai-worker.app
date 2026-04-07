# AI Worker - Dependency Setup Script (Windows)
# This script installs Node.js, Python, and uv for MCP server support

Write-Host "🚀 AI Worker - Setting up dependencies for Windows..." -ForegroundColor Cyan
Write-Host ""

# Function to check if a command exists
function Test-CommandExists {
    param($command)
    $null = Get-Command $command -ErrorAction SilentlyContinue
    return $?
}

# Function to check if running as Administrator
function Test-Administrator {
    $currentUser = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $currentUser.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# We prefer admin for system-wide installs, but can still run user-scoped installs.
$isAdmin = Test-Administrator
if (-not $isAdmin) {
    Write-Host "⚠️  Running without Administrator privileges. Trying user-scoped installs first." -ForegroundColor Yellow
}

# Check for Chocolatey (package manager for Windows)
$hasChoco = Test-CommandExists choco

if (-not $hasChoco -and $isAdmin) {
    Write-Host "📦 Installing Chocolatey (Windows package manager)..." -ForegroundColor Yellow
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    
    # Refresh environment
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    if ($hasChoco) {
        Write-Host "✅ Chocolatey already installed" -ForegroundColor Green
    } else {
        Write-Host "ℹ️ Chocolatey not found (and no admin). Falling back to winget/manual installers." -ForegroundColor Gray
    }
}

function Install-WithWingetOrManual {
    param(
        [string]$WingetId,
        [string]$DisplayName,
        [string]$ManualUrl
    )
    if (Test-CommandExists winget) {
        Write-Host "📦 Installing $DisplayName via winget..." -ForegroundColor Yellow
        winget install --id $WingetId --accept-package-agreements --accept-source-agreements --silent --disable-interactivity --scope user
        return $true
    }
    Write-Host "❌ Could not install $DisplayName automatically (winget not found)." -ForegroundColor Red
    Write-Host "   Install manually: $ManualUrl" -ForegroundColor Yellow
    return $false
}

# Install Node.js
if (-not (Test-CommandExists node)) {
    Write-Host "📦 Installing Node.js..." -ForegroundColor Yellow
    if ($hasChoco) {
        choco install nodejs -y
    } else {
        Install-WithWingetOrManual -WingetId "OpenJS.NodeJS.LTS" -DisplayName "Node.js LTS" -ManualUrl "https://nodejs.org"
    }
} else {
    $nodeVersion = node --version
    Write-Host "✅ Node.js already installed ($nodeVersion)" -ForegroundColor Green
}

# Install Python
if (-not (Test-CommandExists python)) {
    Write-Host "📦 Installing Python 3..." -ForegroundColor Yellow
    if ($hasChoco) {
        choco install python -y
    } else {
        Install-WithWingetOrManual -WingetId "Python.Python.3.12" -DisplayName "Python 3" -ManualUrl "https://www.python.org/downloads/windows/"
    }
} else {
    $pythonVersion = python --version
    Write-Host "✅ Python already installed ($pythonVersion)" -ForegroundColor Green
}

# Install uv
if (-not (Test-CommandExists uv)) {
    Write-Host "📦 Installing uv (Python package runner)..." -ForegroundColor Yellow
    powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
} else {
    $uvVersion = uv --version
    Write-Host "✅ uv already installed ($uvVersion)" -ForegroundColor Green
}

# Install ffmpeg
if (-not (Test-CommandExists ffmpeg)) {
    Write-Host "📦 Installing ffmpeg (required for audio processing)..." -ForegroundColor Yellow
    if ($hasChoco) {
        choco install ffmpeg -y
    } else {
        Install-WithWingetOrManual -WingetId "Gyan.FFmpeg" -DisplayName "ffmpeg" -ManualUrl "https://ffmpeg.org/download.html"
    }
} else {
    Write-Host "✅ ffmpeg already installed" -ForegroundColor Green
}

# Refresh environment variables
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

Write-Host ""
Write-Host "✅ All dependencies installed successfully!" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "🎉 YOU'RE ALL SET! " -ForegroundColor Green
Write-Host ""
Write-Host "🛑 PLEASE CLOSE THIS TERMINAL WINDOW TO CONTINUE." -ForegroundColor Yellow
Write-Host "   The AI-Worker app will automatically detect these changes" -ForegroundColor Yellow
Write-Host "   and dismiss the setup screen." -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""
Read-Host "Press Enter to exit"
