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
    res.json({ path: rel, folders });
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
      name: f.name,
      size: f.size,
      audio: isAudio(f.name),
      url: joinUrlPath(rel, f.name),
    }));
    res.json({ path: rel, folders, files: fileList });
  } catch (e) {
    res.status(400).json({ error: "폴더를 열 수 없습니다. (공유 루트가 설정되어 있는지 확인하세요)" });
  }
});

function joinUrlPath(rel, name) {
  const parts = (rel ? rel.split("/") : []).concat(name).filter(Boolean);
  return "/" + parts.map(encodeURIComponent).join("/");
}

// ---------- 웹 UI ----------

app.get("/", (req, res) => {
  res.type("html").send(HTML_PAGE);
});

app.get("/_ui", (req, res) => {
  res.type("html").send(HTML_PAGE);
});

// ---------- 실제 파일 서빙 (재생/다운로드/Range 지원) ----------

app.get(/^\/(?!_api|_ui).*/, (req, res) => {
  const decodedPath = decodeURIComponent(req.path);
  const rel = decodedPath.replace(/^\/+/, "");

  let abs;
  try {
    abs = safeResolve(getShareRootAbs(), rel);
  } catch (e) {
    return res.status(400).send("잘못된 경로입니다.");
  }

  fs.stat(abs, (err, stat) => {
    if (err) return res.status(404).send("파일을 찾을 수 없습니다.");

    if (stat.isDirectory()) {
      // 폴더 자체를 직접 열면 UI로 안내
      return res.redirect("/_ui?p=" + encodeURIComponent(rel));
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
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, "Malgun Gothic", sans-serif; margin:0; padding:16px; max-width:720px; margin:0 auto; }
  h1 { font-size:18px; }
  .bar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:12px; }
  button { padding:6px 10px; border-radius:6px; border:1px solid #888; background:transparent; cursor:pointer; }
  .crumb { cursor:pointer; color:#0a7; text-decoration:underline; }
  ul { list-style:none; padding:0; margin:0; }
  li { display:flex; align-items:center; gap:8px; padding:8px 4px; border-bottom:1px solid #6666; }
  .name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .folder { cursor:pointer; font-weight:bold; }
  .size { color:#888; font-size:12px; min-width:60px; text-align:right; }
  audio { width:120px; height:28px; }
  .toast { position:fixed; bottom:16px; left:50%; transform:translateX(-50%); background:#333; color:#fff; padding:8px 16px; border-radius:6px; display:none; }
  .rootbox { padding:8px; border:1px dashed #888; border-radius:6px; margin-bottom:12px; font-size:13px; }
</style>
</head>
<body>
<h1>📁 HTTP File Server</h1>
<div class="rootbox" id="rootbox"></div>
<div class="bar" id="crumbs"></div>
<ul id="list"></ul>
<div class="toast" id="toast"></div>

<script>
let mode = "normal"; // normal | pick
let curPath = "";

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
  const res = await fetch("/_api/settings");
  const data = await res.json();
  document.getElementById("rootbox").textContent =
    "현재 공유 루트: " + (data.shareRoot ? "/" + data.shareRoot : "(미설정: media 폴더 전체)");
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
    data.folders.forEach((name) => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.className = "name folder";
      span.textContent = "📁 " + name;
      span.onclick = () => { curPath = curPath ? curPath + "/" + name : name; load(); };
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
    data.folders.forEach((name) => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.className = "name folder";
      span.textContent = "📁 " + name;
      span.onclick = () => { curPath = curPath ? curPath + "/" + name : name; load(); };
      li.appendChild(span);
      listEl.appendChild(li);
    });
    data.files.forEach((f) => {
      const li = document.createElement("li");

      const nameSpan = document.createElement("span");
      nameSpan.className = "name";
      nameSpan.textContent = (f.audio ? "🎵 " : "📄 ") + f.name;
      li.appendChild(nameSpan);

      const sizeSpan = document.createElement("span");
      sizeSpan.className = "size";
      sizeSpan.textContent = fmtSize(f.size);
      li.appendChild(sizeSpan);

      if (f.audio) {
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.preload = "none";
        audio.src = f.url;
        li.appendChild(audio);
      }

      const dl = document.createElement("button");
      dl.textContent = "⬇";
      dl.title = "다운로드";
      dl.onclick = () => { window.location.href = f.url + "?download=1"; };
      li.appendChild(dl);

      const copy = document.createElement("button");
      copy.textContent = "🔗";
      copy.title = "URL 복사";
      copy.onclick = async () => {
        const full = window.location.origin + f.url;
        try {
          await navigator.clipboard.writeText(full);
          toast("URL이 복사되었습니다");
        } catch(e) {
          prompt("아래 URL을 복사하세요", full);
        }
      };
      li.appendChild(copy);

      listEl.appendChild(li);
    });
    if (data.folders.length === 0 && data.files.length === 0) {
      listEl.innerHTML = "<li>(빈 폴더)</li>";
    }
  }
}

load();
</script>
</body>
</html>`;
