// Reads book barcodes with the phone or iPad camera.
//
// iPhone and iPad Safari have no built-in barcode reader, so this loads a
// copy of ZXing (public/vendor) the first time the camera is opened. Browsers
// that do have a reader (Chrome on Android) use their own. Either way every
// read goes through readScan, the same as a Bluetooth scanner, so the rest of
// the app can't tell the difference.

import { readScan } from "./isbn.js";

const READER_JS = "/vendor/barcode-detector-3.2.3.js";
const READER_WASM = "/vendor/zxing_reader-3.1.6.wasm";
const FORMATS = ["ean_13", "upc_a"]; // books carry EAN-13; upc_a lets us say "that's the store barcode"
const EVERY_MS = 150;     // how often a frame is checked
const SAME_BOOK_MS = 3000; // the camera keeps seeing the book it just read; ignore it for this long

let detectorPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("load"));
    document.head.append(s);
  });
}

async function makeDetector() {
  if ("BarcodeDetector" in window) {
    try {
      const have = await window.BarcodeDetector.getSupportedFormats();
      if (FORMATS.every((f) => have.includes(f))) return new window.BarcodeDetector({ formats: FORMATS });
    } catch { /* fall through to ZXing */ }
  }
  await loadScript(READER_JS);
  const api = window.BarcodeDetectionAPI;
  api.prepareZXingModule({
    overrides: { locateFile: (path, prefix) => (path.endsWith(".wasm") ? READER_WASM : prefix + path) },
  });
  return new api.BarcodeDetector({ formats: FORMATS });
}

function getDetector() {
  if (!detectorPromise) detectorPromise = makeDetector().catch((e) => { detectorPromise = null; throw e; });
  return detectorPromise;
}

function cameraError(err) {
  switch (err?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "The camera is blocked for this site. Allow it in the browser's settings, or type the ISBN.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera found on this device. Type the ISBN instead.";
    case "NotReadableError":
      return "The camera is busy in another app. Close that app and try again.";
    default:
      return "Couldn't start the camera. Type the ISBN instead.";
  }
}

// A short beep so she knows a book went in without looking at the screen.
function beeper() {
  let ctx = null;
  return {
    unlock() { // must run inside the tap that opened the camera, or iOS stays silent
      try { ctx ??= new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); } catch { ctx = null; }
    },
    beep() {
      if (!ctx) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 1200;
      g.gain.setValueAtTime(0.15, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.12);
    },
  };
}

// panel: an element holding [data-cam-video] (a <video>), [data-cam-msg] and
// [data-cam-stop]. button opens it. onScan(read, raw) gets every good read.
// continuous: keep reading after a book (bulk scan); otherwise close after one.
export function attachCamera({ button, panel, onScan, continuous = false }) {
  const video = panel.querySelector("[data-cam-video]");
  const note = panel.querySelector("[data-cam-msg]");
  const sound = beeper();
  let stream = null;
  let timer = null;
  let busy = false;
  let last = { value: "", at: 0 };
  let lastNote = "";

  if (!navigator.mediaDevices?.getUserMedia) {
    button.hidden = true; // no camera API here (an old browser, or not on https)
    return { stop() {} };
  }

  const say = (t) => { note.textContent = t; };

  function stop() {
    clearInterval(timer);
    timer = null;
    if (stream) for (const t of stream.getTracks()) t.stop();
    stream = null;
    video.srcObject = null;
    panel.hidden = true;
    button.hidden = false;
  }

  async function tick(detector) {
    if (busy || !stream || video.readyState < 2) return;
    busy = true;
    try {
      const codes = await detector.detect(video);
      for (const c of codes) {
        const raw = c.rawValue;
        const now = Date.now();
        if (raw === last.value && now - last.at < SAME_BOOK_MS) { last.at = now; continue; }
        const read = readScan(raw);
        if (read.kind === "isbn") {
          last = { value: raw, at: now };
          sound.beep();
          panel.classList.remove("cam-hit");
          void panel.offsetWidth; // restart the flash
          panel.classList.add("cam-hit");
          if (!continuous) stop();
          onScan(read, raw);
          if (continuous) say(`Got ${read.isbn13}. Point at the next book.`);
          return;
        }
        if (read.message && read.message !== lastNote) { lastNote = read.message; say(read.message); }
      }
    } catch {
      // a frame that couldn't be read; the next one will be tried
    } finally {
      busy = false;
    }
  }

  async function start() {
    sound.unlock();
    button.hidden = true;
    panel.hidden = false;
    video.hidden = false;
    lastNote = "";
    say("Starting the camera...");
    try {
      const [detector, s] = await Promise.all([
        getDetector().catch(() => { throw Object.assign(new Error(), { name: "ReaderLoad" }); }),
        navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        }),
      ]);
      if (panel.hidden) { for (const t of s.getTracks()) t.stop(); return; } // closed while starting
      stream = s;
      video.srcObject = s;
      await video.play();
      say("Point the camera at the barcode on the back of the book.");
      timer = setInterval(() => tick(detector), EVERY_MS);
    } catch (err) {
      stop();
      panel.hidden = false; // keep the panel up to show why, without the video
      video.hidden = true;
      button.hidden = false;
      say(err.name === "ReaderLoad" ? "Couldn't load the barcode reader. Type the ISBN instead." : cameraError(err));
    }
  }

  button.addEventListener("click", start);
  panel.querySelector("[data-cam-stop]").addEventListener("click", stop);
  document.addEventListener("visibilitychange", () => { if (document.hidden && stream) stop(); });
  return { start, stop, get on() { return !!stream; } };
}
