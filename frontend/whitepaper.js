// ===== Theme Management =====
const initTheme = () => {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
};

let currentTheme = initTheme();

const toggleTheme = () => {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);
  localStorage.setItem('theme', currentTheme);
};

document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

const WHITEPAPER_CONTENT = `# Белая книга: Parallel Funetun

> Версия: 0.1 (рабочая)  
> Дата: 2026-01-23  
> Репозиторий: \`parallel__funetun\`

## Аннотация

Parallel Funetun — прототип системы распределенного обучения нейросетей, где вычисления выполняются off-chain, а контроль целостности и выплаты фиксируются on-chain. Роли разделены на заказчика задания, тренеров (GPU‑участников), валидаторов и оркестратора. Смарт‑контракт управляет депозитами и выплатами, а оркестратор распределяет микрозадачи, собирает дельты и инициирует валидацию.

Документ стремится к математической строгости: вводятся определения, формулы для обновления параметров, модели агрегации и правила выплат.

## 1. Обозначения и базовые определения

- $\\mathcal{D}$ — исходный датасет, разбитый на шарды $\\{\\mathcal{D}_k\\}_{k=1}^K$.
- $\\theta \\in \\mathbb{R}^d$ — параметры модели.
- $\\ell(\\theta; x, y)$ — функция потерь.
- $\\nabla \\ell$ — градиент по $\\theta$.
- $t$ — индекс раунда глобального обучения.
- $i$ — индекс тренера.
- $\\Delta_i^{(t)}$ — дельта‑обновление от тренера $i$ на раунде $t$.
- $H(\\cdot)$ — криптографическая хэш‑функция (Keccak/SHA‑256).
- $B$ — депозит задания (в смарт‑контракте).
- $R$ — базовая награда за валидное обновление.

## 2. Роли и ответственность

1) **Заказчик (Job Owner):**  
   Создает задачу, вносит депозит $B$, получает итоговые веса модели.

2) **Тренер (Trainer):**  
   Выполняет локальные шаги обучения на шарде данных и отправляет дельту.

3) **Валидатор (Validator):**  
   Проверяет корректность обновления (повторным обучением или spot‑check).

4) **Оркестратор (Job Leader):**  
   Распределяет микрозадачи, агрегирует обновления, координирует валидацию.

## 3. Архитектура системы

### 3.1 Контекстная схема

\`\`\`plantuml
@startuml
actor "Job Owner" as Owner
actor "Trainer" as Trainer
actor "Validator" as Validator
rectangle "Orchestrator (Python + FastAPI)" as Orch
rectangle "JobManager (Solidity)" as Contract
database "Off-chain Data" as Data

Owner --> Contract : createJob() + deposit
Trainer --> Orch : get_task
Orch --> Trainer : task (steps, shard)
Trainer --> Orch : submit_update (delta, hash)
Orch --> Contract : submitUpdate(hash)
Validator --> Orch : validate_update
Orch --> Contract : validateUpdate()
Contract --> Trainer : payout()
@enduml
\`\`\`

### 3.2 Поток выполнения

\`\`\`plantuml
@startuml
participant Owner
participant Contract
participant Orchestrator
participant Trainer
participant Validator

Owner -> Contract : createJob(baseReward) + deposit
Contract --> Orchestrator : JobCreated
Trainer -> Orchestrator : get_task(job_id)
Orchestrator --> Trainer : task(steps, shard_id)
Trainer -> Orchestrator : submit_update(hash, metrics)
Orchestrator -> Contract : submitUpdate(job_id, hash)
Validator -> Orchestrator : validate_update(job_id, index)
Orchestrator -> Contract : validateUpdate(job_id, index, valid)
Contract --> Trainer : payout(baseReward)
@enduml
\`\`\`

## 4. Математическая модель обучения

### 4.1 Локальные шаги тренера

Тренер выполняет $S$ локальных шагов стохастического градиентного спуска:

$$\\theta_{i}^{(t, s+1)} = \\theta_{i}^{(t, s)} - \\eta \\nabla \\ell(\\theta_{i}^{(t, s)}; x_s, y_s), \\quad s=0,\\dots,S-1$$

Итоговая дельта:

$$\\Delta_i^{(t)} = \\theta_{i}^{(t, S)} - \\theta^{(t)}$$

Хэшируется и фиксируется on‑chain:

$$h_i^{(t)} = H(\\Delta_i^{(t)})$$

### 4.2 Агрегация обновлений

Пусть $\\mathcal{V}^{(t)}$ — множество валидных дельт раунда $t$.

**Среднее (mean):**

$$\\Delta^{(t)} = \\frac{1}{|\\mathcal{V}^{(t)}|} \\sum_{i \\in \\mathcal{V}^{(t)}} \\Delta_i^{(t)}$$

**Координатная медиана:**

$$\\Delta^{(t)}_j = \\operatorname{median}\\{\\Delta_{i,j}^{(t)}\\}$$

**Trimmed mean:**

$$\\Delta^{(t)}_j = \\frac{1}{|\\mathcal{V}^{(t)}|-2q} \\sum_{i \\in \\mathcal{V}^{(t)} \\setminus \\text{top/bottom }q} \\Delta_{i,j}^{(t)}$$

Глобальное обновление:

$$\\theta^{(t+1)} = \\theta^{(t)} + \\Delta^{(t)}$$

## 5. Модель валидации

Валидация трактуется как функция:

$$\\phi(\\Delta_i^{(t)}) \\in \\{0,1\\}$$

Если $\\phi=1$, обновление считается валидным и допускается к выплате.

Оркестратор может использовать:

- **Spot‑check:** сравнение метрик на подвыборке.
- **Повторное обучение:** запуск на том же шарде с теми же параметрами.

## 6. Экономическая модель

**Депозит:**  
Заказчик блокирует сумму $B$:

$$B \\ge R$$

**Выплата:**  
За каждое валидное обновление выплачивается $R$:

$$B \\leftarrow B - R$$

## 7. Ончейн‑контракт (JobManager)

### 7.1 Состояние

Контракт хранит:

- \`Job { id, owner, deposit, baseReward, bonusReward, active }\`
- \`trainers[address]\`, \`validators[address]\`
- \`jobUpdates[jobId] = { trainer, hash, validated, paid }\`

### 7.2 Функции

1) **createJob(baseReward)**  
   Вход: $R$, депозит $B=msg.value$  
   Предусловие: B > R \n
   Создает \`Job\`, эмитит \`JobCreated\`.

2) **registerTrainer / registerValidator**  
   Добавляет адрес в соответствующую роль.

3) **submitUpdate(jobId, updateHash)**  
   Предусловие: отправитель — зарегистрированный тренер, \`Job.active=true\`.  
   Добавляет \`Update\`.

4) **validateUpdate(jobId, index, valid)**  
   Предусловие: отправитель — валидатор, update не валидирован.  
   Если \`valid=true\`, вызывает выплату.

5) **_payout(jobId, index)**  
   Предусловие: \`validated=true\`, \`paid=false\`, депозит достаточен.  
   Переводит \`baseReward\` тренеру.

6) **withdrawUnusedFunds(jobId)**  
   Закрывает задачу, возвращает остаток депозита владельцу.

### 7.3 Диаграмма состояния задания

\`\`\`plantuml
@startuml
[*] --> Active : createJob
Active --> Active : submitUpdate
Active --> Active : validateUpdate(valid)
Active --> Closed : withdrawUnusedFunds
Active --> Closed : deposit exhausted
Closed --> [*]
@enduml
\`\`\`

## 8. Off‑chain протокол (API)

### 8.1 Оркестратор (FastAPI)

Доступные эндпоинты:

\`\`\`
POST /get_task
  Вход: { trainer, job_id }
  Выход: { steps, shard_id }

POST /submit_update
  Вход: { trainer, job_id, update_hash, index }
  Действие: фиксирует ребра графа

POST /submit_validation
  Вход: { validator, job_id, index, valid }
  Действие: фиксирует ребра графа

GET /graph
  Выход: { nodes, edges, updated_at }
\`\`\`

### 8.2 Формат графа

Узлы:
\`\`\`json
{ "id": "...", "label": "...", "type": "trainer|validator|orchestrator|contract", "last_seen": "..." }
\`\`\`

Ребра:
\`\`\`json
{ "id": "...", "source": "...", "target": "...", "label": "...", "count": 1, "last_seen": "..." }
\`\`\`

## 9. Безопасность и модель угроз

### 9.1 Угрозы

- **Вредоносные обновления:** обучающий может отправить дельту, ухудшающую модель.
- **Sybil‑атаки:** множественные псевдо‑узлы для захвата выплат.
- **Отказ оркестратора:** single‑point‑of‑failure в текущем прототипе.
- **Задержки сети:** при неполадках RPC узла транзакции зависают.

### 9.2 Митигирующие меры

- Валидация (spot‑check/повторное обучение).
- Устойчивые агрегации (median/trimmed mean).
- Ограничение частоты/лимитов ролей и депозитные требования.

## 10. Ограничения прототипа

- Контракт минимален (нет штрафов, слэшинга, DAO‑правил).
- Нет полноценной криптографической верификации вычислений.
- Оркестратор — централизованный компонент.
- Обновления не передаются on‑chain, только хэши.

## 11. Дорожная карта

- Токенизация стимулов (ERC‑20).
- NFT‑доли модели (ERC‑721/1155).
- DAO‑управление параметрами.
- IPFS/Arweave для хранения датасетов.
- ZK‑доказательства корректности вычислений.

## 12. Соответствие коду

| Компонент | Путь |
|-----------|------|
| Контракт | \`contracts/JobManager.sol\` |
| Оркестратор | \`orchestrator/orchestrator.py\` |
| Тренер | \`trainer/trainer.py\` |
| Валидатор | \`validator/validator.py\` |
| Скрипты деплоя | \`scripts/deploy.js\` |

## 13. Вывод

Parallel Funetun демонстрирует, как можно объединить off‑chain обучение и on‑chain учет. Математическая модель опирается на стандартные подходы federated learning, а контракт обеспечивает прозрачность выплат. Следующий шаг — расширить криптографическую верификацию и децентрализовать оркестрацию.
`;

const renderMath = (text) => {
  text = text.replace(/\$\$([^$]+)\$\$/g, (match, math) => {
    try {
      return '<div class="katex-display">' + katex.renderToString(math.trim(), {
        displayMode: true,
        throwOnError: false,
        trust: true
      }) + '</div>';
    } catch (e) {
      console.error('KaTeX error:', e);
      return match;
    }
  });

  text = text.replace(/\$([^$\n]+)\$/g, (match, math) => {
    try {
      return katex.renderToString(math.trim(), {
        displayMode: false,
        throwOnError: false,
        trust: true
      });
    } catch (e) {
      console.error('KaTeX error:', e);
      return match;
    }
  });

  return text;
};

const renderPlantUML = (code) => {
  if (typeof plantumlEncoder !== 'undefined') {
    try {
      const encoded = plantumlEncoder.encode(code);
      const url = `https://www.plantuml.com/plantuml/svg/${encoded}`;
      return `<div class="plantuml-container">
        <img src="${url}" alt="PlantUML Diagram" loading="lazy" />
      </div>`;
    } catch (e) {
      console.error('PlantUML encoding error:', e);
    }
  }
  
  return `<div class="plantuml-container">
    <div class="plantuml-placeholder">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8" cy="8" r="2"/>
        <path d="M21 15l-5-5L5 21"/>
      </svg>
      <p>PlantUML Diagram</p>
      <code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>
    </div>
  </div>`;
};

const processCodeBlocks = (html) => {
  html = html.replace(/<pre><code class="language-plantuml">([\s\S]*?)<\/code><\/pre>/g, (match, code) => {
    return renderPlantUML(decodeHTMLEntities(code));
  });

  html = html.replace(/<pre><code class="language-(\w+)">/g, '<pre data-lang="$1"><code class="language-$1">');

  return html;
};

const decodeHTMLEntities = (text) => {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
};

marked.setOptions({
  highlight: function(code, lang) {
    if (lang && typeof hljs !== 'undefined' && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch (e) {}
    }
    if (typeof hljs !== 'undefined') {
      return hljs.highlightAuto(code).value;
    }
    return code;
  },
  breaks: false,
  gfm: true
});

const renderWhitepaper = () => {
  const container = document.getElementById('whitepaper-content');
  if (!container) return;

  let html = marked.parse(WHITEPAPER_CONTENT);

  html = processCodeBlocks(html);

  html = renderMath(html);

  container.innerHTML = html;

  generateTOC();

  setupScrollSpy();

  addScrollProgress();

  addBackToTop();
};

const generateTOC = () => {
  const toc = document.getElementById('toc');
  const content = document.getElementById('whitepaper-content');
  if (!toc || !content) return;

  const headings = content.querySelectorAll('h2, h3');
  let tocHTML = '';

  headings.forEach((heading, index) => {
    const id = `section-${index}`;
    heading.id = id;

    const isH3 = heading.tagName === 'H3';
    const className = isH3 ? 'toc-h3' : 'toc-h2';

    tocHTML += `<a href="#${id}" class="${className}">${heading.textContent}</a>`;
  });

  toc.innerHTML = tocHTML;
};

const setupScrollSpy = () => {
  const tocLinks = document.querySelectorAll('.toc a');
  const headings = document.querySelectorAll('.whitepaper-content h2, .whitepaper-content h3');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        tocLinks.forEach(link => link.classList.remove('active'));
        const activeLink = document.querySelector(`.toc a[href="#${entry.target.id}"]`);
        if (activeLink) activeLink.classList.add('active');
      }
    });
  }, { rootMargin: '-100px 0px -66%' });

  headings.forEach(heading => observer.observe(heading));
};

const addScrollProgress = () => {
  const progress = document.createElement('div');
  progress.className = 'scroll-progress';
  document.body.appendChild(progress);

  window.addEventListener('scroll', () => {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const scrollPercent = (scrollTop / docHeight) * 100;
    progress.style.width = `${scrollPercent}%`;
  });
};

const addBackToTop = () => {
  const btn = document.createElement('button');
  btn.className = 'back-to-top';
  btn.setAttribute('aria-label', 'Back to top');
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M18 15l-6-6-6 6"/>
  </svg>`;
  document.body.appendChild(btn);

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  window.addEventListener('scroll', () => {
    if (window.scrollY > 500) {
      btn.classList.add('is-visible');
    } else {
      btn.classList.remove('is-visible');
    }
  });
};

const tocSidebar = document.getElementById('toc-sidebar');
const tocToggle = document.getElementById('toc-toggle');
const tocClose = document.getElementById('toc-close');

const tocOverlay = document.createElement('div');
tocOverlay.className = 'toc-overlay';
document.body.appendChild(tocOverlay);

const openTOC = () => {
  tocSidebar?.classList.add('is-open');
  tocOverlay.classList.add('is-visible');
  document.body.style.overflow = 'hidden';
};

const closeTOC = () => {
  tocSidebar?.classList.remove('is-open');
  tocOverlay.classList.remove('is-visible');
  document.body.style.overflow = '';
};

tocToggle?.addEventListener('click', openTOC);
tocClose?.addEventListener('click', closeTOC);
tocOverlay.addEventListener('click', closeTOC);

document.getElementById('toc')?.addEventListener('click', (e) => {
  if (e.target.tagName === 'A' && window.innerWidth < 1100) {
    closeTOC();
  }
});

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="#"]');
  if (link) {
    e.preventDefault();
    const target = document.querySelector(link.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
});

const init = () => {
  if (typeof marked === 'undefined' || typeof katex === 'undefined' || typeof plantumlEncoder === 'undefined') {
    setTimeout(init, 100);
    return;
  }
  renderWhitepaper();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
