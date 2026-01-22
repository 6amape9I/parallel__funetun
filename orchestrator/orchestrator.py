from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from web3 import Web3
import json
import os

# Подключение к Ethereum‑узлу (Hardhat localhost)
w3 = Web3(Web3.HTTPProvider("http://127.0.0.1:8545"))
# Адрес и ABI контракта
CONTRACT_ADDRESS = os.environ.get("0x5fbdb2315678afecb367f032d93f642f64180aa3")
with open("artifacts/contracts/JobManager.sol/JobManager.json") as f:
    abi = json.load(f)["abi"]
job_manager = w3.eth.contract(address=CONTRACT_ADDRESS, abi=abi)

app = FastAPI()

# Простейшая модель задачи для тренера
class TaskRequest(BaseModel):
    trainer: str
    job_id: int

class UpdateReport(BaseModel):
    trainer: str
    job_id: int
    update_hash: str
    index: int

# Хранилище незавершённых задач (наивно)
pending_tasks = {}

@app.post("/get_task")
def get_task(req: TaskRequest):
    # выдаём фиктивный K и индекс даташарда
    task = {"steps": 10, "shard_id": 0}
    pending_tasks[req.trainer] = task
    return task

@app.post("/submit_update")
def submit_update(report: UpdateReport):
    # Отправляем транзакцию submitUpdate в контракт
    trainer_address = Web3.toChecksumAddress(report.trainer)
    tx = job_manager.functions.submitUpdate(
        report.job_id, Web3.keccak(text=report.update_hash)
    ).build_transaction({
        "from": trainer_address,
        "nonce": w3.eth.get_transaction_count(trainer_address),
        "gas": 500_000
    })
    # Здесь должен происходить процесс подписи транзакции приватным ключом тренера
    # Для примера считаем, что транзакция уже подписана (требуется доработка)
    return {"status": "submitted"}
