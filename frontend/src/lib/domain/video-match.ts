// 영상 파일명으로 어느 장면에 쓸지 추천한다. 영상 내용은 알 수 없으므로 "추천"일 뿐 사용자가 확인해야 한다.
export type MatchSection = { id: string; title: string; parentId: string | null };

const clean = (text: string) => text.normalize("NFC").replace(/\.[^.]+$/, "").trim();

/** 파일명 앞의 번호: "#6_car" → 6, "05 오프닝" → 5, "no.3" → 3. */
export function fileNumber(fileName: string): number | null {
  const match = clean(fileName).match(/^(?:#|no\.?\s*|넘버\s*)?(\d{1,3})(?:[\s_\-.]|$)/i);
  return match ? Number(match[1]) : null;
}

/** 장면 제목의 곡 번호: "넘버 3 Being Alive" → 3. */
export function titleNumber(title: string): number | null {
  const match = title.normalize("NFC").match(/^(?:넘버|no\.?|#)\s*(\d{1,3})(?!\d)/i);
  return match ? Number(match[1]) : null;
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^0-9a-z가-힣]+/).filter((word) => word.length >= 2 && !/^\d+$/.test(word));
}

/**
 * 파일마다 장면 하나를 추천한다. 같은 장면을 두 파일이 가져가지 않으며(장면당 배경 하나),
 * 우선순위는 ① 파일 번호 = 곡 번호 ② 파일명 단어가 장면 제목에 포함. 맞는 곳이 없으면 null.
 */
export function suggestScenes(fileNames: string[], sections: MatchSection[]): Array<string | null> {
  const taken = new Set<string>();
  const result: Array<string | null> = fileNames.map(() => null);
  const leaves = sections.filter((section) => section.parentId !== null || !sections.some((other) => other.parentId === section.id));
  fileNames.forEach((name, index) => {
    const number = fileNumber(name);
    const byNumber = number === null ? undefined : leaves.find((section) => !taken.has(section.id) && titleNumber(section.title) === number);
    const pick = byNumber ?? (() => {
      const tokens = words(clean(name));
      return tokens.length ? leaves.find((section) => !taken.has(section.id) && tokens.some((token) => section.title.toLowerCase().includes(token))) : undefined;
    })();
    if (pick) { taken.add(pick.id); result[index] = pick.id; }
  });
  return result;
}

export function mimeFor(file: { name: string; type: string }): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ({ mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" } as Record<string, string>)[extension] ?? "application/octet-stream";
}
