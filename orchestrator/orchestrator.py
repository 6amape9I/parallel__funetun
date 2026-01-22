"""
Orchestrator API for distributed training coordination.
"""

import json
import logging
import os
import random
import threading
import time
from datetime import datetime
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from web3 import Web3

# логгирование
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("orchestrator")

# конфиги. Мне стало впадлу их каждый раз вбивать при запуске
WEB3_PROVIDER_URL = os.environ.get("WEB3_PROVIDER_URL", "http://127.0.0.1:8545")
DEFAULT_JOB_MANAGER_ADDRESS = "0x5fbdb2315678afecb367f032d93f642f64180aa3"
CONTRACT_ADDRESS = os.environ.get("JOB_MANAGER_ADDRESS", DEFAULT_JOB_MANAGER_ADDRESS)
SIMULATION_ENABLED = os.environ.get("SIMULATION_ENABLED", "true").lower() == "true"
SIMULATION_INTERVAL = float(os.environ.get("SIMULATION_INTERVAL", "3"))

# Стейты
_web3: Optional[Web3] = None
_contract = None
_abi = None


def _load_abi() -> Optional[list]:
    """Load contract ABI from file."""
    abi_paths = [
        "artifacts/contracts/JobManager.sol/JobManager.json",
        "../artifacts/contracts/JobManager.sol/JobManager.json",
        "/app/artifacts/contracts/JobManager.sol/JobManager.json",
    ]
    for path in abi_paths:
        try:
            with open(path) as f:
                data = json.load(f)
                logger.info(f"ABI loaded from {path}")
                return data.get("abi")
        except FileNotFoundError:
            continue
        except json.JSONDecodeError as e:
            logger.warning(f"ABI parse error from {path}: {e}")
    logger.warning("Contract ABI not found, on-chain features disabled")
    return None


def get_web3() -> Optional[Web3]:
    """Get or create Web3 instance (lazy)."""
    global _web3
    if _web3 is None:
        try:
            _web3 = Web3(Web3.HTTPProvider(WEB3_PROVIDER_URL, request_kwargs={"timeout": 3}))
            if _web3.is_connected():
                logger.info(f"Web3 connected: {WEB3_PROVIDER_URL}")
            else:
                logger.warning("Web3 not connected")
                _web3 = None
        except Exception as e:
            logger.warning(f"Web3 init error: {e}")
            _web3 = None
    return _web3


def get_contract():
    """Get or create contract instance (lazy)."""
    global _contract, _abi
    if _contract is None:
        w3 = get_web3()
        if w3 is None:
            return None
        if _abi is None:
            _abi = _load_abi()
        if _abi is None:
            return None
        try:
            checksum = Web3.to_checksum_address(CONTRACT_ADDRESS)
            _contract = w3.eth.contract(address=checksum, abi=_abi)
            logger.info(f"Contract initialized: {checksum}")
        except Exception as e:
            logger.warning(f"Contract init error: {e}")
    return _contract


# инициализация графа
graph_nodes: dict = {}
graph_edges: dict = {}

ORCHESTRATOR_ID = "orchestrator"
CONTRACT_ID = "contract"

# стетйы
simulation_running = False
simulation_thread: Optional[threading.Thread] = None

# Симуляция воркеров
SIMULATED_TRAINERS = [
    {"address": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", "name": "Trainer-Alpha"},
    {"address": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", "name": "Trainer-Beta"},
    {"address": "0x90F79bf6EB2c4f870365E785982E1f101E93b906", "name": "Trainer-Gamma"},
    {"address": "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", "name": "Trainer-Delta"},
    {"address": "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc", "name": "Trainer-Epsilon"},
]

SIMULATED_VALIDATORS = [
    {"address": "0x976EA74026E726554dB657fA54763abd0C3a0aa9", "name": "Validator-Prime"},
    {"address": "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955", "name": "Validator-Secondary"},
    {"address": "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f", "name": "Validator-Tertiary"},
]

# стетйы для тренировки
job_state = {
    "current_epoch": 0,
    "total_epochs": 100,
    "updates_submitted": 0,
    "validations_completed": 0,
    "aggregations_done": 0,
}


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _short_addr(value: str) -> str:
    value = value or ""
    if len(value) < 12:
        return value
    return f"{value[:6]}...{value[-4:]}"


def _ensure_node(node_id: str, label: str, node_type: str):
    if node_id not in graph_nodes:
        graph_nodes[node_id] = {
            "id": node_id,
            "label": label,
            "type": node_type,
            "last_seen": _now_iso(),
            "status": "active",
        }
    else:
        graph_nodes[node_id]["last_seen"] = _now_iso()


def _update_node_status(node_id: str, status: str):
    if node_id in graph_nodes:
        graph_nodes[node_id]["status"] = status
        graph_nodes[node_id]["last_seen"] = _now_iso()


def _record_edge(source: str, target: str, label: str):
    key = f"{source}|{target}|{label}"
    if key not in graph_edges:
        graph_edges[key] = {
            "id": key,
            "source": source,
            "target": target,
            "label": label,
            "count": 1,
            "last_seen": _now_iso(),
        }
    else:
        graph_edges[key]["count"] += 1
        graph_edges[key]["last_seen"] = _now_iso()


_ensure_node(ORCHESTRATOR_ID, "Orchestrator", "orchestrator")
_ensure_node(
    CONTRACT_ID,
    f"JobManager {_short_addr(CONTRACT_ADDRESS)}" if CONTRACT_ADDRESS else "JobManager (not set)",
    "contract",
)


def _simulate_training_round():
    """Simulate one round of distributed training."""
    global job_state
    
    job_state["current_epoch"] += 1
    epoch = job_state["current_epoch"]
    
    # выборка рандомного активного тренера
    active_trainers = random.sample(SIMULATED_TRAINERS, k=random.randint(2, min(4, len(SIMULATED_TRAINERS))))
    
    for trainer in active_trainers:
        trainer_id = f"trainer:{trainer['address'].lower()}"
        _ensure_node(trainer_id, trainer["name"], "trainer")
        
        # получает задачу
        _record_edge(trainer_id, ORCHESTRATOR_ID, "request_task")
        _update_node_status(trainer_id, "requesting")
    
    time.sleep(0.3)
    
    for trainer in active_trainers:
        trainer_id = f"trainer:{trainer['address'].lower()}"
        
        # Оркестратор назначает задачу
        _record_edge(ORCHESTRATOR_ID, trainer_id, "assign_task")
        _update_node_status(trainer_id, "training")
    
    time.sleep(0.5)
    
    # Трейнер обновляет задачу
    for trainer in active_trainers:
        trainer_id = f"trainer:{trainer['address'].lower()}"
        
        _record_edge(trainer_id, ORCHESTRATOR_ID, "submit_update")
        _update_node_status(trainer_id, "submitted")
        job_state["updates_submitted"] += 1
    
    time.sleep(0.3)
    
    # Выбор валидатора
    active_validators = random.sample(SIMULATED_VALIDATORS, k=random.randint(1, min(2, len(SIMULATED_VALIDATORS))))
    
    for validator in active_validators:
        validator_id = f"validator:{validator['address'].lower()}"
        _ensure_node(validator_id, validator["name"], "validator")
        
        # Валидатор валидирует
        _record_edge(validator_id, ORCHESTRATOR_ID, "validate_update")
        _update_node_status(validator_id, "validating")
        job_state["validations_completed"] += 1
    
    time.sleep(0.3)
    
    # Оркестратор публикует контракт
    _record_edge(ORCHESTRATOR_ID, CONTRACT_ID, "submit_aggregated")
    job_state["aggregations_done"] += 1
    
    # Контракт возвращается, да я знаю что не так как надо но сойдёт
    if random.random() > 0.3:
        _record_edge(CONTRACT_ID, ORCHESTRATOR_ID, "epoch_complete")
    
    # рестарт статусов
    for trainer in active_trainers:
        trainer_id = f"trainer:{trainer['address'].lower()}"
        _update_node_status(trainer_id, "idle")
    
    for validator in active_validators:
        validator_id = f"validator:{validator['address'].lower()}"
        _update_node_status(validator_id, "idle")
    
    logger.info(f"Simulation: Epoch {epoch} complete - {len(active_trainers)} trainers, {len(active_validators)} validators")


def _simulation_loop():
    global simulation_running
    logger.info("Simulation loop started")
    
    while simulation_running:
        try:
            _simulate_training_round()
            # Интервал между раундами
            sleep_time = SIMULATION_INTERVAL + random.uniform(-1, 2)
            time.sleep(max(1, sleep_time))
        except Exception as e:
            logger.error(f"Simulation error: {e}")
            time.sleep(5)
    
    logger.info("Simulation loop stopped")


def start_simulation():
    global simulation_running, simulation_thread
    
    if simulation_running:
        return False
    
    simulation_running = True
    simulation_thread = threading.Thread(target=_simulation_loop, daemon=True)
    simulation_thread.start()
    logger.info("Simulation started")
    return True


def stop_simulation():
    global simulation_running
    simulation_running = False
    logger.info("Simulation stopped")
    return True


# Pydantic models
class TaskRequest(BaseModel):
    trainer: str
    job_id: int

class UpdateReport(BaseModel):
    trainer: str
    job_id: int
    update_hash: str
    index: int


class ValidationReport(BaseModel):
    validator: str
    job_id: int
    index: int
    valid: bool


pending_tasks: dict = {}


# FastAPI app
app = FastAPI(
    title="Parallel Training Orchestrator",
    description="API for distributed training coordination",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_event():
    logger.info("=" * 50)
    logger.info("Orchestrator starting...")
    logger.info(f"WEB3_PROVIDER_URL: {WEB3_PROVIDER_URL}")
    logger.info(f"CONTRACT_ADDRESS: {CONTRACT_ADDRESS}")
    logger.info(f"SIMULATION_ENABLED: {SIMULATION_ENABLED}")
    logger.info("Orchestrator ready")
    logger.info("=" * 50)
    
    if SIMULATION_ENABLED:
        start_simulation()


@app.on_event("shutdown")
def shutdown_event():
    stop_simulation()
    logger.info("Orchestrator shutdown complete")


# API статусов

@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {"status": "ok", "timestamp": _now_iso()}


@app.get("/status")
def get_status():
    """Full orchestrator status."""
    w3 = get_web3()
    return {
        "orchestrator": "running",
        "timestamp": _now_iso(),
        "web3_connected": w3 is not None and w3.is_connected() if w3 else False,
        "contract_ready": get_contract() is not None,
        "provider_url": WEB3_PROVIDER_URL,
        "contract_address": CONTRACT_ADDRESS,
        "simulation": {
            "enabled": SIMULATION_ENABLED,
            "running": simulation_running,
            "job_state": job_state,
        },
        "graph": {
            "nodes_count": len(graph_nodes),
            "edges_count": len(graph_edges),
        },
        "pending_tasks": len(pending_tasks),
    }




@app.get("/graph")
def get_graph():
    """Return interaction graph for visualization."""
    return {
        "nodes": list(graph_nodes.values()),
        "edges": list(graph_edges.values()),
        "updated_at": _now_iso(),
        "job_state": job_state,
    }




@app.post("/simulation/start")
def api_start_simulation():
    """Start background simulation."""
    success = start_simulation()
    return {
        "status": "started" if success else "already_running",
        "running": simulation_running,
    }


@app.post("/simulation/stop")
def api_stop_simulation():
    """Stop background simulation."""
    success = stop_simulation()
    return {
        "status": "stopped" if success else "already_stopped",
        "running": simulation_running,
    }


@app.post("/simulation/step")
def simulation_step():
    """Execute one simulation step manually."""
    if simulation_running:
        return {"status": "error", "message": "Stop auto-simulation first"}
    
    _simulate_training_round()
    return {
        "status": "ok",
        "job_state": job_state,
        "nodes": len(graph_nodes),
        "edges": len(graph_edges),
    }




@app.post("/get_task")
def get_task(req: TaskRequest):
    """Assign task to trainer."""
    trainer_id = f"trainer:{req.trainer.lower()}"
    _ensure_node(trainer_id, f"Trainer {_short_addr(req.trainer)}", "trainer")
    _record_edge(trainer_id, ORCHESTRATOR_ID, "request_task")
    _record_edge(ORCHESTRATOR_ID, trainer_id, "assign_task")

    task = {"steps": 10, "shard_id": 0, "job_id": req.job_id}
    pending_tasks[req.trainer] = task

    logger.info(f"Task assigned to trainer {_short_addr(req.trainer)}")
    return task


@app.post("/submit_update")
def submit_update(report: UpdateReport):
    """Receive update from trainer."""
    trainer_id = f"trainer:{report.trainer.lower()}"
    _ensure_node(trainer_id, f"Trainer {_short_addr(report.trainer)}", "trainer")
    _record_edge(trainer_id, ORCHESTRATOR_ID, "submit_update")
    _record_edge(ORCHESTRATOR_ID, CONTRACT_ID, "submit_update")

    logger.info(f"Update from {_short_addr(report.trainer)}: hash={report.update_hash[:16]}...")

    contract = get_contract()
    if contract is None:
        return {
            "status": "pending",
            "reason": "contract_not_ready",
            "message": "Update accepted, will be submitted to contract later",
        }

    try:
        w3 = get_web3()
        trainer_address = Web3.to_checksum_address(report.trainer)
        update_hash = Web3.keccak(text=report.update_hash)

        tx = contract.functions.submitUpdate(
            report.job_id, update_hash
        ).build_transaction({
            "from": trainer_address,
            "nonce": w3.eth.get_transaction_count(trainer_address),
            "gas": 500_000,
        })

        return {
            "status": "prepared",
            "transaction": {
                "to": tx.get("to"),
                "gas": tx.get("gas"),
                "nonce": tx.get("nonce"),
            },
            "message": "Transaction prepared, signature required",
        }
    except Exception as e:
        logger.error(f"Contract error: {e}")
        return {"status": "error", "reason": str(e)}


@app.post("/submit_validation")
def submit_validation(report: ValidationReport):
    """Receive validation result."""
    validator_id = f"validator:{report.validator.lower()}"
    _ensure_node(validator_id, f"Validator {_short_addr(report.validator)}", "validator")
    _record_edge(validator_id, ORCHESTRATOR_ID, "validate_update")
    _record_edge(ORCHESTRATOR_ID, CONTRACT_ID, "validate_update")

    logger.info(f"Validation from {_short_addr(report.validator)}: job={report.job_id}, valid={report.valid}")

    return {
        "status": "received",
        "job_id": report.job_id,
        "index": report.index,
        "valid": report.valid,
    }



@app.get("/debug/graph/reset")
def reset_graph():
    """Reset graph (for debugging)."""
    global job_state
    graph_nodes.clear()
    graph_edges.clear()
    job_state = {
        "current_epoch": 0,
        "total_epochs": 100,
        "updates_submitted": 0,
        "validations_completed": 0,
        "aggregations_done": 0,
    }
    _ensure_node(ORCHESTRATOR_ID, "Orchestrator", "orchestrator")
    _ensure_node(CONTRACT_ID, f"JobManager {_short_addr(CONTRACT_ADDRESS)}", "contract")
    logger.info("Graph reset")
    return {"status": "reset", "timestamp": _now_iso()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
