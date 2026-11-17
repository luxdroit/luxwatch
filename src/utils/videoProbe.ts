export function probeVideoDuration(
  url: string,
  timeoutMs = 6500
): Promise<number> {
  if (typeof document === 'undefined' || !url.trim()) {
    return Promise.resolve(0);
  }

  return new Promise((resolve) => {
    const video = document.createElement('video');
    let settled = false;

    const cleanup = (result: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timerId);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('error', onError);
      try {
        video.removeAttribute('src');
        video.load();
      } catch {
        // ignore cleanup errors
      }
      resolve(result);
    };

    const readDuration = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        cleanup(Math.round(video.duration));
      }
    };

    const onLoadedMetadata = () => readDuration();
    const onDurationChange = () => readDuration();
    const onError = () => cleanup(0);

    const timerId = window.setTimeout(() => cleanup(0), timeoutMs);

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('error', onError);
    video.src = url;
  });
}
