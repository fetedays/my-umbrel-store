const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const MEDIA_ROOT = process.env.MEDIA_ROOT || "/data/media";
const CONFIG_DIR = process.env.CONFIG_DIR || "/data/config";
const SETTINGS_PATH = path.join(CONFIG_DIR, "settings.json");

// ---------- 설정(공유 루트 폴더) 저장/조회 ----------

function readSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return { shareRoot: "" };
  }
}

function writeSettings(settings) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf8");
}

function getShareRootAbs() {
  const settings = readSettings();
  return safeResolve(MEDIA_ROOT, settings.shareRoot || "");
}

// ---------- 경로 안전 처리 (상위 폴더 탈출 방지) ----------

function safeResolve(base, rel) {
  const target = path.normalize(path.join(base, rel || ""));
  const baseNorm = path.normalize(base);
  if (target !== baseNorm && !target.startsWith(baseNorm + path.sep)) {
    throw new Error("invalid path");
  }
  return target;
}

function listDir(absDir) {
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  const folders = [];
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      folders.push(entry.name);
    } else if (entry.isFile()) {
      const stat = fs.statSync(path.join(absDir, entry.name));
      files.push({ name: entry.name, size: stat.size });
    }
  }
  folders.sort((a, b) => a.localeCompare(b, "ko"));
  files.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return { folders, files };
}

function isAudio(name) {
  return /\.(mp3|m4a|flac|wav|ogg|aac)$/i.test(name);
}

// macOS는 한글을 자모 분리형(NFD)으로 저장할 수 있습니다.
// 화면/다운로드 이름은 NFC로 표시하되, 실제 경로에는 원본 이름을 사용합니다.
function displayName(name) {
  return name.normalize("NFC");
}

// URL은 완성형(NFC) 한글을 사용하지만, 디스크에는 자모 분리형(NFD)으로
// 저장된 파일이 있을 수 있으므로 각 경로 요소를 실제 이름과 매칭합니다.
function resolveUnicodePath(base, rel) {
  const safeBase = path.normalize(base);
  let current = safeBase;
  for (const part of rel.split("/").filter(Boolean)) {
    const exact = path.join(current, part);
    if (fs.existsSync(exact)) {
      current = exact;
      continue;
    }
    const match = fs.readdirSync(current).find((name) => displayName(name) === displayName(part));
    if (!match) return null;
    current = path.join(current, match);
  }
  return current;
}

// ---------- API: 공유 루트 설정 ----------

app.get("/_api/settings", (req, res) => {
  res.json(readSettings());
});

app.post("/_api/settings", (req, res) => {
  const shareRoot = String(req.body.shareRoot || "");
  try {
    safeResolve(MEDIA_ROOT, shareRoot); // 유효성 검사
  } catch (e) {
    return res.status(400).json({ error: "잘못된 경로입니다." });
  }
  writeSettings({ shareRoot });
  res.json({ ok: true, shareRoot });
});

// ---------- API: 루트 선택용 탐색 (MEDIA_ROOT 기준, 폴더만) ----------

app.get("/_api/browse", (req, res) => {
  const rel = req.query.p || "";
  try {
    const abs = safeResolve(MEDIA_ROOT, rel);
    const { folders } = listDir(abs);
    res.json({ path: rel, folders: folders.map((name) => ({ name: displayName(name), pathName: name })) });
  } catch (e) {
    res.status(400).json({ error: "폴더를 열 수 없습니다." });
  }
});

// ---------- API: 실제 서비스 폴더 탐색 (shareRoot 기준) ----------

app.get("/_api/list", (req, res) => {
  const rel = req.query.p || "";
  try {
    const abs = safeResolve(getShareRootAbs(), rel);
    const { folders, files } = listDir(abs);
    const fileList = files.map((f) => ({
      name: displayName(f.name),
      pathName: f.name,
      size: f.size,
      audio: isAudio(f.name),
      url: joinUrlPath(rel, f.name),
    }));
    res.json({ path: rel, folders: folders.map((name) => ({ name: displayName(name), pathName: name })), files: fileList });
  } catch (e) {
    res.status(400).json({ error: "폴더를 열 수 없습니다. (공유 루트가 설정되어 있는지 확인하세요)" });
  }
});

function joinUrlPath(rel, name) {
  const parts = (rel ? rel.split("/") : []).concat(name).filter(Boolean);
  return "/" + parts.map((part) => encodeURIComponent(displayName(part))).join("/");
}

// ---------- 웹 UI ----------

app.get("/", (req, res) => {
  try {
    const root = getShareRootAbs();
    return res.type("html").send(directoryListing(root, ""));
  } catch (e) {
    return res.status(400).send("공유 루트가 설정되지 않았거나 폴더를 열 수 없습니다.");
  }
});

app.get("/_ui", (req, res) => {
  res.type("html").send(HTML_PAGE);
});

function htmlEscape(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function directoryListing(absDir, rel) {
  const entries = fs.readdirSync(absDir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const links = entries.map((entry) => {
    const href = entry.isDirectory()
      ? joinUrlPath(rel, entry.name) + "/"
      : joinUrlPath(rel, entry.name);
    const label = entry.isDirectory() ? "📁 " + displayName(entry.name) + "/" : displayName(entry.name);
    return `<li><a href="${htmlEscape(href)}">${htmlEscape(label)}</a></li>`;
  }).join("\n");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${htmlEscape(rel || "/")}</title></head><body><h1>${htmlEscape(rel || "/")}</h1><ul>${links}</ul></body></html>`;
}

// ---------- 실제 파일 서빙 (재생/다운로드/Range 지원) ----------

app.get(/^\/(?!_api|_ui).*/, (req, res) => {
  const decodedPath = decodeURIComponent(req.path);
  const rel = decodedPath.replace(/^\/+/, "");

  let abs;
  try {
    const root = getShareRootAbs();
    abs = resolveUnicodePath(root, rel);
    if (!abs || !safeResolve(root, path.relative(root, abs))) throw new Error("invalid path");
  } catch (e) {
    return res.status(400).send("잘못된 경로입니다.");
  }

  fs.stat(abs, (err, stat) => {
    if (err) return res.status(404).send("파일을 찾을 수 없습니다.");

    if (stat.isDirectory()) {
      // Galaxy Home Music은 폴더 HTML의 href에서 오디오 목록을 읽습니다.
      // 따라서 UI로 리다이렉트하지 않고 표준 디렉터리 목록을 반환합니다.
      return res.type("html").send(directoryListing(abs, rel));
    }

    if (req.query.download !== undefined) {
      const filename = path.basename(abs);
      const fallback = filename.replace(/[^\x20-\x7E]/g, "_");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
      );
    }

    // res.sendFile 은 Range 헤더, mime 타입을 자동으로 처리합니다.
    res.sendFile(abs);
  });
});

const PORT = 80;
app.listen(PORT, () => {
  console.log(`HTTP File Server listening on port ${PORT}`);
  console.log(`MEDIA_ROOT=${MEDIA_ROOT}`);
});

// ---------- 프론트엔드 (단일 HTML, 별도 빌드 없음) ----------

const HTML_PAGE = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HTTP File Server</title>
<style>
  :root { color-scheme: light dark; --accent:#10b981; --panel:rgba(127,127,127,.12); --line:rgba(127,127,127,.22); }
  * { box-sizing:border-box; }
  body { font-family:-apple-system, BlinkMacSystemFont, "Malgun Gothic", sans-serif; margin:0 auto; padding:22px 16px 48px; max-width:900px; background:radial-gradient(circle at 10% 0%, rgba(16,185,129,.12), transparent 35%); }
  h1 { margin:0; font-size:24px; letter-spacing:-.04em; }
  .subtitle { margin:5px 0 20px; color:#888; font-size:13px; }
  .bar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:12px; }
  button { padding:6px 10px; border-radius:6px; border:1px solid #888; background:transparent; cursor:pointer; }
  .crumb { cursor:pointer; color:#0a7; text-decoration:underline; }
  ul { list-style:none; padding:0; margin:0; }
  li { display:flex; align-items:center; gap:10px; padding:12px 13px; margin:7px 0; border:1px solid var(--line); border-radius:13px; background:var(--panel); }
  .name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .folder { cursor:pointer; font-weight:bold; }
  .size { color:#888; font-size:12px; min-width:60px; text-align:right; }
  audio { width:120px; height:28px; }
  .toast { position:fixed; bottom:16px; left:50%; transform:translateX(-50%); background:#333; color:#fff; padding:8px 16px; border-radius:6px; display:none; }
  .rootbox { padding:8px; border:1px dashed #888; border-radius:6px; margin-bottom:12px; font-size:13px; }
  .infobox { padding:17px; border-radius:18px; margin-bottom:14px; background:var(--panel); border:1px solid var(--line); box-shadow:0 12px 35px rgba(0,0,0,.08); }
  .toolbar input { flex:1; min-width:180px; padding:10px 12px; border-radius:10px; border:1px solid var(--line); background:var(--panel); color:inherit; }
  .empty { justify-content:center; color:#888; padding:28px; }
  .count { color:#888; font-size:12px; margin-left:auto; }
  @media (max-width:650px) { li{flex-wrap:wrap} audio{order:4; width:100%} }
  .infobox .label { font-size:12px; opacity:0.8; margin-bottom:2px; }
  .infobox .url { font-size:16px; font-weight:bold; word-break:break-all; user-select:all; }
  .infobox .row { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
  .infobox button { flex-shrink:0; }
</style>
</head>
<body>
<h1>📁 HTTP File Server</h1>
<div class="subtitle">음악과 파일을 집 안의 기기에서 바로 열어보세요</div>
<div class="infobox">
  <div class="row">
    <div>
      <div class="label">서버 기본 주소 (Galaxy Home Mini 등에서 이 뒤에 파일 경로를 붙여 쓰세요)</div>
      <div class="url" id="baseurl">불러오는 중...</div>
    </div>
    <button onclick="copyBaseUrl()">🔗 복사</button>
  </div>
  <div class="label">현재 공유 중인 폴더</div>
  <div class="url" id="rootbox">불러오는 중...</div>
</div>
<div class="bar" id="crumbs"></div>
<div class="toolbar"><input id="search" type="search" placeholder="파일명 검색..." oninput="renderList()"><select id="sort" onchange="renderList()"><option value="name">이름순</option><option value="size">크기순</option></select><button onclick="load()">↻ 새로고침</button><span class="count" id="count"></span></div>
<ul id="list"></ul>
<div class="toast" id="toast"></div>

<script>
let mode = "normal"; // normal | pick
let curPath = "";
let currentData = { folders: [], files: [] };

function toast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.display = "block";
  setTimeout(()=> t.style.display = "none", 1500);
}

function fmtSize(n){
  if (n > 1024*1024*1024) return (n/1024/1024/1024).toFixed(1) + " GB";
  if (n > 1024*1024) return (n/1024/1024).toFixed(1) + " MB";
  if (n > 1024) return (n/1024).toFixed(0) + " KB";
  return n + " B";
}

function renderList(){
  const listEl = document.getElementById("list");
  const query = (document.getElementById("search").value || "").toLocaleLowerCase();
  let files = currentData.files.filter(f => f.name.toLocaleLowerCase().includes(query));
  if (document.getElementById("sort").value === "size") files.sort((a,b) => b.size - a.size);
  else files.sort((a,b) => a.name.localeCompare(b.name,"ko"));
  document.getElementById("count").textContent = currentData.folders.length + "개 폴더 · " + files.length + "개 파일";
  listEl.querySelectorAll(".file-row").forEach(el => el.remove());
  files.forEach((f) => {
    const li = document.createElement("li"); li.className = "file-row";
    const nameSpan = document.createElement("span"); nameSpan.className = "name"; nameSpan.title = f.name; nameSpan.textContent = (f.audio ? "🎵 " : "📄 ") + f.name; li.appendChild(nameSpan);
    const sizeSpan = document.createElement("span"); sizeSpan.className = "size"; sizeSpan.textContent = fmtSize(f.size); li.appendChild(sizeSpan);
    if (f.audio) { const audio = document.createElement("audio"); audio.controls = true; audio.preload = "none"; audio.src = f.url; li.appendChild(audio); }
    const dl = document.createElement("button"); dl.textContent = "⬇"; dl.title = "다운로드"; dl.onclick = () => { window.location.href = f.url + "?download=1"; }; li.appendChild(dl);
    const copy = document.createElement("button"); copy.textContent = "🔗"; copy.title = "URL 복사"; copy.onclick = async () => { const full = window.location.origin + f.url; try { await navigator.clipboard.writeText(full); toast("URL이 복사되었습니다"); } catch(e) { prompt("아래 URL을 복사하세요", full); } }; li.appendChild(copy);
    listEl.appendChild(li);
  });
  if (!currentData.folders.length && !files.length) listEl.innerHTML = '<li class="empty">검색 결과가 없거나 빈 폴더입니다.</li>';
}

function renderCrumbs(){
  const box = document.getElementById("crumbs");
  box.innerHTML = "";
  if (mode === "pick") {
    const btn = document.createElement("button");
    btn.textContent = "✅ 이 폴더를 공유 루트로 설정";
    btn.onclick = setShareRoot;
    box.appendChild(btn);
    const cancel = document.createElement("button");
    cancel.textContent = "취소";
    cancel.onclick = () => { mode = "normal"; curPath = ""; load(); };
    box.appendChild(cancel);
  } else {
    const btn = document.createElement("button");
    btn.textContent = "⚙ 공유 루트 변경";
    btn.onclick = () => { mode = "pick"; curPath = ""; load(); };
    box.appendChild(btn);
  }
  const root = document.createElement("span");
  root.className = "crumb";
  root.textContent = "🏠";
  root.onclick = () => { curPath = ""; load(); };
  box.appendChild(root);

  const parts = curPath ? curPath.split("/") : [];
  let acc = "";
  parts.forEach((p) => {
    acc = acc ? acc + "/" + p : p;
    const span = document.createElement("span");
    span.className = "crumb";
    span.textContent = " / " + p;
    const target = acc;
    span.onclick = () => { curPath = target; load(); };
    box.appendChild(span);
  });
}

async function setShareRoot(){
  const res = await fetch("/_api/settings", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ shareRoot: curPath })
  });
  if (res.ok) {
    toast("공유 루트가 설정되었습니다");
    mode = "normal";
    curPath = "";
    load();
  } else {
    toast("설정 실패");
  }
}

async function loadRootInfo(){
  document.getElementById("baseurl").textContent = window.location.origin + "/";
  const res = await fetch("/_api/settings");
  const data = await res.json();
  document.getElementById("rootbox").textContent =
    data.shareRoot ? "/" + data.shareRoot : "(아직 미설정 — 아래 '⚙ 공유 루트 변경'으로 폴더를 지정하세요)";
}

async function copyBaseUrl(){
  const url = window.location.origin + "/";
  try {
    await navigator.clipboard.writeText(url);
    toast("서버 주소가 복사되었습니다");
  } catch(e) {
    prompt("아래 URL을 복사하세요", url);
  }
}

async function load(){
  renderCrumbs();
  const listEl = document.getElementById("list");
  listEl.innerHTML = "<li>불러오는 중...</li>";

  if (mode === "pick") {
    const res = await fetch("/_api/browse?p=" + encodeURIComponent(curPath));
    const data = await res.json();
    listEl.innerHTML = "";
    if (data.folders.length === 0) {
      listEl.innerHTML = "<li>(하위 폴더 없음)</li>";
    }
    data.folders.forEach((folder) => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.className = "name folder";
      span.textContent = "📁 " + folder.name;
      span.onclick = () => { curPath = curPath ? curPath + "/" + folder.pathName : folder.pathName; load(); };
      li.appendChild(span);
      listEl.appendChild(li);
    });
  } else {
    await loadRootInfo();
    const res = await fetch("/_api/list?p=" + encodeURIComponent(curPath));
    if (!res.ok) {
      listEl.innerHTML = "<li>공유 루트가 아직 설정되지 않았거나 폴더를 열 수 없습니다.</li>";
      return;
    }
    const data = await res.json();
    listEl.innerHTML = "";
    data.folders.forEach((folder) => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.className = "name folder";
      span.textContent = "📁 " + folder.name;
      span.onclick = () => { curPath = curPath ? curPath + "/" + folder.pathName : folder.pathName; load(); };
      li.appendChild(span);
      listEl.appendChild(li);
    });
    currentData = data;
    renderList();
  }
}

load();
</script>
</body>
</html>`;
