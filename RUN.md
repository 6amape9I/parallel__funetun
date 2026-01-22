# Запуск проекта Parallel Training

## Быстрый старт

### Использование start.ps1

Скрипт `start.ps1` автоматически запускает все компоненты с проверкой готовности.

```powershell
# Базовый запуск (geth + orchestrator + frontend)
.\start.ps1

# С воркерами (trainer + validator)
.\start.ps1 -Workers

# С Hardhat вместо geth
.\start.ps1 -Hardhat

# Если Ethereum узел уже запущен
.\start.ps1 -SkipGeth

# Docker режим
.\start.ps1 -Docker
.\start.ps1 -Docker -Workers
```

### Что делает start.ps1

1. Запускает Ethereum узел (geth или hardhat)
2. Ждёт готовности узла (порт 8545)
3. Запускает оркестратор
4. Ждёт готовности оркестратора (health check)
5. Запускает фронтенд
6. Опционально запускает trainer и validator

## Компоненты

### Оркестратор

REST API для координации распределённого обучения.

**Endpoints:**

| Method | Path | Описание |
|--------|------|----------|
| GET | `/health` | Проверка здоровья |
| GET | `/status` | Полный статус системы |
| GET | `/graph` | Граф взаимодействий для визуализации |
| POST | `/get_task` | Запрос задачи тренером |
| POST | `/submit_update` | Отправка обновления |
| POST | `/submit_validation` | Результат валидации |
| POST | `/reconnect` | Переподключение к Web3 |
| GET | `/debug/simulate` | Симуляция активности (для тестирования) |
| GET | `/debug/graph/reset` | Сброс графа |

**Пример проверки:**

```powershell
# Health check
Invoke-RestMethod http://localhost:8000/health

# Статус системы
Invoke-RestMethod http://localhost:8000/status

# Граф
Invoke-RestMethod http://localhost:8000/graph

# Симуляция активности для тестирования графа
Invoke-RestMethod http://localhost:8000/debug/simulate
```

### Фронтенд

Статический сайт с визуализацией графа и метриками.

- URL: http://localhost:8080
- Граф обновляется каждые 4 секунды
- Показывает связи между оркестратором, контрактом, тренерами и валидаторами

## Ручной запуск

### 1. Ethereum узел

**Geth:**
```powershell
geth --datadir "$env:USERPROFILE\.parallel_chain" `
     --http --http.addr "0.0.0.0" --http.port "8545" `
     --http.api "eth,net,web3" `
     --http.corsdomain "*" --http.vhosts "*" `
     --ws --ws.addr "0.0.0.0" --ws.port "8546" `
     --ws.api "eth,net,web3"
```

**Hardhat (альтернатива):**
```powershell
npx hardhat node
```

### 2. Оркестратор

```powershell
$env:WEB3_PROVIDER_URL = "http://127.0.0.1:8545"
$env:JOB_MANAGER_ADDRESS = "0x5fbdb2315678afecb367f032d93f642f64180aa3"
python -m uvicorn orchestrator.orchestrator:app --reload --port 8000
```

### 3. Фронтенд

```powershell
cd frontend
python -m http.server 8080
```

### 4. Тренер (опционально)

```powershell
python trainer/trainer.py `
    --registry http://127.0.0.1:8000 `
    --job 0 `
    --trainer 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
```

### 5. Валидатор (опционально)

```powershell
python validator/validator.py `
    --registry http://127.0.0.1:8000 `
    --job 0 `
    --validator 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
```

## Docker

### Сборка образов

```powershell
docker build -f docker/Dockerfile.orchestrator -t parallel-orchestrator .
docker build -f docker/Dockerfile.trainer -t parallel-trainer .
docker build -f docker/Dockerfile.validator -t parallel-validator .
docker build -f docker/Dockerfile.frontend -t parallel-frontend .
```

### Docker Compose

```powershell
# Базовый запуск
docker compose -f docker-compose.app.yml up --build

# С воркерами
docker compose -f docker-compose.app.yml --profile workers up --build
```

## Troubleshooting

### /graph возвращает timeout

1. Проверьте, что оркестратор запущен:
   ```powershell
   Invoke-RestMethod http://localhost:8000/health
   ```

2. Проверьте логи оркестратора в его окне

3. Используйте `/debug/simulate` для тестирования графа без реальных воркеров

### Web3 не подключается

Оркестратор работает в offline режиме если Ethereum узел недоступен. Граф и базовые функции работают, но транзакции в контракт не отправляются.

Для переподключения:
```powershell
Invoke-RestMethod http://localhost:8000/reconnect -Method POST
```

### ABI не найден

Скомпилируйте контракты:
```powershell
npx hardhat compile
```

## Примечания

- Адрес контракта задаётся через `JOB_MANAGER_ADDRESS`
- Оркестратор читает ABI из `artifacts/contracts/JobManager.sol/JobManager.json`
- Если ABI не найден, on-chain функции недоступны, но REST API работает
