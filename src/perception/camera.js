// The ONE getUserMedia in the project.

/**
 * @returns {Promise<{video:HTMLVideoElement, stream:MediaStream, settings:object, stop:()=>void}>}
 */
export async function openCamera({
  deviceId = null,
  width = 1280,
  height = 720,
  frameRate = 30,
} = {}) {
  // No facingMode: it is meaningless for a fixed USB webcam and on Linux it can
  // make an otherwise fine camera fail to open.
  const wanted = {
    width: { ideal: width },
    height: { ideal: height },
    frameRate: { ideal: frameRate },
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: wanted });
  } catch (error) {
    // An over-constrained request must not take an unattended installation
    // down: retry once with whatever the camera will give us.
    if (error?.name !== "OverconstrainedError") throw error;
    console.warn("Camera over-constrained; retrying with defaults.", error);
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
  }

  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.setAttribute("aria-hidden", "true");
  video.style.display = "none";
  document.body.append(video);

  await waitForVideo(video);

  // Many USB webcams reach 30fps at 720p only in MJPEG; in YUY2 they cap near
  // 10 and getUserMedia reports success either way. The blink detector needs
  // the frame rate, so surface what we actually got.
  const track = stream.getVideoTracks()[0];
  const settings = track?.getSettings?.() ?? {};

  return {
    video,
    stream,
    settings,
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      video.remove();
    },
  };
}

function waitForVideo(video) {
  return new Promise((resolve, reject) => {
    const ready = async () => {
      try {
        await video.play();
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return ready();
    video.addEventListener("loadeddata", ready, { once: true });
    video.addEventListener("error", () => reject(video.error), { once: true });
  });
}
