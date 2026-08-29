// Continuous capture of what the installation saw and what it painted.
//
// Two tracks, two files, one toggle: the painting canvas ("screen") and the
// raw camera. Chunks are posted to the dev/preview server as they arrive
// (see scripts/vite-recorder-plugin.js), so nothing is held in memory and a
// power cut costs at most one chunk.

const ROUTE = "/__recordings";
const CHUNK_MS = 2000;
const CANVAS_FPS = 30;

// First one the browser admits to. Chrome (macOS and Windows) takes vp9;
// the vp8 and bare-webm entries are the fallbacks for older builds.
const MIME_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
];

/**
 * @param {object} options
 * @param {() => HTMLCanvasElement|null} options.getCanvas  the painting canvas
 * @param {() => HTMLVideoElement|null} options.getVideo    the live camera element
 * @param {(status:{active:boolean, message:string}) => void} [options.onStatus]
 */
export function createRecorder({ getCanvas, getVideo, onStatus = () => {} }) {
  /** @type {Array<{recorder:MediaRecorder, file:string, stopStream:()=>void}>} */
  let takes = [];
  let active = false;
  let startedAt = 0;
  let bytes = 0;

  function status(message) {
    onStatus({ active, message });
  }

  function start() {
    if (active) return;

    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);

    const sources = [
      { label: "screen", stream: canvasStream() },
      { label: "camera", stream: cameraStream() },
    ].filter((source) => source.stream);

    if (!sources.length) {
      status("nothing to record yet");
      return;
    }

    const mimeType = MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      status("no supported recording format");
      return;
    }

    takes = sources.map(({ label, stream }) => {
      const file = `${stamp}_${label}.webm`;
      const recorder = new MediaRecorder(stream, { mimeType });
      const queue = createUploadQueue(file, (delta) => {
        bytes += delta;
      });

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) queue.push(event.data);
      });
      recorder.addEventListener("error", (event) => {
        console.warn(`Recording (${label}) failed:`, event);
        status(`error on ${label}`);
      });

      recorder.start(CHUNK_MS);
      // The canvas stream is ours; the camera stream is perception's, so only
      // the tracks we cloned get stopped.
      return { recorder, file, stopStream: () => stream.getTracks().forEach((t) => t.stop()) };
    });

    active = true;
    startedAt = performance.now();
    bytes = 0;
    status(`recording ${takes.length} track(s)`);
  }

  function stop() {
    if (!active) return;
    for (const take of takes) {
      // requestData first, or the tail since the last chunk is lost.
      if (take.recorder.state === "recording") take.recorder.requestData();
      take.recorder.stop();
      take.stopStream();
    }
    takes = [];
    active = false;
    status("stopped");
  }

  function canvasStream() {
    const canvas = getCanvas();
    return canvas?.captureStream ? canvas.captureStream(CANVAS_FPS) : null;
  }

  function cameraStream() {
    const source = getVideo()?.srcObject;
    if (!(source instanceof MediaStream)) return null;
    // Clone, so stopping the recording never stops perception's camera.
    const tracks = source.getVideoTracks().map((track) => track.clone());
    return tracks.length ? new MediaStream(tracks) : null;
  }

  return {
    get active() {
      return active;
    },
    start,
    stop,
    toggle() {
      if (active) stop();
      else start();
    },
    /** Human-readable line for the debug panel. */
    summary() {
      if (!active) return "off";
      const seconds = (performance.now() - startedAt) / 1000;
      return `${formatDuration(seconds)} · ${formatSize(bytes)}`;
    },
  };
}

// One in-flight request per file: chunks must land in the order the encoder
// produced them or the webm is unplayable.
function createUploadQueue(file, onBytes) {
  let chain = Promise.resolve();

  return {
    push(blob) {
      chain = chain
        .then(() =>
          fetch(`${ROUTE}/append?file=${encodeURIComponent(file)}`, {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: blob,
          }),
        )
        .then((response) => {
          if (!response.ok) throw new Error(`${response.status}`);
          onBytes(blob.size);
        })
        .catch((error) => console.warn(`Could not save ${file}:`, error));
    },
  };
}

function formatSize(bytes) {
  const megabytes = bytes / (1024 * 1024);
  return megabytes < 1 ? `${Math.round(bytes / 1024)} KB` : `${megabytes.toFixed(1)} MB`;
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
