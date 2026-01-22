import argparse
import requests
from web3 import Web3

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", required=True)
    parser.add_argument("--job", type=int, required=True)
    parser.add_argument("--validator", required=True)
    args = parser.parse_args()

    # Пример: получаем список апдейтов и валидируем первую запись (индекс=0)
    # В реальном приложении оркестратор должен предоставить данные для проверки
    # Здесь логика проверки упрощена: всегда считаем обновление валидным
    job_id = args.job
    index = 0
    valid = True

    # Отправляем транзакцию validateUpdate в контракт
    # В этом примере отправка в контракт не реализована: требуется подключение к узлу и подпись транзакции
    try:
        requests.post(
            f"{args.registry}/submit_validation",
            json={
                "validator": args.validator,
                "job_id": job_id,
                "index": index,
                "valid": valid,
            },
            timeout=3,
        )
    except requests.RequestException:
        pass
    print(f"Validated update {index} for job {job_id}: {valid}")

if __name__ == "__main__":
    main()
