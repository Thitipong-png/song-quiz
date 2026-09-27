import {
  createPlayer,
  createSnippetPlayer,
  loadPlaylistIds,
  parsePlaylistId,
  State,
} from "./player.js?v=1";
import { Queue } from "./queue.js?v=1";

// ทดสอบแล้ว: getPlaylist ให้มามากสุด 200 เพลง แม้เพลย์ลิสต์จะมีมากกว่านั้น
const PLAYLIST_CAP = 200;

// สุ่มจุดเริ่มท่อนในช่วงนี้ของความยาวเพลง (หลบอินโทรและฉากพูดต้น MV)
const SNIPPET_RANGE = [0.2, 0.6];

const el = {
  form: document.getElementById("setup-form"),
  url: document.getElementById("playlist-url"),
  snippetLength: document.getElementById("snippet-length"),
  loadBtn: document.getElementById("load-btn"),
  loadMsg: document.getElementById("load-msg"),
  status: document.getElementById("status"),
  prev: document.getElementById("prev-btn"),
  replay: document.getElementById("replay-btn"),
  play: document.getElementById("play-btn"),
  more: document.getElementById("more-btn"),
  next: document.getElementById("next-btn"),
  mute: document.getElementById("mute-btn"),
  volume: document.getElementById("volume"),
  volumeLabel: document.getElementById("volume-label"),
  reveal: document.getElementById("reveal-card"),
  revealNumber: document.getElementById("reveal-number"),
  revealTitle: document.getElementById("reveal-title"),
  revealClose: document.getElementById("reveal-close"),
};

const VOLUME_KEY = "song-quiz:volume";

let player = null;
let snippet = null;
let queue = null;
let loading = false;
// ทิศทางล่าสุดที่ผู้ใช้ขยับ ใช้เลือกว่าจะข้ามเพลงที่ error ไปทางไหน
let direction = 1;
// ข้อความสรุปการโหลด และจำนวนเพลงที่ข้ามไปเพราะเล่นไม่ได้
let loadSummary = "";
let skipped = 0;

// สถานะของเพลงปัจจุบัน
let cued = false;          // ตัวเล่นโหลดเพลงนี้เสร็จแล้ว (รู้ความยาวและชื่อเพลง)
let snippetStart = null;   // วินาทีที่ท่อนเริ่ม (null = ยังไม่เคยกดเล่นเพลงนี้)
let snippetActive = false; // กำลังเล่นท่อนอยู่
let autoPlayWhenCued = false; // เพลงก่อนหน้า error ระหว่างเล่น → เล่นเพลงใหม่ต่อให้เลย
let revealOpen = false;
let finished = false;      // เฉลยเพลงสุดท้ายไปแล้ว
let focusPlayWhenReady = false; // หลังปิดการ์ดเฉลย ให้โฟกัสปุ่ม ▶ (กด Enter เล่นต่อได้เลย)

if (location.protocol === "file:") {
  el.status.textContent =
    "เปิดไฟล์ตรง ๆ ไม่ได้ (YouTube จะขึ้น error 153) ให้รันผ่าน local server ตามวิธีใน README";
} else {
  init();
}

async function init() {
  player = await createPlayer("player", {
    onStateChange: handleStateChange,
    onError: handleError,
    onAutoplayBlocked: () => {
      snippetActive = false;
      render();
      el.status.textContent = "เบราว์เซอร์บล็อกเสียง ให้กดปุ่มเล่นอีกครั้ง";
    },
  });
  snippet = createSnippetPlayer(player, () => {
    snippetActive = false;
    render();
  });

  el.url.disabled = false;
  el.snippetLength.disabled = false;
  el.loadBtn.disabled = false;
  el.status.textContent = "วางลิงก์เพลย์ลิสต์ด้านบน แล้วกดโหลด";

  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    loadPlaylist();
  });

  // การเล่นทุกครั้งต้องเริ่มจากการกดปุ่ม เบราว์เซอร์จึงยอมให้มีเสียง
  el.play.addEventListener("click", togglePlay);
  el.replay.addEventListener("click", () => playSnippet(snippetStart));
  el.more.addEventListener("click", () => {
    snippet.extend(snippetSeconds());
    snippetActive = true;
    render();
  });
  el.next.addEventListener("click", openReveal);
  el.prev.addEventListener("click", () => move(-1));
  el.revealClose.addEventListener("click", closeReveal);

  setupVolume();
}

// ---------- เล่นท่อน ----------

function snippetSeconds() {
  return Number(el.snippetLength.value);
}

// สุ่มจุดเริ่มกลางเพลง และเผื่อให้เล่นครบท่อนก่อนเพลงจบ
function pickSnippetStart() {
  const duration = player.getDuration();
  if (!(duration > 0)) return 0;
  const [from, to] = SNIPPET_RANGE;
  const start = duration * (from + Math.random() * (to - from));
  const latest = Math.max(0, duration - snippetSeconds() - 1);
  return Math.floor(Math.min(start, latest));
}

function playSnippet(start) {
  snippet.playFrom(start, snippetSeconds());
  snippetActive = true;
  render();
}

// ▶/⏸: ครั้งแรกเล่นท่อนที่สุ่มไว้ · กดระหว่างเล่นเพื่อหยุด · กดอีกครั้งเล่นต่อจนครบท่อน
// ถ้าท่อนจบไปแล้ว ▶ จะเล่นท่อนเดิมซ้ำ
function togglePlay() {
  if (snippetActive) {
    snippet.pause();
    snippetActive = false;
  } else if (snippetStart === null) {
    snippetStart = pickSnippetStart();
    playSnippet(snippetStart);
    return;
  } else if (snippet.resume()) {
    snippetActive = true;
  } else {
    playSnippet(snippetStart);
    return;
  }
  render();
}

// ---------- เฉลย ----------

// กด "ถัดไป" → โชว์ชื่อเพลงที่เพิ่งทาย ต้องกดปิดเองเท่านั้น
function openReveal() {
  revealOpen = true;
  el.revealNumber.textContent = `เพลงที่ ${queue.position} / ${queue.size}`;
  el.revealTitle.textContent = player.getVideoData().title || "(ไม่ทราบชื่อเพลง)";
  el.revealClose.textContent = queue.hasNext ? "ปิด แล้วไปเพลงถัดไป" : "ปิด (เพลงสุดท้ายแล้ว)";
  el.reveal.hidden = false;
  render();
  el.revealClose.focus();
}

// ปิดการ์ด → โหลดเพลงถัดไปรอไว้ ผู้เล่นกด ▶ เอง
function closeReveal() {
  revealOpen = false;
  el.reveal.hidden = true;
  if (queue.hasNext) {
    // ปุ่ม ▶ ยังกดไม่ได้จนกว่าเพลงถัดไปจะโหลดเสร็จ จึงค่อยย้ายโฟกัสใน render()
    focusPlayWhenReady = true;
    move(1);
  } else {
    snippet.stop();
    snippetActive = false;
    finished = true;
    render();
  }
}

// ---------- คิวเพลง ----------

async function loadPlaylist() {
  const playlistId = parsePlaylistId(el.url.value);
  if (!playlistId) {
    el.loadMsg.textContent = "ไม่พบรหัสเพลย์ลิสต์ในลิงก์นี้ (ลิงก์ต้องมี list=...)";
    return;
  }

  loading = true;
  snippet.stop();
  resetSong();
  queue = null;
  revealOpen = false;
  el.reveal.hidden = true;
  render();
  el.loadBtn.disabled = true;
  el.loadMsg.textContent = "กำลังโหลดเพลย์ลิสต์…";

  try {
    const ids = await loadPlaylistIds(player, playlistId, (attempt, total) => {
      el.loadMsg.textContent = `กำลังโหลดเพลย์ลิสต์… (ลองครั้งที่ ${attempt}/${total})`;
    });
    queue = new Queue(ids);
    skipped = 0;
    loadSummary =
      `โหลดแล้ว ${ids.length} เพลง สุ่มลำดับเรียบร้อย` +
      (ids.length >= PLAYLIST_CAP
        ? ` (YouTube ให้มาแค่ ${PLAYLIST_CAP} เพลงแรกของเพลย์ลิสต์)`
        : "");
    updateLoadMsg();
    loading = false; // ต้องปิดก่อน cue เพื่อให้ error ของเพลงแรกถูกจัดการ
    cueCurrent();
  } catch {
    el.loadMsg.textContent =
      "โหลดเพลย์ลิสต์ไม่ได้ ตรวจว่าลิงก์ถูก และเพลย์ลิสต์เป็นแบบสาธารณะหรือไม่เป็นส่วนตัว";
    render();
  } finally {
    loading = false;
    el.loadBtn.disabled = false;
  }
}

function move(step) {
  if (!queue) return;
  direction = step;
  if (step > 0) queue.next();
  else queue.prev();
  cueCurrent();
}

function resetSong() {
  cued = false;
  snippetStart = null;
  snippetActive = false;
  finished = false;
}

// โหลดเพลงปัจจุบันเข้าตัวเล่นโดยไม่รีเฟรชหน้า ปุ่มเล่นจะกดได้เมื่อโหลดเสร็จ (CUED)
function cueCurrent() {
  snippet.stop();
  resetSong();
  player.cueVideoById(queue.current);
  render();
}

function handleStateChange(state) {
  if (loading || !queue) return;
  // รับเฉพาะ CUED ของเพลงปัจจุบัน กันไม่ให้ event ที่มาช้าจากเพลงก่อนหน้าหลุดเข้ามา
  if (state === State.CUED && player.getVideoData().video_id === queue.current) {
    cued = true;
    if (autoPlayWhenCued) {
      autoPlayWhenCued = false;
      snippetStart = pickSnippetStart();
      playSnippet(snippetStart);
      return;
    }
    render();
  }
}

// เพลงเล่นไม่ได้ (100 ไม่พบ/ส่วนตัว, 101/150 ห้ามฝัง, 5 ฯลฯ) → ตัดทิ้งแล้วไปเพลงถัดไปเอง
function handleError(code) {
  if (loading || !queue || queue.isEmpty) return;
  autoPlayWhenCued = snippetActive;
  queue.removeCurrent(direction);
  skipped++;
  updateLoadMsg(code);
  if (queue.isEmpty) {
    snippet.stop();
    resetSong();
    queue = null;
    render();
    el.status.textContent = "ไม่มีเพลงในเพลย์ลิสต์นี้ที่เล่นได้";
    return;
  }
  cueCurrent();
}

// ---------- หน้าจอ ----------

function updateLoadMsg(lastErrorCode) {
  el.loadMsg.textContent = skipped
    ? `${loadSummary} · ข้ามเพลงที่เล่นไม่ได้แล้ว ${skipped} เพลง (ล่าสุด error ${lastErrorCode})`
    : loadSummary;
}

// เปิด/ปิดปุ่มตามสถานะ ระหว่างการ์ดเฉลยเปิดอยู่ กดได้แค่ปุ่มปิดการ์ดกับปุ่มเสียง
function render() {
  const ready = !!queue && cued && !revealOpen && !finished;
  el.play.disabled = !ready;
  el.replay.disabled = !ready || snippetStart === null;
  el.more.disabled = !ready || snippetStart === null;
  el.next.disabled = !ready;
  el.prev.disabled = !queue || revealOpen || !queue.hasPrev;
  el.play.textContent = snippetActive ? "⏸ หยุด" : "▶ เล่น";
  if (focusPlayWhenReady && ready) {
    focusPlayWhenReady = false;
    el.play.focus();
  }

  if (!queue) {
    el.status.textContent = loading ? "กำลังโหลดเพลย์ลิสต์…" : "ยังไม่มีเพลย์ลิสต์";
  } else if (finished) {
    el.status.textContent = `จบเพลย์ลิสต์แล้ว 🎉 ครบ ${queue.size} เพลง`;
  } else {
    el.status.textContent = `เพลงที่ ${queue.position} / ${queue.size}`;
  }
}

// ---------- ระดับเสียง ----------

// ปุ่มเสียงแบบ YouTube: กดไอคอนเพื่อปิด/เปิดเสียง ลากแถบเพื่อปรับระดับ
// เก็บค่าไว้ในเบราว์เซอร์ เปิดเกมครั้งหน้าจะได้ระดับเสียงเดิม
function setupVolume() {
  let { volume, muted } = readSavedVolume();

  const apply = () => {
    player.setVolume(volume);
    if (muted || volume === 0) player.mute();
    else player.unMute();

    const shown = muted ? 0 : volume;
    el.volume.value = shown;
    el.volumeLabel.textContent = `${shown}%`;
    el.mute.textContent = shown === 0 ? "🔇" : shown < 34 ? "🔈" : shown < 67 ? "🔉" : "🔊";
    el.mute.setAttribute("aria-label", shown === 0 ? "เปิดเสียง" : "ปิดเสียง");
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume, muted }));
    } catch {
      // เบราว์เซอร์ไม่ให้เก็บข้อมูลก็ไม่เป็นไร แค่จำค่าไม่ได้
    }
  };

  el.volume.addEventListener("input", () => {
    volume = Number(el.volume.value);
    muted = false; // ลากแถบแล้วถือว่าเปิดเสียง เหมือน YouTube
    apply();
  });

  el.mute.addEventListener("click", () => {
    if (muted || volume === 0) {
      muted = false;
      if (volume === 0) volume = 50; // ปิดเสียงด้วยการลากไป 0 แล้วกดเปิด ให้กลับมาที่ครึ่งหนึ่ง
    } else {
      muted = true; // ระดับเสียงเดิมยังจำไว้ กดอีกครั้งจะกลับมาที่ระดับเดิม
    }
    apply();
  });

  el.mute.disabled = false;
  el.volume.disabled = false;
  apply();
}

function readSavedVolume() {
  try {
    const saved = JSON.parse(localStorage.getItem(VOLUME_KEY));
    if (saved && Number.isFinite(saved.volume)) {
      return { volume: Math.min(100, Math.max(0, saved.volume)), muted: !!saved.muted };
    }
  } catch {
    // ไม่มีค่าที่เก็บไว้ หรืออ่านไม่ได้ ใช้ค่าเริ่มต้น
  }
  return { volume: 100, muted: false };
}
