$ErrorActionPreference = "Stop"
# Create an isolated backend environment, then choose a PyTorch wheel that can actually run here.

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
    # Exercise both CUDA and cuDNN so a wheel is not accepted if model inference will fail later.
    # The first probe may run against a CPU-only wheel installed by requirements; that is expected.
    $Probe = @'
import sys
import torch

print("PyTorch:", torch.__version__, "CUDA wheel:", torch.version.cuda)
if not torch.cuda.is_available():
    print("CUDA is not available in this PyTorch build or with the installed NVIDIA driver.")
    sys.exit(2)

try:
    device = torch.device("cuda:0")
    sample = torch.ones((1, 3, 64, 64), device=device)
    convolution = torch.nn.Conv2d(3, 8, kernel_size=3, padding=1).to(device)
    output = convolution(sample)
    torch.cuda.synchronize(device)
    if not torch.isfinite(output).all().item():
        raise RuntimeError("CUDA/cuDNN convolution produced non-finite values.")
    print("CUDA and cuDNN ready:", torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0))
except Exception as error:
    print("CUDA/cuDNN probe failed:", repr(error))
    sys.exit(1)
'@
    & $VenvPython -c $Probe | Out-Host
    return $LASTEXITCODE -eq 0
}

function Install-TorchWheel([string[]]$Packages, [string]$IndexUrl) {
    # Force replacement so a failed CUDA probe cannot leave a partially compatible torch install behind.
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
