let Module = null;
let keyDownPtr = 0;
let keyUpPtr = 0;
let keyCount = 0;
let audioPtr = 0;
let audioTimer = null;
let sampleRate = 48000;
let booted = false;

function send(type, extra = {}) { postMessage({ type, ...extra }); }
function info(text) { send('log', { level: 'info', text: String(text) }); }
function error(text) { send('log', { level: 'error', text: String(text) }); }

async function boot(msg) {
  if (booted) return;
  booted = true;
  try {
    const runtimeUrl = new URL('./runtime/butterscotch.mjs', self.location.href);
    const runtimeBase = new URL('./runtime/', self.location.href);
    const { default: createButterscotch } = await import(runtimeUrl.href);

    Module = await createButterscotch({
      locateFile(path) { return new URL(path, runtimeBase).href; },
      print(text) { info(text); },
      printErr(text) { error(text); }
    });

    if (!Module.specialHTMLTargets) throw new Error('Runtime did not expose specialHTMLTargets.');
    Module.specialHTMLTargets['#canvas'] = msg.canvas;
    Module.canvas = msg.canvas;

    const mountResult = Module._mountOpfs();
    if (mountResult !== 0) throw new Error(`Could not mount browser OPFS (code ${mountResult}).`);

    sampleRate = Math.max(8000, Math.round(Number(msg.sampleRate) || 48000));
    Module._setAudioSampleRate(sampleRate);

    keyDownPtr = Module._getKeyDownPtr();
    keyUpPtr = Module._getKeyUpPtr();
    keyCount = Module._getKeyCount();

    Module.ccall('startRunner', null, ['string', 'string'], [msg.gamePath, msg.savesPath]);
    send('ready');

    const audioFrames = 1024;
    audioPtr = Module._malloc(audioFrames * 2 * 4);
    const intervalMs = Math.max(8, Math.round((audioFrames / sampleRate) * 1000));
    audioTimer = setInterval(() => {
      if (!Module || !audioPtr) return;
      try {
        Module._pullAudioFrames(audioPtr, audioFrames);
        const start = audioPtr >>> 2;
        const copy = Module.HEAPF32.slice(start, start + audioFrames * 2);
        send('audio', { data: copy.buffer, frames: audioFrames, sampleRate });
      } catch (e) {
        error(`Audio pull failed: ${e.message}`);
      }
    }, intervalMs);
  } catch (e) {
    send('fatal', { error: e?.stack || e?.message || String(e) });
  }
}

function setKey(code, down) {
  if (!Module || code < 0 || code >= keyCount) return;
  const ptr = down ? keyDownPtr : keyUpPtr;
  Module.HEAPU8[ptr + code] = 1;
}

function releaseAll() {
  if (!Module || !keyUpPtr || !keyCount) return;
  Module.HEAPU8.fill(1, keyUpPtr, keyUpPtr + keyCount);
}

self.onmessage = event => {
  const m = event.data || {};
  if (m.type === 'boot') boot(m);
  else if (m.type === 'key') setKey(Number(m.code), !!m.down);
  else if (m.type === 'releaseAll') releaseAll();
  else if (m.type === 'stop' && Module) {
    try { Module._stopRunner(); } catch (e) { error(e?.message || e); }
  }
};

// Butterscotch's C side posts these messages from its pthread/main worker.
self.addEventListener('message', event => {
  const m = event.data || {};
  if (m.type === 'windowTitle') send('windowTitle', { title: m.title });
  if (m.type === 'runnerExit') {
    if (audioTimer) clearInterval(audioTimer);
    audioTimer = null;
    if (Module && audioPtr) Module._free(audioPtr);
    audioPtr = 0;
    send('runnerExit');
  }
});
