const GATEWAY = "http://127.0.0.1:28789";
let productLocale = "ru";

const UI_TEXT = {
  en: {
    onboardTitle: "Name your agent",
    avatarTitle: "Pick an avatar",
    continue: "Continue",
    chatPlaceholder: "Ask anything…",
    send: "Send",
    enterName: "Enter a name",
    terminalSetup: "Run in terminal to complete setup",
    name: "Name",
    avatar: "Avatar",
  },
  ru: {
    onboardTitle: "Назовите агента",
    avatarTitle: "Выберите аватар",
    continue: "Продолжить",
    chatPlaceholder: "Напишите запрос…",
    send: "Отправить",
    enterName: "Введите имя",
    terminalSetup: "Завершите настройку в терминале",
    name: "Имя",
    avatar: "Аватар",
  },
};

function uiText() {
  return UI_TEXT[productLocale] || UI_TEXT.en;
}

function applyProductLocale(locale) {
  productLocale = locale === "ru" ? "ru" : "en";
  document.documentElement.lang = productLocale;
  const text = uiText();
  document.getElementById("onboard-title").textContent = text.onboardTitle;
  document.getElementById("avatar-title").textContent = text.avatarTitle;
  document.getElementById("onboard-btn").textContent = text.continue;
  document.getElementById("chat-input").placeholder = text.chatPlaceholder;
  document.getElementById("chat-send").textContent = text.send;
  const select = document.getElementById("locale-select");
  if (select) select.value = productLocale;
}

const AVATARS = [
  { id: "sprite-01", label: "Cyan Bot", color: "#3dd9c4" },
  { id: "sprite-02", label: "Amber Scout", color: "#f5a623" },
  { id: "sprite-03", label: "Rose Pilot", color: "#e85d8a" },
  { id: "sprite-04", label: "Lime Ranger", color: "#7ed957" },
  { id: "sprite-05", label: "Indigo Sage", color: "#6b7fd7" },
  { id: "sprite-06", label: "Coral Spark", color: "#ff6b4a" },
  { id: "sprite-07", label: "Mint Ghost", color: "#9ef0d0" },
  { id: "sprite-08", label: "Gold Knight", color: "#d4a017" },
  { id: "sprite-09", label: "Violet Wisp", color: "#a855f7" },
  { id: "sprite-10", label: "Steel Core", color: "#8b9aab" },
  { id: "sprite-11", label: "Sunrise", color: "#ff9a56" },
  { id: "sprite-12", label: "Night Owl", color: "#4a5568" },
];

const SPRITES = {
  "sprite-01": [[0,1,1,1,1,1,1,0],[1,1,3,1,1,3,1,1],[1,1,1,1,1,1,1,1],[1,2,2,2,2,2,2,1],[0,1,1,1,1,1,1,0],[0,1,0,1,1,0,1,0],[0,1,0,1,1,0,1,0],[0,2,0,0,0,0,2,0]],
  "sprite-02": [[0,0,4,4,4,4,0,0],[0,1,1,1,1,1,1,0],[1,3,1,1,1,1,3,1],[1,1,1,2,2,1,1,1],[0,1,1,1,1,1,1,0],[0,0,1,1,1,1,0,0],[0,1,0,0,0,0,1,0],[0,2,0,0,0,0,2,0]],
  "sprite-03": [[0,0,1,1,1,1,0,0],[0,1,4,4,4,4,1,0],[1,3,1,1,1,1,3,1],[1,1,1,1,1,1,1,1],[0,1,2,2,2,2,1,0],[0,0,1,1,1,1,0,0],[0,1,1,0,0,1,1,0],[2,2,0,0,0,0,2,2]],
  "sprite-04": [[0,4,0,1,1,0,4,0],[0,0,1,1,1,1,0,0],[0,1,3,1,1,3,1,0],[1,1,1,2,2,1,1,1],[0,1,1,1,1,1,1,0],[0,0,1,1,1,1,0,0],[0,1,0,0,0,0,1,0],[0,4,0,0,0,0,4,0]],
  "sprite-05": [[0,0,1,1,1,1,0,0],[0,1,1,1,1,1,1,0],[1,3,4,1,1,4,3,1],[1,1,1,1,1,1,1,1],[0,1,2,1,1,2,1,0],[0,0,1,1,1,1,0,0],[0,0,1,0,0,1,0,0],[0,0,2,0,0,2,0,0]],
  "sprite-06": [[0,0,0,4,4,0,0,0],[0,4,1,1,1,1,4,0],[0,1,3,1,1,3,1,0],[1,1,1,1,1,1,1,1],[0,1,1,2,2,1,1,0],[0,0,1,1,1,1,0,0],[0,1,0,0,0,0,1,0],[4,0,0,0,0,0,0,4]],
  "sprite-07": [[0,0,1,1,1,1,0,0],[0,1,1,1,1,1,1,0],[1,3,1,1,1,1,3,1],[1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1],[1,1,0,1,1,0,1,1],[1,0,0,1,1,0,0,1],[1,0,0,0,0,0,0,1]],
  "sprite-08": [[0,2,2,2,2,2,2,0],[2,1,1,1,1,1,1,2],[1,3,1,1,1,1,3,1],[1,1,1,4,4,1,1,1],[2,1,1,1,1,1,1,2],[0,2,1,1,1,1,2,0],[0,1,0,0,0,0,1,0],[0,2,0,0,0,0,2,0]],
  "sprite-09": [[0,0,0,4,0,0,0,0],[0,0,1,1,1,0,0,0],[0,1,3,1,3,1,0,0],[0,1,1,1,1,1,0,0],[0,0,1,4,1,0,0,0],[0,0,0,1,0,0,4,0],[0,4,0,1,0,0,0,0],[0,0,0,2,0,0,0,0]],
  "sprite-10": [[0,2,1,1,1,1,2,0],[2,1,1,1,1,1,1,2],[1,3,2,1,1,2,3,1],[1,1,1,4,4,1,1,1],[1,1,1,1,1,1,1,1],[2,1,1,1,1,1,1,2],[0,2,1,0,0,1,2,0],[0,0,2,0,0,2,0,0]],
  "sprite-11": [[0,4,0,4,4,0,4,0],[0,0,1,1,1,1,0,0],[4,1,3,1,1,3,1,4],[0,1,1,1,1,1,1,0],[0,0,1,2,2,1,0,0],[0,0,1,1,1,1,0,0],[0,1,0,0,0,0,1,0],[0,2,0,0,0,0,2,0]],
  "sprite-12": [[0,2,0,0,0,0,2,0],[0,0,1,1,1,1,0,0],[0,1,3,1,1,3,1,0],[1,1,4,1,1,4,1,1],[0,1,1,2,2,1,1,0],[0,0,1,1,1,1,0,0],[0,0,1,0,0,1,0,0],[0,0,2,0,0,2,0,0]],
};

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function shade([r, g, b], f) {
  return [Math.min(255, Math.round(r * f)), Math.min(255, Math.round(g * f)), Math.min(255, Math.round(b * f))];
}

function drawSprite(canvas, avatarId, color, scale = 6) {
  const grid = SPRITES[avatarId];
  if (!grid) return;
  canvas.width = 8 * scale;
  canvas.height = 8 * scale;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const main = hexToRgb(color);
  const palette = {
    1: main,
    2: shade(main, 0.45),
    3: [20, 20, 28],
    4: shade(main, 1.35),
  };
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const p = grid[y][x];
      if (!p) continue;
      const [r, g, b] = palette[p];
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}

let sessionId = null;
let selectedAvatar = "sprite-04";

async function init() {
  setupTabs();
  setupAvatarGrid();
  setupChat();
  setupOnboard();
  setupMissions();
  setupModelsPanel();
  paintHero(selectedAvatar);
  startApprovalPoll();
  document.getElementById("locale-select")?.addEventListener("change", (event) => {
    applyProductLocale(event.target.value);
  });
  applyProductLocale("ru");

  try {
    const res = await fetch(`${GATEWAY}/status`);
    const data = await res.json();
    applyProductLocale(data.locale);
    document.getElementById("agent-status").textContent = data.ok
      ? `Online · ${data.model || ""}`
      : "Offline";
  } catch {
    document.getElementById("agent-status").textContent = "Gateway offline — run: hey gateway start";
  }

  try {
    const res = await fetch(`${GATEWAY}/identity`);
    const data = await res.json();
    if (data.identity) {
      document.getElementById("agent-name").textContent = data.identity.name;
      paintHero(data.identity.avatarId);
      document.getElementById("onboard").classList.add("hidden");
    } else {
      document.getElementById("onboard").classList.remove("hidden");
      document.getElementById("chat").classList.add("hidden");
    }
  } catch {
    document.getElementById("onboard").classList.remove("hidden");
  }
}

function paintHero(avatarId) {
  const meta = AVATARS.find((a) => a.id === avatarId) || AVATARS[3];
  const canvas = document.getElementById("avatar");
  if (canvas && canvas.getContext) {
    canvas.className = "avatar idle";
    drawSprite(canvas, meta.id, meta.color, 8);
  }
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const name = tab.dataset.tab;
      document.querySelectorAll(".panel").forEach((p) => p.classList.add("hidden"));
      const panel = name === "models" ? "models-panel" : name;
      document.getElementById(panel)?.classList.remove("hidden");
      if (name === "chat") document.getElementById("chat").classList.remove("hidden");
      if (name === "missions") void refreshMissions();
      if (name === "models") void refreshModels();
    });
  });
}

function setupMissions() {
  document.getElementById("missions-refresh")?.addEventListener("click", () => void refreshMissions());
  document.getElementById("missions-pause")?.addEventListener("click", async () => {
    await fetch(`${GATEWAY}/missions/pause`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    void refreshMissions();
  });
  document.getElementById("missions-cancel")?.addEventListener("click", async () => {
    await fetch(`${GATEWAY}/missions/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    void refreshMissions();
  });
}

async function refreshMissions() {
  const statusEl = document.getElementById("missions-status");
  const queueEl = document.getElementById("missions-queue");
  const histEl = document.getElementById("missions-history");
  if (!statusEl || !queueEl || !histEl) return;
  try {
    const [missions, status] = await Promise.all([
      fetch(`${GATEWAY}/missions`).then((r) => r.json()),
      fetch(`${GATEWAY}/status`).then((r) => r.json()),
    ]);
    statusEl.textContent = [
      `Model: ${status.model || "?"}`,
      `Active UI: ${missions.activeUi || "none"}`,
      `Pending approvals: ${status.pendingApprovals ?? 0}`,
      "",
      "Cron:",
      missions.cron || "(none)",
    ].join("\n");
    queueEl.innerHTML = "";
    (missions.queue || []).forEach((m) => {
      const li = document.createElement("li");
      li.textContent = `[${m.status}] ${m.harness || "?"} — ${(m.goal || "").slice(0, 80)}`;
      queueEl.appendChild(li);
    });
    if (!(missions.queue || []).length) {
      queueEl.innerHTML = "<li>Queue empty</li>";
    }
    histEl.innerHTML = "";
    (missions.history || []).forEach((h) => {
      const li = document.createElement("li");
      li.textContent = `${(h.at || "").slice(0, 16)} · ${h.harness || "?"} — ${(h.goal || "").slice(0, 70)}`;
      histEl.appendChild(li);
    });
    if (!(missions.history || []).length) {
      histEl.innerHTML = "<li>No history yet</li>";
    }
  } catch (err) {
    statusEl.textContent = `Gateway offline: ${err.message}`;
  }
}

function setupModelsPanel() {
  document.getElementById("test-model")?.addEventListener("click", () => void refreshModels());
}

async function refreshModels() {
  const el = document.getElementById("model-status");
  if (!el) return;
  try {
    const data = await fetch(`${GATEWAY}/models`).then((r) => r.json());
    const lines = [
      `Default: ${data.default}`,
      `Fallbacks: ${(data.fallbacks || []).join(", ") || "(none)"}`,
      "",
      "Providers:",
      ...(data.providers || []).map((p) => `  ${p.hasKey ? "✓" : "·"} ${p.id} — ${p.name}`),
    ];
    el.textContent = lines.join("\n");
  } catch (err) {
    el.textContent = `Error: ${err.message}`;
  }
}

function startApprovalPoll() {
  setInterval(() => void refreshApprovals(), 2500);
}

async function refreshApprovals() {
  const box = document.getElementById("approvals-box");
  const list = document.getElementById("approvals-list");
  if (!box || !list) return;
  try {
    const data = await fetch(`${GATEWAY}/approvals`).then((r) => r.json());
    const pending = data.pending || [];
    if (!pending.length) {
      box.classList.add("hidden");
      list.innerHTML = "";
      return;
    }
    box.classList.remove("hidden");
    list.innerHTML = "";
    pending.forEach((p) => {
      const card = document.createElement("div");
      card.className = "approval-card";
      card.innerHTML = `<div><strong>${p.toolName}</strong></div><div>${p.description}</div><pre>${JSON.stringify(p.args || {}, null, 0).slice(0, 200)}</pre>`;
      const actions = document.createElement("div");
      actions.className = "actions";
      const yes = document.createElement("button");
      yes.className = "btn primary";
      yes.textContent = "Approve";
      yes.type = "button";
      yes.onclick = () => void decideApproval(p.id, true);
      const no = document.createElement("button");
      no.className = "btn danger";
      no.textContent = "Deny";
      no.type = "button";
      no.onclick = () => void decideApproval(p.id, false);
      actions.append(yes, no);
      card.appendChild(actions);
      list.appendChild(card);
    });
  } catch {
    /* offline */
  }
}

async function decideApproval(id, approve) {
  await fetch(`${GATEWAY}/approvals/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approve }),
  });
  void refreshApprovals();
}

function setupAvatarGrid() {
  const grid = document.getElementById("avatar-grid");
  AVATARS.forEach((a) => {
    const wrap = document.createElement("button");
    wrap.type = "button";
    wrap.className = `avatar-option${a.id === selectedAvatar ? " selected" : ""}`;
    wrap.title = a.label;
    const canvas = document.createElement("canvas");
    drawSprite(canvas, a.id, a.color, 5);
    wrap.appendChild(canvas);
    wrap.addEventListener("click", () => {
      selectedAvatar = a.id;
      grid.querySelectorAll(".avatar-option").forEach((o) => o.classList.remove("selected"));
      wrap.classList.add("selected");
      paintHero(a.id);
    });
    grid.appendChild(wrap);
  });
}

function setupOnboard() {
  document.getElementById("onboard-btn").addEventListener("click", async () => {
    const name = document.getElementById("name-input").value.trim();
    const text = uiText();
    if (!name) return alert(text.enterName);
    alert(
      `${text.terminalSetup}:\nhey onboard --locale ${productLocale}\n\n${text.name}: ${name}\n${text.avatar}: ${selectedAvatar}`,
    );
    document.getElementById("agent-name").textContent = name;
    paintHero(selectedAvatar);
    document.getElementById("onboard").classList.add("hidden");
    document.getElementById("chat").classList.remove("hidden");
  });
}

function setupChat() {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const messages = document.getElementById("messages");
  const avatar = document.getElementById("avatar");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";

    appendMsg(messages, "user", text);
    avatar.classList.remove("idle");
    avatar.classList.add("thinking");

    try {
      const res = await fetch(`${GATEWAY}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      sessionId = data.sessionId;
      appendMsg(messages, "assistant", data.response);
    } catch (err) {
      appendMsg(messages, "assistant", `Error: ${err.message}`);
    } finally {
      avatar.classList.remove("thinking", "working");
      avatar.classList.add("idle");
    }
  });
}

function appendMsg(container, role, text) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.textContent = text;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

init();
