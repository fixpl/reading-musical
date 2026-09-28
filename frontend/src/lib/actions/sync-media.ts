export type MediaState = { time: number; play: boolean; rate: number; muted: boolean; onError?: (message: string) => void };

// 타임라인 시각에 맞춰 video/audio 엘리먼트를 따라가게 하는 공용 액션.
// /live 연습 화면과 장·막 구성 미리보기가 같은 동기화 로직을 쓴다.
export function syncMedia(node: HTMLMediaElement, state: MediaState) {
  let current = state;
  let playPending = false;
  let disposed = false;
  const apply = () => {
    node.muted = current.muted;
    node.playbackRate = current.rate;
    if (node.readyState < 1) return;
    const target = Number.isFinite(node.duration) ? Math.min(current.time, Math.max(0, node.duration - 0.01)) : current.time;
    if (Math.abs(node.currentTime - target) > 0.25) node.currentTime = target;
    if (!current.play || (Number.isFinite(node.duration) && current.time >= node.duration)) {
      node.pause();
      return;
    }
    if (node.paused && !playPending) {
      playPending = true;
      void node
        .play()
        .catch(() => {
          if (!disposed) current.onError?.("브라우저가 미디어 재생을 허용하지 않았습니다. 소리를 끄거나 재생 버튼을 다시 눌러 주세요.");
        })
        .finally(() => {
          playPending = false;
          if (!current.play) node.pause();
        });
    }
  };
  const failed = () => current.onError?.("파일을 재생할 수 없습니다. 브라우저 지원 형식과 업로드 상태를 확인해 주세요.");
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
