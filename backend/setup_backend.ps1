$ErrorActionPreference = "Stop"

$BackendDir = $PSScriptRoot
$VenvDir = Join-Path $BackendDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"

if (-not (Test-Path -LiteralPath $VenvPython)) {
    $PythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $PythonCommand) {
        throw "Python was not found. Install Python 3.11 or newer, then run this script again."
    }
    & $PythonCommand.Source -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) { throw "Could not create the backend virtual environment." }
}

Write-Host "Installing backend requirements..."
& $VenvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Could not upgrade pip." }
& $VenvPython -m pip install -r (Join-Path $BackendDir "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Could not install backend requirements." }

function Test-TorchCuda {
    $Probe = "import torch; assert torch.cuda.is_available(); x=torch.ones((16,), device='cuda:0'); torch.cuda.synchronize(); print('CUDA ready:', torch.__version__, torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0))"
    & $VenvPython -c $Probe | Out-Host
    return $LASTEXITCODE -eq 0
}

function Install-TorchWheel([string[]]$Packages, [string]$IndexUrl) {
    & $VenvPython -m pip install --upgrade --force-reinstall @Packages --index-url $IndexUrl | Out-Host
    return $LASTEXITCODE -eq 0
}

$GpuInfo = $null
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    $GpuInfo = & nvidia-smi --query-gpu=name,compute_cap,driver_version --format=csv,noheader 2>$null | Select-Object -First 1
}

if ($GpuInfo) {
    $GpuFields = $GpuInfo -split ","
    $GpuName = $GpuFields[0].Trim()
    $ComputeCapability = [double]::Parse($GpuFields[1].Trim(), [Globalization.CultureInfo]::InvariantCulture)
    Write-Host "Detected $GpuName (compute capability $ComputeCapability; driver $($GpuFields[2].Trim()))."

    if (Test-TorchCuda) {
        Write-Host "The installed PyTorch already runs on this GPU; keeping it."
        exit 0
    }

    if ($ComputeCapability -lt 7.5) {
        Write-Host "This older GPU needs the legacy CUDA 12.6 PyTorch wheel."
        $Installed = Install-TorchWheel @("torch==2.14.1", "torchvision==0.29.1") "https://download.pytorch.org/whl/cu126"
    } else {
        Write-Host "Trying the current CUDA 13.2 PyTorch wheel."
        $Installed = Install-TorchWheel @("torch", "torchvision") "https://download.pytorch.org/whl/cu132"
        if ($Installed -and (Test-TorchCuda)) {
            Write-Host "CUDA-enabled PyTorch is ready."
            exit 0
        }

        Write-Host "CUDA 13.2 was not usable; trying the legacy CUDA 12.6 wheel."
        $Installed = Install-TorchWheel @("torch==2.14.1", "torchvision==0.29.1") "https://download.pytorch.org/whl/cu126"
    }

    if ($Installed -and (Test-TorchCuda)) {
        Write-Host "CUDA-enabled PyTorch is ready."
        exit 0
    }

    Write-Warning "No compatible CUDA wheel could run on this GPU/driver. Installing CPU PyTorch so the application remains usable."
} else {
    Write-Host "No NVIDIA GPU was detected through nvidia-smi; installing CPU PyTorch."
}

if (-not (Install-TorchWheel @("torch", "torchvision") "https://download.pytorch.org/whl/cpu")) {
    throw "Could not install CPU PyTorch. Check the Python version and network connection."
}

& $VenvPython -c "import torch; print('CPU PyTorch ready:', torch.__version__)"
if ($LASTEXITCODE -ne 0) { throw "PyTorch installation did not complete successfully." }
