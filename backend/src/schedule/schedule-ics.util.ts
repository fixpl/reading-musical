/** 개인 일정 ICS export 전용 포맷터 — exportMyScheduleIcs에서만 쓰는 순수 유틸. */

export function formatIcsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export function foldIcsLine(line: string): string[] {
  const chunks: string[] = [];
  let chunk = "";
  let byteLength = 0;
  // 한글·이모지를 자르지 않으며 줄 시작 공백도 75옥텟 제한에 포함한다.
  for (const character of line) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (byteLength + characterBytes > 75) {
      chunks.push(chunk);
      chunk = " ";
      byteLength = 1;
    }
    chunk += character;
    byteLength += characterBytes;
  }
  chunks.push(chunk);
  return chunks;
}

export function foldIcsLines(lines: string[]): string {
  return `${lines.flatMap((line) => foldIcsLine(line)).join("\r\n")}\r\n`;
}
