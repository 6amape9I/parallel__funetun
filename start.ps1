param(
    [switch]$Workers,
    [switch]$Docker,
    [switch]$SkipGeth,
    [switch]$Hardhat
)

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "Parallel Training - Launcher"

function Write-Status {
    param([string]$Message, [string]$Status = "INFO")
    $color = switch ($Status) {
        "OK"      { "Green" }
        "WARN"    { "Yellow" }
        "ERROR"   { "Red" }
        "WAIT"    { "Cyan" }
        default   { "White" }
    }
    $timestamp = Get-Date -Format "HH:mm:ss"
    Write-Host "[$timestamp] " -NoNewline -ForegroundColor DarkGray
    Write-Host "[$Status] " -NoNewline -ForegroundColor $color
    Write-Host $Message
}

function Start-Window {
    param(
        [string]$Title,
        [string]$Command,
        [string]$WorkDir = $PSScriptRoot
    )
    Write-Status "Starting: $Title" "INFO"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "& { `$Host.UI.RawUI.WindowTitle = '$Title'; $Command }" -WorkingDirectory $WorkDir
}

function Test-PortOpen {
    param([int]$Port, [int]$TimeoutMs = 1000)
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $result = $tcp.BeginConnect("127.0.0.1", $Port, $null, $null)
        $success = $result.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
        if ($success) {
            $tcp.EndConnect($result)
            $tcp.Close()
            return $true
        }
        $tcp.Close()
        return $false
    } catch {
        return $false
    }
}

function Wait-ForPort {
    param(
        [int]$Port,
        [string]$ServiceName,
        [int]$MaxWaitSeconds = 60
    )
    Write-Status "Waiting for $ServiceName on port $Port..." "WAIT"
    $elapsed = 0
    while ($elapsed -lt $MaxWaitSeconds) {
        if (Test-PortOpen -Port $Port) {
            Write-Status "$ServiceName is ready (port $Port)" "OK"
            return $true
        }
        Start-Sleep -Seconds 1
        $elapsed++
        if ($elapsed % 10 -eq 0) {
            Write-Status "Still waiting for $ServiceName... ($elapsed sec)" "WAIT"
        }
    }
    Write-Status "$ServiceName did not respond within $MaxWaitSeconds seconds" "ERROR"
    return $false
}

function Test-HttpEndpoint {
    param([string]$Url, [int]$TimeoutSec = 5)
    try {
        $response = Invoke-WebRequest -Uri $Url -Method GET -TimeoutSec $TimeoutSec -UseBasicParsing -ErrorAction Stop
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Wait-ForHttp {
    param(
        [string]$Url,
        [string]$ServiceName,
        [int]$MaxWaitSeconds = 60
    )
    Write-Status "Checking HTTP endpoint $ServiceName..." "WAIT"
    $elapsed = 0
    while ($elapsed -lt $MaxWaitSeconds) {
        if (Test-HttpEndpoint -Url $Url) {
            Write-Status "$ServiceName responding at $Url" "OK"
            return $true
        }
        Start-Sleep -Seconds 2
        $elapsed += 2
    }
    Write-Status "$ServiceName HTTP not ready: $Url" "WARN"
    return $false
}

# Configuration
$dataDir = "$env:USERPROFILE\.parallel_chain"
$web3Url = "http://127.0.0.1:8545"
$orchestratorUrl = "http://127.0.0.1:8000"
$jobManagerAddress = "0x5fbdb2315678afecb367f032d93f642f64180aa3"
$trainerAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
$validatorAddress = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Parallel Training System Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Docker mode
if ($Docker) {
    Write-Status "Docker Compose mode" "INFO"
    if ($Workers) {
        Write-Status "Starting with workers (trainer + validator)" "INFO"
        docker compose -f docker-compose.app.yml --profile workers up --build
    } else {
        Write-Status "Starting base services (geth + orchestrator + frontend)" "INFO"
        docker compose -f docker-compose.app.yml up --build
    }
    exit 0
}

# Local mode
Write-Status "Local startup mode" "INFO"
Write-Host ""

# 1. Ethereum node
if (-not $SkipGeth) {
    if ($Hardhat) {
        Write-Status "Starting Hardhat node..." "INFO"
        Start-Window "Hardhat Node" "npx hardhat node"
    } else {
        if (-not (Get-Command geth -ErrorAction SilentlyContinue)) {
            Write-Status "geth not found in PATH" "ERROR"
            Write-Host "  Install geth: https://geth.ethereum.org/downloads" -ForegroundColor Yellow
            Write-Host "  Or use -Hardhat to start Hardhat node" -ForegroundColor Yellow
            Write-Host "  Or -SkipGeth if node is already running" -ForegroundColor Yellow
            exit 1
        }
        
        Write-Status "Starting geth..." "INFO"
        $gethCmd = @(
            "geth",
            "--datadir `"$dataDir`"",
            "--http --http.addr 0.0.0.0 --http.port 8545",
            "--http.api eth,net,web3",
            "--http.corsdomain `"*`" --http.vhosts `"*`"",
            "--ws --ws.addr 0.0.0.0 --ws.port 8546",
            "--ws.api eth,net,web3"
        ) -join " "
        Start-Window "Geth Node" $gethCmd
    }
    
    if (-not (Wait-ForPort -Port 8545 -ServiceName "Ethereum Node" -MaxWaitSeconds 30)) {
        Write-Status "Failed to wait for Ethereum node" "ERROR"
        Write-Host "  Check logs in geth/hardhat window" -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Status "Skipping Ethereum node startup (-SkipGeth)" "WARN"
    if (-not (Test-PortOpen -Port 8545)) {
        Write-Status "Port 8545 not available, orchestrator will work in offline mode" "WARN"
    }
}

Write-Host ""

# 2. Orchestrator
Write-Status "Starting orchestrator..." "INFO"
$orchestratorCmd = @(
    "`$env:WEB3_PROVIDER_URL='$web3Url';",
    "`$env:JOB_MANAGER_ADDRESS='$jobManagerAddress';",
    "python -m uvicorn orchestrator.orchestrator:app --reload --port 8000 --host 0.0.0.0"
) -join " "
Start-Window "Orchestrator" $orchestratorCmd

if (-not (Wait-ForPort -Port 8000 -ServiceName "Orchestrator" -MaxWaitSeconds 30)) {
    Write-Status "Failed to wait for orchestrator" "ERROR"
    exit 1
}

Start-Sleep -Seconds 2
if (Wait-ForHttp -Url "$orchestratorUrl/health" -ServiceName "Orchestrator Health" -MaxWaitSeconds 15) {
    Write-Status "Orchestrator fully ready" "OK"
} else {
    Write-Status "Orchestrator started, but health check failed" "WARN"
}

Write-Host ""

# 3. Frontend
Write-Status "Starting frontend..." "INFO"
$frontendPath = Join-Path $PSScriptRoot "frontend"
Start-Window "Frontend" "python -m http.server 8080" -WorkDir $frontendPath

if (-not (Wait-ForPort -Port 8080 -ServiceName "Frontend" -MaxWaitSeconds 15)) {
    Write-Status "Frontend did not start" "WARN"
}

Write-Host ""

# 4. Workers (optional)
if ($Workers) {
    Write-Status "Starting workers..." "INFO"
    Write-Host ""
    
    $trainerCmd = "python trainer/trainer.py --registry $orchestratorUrl --job 0 --trainer $trainerAddress"
    Start-Window "Trainer" $trainerCmd
    Write-Status "Trainer started" "OK"
    
    Start-Sleep -Seconds 1
    
    $validatorCmd = "python validator/validator.py --registry $orchestratorUrl --job 0 --validator $validatorAddress"
    Start-Window "Validator" $validatorCmd
    Write-Status "Validator started" "OK"
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  System started!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Available URLs:" -ForegroundColor Cyan
Write-Host "  Frontend:     http://localhost:8080" -ForegroundColor White
Write-Host "  Orchestrator: http://localhost:8000" -ForegroundColor White
Write-Host "  Ethereum RPC: http://localhost:8545" -ForegroundColor White
Write-Host ""
Write-Host "API endpoints:" -ForegroundColor Cyan
Write-Host "  Health:  GET  $orchestratorUrl/health" -ForegroundColor White
Write-Host "  Status:  GET  $orchestratorUrl/status" -ForegroundColor White
Write-Host "  Graph:   GET  $orchestratorUrl/graph" -ForegroundColor White
Write-Host "  Simulate: GET  $orchestratorUrl/debug/simulate" -ForegroundColor White
Write-Host ""

# Quick check
Write-Status "Checking /graph endpoint..." "WAIT"
try {
    $response = Invoke-RestMethod -Uri "$orchestratorUrl/graph" -Method GET -TimeoutSec 5
    $nodesCount = $response.nodes.Count
    $edgesCount = $response.edges.Count
    Write-Status "/graph works: $nodesCount nodes, $edgesCount edges" "OK"
} catch {
    Write-Status "/graph not available: $($_.Exception.Message)" "WARN"
}

Write-Host ""
Write-Host "Press any key to exit launcher (services will continue running)..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
