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

# Check for admin privileges
if (-not (Test-Administrator)) {
    Write-Host "⚠️  This script requires Administrator privileges." -ForegroundColor Yellow
    Write-Host "Please right-click PowerShell and select 'Run as Administrator', then run this script again." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

# Check for Chocolatey (package manager for Windows)
$hasChoco = Test-CommandExists choco

if (-not $hasChoco) {
    Write-Host "📦 Installing Chocolatey (Windows package manager)..." -ForegroundColor Yellow
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    
    # Refresh environment
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    Write-Host "✅ Chocolatey already installed" -ForegroundColor Green
}

# Install Node.js
if (-not (Test-CommandExists node)) {
    Write-Host "📦 Installing Node.js..." -ForegroundColor Yellow
    choco install nodejs -y
} else {
    $nodeVersion = node --version
    Write-Host "✅ Node.js already installed ($nodeVersion)" -ForegroundColor Green
}

# Install Python
if (-not (Test-CommandExists python)) {
    Write-Host "📦 Installing Python 3..." -ForegroundColor Yellow
    choco install python -y
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

# Refresh environment variables
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

Write-Host ""
Write-Host "✅ All dependencies installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Next steps:" -ForegroundColor Cyan
Write-Host "  1. Close and reopen PowerShell/Terminal"
Write-Host "  2. Restart the AI Worker app"
Write-Host "  3. Enable MarkItDown in Settings → MCP Servers"
Write-Host ""
Write-Host "🎉 You're all set!" -ForegroundColor Green
Write-Host ""
Read-Host "Press Enter to exit"
