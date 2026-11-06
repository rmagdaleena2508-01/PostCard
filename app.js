// Postcards — a personal, credited collection of nature videos.
// Videos come from videos.json (shared, edit and redeploy) plus ones saved
// in this browser (localStorage). Export merges both into a new videos.json.

const STORE_KEY = "postcards.v1";
const HIDDEN_KEY = "postcards.hidden.v1";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

let shared = [];
let local = store.get(STORE_KEY, []);
let hidden = new Set(store.get(HIDDEN_KEY, []));
let filter = "All";

/* ---------- Link parsing ---------- */
function parseLink(raw) {
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "instagram.com") {
    const i = parts.findIndex(p => ["p", "reel", "reels", "tv"].includes(p));
    if (i > -1 && parts[i + 1]) {
      const code = parts[i + 1];
      return { platform: "Instagram", id: code, vertical: true,
        embed: `https://www.instagram.com/p/${code}/embed/`,
        source: `https://www.instagram.com/p/${code}/` };
    }
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const vi = parts.indexOf("video");
    if (vi > -1 && parts[vi + 1]) {
      const id = parts[vi + 1];
      const handle = parts.find(p => p.startsWith("@"));
      return { platform: "TikTok", id, vertical: true, handle,
        embed: `https://www.tiktok.com/embed/v2/${id}`,
        source: u.origin + u.pathname };
    }
    return { error: "Short TikTok links can't be read here. Open the link, then copy the full address (it has /video/ in it)." };
  }
  if (host === "youtube.com" || host === "youtu.be" || host === "music.youtube.com") {
    let id = host === "youtu.be" ? parts[0] : u.searchParams.get("v");
    let vertical = false;
    if (!id && (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live")) { id = parts[1]; vertical = parts[0] === "shorts"; }
    if (id) return { platform: "YouTube", id, vertical,
      embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`,
      thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      source: vertical ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}` };
  }
  if (host === "x.com" || host === "twitter.com") {
    const si = parts.indexOf("status");
    if (si > -1 && /^\d+$/.test(parts[si + 1] || "")) {
      const id = parts[si + 1];
      return { platform: "X", id, vertical: true, handle: si > 0 ? "@" + parts[0] : undefined,
        embed: `https://platform.twitter.com/embed/Tweet.html?id=${id}&theme=light&dnt=true`,
        source: `https://x.com/${si > 0 ? parts[0] : "i"}/status/${id}` };
    }
  }
  // Direct video files (e.g. video.twimg.com/…/clip.mp4)
  if (/\.(mp4|webm|mov|m4v)$/i.test(u.pathname)) {
    const platform = host.endsWith("twimg.com") ? "X" : host.replace(/^video\./, "");
    const num = u.pathname.match(/\/(\d{6,})\//);
    let h = 0;
    for (const c of u.origin + u.pathname) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const size = u.pathname.match(/\/(\d+)x(\d+)\//);
    return { platform, id: num ? num[1] : "f" + h.toString(36), file: true,
      vertical: size ? +size[2] > +size[1] : false,
      embed: u.href, source: u.href, needsSource: true };
  }
  if (host === "vimeo.com" && /^\d+$/.test(parts[0] || "")) {
    return { platform: "Vimeo", id: parts[0], vertical: false,
      embed: `https://player.vimeo.com/video/${parts[0]}?autoplay=1`,
      source: `https://vimeo.com/${parts[0]}` };
  }
  return null;
}

function profileUrl(platform, handle) {
  const h = handle.replace(/^@/, "");
  if (!h) return null;
  return {
    Instagram: `https://www.instagram.com/${h}/`,
    TikTok: `https://www.tiktok.com/@${h}`,
    YouTube: `https://www.youtube.com/@${h}`,
    Vimeo: `https://vimeo.com/${h}`,
    X: `https://x.com/${h}`,
  }[platform] || null;
}

/* ---------- Soft nature tiles for videos without a thumbnail ---------- */
const TILES = [
  ["#BFE3F0", "#7FC3C9", "#3E8E8C"], // ocean
  ["#F6D9B5", "#E9A87C", "#9C6B8E"], // sunset
  ["#D8EBC8", "#93C59A", "#4F8A6A"], // fynbos
  ["#E6E1F5", "#B7B8E6", "#6E7FB8"], // dusk
  ["#F3E7C9", "#C9C38F", "#7A8C5A"], // savanna
  ["#D3ECF7", "#A2C9E8", "#5E86B8"], // sky
];
function tileFor(text) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [a, b, c] = TILES[h % TILES.length];
  return `linear-gradient(165deg, ${a} 0%, ${b} 55%, ${c} 100%)`;
}

/* ---------- Data ---------- */
function all() {
  const seen = new Set();
  return [...local, ...shared].filter(v => {
    const key = v.platform + v.id;
    if (seen.has(key) || hidden.has(key)) return false;
    seen.add(key);
    return true;
  });
}
const cityOf = v => (v.country || "").split(",")[0].trim() || "Elsewhere";

/* ---------- Render ---------- */
function esc(s = "") {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderFilters(items) {
  const counts = items.reduce((m, v) => (m[cityOf(v)] = (m[cityOf(v)] || 0) + 1, m), {});
  const names = ["All", ...Object.keys(counts).sort((a, b) => counts[b] - counts[a])];
  if (!names.includes(filter)) filter = "All";
  $("#filters").hidden = items.length < 2;
  $("#filters").innerHTML = names.map(n => `
    <button class="chip" role="tab" aria-selected="${n === filter}" data-filter="${esc(n)}">
      ${esc(n)}<span class="n">${n === "All" ? items.length : counts[n]}</span>
    </button>`).join("");
}

function renderGrid() {
  const items = all();
  renderFilters(items);
  const shown = filter === "All" ? items : items.filter(v => cityOf(v) === filter);

  $("#empty").hidden = items.length > 0;
  $("#count-pill").textContent = items.length
    ? `${items.length} place${items.length === 1 ? "" : "s"} saved so far`
    : "A personal collection";

  $("#grid").innerHTML = shown.map((v, i) => {
    const key = esc(v.platform + v.id);
    const profile = profileUrl(v.platform, v.creator || "");
    return `
    <li>
      <article class="card in" style="--d:${Math.min(i, 8) * 0.06}s">
        <button class="thumb" style="--tile:${tileFor(v.place + v.country)};width:calc(100% - 16px);border:0;padding:0;cursor:pointer;display:block"
          data-play="${key}" aria-label="Play ${esc(v.place)}, filmed by ${esc(v.creator)}">
          ${v.thumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy" width="480" height="360" />`
            : v.file ? `<video src="${esc(v.embed)}#t=1" muted playsinline preload="metadata" aria-hidden="true"></video>`
            : `<span class="thumb-word">${esc(v.place)}</span>`}
          <span class="platform">${esc(v.platform)}</span>
          <span class="play" aria-hidden="true"></span>
        </button>
        <div class="meta">
          <div class="meta-place">${esc(v.place)}</div>
          <div class="meta-country">${esc(v.country)}</div>
          <div class="meta-credit">Filmed by ${profile
            ? `<a href="${esc(profile)}" target="_blank" rel="noopener">${esc(v.creator)}</a>`
            : esc(v.creator)}</div>
        </div>
      </article>
    </li>`;
  }).join("");
}

/* ---------- Player ---------- */
function openPlayer(key) {
  const v = all().find(x => x.platform + x.id === key);
  if (!v) return;
  const frame = $("#player-frame");
  frame.classList.toggle("wide", !v.vertical);
  frame.innerHTML = v.file
    ? `<video src="${esc(v.embed)}" controls autoplay playsinline title="${esc(v.place)} by ${esc(v.creator)}"></video>`
    : `<iframe src="${esc(v.embed)}" title="${esc(v.place)} by ${esc(v.creator)}"
    allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"
    referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  $("#player-place").textContent = v.place;
  $("#player-country").textContent = v.country;
  $("#player-note").textContent = v.note || "";
  $("#player-note").hidden = !v.note;
  const creator = $("#player-creator");
  creator.textContent = v.creator;
  creator.href = profileUrl(v.platform, v.creator) || v.source;
  $("#player-source").href = v.source;
  $("#player-source").textContent = `Watch the original on ${v.platform}`;
  $("#player-remove").dataset.key = key;
  $("#player").showModal();
}
function closePlayer() {
  $("#player-frame").innerHTML = ""; // stops playback
  $("#player").close();
}

/* ---------- Add ---------- */
const form = $("#add-form");
const urlInput = form.elements.url;

urlInput.addEventListener("input", () => {
  const hint = $("#url-hint");
  const p = urlInput.value ? parseLink(urlInput.value) : null;
  hint.classList.toggle("ok", !!(p && !p.error));
  if (!urlInput.value) hint.textContent = "We'll play it from the original post.";
  else if (!p) hint.textContent = "Paste a link from Instagram, TikTok, X, YouTube or Vimeo, or a direct .mp4 link.";
  else if (p.error) hint.textContent = p.error;
  else {
    hint.textContent = p.file
      ? `Video file found. Add the original post link below so the creator gets credit.`
      : `${p.platform} video found.`;
    if (p.handle && !form.elements.creator.value) form.elements.creator.value = p.handle;
  }
});

form.addEventListener("submit", e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  const p = parseLink(f.url || "");
  const err = $("#form-error");
  if (!p || p.error) return (err.textContent = p?.error || "That link doesn't look like a video we can play.");
  if (!f.place.trim() || !f.country.trim()) return (err.textContent = "Add the place and where it is.");
  if (!f.creator.trim()) return (err.textContent = "Add the creator's handle so they get the credit.");
  const creator = f.creator.trim().startsWith("@") ? f.creator.trim() : "@" + f.creator.trim();
  let source = p.source;
  if (f.post && f.post.trim()) {
    try { source = new URL(f.post.trim()).href; } catch { return (err.textContent = "The original post link doesn't look right."); }
  }
  const entry = {
    platform: p.platform, id: p.id, embed: p.embed, source, vertical: p.vertical, file: p.file || undefined,
    thumb: p.thumb, place: f.place.trim(), country: f.country.trim(), creator,
    note: f.note.trim(), added: new Date().toISOString().slice(0, 10),
  };
  local = [entry, ...local.filter(v => v.platform + v.id !== p.platform + p.id)];
  hidden.delete(p.platform + p.id);
  store.set(STORE_KEY, local);
  store.set(HIDDEN_KEY, [...hidden]);
  err.textContent = "";
  form.reset();
  $("#url-hint").textContent = "We'll play it from the original post.";
  $("#add").close();
  filter = "All";
  renderGrid();
  document.getElementById("collection").scrollIntoView({ behavior: "smooth" });
});

/* ---------- Export / import ---------- */
$("#export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(all(), null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "videos.json" });
  a.click();
  URL.revokeObjectURL(a.href);
});
$("#import").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const items = JSON.parse(await file.text());
    if (!Array.isArray(items)) throw 0;
    const keys = new Set(local.map(v => v.platform + v.id));
    local = [...local, ...items.filter(v => v.platform && v.id && !keys.has(v.platform + v.id))];
    store.set(STORE_KEY, local);
    renderGrid();
  } catch { alert("That file isn't a Postcards export."); }
  e.target.value = "";
});

/* ---------- Events ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-play],[data-filter],[data-open-add],[data-close],#player-remove");
  if (!t) {
    if (e.target === $("#player")) closePlayer();
    if (e.target === $("#add")) $("#add").close();
    return;
  }
  if (t.dataset.play) openPlayer(t.dataset.play);
  else if (t.dataset.filter) { filter = t.dataset.filter; renderGrid(); }
  else if ("openAdd" in t.dataset) { $("#form-error").textContent = ""; $("#add").showModal(); urlInput.focus(); }
  else if ("close" in t.dataset) t.closest("dialog").id === "player" ? closePlayer() : t.closest("dialog").close();
  else if (t.id === "player-remove") {
    const key = t.dataset.key;
    local = local.filter(v => v.platform + v.id !== key);
    hidden.add(key);
    store.set(STORE_KEY, local);
    store.set(HIDDEN_KEY, [...hidden]);
    closePlayer();
    renderGrid();
  }
});
$("#player").addEventListener("cancel", e => { e.preventDefault(); closePlayer(); });

const nav = $("#nav");
addEventListener("scroll", () => nav.classList.toggle("scrolled", scrollY > 24), { passive: true });

/* ---------- Boot ---------- */
fetch("videos.json", { cache: "no-store" })
  .then(r => (r.ok ? r.json() : []))
  .catch(() => [])
  .then(items => {
    shared = Array.isArray(items) ? items : [];
    renderGrid();
  });
