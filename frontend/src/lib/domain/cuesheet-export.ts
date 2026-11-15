// 큐시트를 엑셀·한글 문서로 옮겨 쓸 수 있게 CSV로 만든다. 열 구성은 국내 큐시트 양식(큐번호·시간·장면·내용·계기·출연·부서·비고)을 따른다.
export type ExportCue = { cueNumber: string; trackId: string; sceneId: string | null; content: string; trigger: string | null; note: string | null; durationSec: number | null; startMs?: number | null; character?: { name: string } | null };
export type ExportScene = { id: string; title: string; order: number; act: { title: string; order: number } };
export type ExportTrack = { id: string; name: string; order?: number };

const clock = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};
// 엑셀이 수식으로 읽어 실행하는 것을 막는다(=, +, -, @ 로 시작하는 셀 앞에 작은따옴표).
const cell = (value: string | number | null | undefined) => {
  let text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const CUESHEET_HEADERS = ["큐번호", "시간", "막", "장면", "부서", "내용", "계기", "출연", "길이(초)", "비고"];

export function cuesheetCsv(cues: ExportCue[], scenes: ExportScene[], tracks: ExportTrack[]): string {
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const sceneOrder = (cue: ExportCue) => { const scene = cue.sceneId ? sceneById.get(cue.sceneId) : null; return scene ? scene.act.order * 10_000 + scene.order : Number.MAX_SAFE_INTEGER; };
  const sorted = [...cues].sort((a, b) => sceneOrder(a) - sceneOrder(b) || (a.startMs ?? Infinity) - (b.startMs ?? Infinity) || a.cueNumber.localeCompare(b.cueNumber, "ko", { numeric: true }));
  const rows = sorted.map((cue) => {
    const scene = cue.sceneId ? sceneById.get(cue.sceneId) : null;
    return [cue.cueNumber, cue.startMs != null ? clock(cue.startMs) : "", scene?.act.title ?? "", scene?.title ?? "장면 미지정", trackById.get(cue.trackId)?.name ?? "", cue.content, cue.trigger ?? "", cue.character?.name ?? "", cue.durationSec ?? "", cue.note ?? ""];
  });
  // UTF-8 BOM — 엑셀에서 한글이 깨지지 않는다.
  return "﻿" + [CUESHEET_HEADERS, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function downloadText(fileName: string, text: string, mime = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement("a");
  link.href = url; link.download = fileName;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
