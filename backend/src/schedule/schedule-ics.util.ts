/** 개인 일정 ICS export 전용 포맷터 — exportMyScheduleIcs에서만 쓰는 순수 유틸. */

export function formatIcsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export function foldIcsLine(line: string): string[] {
  const chunks: string[] = [];
  let remaining = line;
  while (remaining.length > 75) {
    chunks.push(remaining.slice(0, 75));
    remaining = ` ${remaining.slice(75)}`;
  }
  chunks.push(remaining);
  return chunks;
}

export function foldIcsLines(lines: string[]): string {
  return `${lines.flatMap((line) => foldIcsLine(line)).join("\r\n")}\r\n`;
}
