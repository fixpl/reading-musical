export type ExportableRunSheet = {
  id: string;
  title: string;
  status: string;
  version: number;
  event: {
    title: string;
    type: string;
    startAt: Date;
    endAt: Date;
    location: string | null;
    meetingUrl?: string | null;
  };
  items: Array<{
    order: number;
    itemType: string;
    title: string;
    estimatedDurationMin: number | null;
    ownerRole: string | null;
    staffDiscipline: string | null;
    completedAt: Date | null;
    note: string | null;
    scene?: { title: string; act: { title: string } } | null;
    cue?: { cueNumber: string; cueType: string; track: { title: string } } | null;
    stageSceneNote?: { note: string; stagePlan: { name: string }; scene: { title: string; act: { title: string } } } | null;
    checklistItem?: { label: string; status: string } | null;
    ownerMembership?: { user: { name: string; email: string }; primaryRole: string } | null;
  }>;
};

export function buildRunSheetExportHtml(runSheet: ExportableRunSheet) {
  const rows = runSheet.items
    .map(
      (item) => `
        <tr>
          <td class="order">${item.order}</td>
          <td>${escapeHtml(item.itemType)}</td>
          <td>
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(itemReference(item))}</span>
          </td>
          <td>${escapeHtml(ownerLabel(item))}</td>
          <td>${item.estimatedDurationMin ?? "-"}분</td>
          <td>${item.completedAt ? "완료" : "대기"}</td>
          <td>${escapeHtml(item.note ?? "")}</td>
        </tr>`
    )
    .join("");

  return Buffer.from(
    `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(runSheet.title)} 진행표</title>
  <style>
    :root { color: #20242a; background: #f7f8f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; padding: 32px; }
    main { max-width: 1120px; margin: 0 auto; background: #fff; border: 1px solid #dfe4db; padding: 28px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { margin: 0; }
    .muted { color: #68706a; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0; }
    .summary div { border: 1px solid #dfe4db; padding: 12px; }
    .summary span { display: block; color: #68706a; font-size: 12px; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #eef2eb; color: #343a34; text-align: left; }
    th, td { border: 1px solid #dfe4db; padding: 9px; vertical-align: top; }
    td strong, td span { display: block; }
    td span { color: #68706a; margin-top: 4px; }
    .order { width: 40px; text-align: right; }
    .policy { margin-top: 16px; padding: 12px; background: #f4f6f2; border: 1px solid #dfe4db; color: #4b554d; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(runSheet.title)}</h1>
    <p class="muted">아트브릿지 공연 진행표 export · 대본 전문은 포함하지 않음</p>
    <section class="summary" aria-label="진행표 요약">
      <div><span>일정</span>${escapeHtml(runSheet.event.title)}</div>
      <div><span>시간</span>${escapeHtml(formatDate(runSheet.event.startAt))} - ${escapeHtml(formatDate(runSheet.event.endAt))}</div>
      <div><span>상태</span>${escapeHtml(runSheet.status)} · v${runSheet.version}</div>
      <div><span>장소</span>${escapeHtml(runSheet.event.location ?? "-")}</div>
    </section>
    <table>
      <thead>
        <tr>
          <th>No</th>
          <th>유형</th>
          <th>항목/연결</th>
          <th>담당</th>
          <th>예상</th>
          <th>상태</th>
          <th>메모</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="7">진행표 항목이 없습니다.</td></tr>`}</tbody>
    </table>
    <p class="policy">본 파일은 운영 공유용 진행표입니다. 장면 제목, 큐 번호, 담당, 체크 상태만 포함하며 대본 본문과 음원 파일은 포함하지 않습니다.</p>
  </main>
</body>
</html>`,
    "utf8"
  );
}

export function buildRunSheetExportPdf(runSheet: ExportableRunSheet) {
  const lines = [
    pdfText("Reading Musical Run Sheet", 40, 800, 18),
    pdfText(runSheet.title, 40, 776, 13),
    pdfText(`Event: ${runSheet.event.title}`, 40, 756, 10),
    pdfText(`Time: ${formatDate(runSheet.event.startAt)} - ${formatDate(runSheet.event.endAt)}`, 40, 740, 9),
    pdfText(`Status: ${runSheet.status} / v${runSheet.version}`, 40, 724, 9),
    pdfText("No full script text is included in this export.", 40, 704, 9),
    "0.91 0.93 0.89 rg",
    "40 674 515 20 re f",
    pdfText("No  Type  Title / Reference  Owner  Status", 48, 681, 8)
  ];

  let y = 654;
  for (const item of runSheet.items.slice(0, 34)) {
    const title = truncate(`${item.order}. ${item.itemType} ${item.title}`, 70);
    const owner = truncate(ownerLabel(item), 24);
    const status = item.completedAt ? "Done" : "Waiting";
    lines.push(pdfText(title, 48, y, 8));
    y -= 11;
    lines.push(pdfText(truncate(`${itemReference(item)} / ${owner} / ${status}`, 96), 58, y, 7));
    y -= 15;
    if (item.note) {
      lines.push(pdfText(truncate(`Note: ${item.note}`, 96), 58, y, 7));
      y -= 13;
    }
    if (y < 56) break;
  }

  const content = lines.join("\n");
  const objects: string[] = [];
  const offsets: number[] = [0];

  function appendObject(id: number, body: string) {
    offsets[id] = Buffer.byteLength(`%PDF-1.4\n${objects.join("")}`, "utf8");
    objects.push(`${id} 0 obj\n${body}\nendobj\n`);
  }

  appendObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  appendObject(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  appendObject(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>");
  appendObject(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  appendObject(5, `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`);

  const head = `%PDF-1.4\n${objects.join("")}`;
  const startxref = Buffer.byteLength(head, "utf8");
  const xref = [
    "xref",
    "0 6",
    "0000000000 65535 f ",
    ...offsets.slice(1, 6).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    "<< /Size 6 /Root 1 0 R >>",
    "startxref",
    String(startxref),
    "%%EOF"
  ].join("\n");

  return Buffer.from(`${head}${xref}\n`, "utf8");
}

function itemReference(item: ExportableRunSheet["items"][number]) {
  if (item.cue) return `${item.cue.cueNumber} · ${item.cue.track.title}`;
  if (item.stageSceneNote) return `${item.stageSceneNote.scene.act.title} · ${item.stageSceneNote.scene.title} · ${item.stageSceneNote.stagePlan.name}`;
  if (item.checklistItem) return `체크리스트 · ${item.checklistItem.label}`;
  if (item.scene) return `${item.scene.act.title} · ${item.scene.title}`;
  return "직접 입력 항목";
}

function ownerLabel(item: ExportableRunSheet["items"][number]) {
  if (item.ownerMembership) return `${item.ownerMembership.user.name} · ${item.ownerMembership.primaryRole}`;
  const owner = [item.ownerRole, item.staffDiscipline].filter(Boolean).join(" · ");
  return owner || "담당 미지정";
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function pdfText(text: string, x: number, y: number, size: number) {
  return `BT /F1 ${size} Tf ${x} ${y} Td ${pdfHexText(text)} Tj ET`;
}

function pdfHexText(value: string) {
  const utf16 = Buffer.from(value, "utf16le");
  const be = Buffer.alloc(utf16.length + 2);
  be[0] = 0xfe;
  be[1] = 0xff;
  for (let index = 0; index < utf16.length; index += 2) {
    be[index + 2] = utf16[index + 1];
    be[index + 3] = utf16[index];
  }
  return `<${be.toString("hex").toUpperCase()}>`;
}
