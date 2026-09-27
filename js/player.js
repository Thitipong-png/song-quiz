// ควบคุมตัวเล่น YouTube (IFrame Player API)
// ใช้ตัวเล่นตัวเดียวตลอดเกม: เปลี่ยนเพลงด้วย cueVideoById โดยไม่ต้องรีเฟรชหน้า

let apiReady = null;

// โหลดสคริปต์ API ครั้งเดียว และคืน Promise ที่สำเร็จเมื่อ API พร้อม
function loadApi() {
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = resolve;
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.append(tag);
  });
  return apiReady;
}

// สร้างตัวเล่นเปล่า ๆ แทนที่ element ที่มี id ตามที่ส่งมา
// handlers: { onReady, onStateChange(state), onError(code), onAutoplayBlocked }
export async function createPlayer(elementId, handlers = {}) {
  await loadApi();
  return new Promise((resolve) => {
    const player = new YT.Player(elementId, {
      width: 356,
      height: 200,
      playerVars: {
        playsinline: 1,
        rel: 0,
        origin: location.origin,
      },
      events: {
        onReady: () => {
          handlers.onReady?.();
          resolve(player);
        },
        onStateChange: (e) => handlers.onStateChange?.(e.data),
        onError: (e) => handlers.onError?.(e.data),
        onAutoplayBlocked: () => handlers.onAutoplayBlocked?.(),
      },
    });
  });
}

// ดึง playlist ID จากลิงก์ที่ผู้ใช้วาง (รับได้ทั้งลิงก์เต็มและ ID เปล่า ๆ)
// คืน null ถ้าหาไม่เจอ
export function parsePlaylistId(text) {
  const input = text.trim();
  if (!input) return null;
  try {
    const list = new URL(input).searchParams.get("list");
    if (list) return list;
  } catch {
    // ไม่ใช่ URL ก็ลองดูว่าเป็น ID เปล่า ๆ หรือเปล่า
  }
  return /^[\w-]{10,}$/.test(input) ? input : null;
}

// ลำดับวิดีโอที่จะลองเริ่มโหลด
// ตัวเล่นค้างเงียบโดยไม่แจ้ง error ได้ 2 กรณี (ทดสอบแล้ว 2026-09-27):
//   - วิดีโอแรกของเพลย์ลิสต์ใช้ไม่ได้ (ถูกลบ/ซ่อน)
//   - เปลี่ยนจากเพลย์ลิสต์อื่นมา แล้วเริ่มที่ index 0
// จึงลองเริ่มที่วิดีโอลำดับถัด ๆ ไปแทน ถ้าสำเร็จ CUED จะมาภายในราว 0.3 วินาที
const START_INDEXES = [0, 1, 2, 5];
const ATTEMPT_TIMEOUT_MS = 2500;

// เพลย์ลิสต์ที่โหลดสำเร็จครั้งล่าสุด ใช้จับรายชื่อเก่าที่ค้างอยู่ในตัวเล่น
let last = { playlistId: null, key: "" };

// สั่งตัวเล่นโหลดเพลย์ลิสต์ แล้วคืนรายการ video ID ทั้งหมด
// onRetry(attempt, total) ใช้แจ้งผู้ใช้ตอนต้องลองใหม่
// ถ้าลองครบแล้วยังไม่ได้ (เช่น เพลย์ลิสต์เป็นส่วนตัวหรือไม่มีจริง) จะ throw
export async function loadPlaylistIds(player, playlistId, onRetry) {
  for (let i = 0; i < START_INDEXES.length; i++) {
    if (i > 0) onRetry?.(i + 1, START_INDEXES.length);
    const ids = await cuePlaylistOnce(player, playlistId, START_INDEXES[i]);
    if (ids) {
      last = { playlistId, key: ids.join() };
      return ids;
    }
  }
  throw new Error("playlist-unavailable");
}

// ลองโหลดหนึ่งครั้ง: รอ event CUED แล้วค่อยอ่าน getPlaylist()
// คืน null ถ้าไม่เสร็จภายในเวลาที่กำหนด
//
// ระวัง: ถ้าเพลย์ลิสต์ใหม่โหลดค้าง ตัวเล่นอาจส่ง CUED พร้อม "รายชื่อของเพลย์ลิสต์เก่า"
// ที่ถูกแปะป้าย list เป็น ID ใหม่ (ทดสอบแล้ว 2026-09-27) ข้อมูลจากตัวเล่นจึงเชื่อไม่ได้
// ทางเดียวที่แยกออกคือเทียบกับรายชื่อที่โหลดครั้งก่อน ถ้าเหมือนกันทุกตัวให้ถือว่าค้าง
function cuePlaylistOnce(player, playlistId, index) {
  return new Promise((resolve) => {
    const onState = (e) => {
      if (e.data !== State.CUED) return;
      const ids = player.getPlaylist();
      if (!Array.isArray(ids) || ids.length === 0) return;
      const isStale = playlistId !== last.playlistId && ids.join() === last.key;
      if (!isStale) finish(ids);
    };
    const timer = setTimeout(() => finish(null), ATTEMPT_TIMEOUT_MS);
    function finish(result) {
      clearTimeout(timer);
      player.removeEventListener("onStateChange", onState);
      resolve(result);
    }
    player.addEventListener("onStateChange", onState);
    player.cuePlaylist({ listType: "playlist", list: playlistId, index });
  });
}

// ตัวคุมการเล่นเป็นท่อน: เล่นถึงเวลาที่กำหนดแล้วหยุดเอง
// จับเวลาจากเวลาในวิดีโอ (getCurrentTime) ไม่ใช่นาฬิกาจริง
// ถ้าเน็ตช้าจนวิดีโอค้างโหลด ผู้เล่นก็ยังได้ฟังครบท่อน
// onStop() ถูกเรียกเมื่อเล่นครบท่อนแล้วหยุดเอง
export function createSnippetPlayer(player, onStop) {
  let stopAt = null;
  let timer = null;

  function watch() {
    clearInterval(timer);
    timer = setInterval(() => {
      if (stopAt !== null && player.getCurrentTime() >= stopAt) {
        halt();
        onStop?.();
      }
    }, 100);
  }

  function halt() {
    clearInterval(timer);
    timer = null;
    stopAt = null;
    player.pauseVideo();
  }

  return {
    // เล่นตั้งแต่วินาทีที่ start ไปอีก seconds วินาที
    playFrom(start, seconds) {
      stopAt = start + seconds;
      player.seekTo(start, true);
      player.playVideo();
      watch();
    },
    // เล่นต่อจากจุดที่หยุดไปอีก seconds วินาที
    extend(seconds) {
      stopAt = player.getCurrentTime() + seconds;
      player.playVideo();
      watch();
    },
    // หยุดกลางท่อน แต่จำจุดจบไว้ resume() จะได้เล่นต่อจนครบท่อนเดิม
    pause() {
      clearInterval(timer);
      player.pauseVideo();
    },
    resume() {
      if (stopAt === null) return false;
      player.playVideo();
      watch();
      return true;
    },
    stop: halt,
  };
}

// สถานะของตัวเล่น (ค่าตามเอกสาร YT.PlayerState)
export const State = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
};
