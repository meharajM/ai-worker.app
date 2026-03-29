# AI-Worker Windows Installer
# Downloads the latest build from Cloudflare R2 and runs the NSIS installer.
# Bypasses Windows SmartScreen "Mark of the Web" by downloading via PowerShell (Invoke-WebRequest)
# rather than a browser, preventing the Zone.Identifier alternate data stream from being attached.
#
# How to run: Right-click this file -> "Run with PowerShell"

$ErrorActionPreference = "Stop"

# Set encoding to UTF8 to ensure emojis and characters display correctly in Windows terminals
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

$R2Base = "https://downloads.ai-worker.tech"
$TempDir = [System.IO.Path]::GetTempPath()

Write-Host "🚀 AI-Worker Installer" -ForegroundColor Cyan
Write-Host "Fetching latest version info..."

# Force TLS 1.2+ for all network calls
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
} catch {}

function Fetch-Manifest {
    param([string]$Url)
    try {
        # Using a fresh query param to bypass CDN cache
        $ManifestUrl = "$Url?v=$([DateTime]::UtcNow.Ticks)"
        $RawResponse = Invoke-WebRequest -Uri $ManifestUrl -UseBasicParsing -TimeoutSec 30 -Headers @{ "Cache-Control" = "no-cache" }
        
        if ($RawResponse.Content -is [System.String]) {
            return $RawResponse.Content
        } else {
            return [System.Text.Encoding]::UTF8.GetString($RawResponse.Content)
        }
    } catch {
        # Fallback to plain URL if query param is rejected
        $RawResponse = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 30
        if ($RawResponse.Content -is [System.String]) {
            return $RawResponse.Content
        } else {
            return [System.Text.Encoding]::UTF8.GetString($RawResponse.Content)
        }
    }
}

$ManifestContent = Fetch-Manifest -Url "$R2Base/latest.yml"

# Robust parsing: Line-by-line check
$ExeFile = $null
$ExpectedSha = $null

foreach ($line in ($ManifestContent -split "\r?\n")) {
    $cleanLine = $line.Trim()
    
    # Identify filename
    if ($line -match '^path:\s*["'']?([^"''\r\n]+\.exe)["'']?') {
        $ExeFile = $Matches[1].Trim()
    }
    elseif (-not $ExeFile -and $line -match '^\s*-\s*url:\s*["'']?([^"''\r\n]+\.exe)["'']?') {
        $ExeFile = $Matches[1].Trim()
    }
    
    # Identify checksum
    if (-not $ExpectedSha -and $line -match 'sha512:\s*["'']?([A-Za-z0-9+/=]+)["'']?') {
        $ExpectedSha = $Matches[1].Trim()
    }
}

if (-not $ExeFile) {
    Write-Host "❌ Failed to identify latest installer file in manifest." -ForegroundColor Red
    pause
    exit 1
}

$DownloadUrl = "$R2Base/$ExeFile"
$DestPath = Join-Path $TempDir $ExeFile

function Get-FileSha512Base64 {
    param([string]$Path)
    $sha = [System.Security.Cryptography.SHA512]::Create()
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        try {
            $hashBytes = $sha.ComputeHash($stream)
        } finally {
            $stream.Dispose()
        }
    } finally {
        $sha.Dispose()
    }
    return [Convert]::ToBase64String($hashBytes)
}

function Validate-DownloadedFile {
    param(
        [string]$Path,
        [string]$ExpectedSha512
    )

    if (-not (Test-Path $Path)) { return $false }

    if ($ExpectedSha512) {
        $actualSha = Get-FileSha512Base64 -Path $Path
        if ($actualSha -ne $ExpectedSha512) { 
            Write-Host "   (Verification Mismatch)" -ForegroundColor Yellow
            Write-Host "   Expected: $ExpectedSha512" -ForegroundColor Gray
            Write-Host "   Actual:   $actualSha" -ForegroundColor Gray
            return $false 
        }
    }

    return $true
}

function Download-File {
    param(
        [string]$Url,
        [string]$Destination,
        [bool]$UseRefresh = $false
    )

    $OriginalProgressPreference = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'

    $targetUrl = $Url
    if ($UseRefresh) { $targetUrl = "$Url?v=$([DateTime]::UtcNow.Ticks)" }

    try {
        # Cancel any BITS jobs blocking the file
        try {
            if (Get-Command Get-BitsTransfer -ErrorAction SilentlyContinue) {
                Get-BitsTransfer | Where-Object { $_.FileList.LocalName -eq $Destination } | Stop-BitsTransfer -ErrorAction SilentlyContinue
            }
        } catch {}

        if (Test-Path $Destination) { Remove-Item $Destination -Force }

        # Try curl.exe primary
        $curl = (Get-Command "curl.exe" -ErrorAction SilentlyContinue)
        if ($curl) {
            $curlArgs = @("-fL", "--progress-bar", $targetUrl, "-o", $Destination, "-H", "Cache-Control: no-cache")
            & $curl.Source @curlArgs
            if ($LASTEXITCODE -eq 0 -and (Test-Path $Destination)) { return }
        }

        # Fallback to Invoke-WebRequest
        Invoke-WebRequest -Uri $targetUrl -OutFile $Destination -UseBasicParsing -TimeoutSec 600 -Headers @{ "Cache-Control" = "no-cache" }
    } finally {
        $ProgressPreference = $OriginalProgressPreference
    }
}

Write-Host "📦 Downloading $ExeFile..."

# Primary Attempt
try {
    Download-File -Url $DownloadUrl -Destination $DestPath
} catch {
    Write-Host "   (Primary source failed, trying refresh...)" -ForegroundColor Yellow
    try {
        Download-File -Url $DownloadUrl -Destination $DestPath -UseRefresh $true
    } catch {
        Write-Host "❌ Download failed." -ForegroundColor Red
        pause
        exit 1
    }
}

# Validation and Retry
if (-not (Validate-DownloadedFile -Path $DestPath -ExpectedSha512 $ExpectedSha)) {
    Write-Host "   (Validation failed, performing fresh download...)" -ForegroundColor Yellow
    try {
        Download-File -Url $DownloadUrl -Destination $DestPath -UseRefresh $true
    } catch {
        # If refreshing with query params fails (404), fallback to plain source one last time
        try {
            Download-File -Url $DownloadUrl -Destination $DestPath
        } catch {
            Write-Host "❌ Refresh source unavailable." -ForegroundColor Red
            pause
            exit 1
        }
    }
}

# Final Verification
if (-not (Validate-DownloadedFile -Path $DestPath -ExpectedSha512 $ExpectedSha)) {
    Write-Host "❌ Downloaded installer checksum does not match manifest information." -ForegroundColor Red
    pause
    exit 1
}

# Unblock
try {
    if (Get-Command Unblock-File -ErrorAction SilentlyContinue) {
        Unblock-File -Path $DestPath
    }
} catch {}

Write-Host "🔧 Starting the installer..." -ForegroundColor Yellow
Write-Host "   (Please check for a Windows User Account Control / UAC prompt on your screen)"

# Try Start-Process with Verb RunAs to force visibility and elevation if needed
try {
    Start-Process -FilePath $DestPath -Verb RunAs -Wait
} catch {
    # If user denies UAC or it's not supported, try normal start
    Write-Host "   (Elevation prompt bypassed, starting normally...)" -ForegroundColor Gray
    Start-Process -FilePath $DestPath -Wait
}

Write-Host ""
Write-Host "✅ Installation process finished!" -ForegroundColor Green
pause
