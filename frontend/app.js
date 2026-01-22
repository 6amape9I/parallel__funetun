const mesh = document.getElementById("mesh");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const liveChain = document.getElementById("live-chain");
const liveBlock = document.getElementById("live-block");
const liveTime = document.getElementById("live-time");
const liveAccounts = document.getElementById("live-accounts");
const liveHint = document.getElementById("live-hint");
const graphCanvas = document.getElementById("graph-canvas");
const graphStatus = document.getElementById("graph-status");
const graphNodesCount = document.getElementById("graph-nodes");
const graphEdgesCount = document.getElementById("graph-edges");
const graphTooltip = document.getElementById("graph-tooltip");

const rpcUrl = "http://127.0.0.1:8545";
const rpcFetch = async (method, params = []) => {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });
  if (!res.ok) {
    throw new Error(`RPC ${method} failed`);
  }
  const payload = await res.json();
  if (payload.error) {
    throw new Error(payload.error.message || "RPC error");
  }
  return payload.result;
};

const updateLiveData = async () => {
  if (!liveChain || !liveBlock || !liveTime || !liveAccounts) return;
  try {
    const providers = [];
    if (window.ethereum && typeof window.ethereum.request === "function") {
      providers.push((method, params = []) =>
        window.ethereum.request({ method, params })
      );
    }
    providers.push(rpcFetch);

    let lastError = null;
    for (const provider of providers) {
      try {
        const [chainIdHex, blockHex, accounts] = await Promise.all([
          provider("eth_chainId"),
          provider("eth_blockNumber"),
          provider("eth_accounts"),
        ]);
        const blockNumber = parseInt(blockHex, 16);
        const block = await provider("eth_getBlockByNumber", ["latest", false]);
        const timestamp = block?.timestamp ? parseInt(block.timestamp, 16) : null;

        liveChain.textContent = chainIdHex;
        liveBlock.textContent = Number.isFinite(blockNumber)
          ? blockNumber.toString()
          : "—";
        liveTime.textContent = timestamp
          ? new Date(timestamp * 1000).toLocaleString("ru-RU")
          : "—";
        liveAccounts.textContent = Array.isArray(accounts)
          ? accounts.length.toString()
          : "—";

        if (liveHint) {
          liveHint.textContent = "Connected to local node or Web3 wallet.";
        }
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("No provider available");
  } catch (error) {
    if (liveChain) liveChain.textContent = "offline";
    if (liveHint) {
      liveHint.textContent =
        "Run `npx hardhat node` on `localhost:8545` to see on-chain metrics.";
    }
  }
};

const graphApiBase = window.location.hostname
  ? `http://${window.location.hostname}:8000`
  : "http://localhost:8000";

const graphFetch = async () => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  
  try {
    const res = await fetch(`${graphApiBase}/graph`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      throw new Error("Graph fetch failed");
    }
    return res.json();
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
};

const graphState = {
  nodes: new Map(),
  edges: [],
  width: 0,
  height: 0,
  jobState: null,
};

const graphColors = {
  orchestrator: "#1a232b",
  contract: "#ff6b35",
  trainer: "#2ec4b6",
  validator: "#ffc857",
  default: "#566372",
};

const statusColors = {
  active: "#2ec4b6",
  idle: "#566372",
  training: "#ff6b35",
  submitted: "#ffc857",
  validating: "#9b59b6",
  requesting: "#3498db",
};

const updateGraphData = async () => {
  if (!graphCanvas) return;
  try {
    const payload = await graphFetch();
    const incomingNodes = payload.nodes || [];
    const incomingEdges = payload.edges || [];
    graphState.jobState = payload.job_state || null;

    incomingNodes.forEach((node) => {
      if (!graphState.nodes.has(node.id)) {
        graphState.nodes.set(node.id, {
          ...node,
          x: Math.random() * graphState.width,
          y: Math.random() * graphState.height,
          vx: 0,
          vy: 0,
        });
      } else {
        const existing = graphState.nodes.get(node.id);
        Object.assign(existing, node);
      }
    });

    graphState.edges = incomingEdges;

    if (graphNodesCount) graphNodesCount.textContent = incomingNodes.length;
    if (graphEdgesCount) graphEdgesCount.textContent = incomingEdges.length;
    if (graphStatus) {
      graphStatus.textContent = "connected to orchestrator";
      graphStatus.style.color = "#2ec4b6";
    }
    
    updateJobStateDisplay();
    
  } catch (error) {
    if (graphStatus) {
      graphStatus.textContent = "no connection to orchestrator";
      graphStatus.style.color = "#ff6b35";
    }
  }
};

const updateJobStateDisplay = () => {
  const jobStateEl = document.getElementById("job-state");
  if (!jobStateEl || !graphState.jobState) return;
  
  const { current_epoch, total_epochs, updates_submitted, validations_completed, aggregations_done } = graphState.jobState;
  
  jobStateEl.innerHTML = `
    <div class="job-stat">
      <span class="job-label">Epoch:</span>
      <span class="job-value">${current_epoch} / ${total_epochs}</span>
    </div>
    <div class="job-stat">
      <span class="job-label">Updates:</span>
      <span class="job-value">${updates_submitted}</span>
    </div>
    <div class="job-stat">
      <span class="job-label">Validations:</span>
      <span class="job-value">${validations_completed}</span>
    </div>
    <div class="job-stat">
      <span class="job-label">Aggregations:</span>
      <span class="job-value">${aggregations_done}</span>
    </div>
  `;
};

const startGraph = () => {
  if (!graphCanvas) return;
  const ctx = graphCanvas.getContext("2d");
  let resizeTimer = null;
  let animationFrame = null;

  const resize = () => {
    const rect = graphCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    graphState.width = rect.width;
    graphState.height = rect.height;
    graphCanvas.width = rect.width * dpr;
    graphCanvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const applyForces = () => {
    const nodes = Array.from(graphState.nodes.values());
    const centerX = graphState.width / 2;
    const centerY = graphState.height / 2;
    const repulsion = 2500;
    const spring = 0.003;
    const damping = 0.85;

    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      
      const gravityStrength = (node.type === "orchestrator" || node.type === "contract") ? 0.002 : 0.0008;
      node.vx += (centerX - node.x) * gravityStrength;
      node.vy += (centerY - node.y) * gravityStrength;

      for (let j = i + 1; j < nodes.length; j += 1) {
        const other = nodes[j];
        const dx = node.x - other.x;
        const dy = node.y - other.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = repulsion / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        node.vx += fx;
        node.vy += fy;
        other.vx -= fx;
        other.vy -= fy;
      }
    }

    graphState.edges.forEach((edge) => {
      const source = graphState.nodes.get(edge.source);
      const target = graphState.nodes.get(edge.target);
      if (!source || !target) return;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const idealDist = 120;
      const force = (dist - idealDist) * spring;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    });

    nodes.forEach((node) => {
      if (reduceMotion) return;
      node.vx *= damping;
      node.vy *= damping;
      node.x += node.vx;
      node.y += node.vy;
      const margin = 40;
      node.x = Math.min(Math.max(margin, node.x), graphState.width - margin);
      node.y = Math.min(Math.max(margin, node.y), graphState.height - margin);
    });
  };

  const draw = () => {
    ctx.clearRect(0, 0, graphState.width, graphState.height);
    
    ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
    ctx.fillRect(0, 0, graphState.width, graphState.height);

    graphState.edges.forEach((edge) => {
      const source = graphState.nodes.get(edge.source);
      const target = graphState.nodes.get(edge.target);
      if (!source || !target) return;
      
      const intensity = Math.min(0.9, 0.15 + edge.count * 0.05);
      const lineWidth = Math.min(4, 1 + edge.count * 0.15);
      
      ctx.strokeStyle = `rgba(26, 35, 43, ${intensity})`;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      
      const angle = Math.atan2(target.y - source.y, target.x - source.x);
      const arrowLen = 8;
      const midX = (source.x + target.x) / 2;
      const midY = (source.y + target.y) / 2;
      
      ctx.fillStyle = `rgba(26, 35, 43, ${intensity})`;
      ctx.beginPath();
      ctx.moveTo(
        midX + arrowLen * Math.cos(angle),
        midY + arrowLen * Math.sin(angle)
      );
      ctx.lineTo(
        midX + arrowLen * Math.cos(angle + 2.5),
        midY + arrowLen * Math.sin(angle + 2.5)
      );
      ctx.lineTo(
        midX + arrowLen * Math.cos(angle - 2.5),
        midY + arrowLen * Math.sin(angle - 2.5)
      );
      ctx.closePath();
      ctx.fill();
      
      if (edge.count > 1) {
        ctx.fillStyle = "rgba(26, 35, 43, 0.6)";
        ctx.font = "10px Space Grotesk, sans-serif";
        ctx.fillText(`×${edge.count}`, midX + 5, midY - 5);
      }
    });

    Array.from(graphState.nodes.values()).forEach((node) => {
      const baseColor = graphColors[node.type] || graphColors.default;
      const statusColor = statusColors[node.status] || baseColor;
      
      let radius = 12;
      if (node.type === "orchestrator") radius = 18;
      if (node.type === "contract") radius = 15;
      
      if (node.status && node.status !== "idle" && node.status !== "active") {
        ctx.fillStyle = `${statusColor}40`;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 6, 0, Math.PI * 2);
        ctx.fill();
      }
      
      ctx.fillStyle = baseColor;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fill();
      
      if (node.status && node.status !== "active") {
        ctx.fillStyle = statusColor;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = "rgba(26, 35, 43, 0.85)";
      ctx.font = "12px Space Grotesk, sans-serif";
      const labelWidth = ctx.measureText(node.label).width;
      ctx.fillText(node.label, node.x - labelWidth / 2, node.y + radius + 14);
      
      if (node.status && node.status !== "active" && node.status !== "idle") {
        ctx.fillStyle = statusColor;
        ctx.font = "10px Space Grotesk, sans-serif";
        const statusWidth = ctx.measureText(node.status).width;
        ctx.fillText(node.status, node.x - statusWidth / 2, node.y + radius + 26);
      }
    });
  };

  const render = () => {
    applyForces();
    draw();
    if (!reduceMotion) {
      animationFrame = requestAnimationFrame(render);
    }
  };

  const handleMouseMove = (event) => {
    if (!graphTooltip) return;
    const rect = graphCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let closest = null;
    let minDist = 24;
    graphState.nodes.forEach((node) => {
      const dx = node.x - x;
      const dy = node.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        closest = node;
        minDist = dist;
      }
    });

    if (closest) {
      let tooltipText = closest.label;
      if (closest.status) {
        tooltipText += ` [${closest.status}]`;
      }
      graphTooltip.textContent = tooltipText;
      graphTooltip.style.left = `${x + 18}px`;
      graphTooltip.style.top = `${y - 6}px`;
      graphTooltip.classList.add("is-visible");
    } else {
      graphTooltip.classList.remove("is-visible");
    }
  };

  const handleMouseLeave = () => {
    if (graphTooltip) {
      graphTooltip.classList.remove("is-visible");
    }
  };

  graphCanvas.addEventListener("mousemove", handleMouseMove);
  graphCanvas.addEventListener("mouseleave", handleMouseLeave);

  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, 120);
  });

  resize();
  updateGraphData();
  if (!reduceMotion) {
    render();
  } else {
    applyForces();
    draw();
  }

  window.setInterval(updateGraphData, 2000);

  return () => {
    if (animationFrame) cancelAnimationFrame(animationFrame);
  };
};

const revealItems = document.querySelectorAll(".reveal");
if (revealItems.length) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2 }
  );
  revealItems.forEach((item) => observer.observe(item));
}

if (mesh) {
  const ctx = mesh.getContext("2d");
  let width = 0;
  let height = 0;
  let nodes = [];

  const resize = () => {
    const rect = mesh.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    width = rect.width;
    height = rect.height;
    mesh.width = width * dpr;
    mesh.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    createNodes();
    drawFrame();
  };

  const createNodes = () => {
    const count = Math.max(18, Math.min(46, Math.floor((width * height) / 15000)));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      radius: 1.5 + Math.random() * 2.2,
    }));
  };

  const drawFrame = () => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.fillRect(0, 0, width, height);

    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!reduceMotion) {
        node.x += node.vx;
        node.y += node.vy;
        if (node.x < 0 || node.x > width) node.vx *= -1;
        if (node.y < 0 || node.y > height) node.vy *= -1;
      }

      for (let j = i + 1; j < nodes.length; j += 1) {
        const other = nodes[j];
        const dx = node.x - other.x;
        const dy = node.y - other.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 130) {
          const alpha = 1 - dist / 130;
          ctx.strokeStyle = `rgba(46, 196, 182, ${alpha * 0.45})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(node.x, node.y);
          ctx.lineTo(other.x, other.y);
          ctx.stroke();
        }
      }
    }

    nodes.forEach((node) => {
      ctx.fillStyle = "rgba(26, 35, 43, 0.65)";
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  const animate = () => {
    drawFrame();
    if (!reduceMotion) {
      requestAnimationFrame(animate);
    }
  };

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, 120);
  });

  resize();
  if (!reduceMotion) {
    requestAnimationFrame(animate);
  }
}

updateLiveData();
startGraph();
