import argparse
import requests
from web3 import Web3
import torch
import torch.nn as nn
import hashlib
import json
import os

# Пример простой модели
class SimpleModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.layer = nn.Linear(784, 10)
    def forward(self, x):
        return self.layer(x)

def train_steps(model, data_loader, steps=10):
    model.train()
    optimizer = torch.optim.SGD(model.parameters(), lr=0.01)
    loss_fn = nn.CrossEntropyLoss()
    for i, (x, y) in enumerate(data_loader):
        if i >= steps:
            break
        pred = model(x.view(x.size(0), -1))
        loss = loss_fn(pred, y)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()

def compute_delta(old_state, new_state):
    delta = {}
    for k in old_state.keys():
        delta[k] = new_state[k] - old_state[k]
    # сериализуем дельту в строку для хэширования
    delta_bytes = b''.join([v.cpu().numpy().tobytes() for v in delta.values()])
    return hashlib.sha256(delta_bytes).hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", required=True)
    parser.add_argument("--job", type=int, required=True)
    parser.add_argument("--trainer", required=True)
    args = parser.parse_args()

    # Загружаем модель и данные (упрощённо)
    model = SimpleModel()
    dataset = torch.utils.data.TensorDataset(torch.randn(100, 1, 28, 28), torch.randint(0,10,(100,)))
    loader = torch.utils.data.DataLoader(dataset, batch_size=10)

    # Запрос задачи у оркестратора
    resp = requests.post(f"{args.registry}/get_task", json={"trainer": args.trainer, "job_id": args.job})
    task = resp.json()
    # Сохраняем старое состояние модели
    old_state = {k: v.clone() for k, v in model.state_dict().items()}
    # Выполняем обучение K шагов
    train_steps(model, loader, steps=task["steps"])
    # Вычисляем delta и хэш
    delta_hash = compute_delta(old_state, model.state_dict())
    # Отправляем хэш обновления в оркестратор/контракт
    requests.post(f"{args.registry}/submit_update",
                  json={"trainer": args.trainer, "job_id": args.job, "update_hash": delta_hash, "index": 0})
    print("Delta sent")

if __name__ == "__main__":
    main()
