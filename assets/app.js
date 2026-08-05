/* MissAV Viewer — 纯静态前端 */
(() => {
  "use strict";

  const DATA_VERSION = 1;
  const PAGE = 36;              // 每批渲染数量
  const FEED_LABELS = {
    home: "推荐",
    fc2: "FC2 系列",
    uncensored: "无码流出",
    subtitle: "中文字幕",
    new: "新作速递",
  };
  const TAB_ORDER = ["home", "fc2", "uncensored", "subtitle", "new"];

  const $ = (s) => document.querySelector(s);
  const grid = $("#grid"), state = $("#state"), tabs = $("#tabs");
  const searchInput = $("#search-input"), searchClear = $("#search-clear");
  const modalOverlay = $("#modal-overlay"), modal = $("#modal");
  const toastEl = $("#toast"), metaInfo = $("#meta-info"), sectionTitle = $("#section-title");

  let videos = new Map();       // id -> video
  let feeds = {};               // feed -> id[]
  let currentFeed = "home";
  let currentList = [];         // 当前渲染列表
  let rendered = 0;             // 已渲染数量
  let searchResults = null;     // 搜索模式下的列表
  let relatedCache = new Map(); // id -> 相关视频(同演员/同系列)

  /* ---------- 工具 ---------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const fmtDuration = (sec) => {
    if (!sec) return "";
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
             : `${m}:${String(s).padStart(2, "0")}`;
  };
  const fmtDate = (ts) => ts ? new Date(ts * 1000).toISOString().slice(0, 10) : "";

  const displayTitle = (v) => v.title_cn || v.title || v.id;
  const displayActresses = (v) => (v.actresses || []).join(" / ");

  const videoUrl = (v) => {
    const base = `https://missav.ws`;
    const lang = v.has_cn || v.uncensored ? "cn" : "en";
    const dm = v.dm ? `/dm${v.dm}` : "";
    return lang === "cn" ? `${base}${dm}/${v.id}` : `${base}${dm}/${lang}/${v.id}`;
  };

  const coverUrl = (v, size = "t") => `https://fourhoi.com/${v.id}/cover-${size}.jpg`;

  /* ---------- 数据加载 ---------- */
  const base = document.querySelector("base")?.href || `${location.pathname.replace(/\/[^/]*$/, "/")}`;
  const dataRoot = location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? ""
    : `${location.pathname.replace(/\/[^/]*$/, "/")}`;

  async function loadData() {
    state.innerHTML = `<div class="spinner"></div>`;
    try {
      const [vRes, fRes] = await Promise.all([
        fetch(`${dataRoot}data/videos.json?ts=${Date.now()}`),
        fetch(`${dataRoot}data/feeds.json?ts=${Date.now()}`),
      ]);
      if (!vRes.ok || !fRes.ok) throw new Error(`HTTP ${vRes.status}`);
      const vList = await vRes.json();
      feeds = await fRes.json();
      videos = new Map(vList.map((v) => [v.id, v]));
      metaInfo.textContent = `${vList.length} 部影片 · ${new Date().toLocaleDateString("zh-CN")}`;
      return true;
    } catch (e) {
      state.innerHTML = `<div class="empty">数据加载失败:${esc(e.message)}<br><br>
        <button class="tab active" onclick="location.reload()">重试</button></div>`;
      return false;
    }
  }

  /* ---------- 渲染 ---------- */
  function buildTabs() {
    tabs.innerHTML = TAB_ORDER.map((k) =>
      `<button class="tab ${k === currentFeed ? "active" : ""}" data-feed="${k}">${FEED_LABELS[k]}</button>`
    ).join("");
    tabs.querySelectorAll(".tab").forEach((t) =>
      t.addEventListener("click", () => switchFeed(t.dataset.feed)));
  }

  function cardHTML(v) {
    const badges = [];
    if (v.has_cn) badges.push(`<span class="badge cn">中字</span>`);
    if (v.uncensored) badges.push(`<span class="badge uncensored">无码</span>`);
    if (v.duration >= 3600) badges.push(`<span class="badge hd">长片</span>`);
    const dur = fmtDuration(v.duration);
    const act = displayActresses(v);
    const t = displayTitle(v);
    return `<div class="card" data-id="${esc(v.id)}" tabindex="0" role="button" aria-label="${esc(t)}">
      <div class="thumb">
        <div class="fallback">${esc((v.id || "?").slice(0, 2).toUpperCase())}</div>
        <img loading="lazy" referrerpolicy="no-referrer" data-src="${coverUrl(v, "t")}" alt="" onload="this.classList.add('loaded')" onerror="this.style.display='none'">
        ${badges.length ? `<div class="badges">${badges.join("")}</div>` : ""}
        ${dur ? `<span class="duration">${dur}</span>` : ""}
      </div>
      <div class="card-body">
        <div class="card-title">${esc(t)}</div>
        ${act ? `<div class="card-actresses">${esc(act)}</div>` : ""}
        <div class="card-meta">${esc(v.id)}${v.released_at ? " · " + fmtDate(v.released_at) : ""}</div>
      </div>
    </div>`;
  }

  function renderNext() {
    const list = searchResults || currentList;
    const slice = list.slice(rendered, rendered + PAGE);
    if (!slice.length) return;
    const frag = document.createDocumentFragment();
    slice.forEach((v) => {
      const el = document.createElement("div");
      el.innerHTML = cardHTML(v);
      frag.appendChild(el.firstElementChild);
    });
    grid.appendChild(frag);
    rendered += slice.length;

    // 懒加载封面
    grid.querySelectorAll("img[data-src]").forEach((img) => {
      const src = img.dataset.src;
      delete img.dataset.src;
      img.src = src;
    });
    updateSectionTitle();
  }

  function updateSectionTitle() {
    const total = searchResults || currentList;
    if (!searchResults && !currentList.length) {
      sectionTitle.textContent = "";
      return;
    }
    const label = searchResults ? `搜索 “${searchInput.value}”`
      : `${FEED_LABELS[currentFeed] || currentFeed}`;
    sectionTitle.innerHTML = `${esc(label)} <span class="count">${total.length}</span>`;
  }

  function switchFeed(feed) {
    currentFeed = feed;
    searchInput.value = "";
    searchResults = null;
    searchClear.style.display = "none";
    currentList = (feeds[feed] || []).map((id) => videos.get(id)).filter(Boolean);
    rendered = 0;
    grid.innerHTML = "";
    tabs.querySelectorAll(".tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.feed === feed));
    if (currentList.length) renderNext();
    else state.innerHTML = `<div class="empty">该分类暂无数据,等待数据刷新…</div>`;
  }

  /* ---------- 搜索 ---------- */
  const norm = (s) => s.toLowerCase().normalize("NFKC").trim();

  function doSearch(keyword) {
    const q = norm(keyword);
    if (!q) { searchResults = null; rendered = 0; grid.innerHTML = ""; renderNext(); return; }
    const terms = q.split(/\s+/);
    const results = [];
    for (const v of videos.values()) {
      const hay = norm([
        v.id, v.title, v.title_cn, displayActresses(v),
        (v.series || []).join(" "), (v.genres || []).join(" "),
        (v.labels || []).join(" "), (v.tags || []).join(" "),
      ].join(" "));
      if (terms.every((t) => hay.includes(t))) results.push(v);
    }
    // 相关度排序:标题匹配优先
    results.sort((a, b) =>
      (norm(a.title + a.title_cn).includes(q) ? 0 : 1) -
      (norm(b.title + b.title_cn).includes(q) ? 0 : 1));
    searchResults = results;
    rendered = 0;
    grid.innerHTML = "";
    if (results.length) renderNext();
    else state.innerHTML = `<div class="empty">没有找到 “${esc(keyword)}” 相关的影片</div>`;
    updateSectionTitle();
    searchClear.style.display = q ? "block" : "none";
  }

  /* ---------- 详情弹窗 ---------- */
  function buildRelated(v) {
    const act = new Set(v.actresses || []);
    const series = new Set(v.series || []);
    const markers = new Set(v.markers || []);
    const genres = new Set(v.genres || []);
    const related = [];
    for (const o of videos.values()) {
      if (o.id === v.id) continue;
      let score = 0;
      if ((o.actresses || []).some((a) => act.has(a))) score += 3;
      if ((o.series || []).some((s) => series.has(s))) score += 2;
      if ((o.markers || []).some((m) => markers.has(m))) score += 1;
      const shareGenres = (o.genres || []).filter((g) => genres.has(g)).length;
      score += Math.min(shareGenres, 2);
      if (score >= 2) related.push({ v: o, score });
      if (related.length >= 48) break;
    }
    related.sort((a, b) => b.score - a.score);
    if (!related.length) {
      // 兜底:当前频道其他影片(按发行时间新→旧)
      const pool = (searchResults || currentList).filter((o) => o && o.id !== v.id)
        .sort((a, b) => (b.released_at || 0) - (a.released_at || 0));
      return pool.map((o) => ({ v: o, score: 0 })).slice(0, 12);
    }
    return related.slice(0, 12);
  }

  function openModal(v) {
    const act = displayActresses(v) || "—";
    const facts = [
      ["番号", v.id],
      ["时长", fmtDuration(v.duration) || "—"],
      ["发行", fmtDate(v.released_at) || "—"],
      ["演员", act],
      ["系列", (v.series || []).join("、") || "—"],
      ["制造商", (v.markers || []).join("、") || "—"],
      ["标签", (v.labels || []).join("、") || "—"],
      ["类型", (v.genres || []).slice(0, 6).join("、") || "—"],
    ];
    const tags = (v.genres || []).concat(v.tags || []).slice(0, 12);
    const related = buildRelated(v);
    modal.innerHTML = `
      <div class="modal-head">
        <img referrerpolicy="no-referrer" src="${coverUrl(v, "n")}" onerror="this.style.display='none'"
             onload="this.style.display='block'">
        <button class="modal-close" id="modal-close" aria-label="关闭">✕</button>
      </div>
      <div class="modal-body">
        <div class="modal-title">${esc(displayTitle(v))}</div>
        <div class="modal-sub">${esc(v.title || "")}</div>
        <div class="fact-grid">
          ${facts.map(([k, val]) => `<div class="fact"><span class="k">${k}</span><span class="v">${esc(val)}</span></div>`).join("")}
        </div>
        ${tags.length ? `<div class="tag-row">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
        <a class="btn-play" href="${videoUrl(v)}" target="_blank" rel="noopener">
          ▶ 前往原站播放
        </a>
        ${related.length ? `
        <div class="related">
          <h3>相关推荐(同演员 / 同系列)</h3>
          <div class="grid">${related.map(({ v: r }) => cardHTML(r)).join("")}</div>
        </div>` : ""}
      </div>`;
    $("#modal-close").addEventListener("click", closeModal);
    // 相关卡片点击
    modal.querySelectorAll(".card").forEach((c) =>
      c.addEventListener("click", () => openModal(videos.get(c.dataset.id))));
    modalOverlay.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    modalOverlay.classList.remove("open");
    document.body.style.overflow = "";
  }

  /* ---------- 事件 ---------- */
  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => doSearch(searchInput.value), 200);
  });
  searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(searchInput.value); });
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    doSearch("");
    searchInput.focus();
  });
  modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  grid.addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (card) openModal(videos.get(card.dataset.id));
  });

  // 无限滚动
  let busy = false;
  window.addEventListener("scroll", () => {
    if (busy) return;
    if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 800) {
      busy = true;
      requestAnimationFrame(() => { renderNext(); busy = false; });
    }
  });

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  /* ---------- 启动 ---------- */
  (async () => {
    buildTabs();
    const ok = await loadData();
    if (!ok) return;
    switchFeed("home");
  })();
})();
