// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract JobManager {
    struct Job {
        uint256 id;
        address owner;
        uint256 deposit;     // накопленные средства для выплат
        uint256 baseReward;  // фиксированная выплата за валидированное обновление
        uint256 bonusReward; // можно расширить для бонусов
        bool active;
    }

    uint256 public nextJobId;
    mapping(uint256 => Job) public jobs;

    mapping(address => bool) public trainers;
    mapping(address => bool) public validators;

    struct Update {
        address trainer;
        bytes32 hash;     // хэш delta-обновления
        bool validated;
        bool paid;
    }
    // jobId => список обновлений
    mapping(uint256 => Update[]) public jobUpdates;

    event JobCreated(uint256 indexed jobId, address indexed owner, uint256 deposit);
    event TrainerRegistered(address indexed trainer);
    event ValidatorRegistered(address indexed validator);
    event UpdateSubmitted(uint256 indexed jobId, address indexed trainer, bytes32 updateHash);
    event UpdateValidated(uint256 indexed jobId, address indexed trainer, bytes32 updateHash, bool valid);
    event Paid(uint256 indexed jobId, address indexed trainer, uint256 amount);

    // Создание задания: владелец отправляет депозит и задаёт размер награды
    function createJob(uint256 baseReward) external payable returns (uint256) {
        require(msg.value > baseReward, "Deposit must cover at least one reward");
        uint256 jobId = nextJobId++;
        jobs[jobId] = Job({
            id: jobId,
            owner: msg.sender,
            deposit: msg.value,
            baseReward: baseReward,
            bonusReward: 0,
            active: true
        });
        emit JobCreated(jobId, msg.sender, msg.value);
        return jobId;
    }

    // Регистрация участника в роли тренера
    function registerTrainer() external {
        trainers[msg.sender] = true;
        emit TrainerRegistered(msg.sender);
    }

    // Регистрация участника в роли валидатора
    function registerValidator() external {
        validators[msg.sender] = true;
        emit ValidatorRegistered(msg.sender);
    }

    // Отправка хэша обновления тренером
    function submitUpdate(uint256 jobId, bytes32 updateHash) external {
        require(trainers[msg.sender], "Not registered trainer");
        Job storage job = jobs[jobId];
        require(job.active, "Job not active");
        jobUpdates[jobId].push(Update({
            trainer: msg.sender,
            hash: updateHash,
            validated: false,
            paid: false
        }));
        emit UpdateSubmitted(jobId, msg.sender, updateHash);
    }

    // Валидация обновления валидатором; index – индекс апдейта в списке jobUpdates[jobId]
    function validateUpdate(uint256 jobId, uint256 index, bool valid) external {
        require(validators[msg.sender], "Not registered validator");
        Update storage update = jobUpdates[jobId][index];
        require(!update.validated, "Already validated");
        update.validated = true;
        emit UpdateValidated(jobId, update.trainer, update.hash, valid);
        if (valid) {
            _payout(jobId, index);
        }
    }

    // Внутренняя функция выплаты награды
    function _payout(uint256 jobId, uint256 index) internal {
        Update storage update = jobUpdates[jobId][index];
        require(update.validated, "Not validated");
        require(!update.paid, "Already paid");
        Job storage job = jobs[jobId];
        require(job.deposit >= job.baseReward, "Insufficient deposit");
        update.paid = true;
        job.deposit -= job.baseReward;
        payable(update.trainer).transfer(job.baseReward);
        emit Paid(jobId, update.trainer, job.baseReward);
    }

    // Вывод неиспользованных средств владельцем
    function withdrawUnusedFunds(uint256 jobId) external {
        Job storage job = jobs[jobId];
        require(msg.sender == job.owner, "Only job owner");
        require(job.active, "Job inactive");
        job.active = false;
        uint256 amount = job.deposit;
        job.deposit = 0;
        payable(job.owner).transfer(amount);
    }
}
