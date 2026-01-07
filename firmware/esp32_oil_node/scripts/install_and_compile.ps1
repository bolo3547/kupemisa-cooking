# Install and compile helper for Windows PowerShell
# Usage (PowerShell, run as Admin if possible):
#   powershell -ExecutionPolicy Bypass -File .\scripts\install_and_compile.ps1
# This script will:
#  - Download arduino-cli Windows x64 binary (to %USERPROFILE%\Downloads) if not present
#  - Add it to PATH for this session
#  - Install ESP32 core
#  - Install required libraries (TFT_eSPI, Keypad, TJpg_Decoder, PNGdec, XPT2046_Touchscreen, LittleFS, ArduinoJson)
#  - Compile esp32_oil_node.ino and write compile logs to scripts/compile.log

Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$downloads = Join-Path $env:USERPROFILE 'Downloads'
$zipPath = Join-Path $downloads 'arduino-cli.zip'
$cliDir = Join-Path $downloads 'arduino-cli'
$compileLog = Join-Path $scriptDir 'compile.log'
$sketchDir = Resolve-Path "$scriptDir\..\"
$sketch = Join-Path $sketchDir 'esp32_oil_node.ino'

function Write-Log { param($m) Write-Output "[install_and_compile] $m" }

# Step 1: find or download arduino-cli
$cliExe = Get-Command arduino-cli -ErrorAction SilentlyContinue | Select-Object -First 1
if ($cliExe) {
    Write-Log "arduino-cli found at $($cliExe.Path)"
    $cliPath = $cliExe.Path
} else {
    Write-Log "arduino-cli not found in PATH; downloading latest Windows x64 release to $downloads"
    try {
        $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/arduino/arduino-cli/releases/latest' -UseBasicParsing
        $asset = $rel.assets | Where-Object { $_.name -match 'Windows_64bit' } | Select-Object -First 1
        if (-not $asset) { throw 'No Windows_64bit asset found in latest release.' }
            Write-Log "Downloading $($asset.name)"
        $dlPath = Join-Path $downloads $($asset.name)
        # If a previous partial file exists, try to remove it first
        if (Test-Path $dlPath) {
          try { Remove-Item $dlPath -Force -ErrorAction Stop }
          catch {
            Write-Log "Could not remove existing file $dlPath. Close programs that may be using it (browser/installer) and re-run this script."
            exit 3
          }
        }
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dlPath -UseBasicParsing
        if (Test-Path $cliDir) { Remove-Item $cliDir -Recurse -Force -ErrorAction SilentlyContinue }
        # Handle ZIP and MSI packages differently
        if ($dlPath -like "*.zip") {
          Expand-Archive $dlPath -DestinationPath $cliDir -Force
        } elseif ($dlPath -like "*.msi") {
          Write-Log "MSI package downloaded. Attempting administrative extract to $cliDir (may require elevation)."
          try {
            New-Item -ItemType Directory -Path $cliDir -Force | Out-Null
            $arg = "/a `"$dlPath`" /qn TARGETDIR=`"$cliDir`""
            $p = Start-Process -FilePath msiexec -ArgumentList $arg -Wait -NoNewWindow -PassThru
            if ($p.ExitCode -ne 0) { throw "msiexec returned $($p.ExitCode)" }
          } catch {
            Write-Log "MSI extraction failed or requires admin rights. Please run the MSI installer manually as Administrator: $dlPath";
            exit 4
          }
        } else {
          Write-Log "Downloaded file type not recognized: $dlPath"; exit 5
        }
        $cliExeCandidate = Get-ChildItem $cliDir -Filter arduino-cli.exe -Recurse | Select-Object -First 1
        if (-not $cliExeCandidate) { throw 'arduino-cli.exe not found after extract or install' }
        $cliPath = $cliExeCandidate.FullName
        Write-Log "arduino-cli available at $cliPath"
    } catch {
        Write-Log "Failed to download/install arduino-cli: $_"
        Write-Log "If you are behind a firewall or offline, please install arduino-cli manually:"
        Write-Log "  1) Download the latest Windows x64 MSI from https://github.com/arduino/arduino-cli/releases/latest"
        Write-Log "  2) Run the MSI as Administrator and ensure 'arduino-cli.exe' is on your PATH, or note the installation path and set PATH for this session."
        Write-Log "  3) Re-run this script or run the following from the script folder to install libraries and compile: `arduino-cli lib install TFT_eSPI Keypad TJpg_Decoder PNGdec XPT2046_Touchscreen ArduinoJson` then `arduino-cli compile --fqbn esp32:esp32:esp32 ..\esp32_oil_node.ino --verbose`"
        exit 1
    }
}

# Add cli path to PATH for this session
$cliBinDir = Split-Path $cliPath -Parent
if ($env:Path -notlike "*$cliBinDir*") { $env:Path = $env:Path + ";$cliBinDir" }
Write-Log "Using arduino-cli from: $cliPath"
& "$cliPath" version | Tee-Object -FilePath $compileLog -Append

# Step 2: install core and libs
Write-Log "Updating core index and installing esp32 core (may take a while)"
& "$cliPath" core update-index 2>&1 | Tee-Object -FilePath $compileLog -Append
& "$cliPath" core install esp32:esp32 2>&1 | Tee-Object -FilePath $compileLog -Append

$libs = @('TFT_eSPI','Keypad','TJpg_Decoder','PNGdec','XPT2046_Touchscreen','LittleFS','ArduinoJson')
Write-Log "Installing libraries: $($libs -join ', ')"
foreach ($lib in $libs) {
  Write-Log "Installing $lib..."
  try {
    & "$cliPath" lib install $lib 2>&1 | Tee-Object -FilePath $compileLog -Append
    if ($LASTEXITCODE -ne 0) { Write-Log "Warning: installing $lib returned exit code $LASTEXITCODE (see $compileLog); continuing." }
  } catch {
    Write-Log "Warning: failed to install $lib: $_. Continuing."
  }
} 

# Step 3: Compile sketch
Write-Log "Compiling sketch (this may take a minute)"
Push-Location $sketchDir
$rc = & "$cliPath" compile --fqbn esp32:esp32:esp32 $sketch --verbose 2>&1 | Tee-Object -FilePath $compileLog -Append
Pop-Location

# Step 4: Report result
if ($LASTEXITCODE -eq 0) {
  Write-Log "Compilation succeeded. See full log at $compileLog"
  exit 0
} else {
  Write-Log "Compilation FAILED. See full log at $compileLog"
  exit 2
}
