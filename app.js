/* ════════════════════════════════════════════════════════════════════
   GAMELIST — catálogo de jogos zerados
   Dados: SEED_GAMES (games-data.js) + localStorage
   APIs:  Wikipedia (busca, capas, resumos) — gratuita, sem chave
   ════════════════════════════════════════════════════════════════════ */

const LS_KEY = "gamelist_v1";
const LS_CFG = "gamelist_github_cfg";
const GH_FILE = "games.json";
const CONSOLES = [
  "SNES","PS1","PS2","PS3","PS4","PS5","Xbox","Xbox 360","Xbox One","Xbox Series X/S",
  "Nintendo Switch","Wii U","Wii","Nintendo 3DS","Nintendo DS","Game Boy Advance","Game Boy",
  "Mega Drive","PC","Android","iOS","Outro"
];

let library = [];
let activeConsole = "Todos";
let filterText = "";
let selectedResult = null;
let coverQueueRunning = false;

/* ── GitHub sync ─────────────────────────────────────────────────── */
let ghCfg = null;       // {repo, branch, token}
let ghSha = null;       // sha atual do games.json no repo
let ghSaveTimer = null; // debounce de commits

function loadCfg() {
  try { ghCfg = JSON.parse(localStorage.getItem(LS_CFG)) || null; } catch { ghCfg = null; }
}
function saveCfg() {
  if (ghCfg) localStorage.setItem(LS_CFG, JSON.stringify(ghCfg));
  else localStorage.removeItem(LS_CFG);
}
function ghHeaders() {
  return {
    "Authorization": `Bearer ${ghCfg.token}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}
function ghUrl() {
  return `https://api.github.com/repos/${ghCfg.repo}/contents/${GH_FILE}`;
}
// base64 com suporte a unicode
function b64encode(str) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}
function b64decode(b64) {
  return new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), c => c.charCodeAt(0)));
}

// lê games.json do repo → {games, sha} | null (404 = arquivo ainda não existe)
async function ghLoad() {
  const res = await fetch(`${ghUrl()}?ref=${encodeURIComponent(ghCfg.branch)}`, { headers: ghHeaders() });
  if (res.status === 404) return { games: null, sha: null };
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const d = await res.json();
  const games = JSON.parse(b64decode(d.content));
  return { games: Array.isArray(games) ? games : null, sha: d.sha };
}

// grava games.json no repo (com retry em conflito de sha)
async function ghSave(retry = true) {
  const body = {
    message: `gamelist: atualiza (${library.length} jogos)`,
    content: b64encode(JSON.stringify(library, null, 1)),
    branch: ghCfg.branch
  };
  if (ghSha) body.sha = ghSha;
  const res = await fetch(ghUrl(), { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) });
  if (res.status === 409 && retry) {
    // outro dispositivo commitou antes: pega o sha novo e tenta de novo
    const { sha } = await ghLoad();
    ghSha = sha;
    return ghSave(false);
  }
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const d = await res.json();
  ghSha = d.content.sha;
}

// agenda um commit (debounce 1.5s pra agrupar mudanças rápidas)
function scheduleGhSave() {
  clearTimeout(ghSaveTimer);
  setStatus("busy", "Sincronizando com GitHub...");
  ghSaveTimer = setTimeout(async () => {
    try {
      await ghSave();
      setStatus("ok", `GitHub · ${library.length} jogos`);
    } catch (e) {
      setStatus("error", "Falha ao commitar — veja ⚙ GitHub");
    }
  }, 1500);
}

/* ── helpers ─────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const mkId = (name, console_) =>
  name.toLowerCase().replace(/[^a-z0-9]/g,"") + "__" + console_.toLowerCase().replace(/[^a-z0-9]/g,"");

function setStatus(kind, msg) {
  $("status-dot").className = "dot " + kind;
  $("status-msg").textContent = msg;
}
function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2500);
}

/* ── persistência: GitHub (fonte da verdade) + localStorage (cache) ─ */
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return null;
}
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(library)); } catch {}
  if (ghCfg) {
    scheduleGhSave();
  } else {
    setStatus("ok", `Local · ${library.length} jogos — configure ⚙ GitHub pra sincronizar`);
  }
}

/* ── Wikipedia API ───────────────────────────────────────────────── */
const WIKI = "https://en.wikipedia.org/w/api.php";

// busca jogos: retorna [{title, description, thumb}]
async function wikiSearch(query) {
  const url = `${WIKI}?action=query&generator=search&gsrsearch=${encodeURIComponent(query + " video game")}&gsrlimit=10&prop=pageimages|description&piprop=thumbnail&pithumbsize=120&format=json&origin=*`;
  const res = await fetch(url);
  const data = await res.json();
  const pages = data?.query?.pages;
  if (!pages) return [];
  return Object.values(pages)
    .sort((a, b) => a.index - b.index)
    .map(p => ({
      title: p.title,
      description: p.description || "",
      thumb: p.thumbnail?.source || ""
    }));
}

// capa: resolve wikiTitle (se preciso) e retorna {wikiTitle, cover}
async function wikiCover(name, wikiTitle) {
  let title = wikiTitle;
  if (!title) {
    const results = await wikiSearch(name);
    if (!results.length) return { wikiTitle: null, cover: null };
    title = results[0].title;
  }
  const url = `${WIKI}?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&piprop=thumbnail&pithumbsize=400&redirects=1&format=json&origin=*`;
  const res = await fetch(url);
  const data = await res.json();
  const pages = data?.query?.pages;
  if (!pages) return { wikiTitle: title, cover: null };
  const page = Object.values(pages)[0];
  return { wikiTitle: page?.title || title, cover: page?.thumbnail?.source || null };
}

// resumo do jogo (REST API): {extract, description, thumb, url}
async function wikiSummary(wikiTitle) {
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`);
  if (!res.ok) return null;
  const d = await res.json();
  return {
    extract: d.extract || "",
    description: d.description || "",
    thumb: d.thumbnail?.source || "",
    url: d.content_urls?.desktop?.page || ""
  };
}

/* ── fila de capas em segundo plano ──────────────────────────────── */
async function runCoverQueue() {
  if (coverQueueRunning) return;
  coverQueueRunning = true;
  try {
    while (true) {
      const missing = library.filter(g => g.cover === "");
      if (!missing.length) break;
      setStatus("busy", `Carregando capas ${library.length - missing.length}/${library.length}...`);
      // 4 em paralelo por rodada (gentil com a API)
      const batch = missing.slice(0, 4);
      await Promise.all(batch.map(async (g) => {
        try {
          const { wikiTitle, cover } = await wikiCover(g.name, g.wikiTitle);
          g.wikiTitle = wikiTitle || g.wikiTitle || null;
          g.cover = cover; // string = achou; null = não achou (não tenta de novo)
        } catch { g.cover = null; }
      }));
      save();
      render();
      await new Promise(r => setTimeout(r, 350)); // respiro entre lotes
    }
    setStatus("ok", `${library.length} jogos`);
  } finally {
    coverQueueRunning = false;
  }
}

/* ── render ──────────────────────────────────────────────────────── */
function render() {
  // stats
  const consoles = [...new Set(library.map(g => g.console))].sort();
  $("stat-games").textContent = library.length;
  $("stat-consoles").textContent = consoles.length;

  // tabs
  const counts = {};
  library.forEach(g => counts[g.console] = (counts[g.console] || 0) + 1);
  $("platform-tabs").innerHTML = ["Todos", ...consoles].map(c => {
    const n = c === "Todos" ? library.length : counts[c];
    return `<button class="tab ${activeConsole === c ? "active" : ""}" data-console="${esc(c)}">${esc(c)}<small>${n}</small></button>`;
  }).join("");

  // grid
  const visible = library
    .filter(g => (activeConsole === "Todos" || g.console === activeConsole)
              && (!filterText || g.name.toLowerCase().includes(filterText)))
    .sort((a, b) => a.name.localeCompare(b.name));

  const catalog = $("catalog");
  if (!visible.length) {
    catalog.innerHTML = `<div class="empty">
      <div class="icon">🎮</div>
      <div class="title">Nenhum jogo aqui</div>
      <div class="sub">${filterText ? "Nada com esse filtro" : 'Clique em "+ Adicionar"'}</div>
    </div>`;
    return;
  }

  catalog.innerHTML = `<div class="grid">` + visible.map(g => {
    const cover = (typeof g.cover === "string" && g.cover.startsWith("http"))
      ? `<img class="cover" src="${esc(g.cover)}" alt="${esc(g.name)}" loading="lazy"
            onerror="this.outerHTML='<div class=&quot;cover-fallback&quot;><span class=&quot;emoji&quot;>🎮</span><span class=&quot;nm&quot;>${esc(g.name)}</span></div>'">`
      : `<div class="cover-fallback">
          <span class="emoji ${g.cover === "" ? "loading" : ""}">🎮</span>
          <span class="nm">${esc(g.name)}</span>
          ${g.cover === "" ? '<span class="ld">buscando capa...</span>' : ""}
        </div>`;
    const meta = activeConsole === "Todos" ? g.console : (g.year || "");
    return `<div class="card" data-id="${esc(g.id)}">
      ${cover}
      <div class="info"><div class="nm">${esc(g.name)}</div><div class="meta">${esc(meta)}</div></div>
      <button class="del" data-del="${esc(g.id)}" title="Remover">✕</button>
    </div>`;
  }).join("") + `</div>`;
}

/* ── popup de detalhes ───────────────────────────────────────────── */
async function openDetail(id) {
  const g = library.find(x => x.id === id);
  if (!g) return;

  const consolesOf = library.filter(x => x.name === g.name).map(x => x.console);
  const coverHtml = (typeof g.cover === "string" && g.cover.startsWith("http"))
    ? `<img src="${esc(g.cover)}" alt="${esc(g.name)}">`
    : `<div class="cover-fallback">🎮</div>`;

  $("detail-content").innerHTML = `
    <div class="detail-hero">
      ${coverHtml}
      <div class="dh-info">
        <div class="detail-title">${esc(g.name)}</div>
        <div class="detail-desc" id="d-desc"></div>
        <div class="detail-meta">
          <div class="dm-row"><span class="dm-label">Zerado em</span>
            <span class="dm-value">${consolesOf.map(c => `<span class="badge mine">${esc(c)}</span>`).join("")}</span></div>
          <div class="dm-row" id="d-release" hidden><span class="dm-label">Lançamento</span><span class="dm-value" id="d-release-v"></span></div>
          <div class="dm-row" id="d-platforms" hidden><span class="dm-label">Plataformas</span><span class="dm-value" id="d-platforms-v"></span></div>
        </div>
      </div>
    </div>
    <div class="detail-loading" id="d-loading">Buscando informações na Wikipedia...</div>
    <div class="detail-summary" id="d-summary" hidden>
      <h3>Sobre o jogo</h3>
      <p id="d-extract"></p>
    </div>
    <div class="detail-link" id="d-link" hidden></div>
  `;
  $("detail-overlay").hidden = false;

  // resolve wikiTitle se ainda não tem
  let title = g.wikiTitle;
  if (!title) {
    try {
      const r = await wikiSearch(g.name);
      title = r[0]?.title || null;
      if (title) { g.wikiTitle = title; save(); }
    } catch {}
  }
  if (!title) {
    $("d-loading").textContent = "Não achei informações sobre esse jogo na Wikipedia.";
    return;
  }

  try {
    const s = await wikiSummary(title);
    if (!s) throw new Error();
    $("d-loading").hidden = true;

    // descrição curta (ex: "2001 action-adventure game")
    if (s.description) $("d-desc").textContent = s.description;

    // extrai ano de lançamento e plataformas do texto, quando presentes
    const yearMatch = (s.description + " " + s.extract).match(/\b(19[7-9]\d|20[0-2]\d)\b/);
    if (yearMatch) {
      $("d-release").hidden = false;
      $("d-release-v").textContent = yearMatch[1];
      if (!g.year) { g.year = yearMatch[1]; save(); render(); }
    }

    const knownPlatforms = ["PlayStation 5","PlayStation 4","PlayStation 3","PlayStation 2","PlayStation","Xbox Series X","Xbox One","Xbox 360","Xbox","Nintendo Switch","Wii U","Wii","Nintendo 3DS","Nintendo DS","Game Boy Advance","Game Boy","Super Nintendo","Super NES","SNES","Mega Drive","Genesis","Windows","PC","Android","iOS","GameCube","Nintendo 64","Dreamcast","Saturn","PSP","PS Vita"];
    const found = knownPlatforms.filter(p => s.extract.includes(p));
    if (found.length) {
      $("d-platforms").hidden = false;
      $("d-platforms-v").innerHTML = found.map(p => `<span class="badge">${esc(p)}</span>`).join("");
    }

    if (s.extract) {
      $("d-summary").hidden = false;
      $("d-extract").textContent = s.extract;
    }
    if (s.url) {
      $("d-link").hidden = false;
      $("d-link").innerHTML = `<a href="${esc(s.url)}" target="_blank" rel="noopener">Ver artigo completo na Wikipedia →</a>`;
    }
  } catch {
    $("d-loading").textContent = "Erro ao buscar informações. Tente de novo.";
  }
}

/* ── adicionar jogo ──────────────────────────────────────────────── */
async function runSearch() {
  const q = $("add-query").value.trim();
  if (q.length < 2) return;
  selectedResult = null;
  $("btn-confirm").disabled = true;
  $("search-results").hidden = true;
  $("search-feedback").hidden = false;
  $("search-feedback").textContent = "🔍 Buscando...";
  try {
    const results = await wikiSearch(q);
    if (!results.length) {
      $("search-feedback").textContent = "Nada encontrado. Tente outro nome.";
      return;
    }
    $("search-feedback").hidden = true;
    $("search-results").hidden = false;
    $("search-results").innerHTML = results.map((r, i) => `
      <div class="result" data-idx="${i}">
        ${r.thumb ? `<img src="${esc(r.thumb)}" alt="">` : `<div class="ph">🎮</div>`}
        <div class="ri">
          <div class="rn">${esc(r.title)}</div>
          <div class="rd">${esc(r.description)}</div>
        </div>
        <span class="check">✓</span>
      </div>`).join("");
    $("search-results")._data = results;
  } catch {
    $("search-feedback").textContent = "Erro na busca. Verifica tua conexão.";
  }
}

function confirmAdd() {
  const console_ = $("add-console").value;
  if (!console_ || !selectedResult) return;
  // nome limpo: remove desambiguação "(video game)" etc.
  const cleanName = selectedResult.title.replace(/\s*\((\d{4} )?video game\)$/i, "").trim();
  const id = mkId(cleanName, console_);
  if (library.some(g => g.id === id)) { showToast("Esse jogo já está nesse console!"); return; }
  library.push({
    id, name: cleanName, console: console_, year: "",
    cover: "", wikiTitle: selectedResult.title
  });
  save();
  render();
  $("add-overlay").hidden = true;
  showToast(`"${cleanName}" adicionado!`);
  runCoverQueue();
}

/* ── backup / import ─────────────────────────────────────────────── */
function exportBackup() {
  const blob = new Blob([JSON.stringify(library, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "gamelist-backup.json";
  a.click();
  URL.revokeObjectURL(a.href);
  showToast("Backup baixado!");
}
function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data)) throw new Error();
      library = normalizeAll(data);
      save();
      render();
      showToast(`${library.length} jogos importados!`);
      runCoverQueue();
    } catch { showToast("Arquivo inválido"); }
  };
  reader.readAsText(file);
}

/* ── eventos ─────────────────────────────────────────────────────── */
function bindEvents() {
  $("filter-input").addEventListener("input", e => {
    filterText = e.target.value.toLowerCase();
    render();
  });

  $("platform-tabs").addEventListener("click", e => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    activeConsole = tab.dataset.console;
    $("filter-input").placeholder = `Filtrar em ${activeConsole}...`;
    render();
  });

  $("catalog").addEventListener("click", e => {
    const del = e.target.closest("[data-del]");
    if (del) {
      e.stopPropagation();
      library = library.filter(g => g.id !== del.dataset.del);
      save(); render();
      showToast("Jogo removido");
      return;
    }
    const card = e.target.closest(".card");
    if (card) openDetail(card.dataset.id);
  });

  $("btn-add").addEventListener("click", () => {
    $("add-query").value = "";
    $("search-results").hidden = true;
    $("search-feedback").hidden = true;
    $("btn-confirm").disabled = true;
    selectedResult = null;
    const sel = $("add-console");
    const extra = [...new Set(library.map(g => g.console))].filter(c => !CONSOLES.includes(c));
    sel.innerHTML = `<option value="">Selecione o console...</option>` +
      [...CONSOLES, ...extra].map(c => `<option ${c === activeConsole ? "selected" : ""}>${esc(c)}</option>`).join("");
    $("add-overlay").hidden = false;
    $("add-query").focus();
  });

  $("btn-search").addEventListener("click", runSearch);
  $("add-query").addEventListener("keydown", e => { if (e.key === "Enter") runSearch(); });

  $("search-results").addEventListener("click", e => {
    const r = e.target.closest(".result");
    if (!r) return;
    document.querySelectorAll(".result").forEach(x => x.classList.remove("selected"));
    r.classList.add("selected");
    selectedResult = $("search-results")._data[Number(r.dataset.idx)];
    $("btn-confirm").disabled = !$("add-console").value;
  });
  $("add-console").addEventListener("change", () => {
    $("btn-confirm").disabled = !($("add-console").value && selectedResult);
  });
  $("btn-confirm").addEventListener("click", confirmAdd);

  $("btn-export").addEventListener("click", exportBackup);
  $("btn-import").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", e => {
    if (e.target.files?.[0]) importBackup(e.target.files[0]);
    e.target.value = "";
  });

  // ── config GitHub ──
  $("btn-settings").addEventListener("click", () => {
    $("cfg-repo").value = ghCfg?.repo || "";
    $("cfg-branch").value = ghCfg?.branch || "main";
    $("cfg-token").value = ghCfg?.token || "";
    $("cfg-feedback").hidden = true;
    $("settings-overlay").hidden = false;
  });

  $("cfg-save").addEventListener("click", async () => {
    const repo = $("cfg-repo").value.trim();
    const branch = $("cfg-branch").value.trim() || "main";
    const token = $("cfg-token").value.trim();
    const fb = $("cfg-feedback");
    fb.hidden = false;
    fb.className = "settings-feedback";
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { fb.classList.add("err"); fb.textContent = "Repositório inválido. Use o formato usuario/repo."; return; }
    if (!token) { fb.classList.add("err"); fb.textContent = "Cole o token de acesso."; return; }
    fb.textContent = "Testando conexão...";
    const prevCfg = ghCfg;
    ghCfg = { repo, branch, token };
    try {
      const { games, sha } = await ghLoad();
      ghSha = sha;
      saveCfg();
      fb.classList.add("ok");
      if (games) {
        // arquivo já existe no repo: ele é a fonte da verdade
        library = normalizeAll(games);
        try { localStorage.setItem(LS_KEY, JSON.stringify(library)); } catch {}
        render();
        fb.textContent = `Conectado! ${library.length} jogos carregados do repositório.`;
        runCoverQueue();
      } else {
        // ainda não existe: cria com a lista atual
        fb.textContent = "Conectado! Criando games.json no repositório...";
        await ghSave();
        fb.textContent = `Conectado! games.json criado com ${library.length} jogos.`;
      }
      setStatus("ok", `GitHub · ${library.length} jogos`);
    } catch (e) {
      ghCfg = prevCfg;
      fb.classList.add("err");
      fb.textContent = "Não conectou. Confere o repositório, o branch e se o token tem permissão Contents: Read and write.";
    }
  });

  $("cfg-disconnect").addEventListener("click", () => {
    ghCfg = null; ghSha = null;
    saveCfg();
    $("settings-overlay").hidden = true;
    setStatus("ok", `Local · ${library.length} jogos`);
    showToast("GitHub desconectado (lista continua no navegador)");
  });

  // fechar modais (botões e clique fora)
  document.querySelectorAll("[data-close]").forEach(b =>
    b.addEventListener("click", () => $(b.dataset.close).hidden = true));
  ["add-overlay", "detail-overlay", "settings-overlay"].forEach(id =>
    $(id).addEventListener("click", e => { if (e.target === $(id)) $(id).hidden = true; }));
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { $("add-overlay").hidden = true; $("detail-overlay").hidden = true; $("settings-overlay").hidden = true; }
  });
}

/* ── init ────────────────────────────────────────────────────────── */
function normalizeAll(arr) {
  return arr.map(g => ({
    id: g.id || mkId(g.name || "", g.console || "Outro"),
    name: g.name || "", console: g.console || "Outro",
    year: String(g.year || ""), cover: g.cover ?? "", wikiTitle: g.wikiTitle || ""
  }));
}

(async function init() {
  loadCfg();
  bindEvents();

  // 1) GitHub configurado? Ele é a fonte da verdade.
  if (ghCfg) {
    setStatus("busy", "Carregando do GitHub...");
    try {
      const { games, sha } = await ghLoad();
      ghSha = sha;
      if (games) {
        library = normalizeAll(games);
        try { localStorage.setItem(LS_KEY, JSON.stringify(library)); } catch {}
        setStatus("ok", `GitHub · ${library.length} jogos`);
        render();
        runCoverQueue();
        return;
      }
      // configurado mas arquivo não existe ainda: segue pro fallback e cria no 1º save
    } catch {
      setStatus("error", "GitHub indisponível — usando cópia local");
    }
  }

  // 2) Fallback: cache local > seed da planilha
  const stored = load();
  if (stored) {
    library = stored;
  } else {
    library = normalizeAll(typeof SEED_GAMES !== "undefined" ? SEED_GAMES : []);
    try { localStorage.setItem(LS_KEY, JSON.stringify(library)); } catch {}
  }
  if (ghCfg && !ghSha) {
    // cria o games.json no repo com a lista atual
    try { await ghSave(); setStatus("ok", `GitHub · ${library.length} jogos`); }
    catch { setStatus("error", "Falha ao criar games.json — veja ⚙ GitHub"); }
  } else if (!ghCfg) {
    setStatus("ok", `Local · ${library.length} jogos — configure ⚙ GitHub pra sincronizar`);
  }
  render();
  runCoverQueue();
})();
