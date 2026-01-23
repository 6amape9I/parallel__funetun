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
  
  // Update graph colors
  updateGraphColors();
};

// Theme toggle button
document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const mesh = document.getElementById("mesh");
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

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

const rpcUrl = "http://127.0.0.1:8545";
const rpcFetch = async (method, params = []) => {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} failed`);
  const payload = await res.json();
  if (payload.error) throw new Error(payload.error.message || "RPC error");
  return payload.result;
};

const updateLiveData = async () => {
  if (!liveChain || !liveBlock || !liveTime || !liveAccounts) return;
  try {
    const providers = [];
    if (window.ethereum && typeof window.ethereum.request === "function") {
      providers.push((method, params = []) => window.ethereum.request({ method, params }));
    }
    providers.push(rpcFetch);

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

        animateValue(liveChain, chainIdHex);
        animateValue(liveBlock, Number.isFinite(blockNumber) ? blockNumber.toString() : "—");
        animateValue(liveTime, timestamp ? new Date(timestamp * 1000).toLocaleString("ru-RU") : "—");
        animateValue(liveAccounts, Array.isArray(accounts) ? accounts.length.toString() : "—");

        if (liveHint) liveHint.textContent = "Connected to local node";
        return;
      } catch (error) {
        continue;
      }
    }
    throw new Error("No provider");
  } catch (error) {
    if (liveChain) animateValue(liveChain, "offline");
    if (liveHint) liveHint.textContent = "Run `npx hardhat node` on localhost:8545";
  }
};

function animateValue(element, newValue) {
  if (element.textContent === newValue) return;
  element.style.transform = 'translateY(-10px)';
  element.style.opacity = '0';
  setTimeout(() => {
    element.textContent = newValue;
    element.style.transform = 'translateY(10px)';
    setTimeout(() => {
      element.style.transform = 'translateY(0)';
      element.style.opacity = '1';
    }, 50);
  }, 150);
}

const graphApiBase = window.location.hostname
  ? `http://${window.location.hostname}:8000`
  : "http://localhost:8000";

const graphFetch = async () => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${graphApiBase}/graph`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error("Graph fetch failed");
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
  mouseX: 0,
  mouseY: 0,
  hoveredNode: null,
};

const getGraphColors = () => {
  const isDark = currentTheme === 'dark';
  return {
    orchestrator: { 
      fill: isDark ? "#ffffff" : "#1a232b", 
      glow: isDark ? "rgba(255, 255, 255, 0.4)" : "rgba(26, 35, 43, 0.3)" 
    },
    contract: { 
      fill: isDark ? "#f472b6" : "#ff6b35", 
      glow: isDark ? "rgba(244, 114, 182, 0.5)" : "rgba(255, 107, 53, 0.4)" 
    },
    trainer: { 
      fill: isDark ? "#22d3ee" : "#2ec4b6", 
      glow: isDark ? "rgba(34, 211, 238, 0.5)" : "rgba(46, 196, 182, 0.4)" 
    },
    validator: { 
      fill: isDark ? "#fbbf24" : "#ffc857", 
      glow: isDark ? "rgba(251, 191, 36, 0.5)" : "rgba(255, 200, 87, 0.4)" 
    },
    default: { 
      fill: isDark ? "#94a3b8" : "#566372", 
      glow: isDark ? "rgba(148, 163, 184, 0.3)" : "rgba(86, 99, 114, 0.3)" 
    },
    edge: {
      color1: isDark ? "rgba(99, 102, 241, 0.5)" : "rgba(99, 102, 241, 0.4)",
      color2: isDark ? "rgba(34, 211, 238, 0.6)" : "rgba(46, 196, 182, 0.5)",
      color3: isDark ? "rgba(244, 114, 182, 0.5)" : "rgba(255, 107, 53, 0.4)",
      particle: isDark ? "rgba(34, 211, 238, 0.8)" : "rgba(46, 196, 182, 0.8)",
    },
    text: isDark ? "rgba(255, 255, 255, 0.9)" : "rgba(26, 35, 43, 0.9)",
    textMuted: isDark ? "rgba(255, 255, 255, 0.5)" : "rgba(26, 35, 43, 0.5)",
    background: {
      gradient1: isDark ? "rgba(99, 102, 241, 0.03)" : "rgba(99, 102, 241, 0.05)",
      gradient2: isDark ? "rgba(34, 211, 238, 0.02)" : "rgba(46, 196, 182, 0.04)",
    }
  };
};

let graphColors = getGraphColors();

const updateGraphColors = () => {
  graphColors = getGraphColors();
};

const statusColors = {
  active: "#22d3ee",
  idle: "#64748b",
  training: "#f472b6",
  submitted: "#a78bfa",
  validating: "#fbbf24",
  requesting: "#6366f1",
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
        const angle = Math.random() * Math.PI * 2;
        const radius = 100 + Math.random() * 100;
        graphState.nodes.set(node.id, {
          ...node,
          x: graphState.width / 2 + Math.cos(angle) * radius,
          y: graphState.height / 2 + Math.sin(angle) * radius,
          vx: 0,
          vy: 0,
          targetX: null,
          targetY: null,
          pulsePhase: Math.random() * Math.PI * 2,
        });
      } else {
        const existing = graphState.nodes.get(node.id);
        Object.assign(existing, node);
      }
    });

    graphState.edges = incomingEdges;

    if (graphNodesCount) {
      animateValue(graphNodesCount, incomingNodes.length.toString());
    }
    if (graphEdgesCount) {
      animateValue(graphEdgesCount, incomingEdges.length.toString());
    }
    if (graphStatus) {
      graphStatus.textContent = "connected";
      graphStatus.style.color = currentTheme === 'dark' ? "#22d3ee" : "#0d9488";
    }

    updateJobStateDisplay();
  } catch (error) {
    if (graphStatus) {
      graphStatus.textContent = "disconnected";
      graphStatus.style.color = currentTheme === 'dark' ? "#f472b6" : "#ec4899";
    }
  }
};

const updateJobStateDisplay = () => {
  const jobStateEl = document.getElementById("job-state");
  if (!jobStateEl || !graphState.jobState) return;

  const { current_epoch, total_epochs, updates_submitted, validations_completed, aggregations_done } = graphState.jobState;

  jobStateEl.innerHTML = `
    <div class="job-stat">
      <span class="job-label">Epoch</span>
      <span class="job-value">${current_epoch} / ${total_epochs}</span>
    </div>
    <div class="job-stat">
      <span class="job-label">Updates</span>
      <span class="job-value">${updates_submitted}</span>
    </div>
    <div class="job-stat">
      <span class="job-label">Validations</span>
      <span class="job-value">${validations_completed}</span>
    </div>
    <div class="job-stat">
      <span class="job-label">Aggregations</span>
      <span class="job-value">${aggregations_done}</span>
    </div>
  `;
};

const startGraph = () => {
  if (!graphCanvas) return;
  const ctx = graphCanvas.getContext("2d");
  let resizeTimer = null;
  let animationFrame = null;
  let time = 0;

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
    const repulsion = 3000;
    const spring = 0.004;
    const damping = 0.88;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const gravityStrength = (node.type === "orchestrator" || node.type === "contract") ? 0.003 : 0.001;
      node.vx += (centerX - node.x) * gravityStrength;
      node.vy += (centerY - node.y) * gravityStrength;

      for (let j = i + 1; j < nodes.length; j++) {
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
      const idealDist = 140;
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
      const margin = 50;
      node.x = Math.min(Math.max(margin, node.x), graphState.width - margin);
      node.y = Math.min(Math.max(margin, node.y), graphState.height - margin);
    });
  };

  const draw = () => {
    time += 0.016;
    const colors = graphColors;
    
    ctx.clearRect(0, 0, graphState.width, graphState.height);

    const bgGradient = ctx.createRadialGradient(
      graphState.width / 2, graphState.height / 2, 0,
      graphState.width / 2, graphState.height / 2, graphState.width * 0.7
    );
    bgGradient.addColorStop(0, colors.background.gradient1);
    bgGradient.addColorStop(0.5, colors.background.gradient2);
    bgGradient.addColorStop(1, "transparent");
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, graphState.width, graphState.height);

    graphState.edges.forEach((edge) => {
      const source = graphState.nodes.get(edge.source);
      const target = graphState.nodes.get(edge.target);
      if (!source || !target) return;

      const intensity = Math.min(0.8, 0.2 + edge.count * 0.08);
      const lineWidth = Math.min(3, 1 + edge.count * 0.2);

      const gradient = ctx.createLinearGradient(source.x, source.y, target.x, target.y);
      const pulse = (Math.sin(time * 2 + edge.count) + 1) / 2;
      gradient.addColorStop(0, colors.edge.color1);
      gradient.addColorStop(0.5, colors.edge.color2.replace('0.6', `${0.4 + pulse * 0.3}`));
      gradient.addColorStop(1, colors.edge.color3);

      ctx.strokeStyle = gradient;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "round";

      ctx.beginPath();
      const midX = (source.x + target.x) / 2;
      const midY = (source.y + target.y) / 2;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const ctrlX = midX - dy * 0.1;
      const ctrlY = midY + dx * 0.1;
      
      ctx.moveTo(source.x, source.y);
      ctx.quadraticCurveTo(ctrlX, ctrlY, target.x, target.y);
      ctx.stroke();

      if (!reduceMotion) {
        const particleT = ((time * 0.5 + edge.count * 0.3) % 1);
        const t = particleT;
        const px = (1 - t) * (1 - t) * source.x + 2 * (1 - t) * t * ctrlX + t * t * target.x;
        const py = (1 - t) * (1 - t) * source.y + 2 * (1 - t) * t * ctrlY + t * t * target.y;
        
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fillStyle = colors.edge.particle.replace('0.8', `${0.8 * (1 - Math.abs(t - 0.5) * 2)}`);
        ctx.fill();
      }

      if (edge.count > 1) {
        ctx.font = "600 10px 'Space Grotesk', sans-serif";
        ctx.fillStyle = colors.textMuted;
        ctx.fillText(`×${edge.count}`, midX + 8, midY - 8);
      }
    });

    Array.from(graphState.nodes.values()).forEach((node) => {
      const nodeColors = colors[node.type] || colors.default;
      const statusColor = statusColors[node.status] || nodeColors.fill;
      const isHovered = graphState.hoveredNode === node.id;

      let baseRadius = 14;
      if (node.type === "orchestrator") baseRadius = 22;
      if (node.type === "contract") baseRadius = 18;

      const pulseScale = 1 + Math.sin(time * 2 + node.pulsePhase) * 0.05;
      const radius = baseRadius * (isHovered ? 1.2 : pulseScale);

      const glowGradient = ctx.createRadialGradient(
        node.x, node.y, radius * 0.5,
        node.x, node.y, radius * 3
      );
      glowGradient.addColorStop(0, nodeColors.glow);
      glowGradient.addColorStop(1, "transparent");
      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius * 3, 0, Math.PI * 2);
      ctx.fill();

      if (node.status && node.status !== "idle" && node.status !== "active") {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 6, 0, Math.PI * 2);
        ctx.strokeStyle = statusColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -time * 20;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const nodeGradient = ctx.createRadialGradient(
        node.x - radius * 0.3, node.y - radius * 0.3, 0,
        node.x, node.y, radius
      );
      nodeGradient.addColorStop(0, nodeColors.fill);
      nodeGradient.addColorStop(1, shadeColor(nodeColors.fill, -30));
      
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = nodeGradient;
      ctx.fill();

      // Inner highlight
      ctx.beginPath();
      ctx.arc(node.x - radius * 0.25, node.y - radius * 0.25, radius * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = isHovered 
        ? (currentTheme === 'dark' ? "rgba(255, 255, 255, 0.8)" : "rgba(26, 35, 43, 0.8)")
        : (currentTheme === 'dark' ? "rgba(255, 255, 255, 0.2)" : "rgba(26, 35, 43, 0.2)");
      ctx.lineWidth = isHovered ? 2 : 1;
      ctx.stroke();

      ctx.font = "500 12px 'Space Grotesk', sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = colors.text;
      ctx.fillText(node.label, node.x, node.y + radius + 18);

      if (node.status && node.status !== "active" && node.status !== "idle") {
        ctx.font = "500 10px 'Space Grotesk', sans-serif";
        ctx.fillStyle = statusColor;
        ctx.fillText(node.status, node.x, node.y + radius + 32);
      }
    });
  };

  function shadeColor(color, percent) {
    const num = parseInt(color.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return "#" + (0x1000000 + 
      (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 + 
      (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 + 
      (B < 255 ? B < 1 ? 0 : B : 255)
    ).toString(16).slice(1);
  }

  const render = () => {
    applyForces();
    draw();
    if (!reduceMotion) {
      animationFrame = requestAnimationFrame(render);
    }
  };

  const handleMouseMove = (event) => {
    const rect = graphCanvas.getBoundingClientRect();
    graphState.mouseX = event.clientX - rect.left;
    graphState.mouseY = event.clientY - rect.top;

    let closest = null;
    let minDist = 30;
    graphState.nodes.forEach((node, id) => {
      const dx = node.x - graphState.mouseX;
      const dy = node.y - graphState.mouseY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        closest = id;
        minDist = dist;
      }
    });

    graphState.hoveredNode = closest;

    if (graphTooltip) {
      if (closest) {
        const node = graphState.nodes.get(closest);
        let tooltipText = node.label;
        if (node.status && node.status !== "active") {
          tooltipText += ` [${node.status}]`;
        }
        graphTooltip.textContent = tooltipText;
        graphTooltip.style.left = `${graphState.mouseX + 16}px`;
        graphTooltip.style.top = `${graphState.mouseY - 8}px`;
        graphTooltip.classList.add("is-visible");
      } else {
        graphTooltip.classList.remove("is-visible");
      }
    }
  };

  const handleMouseLeave = () => {
    graphState.hoveredNode = null;
    if (graphTooltip) graphTooltip.classList.remove("is-visible");
  };

  graphCanvas.addEventListener("mousemove", handleMouseMove);
  graphCanvas.addEventListener("mouseleave", handleMouseLeave);
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 100);
  });

  resize();
  updateGraphData();
  
  if (!reduceMotion) {
    render();
  } else {
    applyForces();
    draw();
  }

  setInterval(updateGraphData, 2000);
};

if (mesh) {
  const ctx = mesh.getContext("2d");
  let width = 0;
  let height = 0;
  let nodes = [];
  let time = 0;

  const getMeshColors = () => {
    const isDark = currentTheme === 'dark';
    return {
      line1: isDark ? "rgba(99, 102, 241, 0.4)" : "rgba(46, 196, 182, 0.45)",
      line2: isDark ? "rgba(34, 211, 238, 0.4)" : "rgba(99, 102, 241, 0.3)",
      glow: isDark ? "rgba(99, 102, 241, 0.3)" : "rgba(46, 196, 182, 0.3)",
      node: isDark ? "rgba(255, 255, 255, 0.8)" : "rgba(26, 35, 43, 0.7)",
    };
  };

  const resize = () => {
    const rect = mesh.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    width = rect.width;
    height = rect.height;
    mesh.width = width * dpr;
    mesh.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    createNodes();
  };

  const createNodes = () => {
    const count = Math.max(20, Math.min(50, Math.floor((width * height) / 12000)));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      radius: 1 + Math.random() * 2,
      phase: Math.random() * Math.PI * 2,
    }));
  };

  const drawFrame = () => {
    time += 0.016;
    const colors = getMeshColors();
    ctx.clearRect(0, 0, width, height);

    nodes.forEach((node, i) => {
      if (!reduceMotion) {
        node.x += node.vx;
        node.y += node.vy;
        if (node.x < 0 || node.x > width) node.vx *= -1;
        if (node.y < 0 || node.y > height) node.vy *= -1;
      }

      for (let j = i + 1; j < nodes.length; j++) {
        const other = nodes[j];
        const dx = node.x - other.x;
        const dy = node.y - other.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 150) {
          const alpha = (1 - dist / 150) * 0.4;
          const gradient = ctx.createLinearGradient(node.x, node.y, other.x, other.y);
          gradient.addColorStop(0, colors.line1.replace('0.4', alpha.toString()));
          gradient.addColorStop(1, colors.line2.replace('0.4', alpha.toString()));
          ctx.strokeStyle = gradient;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(node.x, node.y);
          ctx.lineTo(other.x, other.y);
          ctx.stroke();
        }
      }
    });

    nodes.forEach((node) => {
      const pulse = 1 + Math.sin(time * 2 + node.phase) * 0.3;
      const radius = node.radius * pulse;
      
      const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, radius * 4);
      gradient.addColorStop(0, colors.glow);
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius * 4, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = colors.node;
      ctx.fill();
    });
  };

  const animate = () => {
    drawFrame();
    if (!reduceMotion) requestAnimationFrame(animate);
  };

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 100);
  });

  resize();
  if (!reduceMotion) animate();
  else drawFrame();
}

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
    { threshold: 0.1, rootMargin: "0px 0px -50px 0px" }
  );
  revealItems.forEach((item) => observer.observe(item));
}

if (!reduceMotion) {
  document.addEventListener("mousemove", (e) => {
    const panels = document.querySelectorAll(".panel");
    const x = (e.clientX / window.innerWidth - 0.5) * 2;
    const y = (e.clientY / window.innerHeight - 0.5) * 2;
    
    panels.forEach((panel, i) => {
      const depth = (i + 1) * 5;
      panel.style.transform = `translate(${x * depth}px, ${y * depth}px)`;
    });
  });
}

updateLiveData();
startGraph();
setInterval(updateLiveData, 5000);

document.querySelectorAll('.live-value').forEach(el => {
  el.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
});
