export type MediaState = { time: number; play: boolean; rate: number; muted: boolean; volume?: number; loop?: boolean; sourceStart?: number; onError?: (message: string) => void };

// 타임라인 시각에 맞춰 video/audio 엘리먼트를 따라가게 하는 공용 액션.
// /live 연습 화면과 장·막 구성 미리보기가 같은 동기화 로직을 쓴다.
export function syncMedia(node: HTMLMediaElement, state: MediaState) {
  let current = state;
  let playPending = false;
  let disposed = false;
  const apply = () => {
    node.muted = current.muted;
    node.volume = Math.max(0, Math.min(1, current.volume ?? 1));
    node.playbackRate = current.rate;
    if (node.readyState < 1) return;
    const sourceStart = current.sourceStart ?? 0;
    const available = node.duration - sourceStart;
    const time = current.loop && Number.isFinite(available) && available > 0 ? sourceStart + Math.max(0, current.time - sourceStart) % available : current.time;
    const target = Number.isFinite(node.duration) ? Math.min(time, Math.max(0, node.duration - 0.01)) : time;
    if (Math.abs(node.currentTime - target) > 0.25) node.currentTime = target;
    if (!current.play || (Number.isFinite(node.duration) && time >= node.duration)) {
      node.pause();
      return;
    }
    if (node.paused && !playPending) {
      playPending = true;
      void node
        .play()
        .catch(() => {
          if (!disposed) current.onError?.("브라우저가 미디어 재생을 허용하지 않았어요. 소리를 끄거나 재생 버튼을 다시 눌러 주세요.");
        })
        .finally(() => {
          playPending = false;
          if (!current.play) node.pause();
        });
    }
  };
  const failed = () => current.onError?.("파일을 재생할 수 없어요. 브라우저가 지원하는 형식인지 확인하고, 업로드 상태도 확인해 주세요.");
  node.addEventListener("loadedmetadata", apply);
  node.addEventListener("error", failed);
  apply();
  return {
    update(value: MediaState) {
      current = value;
      apply();
    },
    destroy() {
      disposed = true;
      node.pause();
      node.removeEventListener("loadedmetadata", apply);
      node.removeEventListener("error", failed);
    }
  };
}
