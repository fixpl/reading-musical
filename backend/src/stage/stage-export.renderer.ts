import type { Prisma } from "@prisma/client";
import { deflateSync } from "node:zlib";

export type ExportableStagePlan = {
  id: string;
  name: string;
  layout: Prisma.JsonValue;
  elements: Array<{
    kind: string;
    label: string;
    x: number;
    y: number;
    note: string | null;
  }>;
  sceneNotes: Array<{
    note: string;
    scene: {
      title: string;
      order: number;
      act: {
        title: string;
        order: number;
      };
    };
  }>;
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function buildStageExportPdf(plan: ExportableStagePlan) {
  const contentLines = [
    "q",
    "0.96 0.97 0.95 rg",
    "40 492 515 260 re f",
    "0.16 0.19 0.22 RG",
    "1.5 w",
    "40 492 515 260 re S",
    "0.80 0.82 0.78 RG",
    "0.5 w",
    ...[1, 2, 3, 4].flatMap((index) => {
      const x = 40 + index * 103;
      const y = 492 + index * 52;
      return [`${x} 492 m ${x} 752 l S`, `40 ${y} m 555 ${y} l S`];
    }),
    "Q",
    pdfText("Reading Musical Stage Export", 40, 800, 18),
    pdfText(`Plan: ${plan.name}`, 40, 775, 12),
    pdfText(`Elements: ${plan.elements.length} / Scene notes: ${plan.sceneNotes.length}`, 40, 758, 10)
  ];

  for (const element of plan.elements) {
    const point = toPdfStagePoint(element.x, element.y);
    contentLines.push(
      "q",
      `${pdfElementColor(element.kind)} rg`,
      `${point.x - 7} ${point.y - 7} 14 14 re f`,
      "0.16 0.19 0.22 RG",
      `${point.x - 7} ${point.y - 7} 14 14 re S`,
      "Q"
    );
  }

  let y = 455;
  for (const element of plan.elements.slice(0, 16)) {
    contentLines.push(pdfText(`- ${element.kind}: ${element.label} (${element.x}, ${element.y})`, 50, y, 9));
    y -= 14;
    if (element.note) {
      contentLines.push(pdfText(`  note: ${element.note}`, 62, y, 8));
      y -= 12;
    }
  }

  if (plan.sceneNotes.length > 0) {
    y -= 10;
    contentLines.push(pdfText("Scene notes", 40, y, 11));
    y -= 16;
    for (const note of plan.sceneNotes.slice(0, 10)) {
      contentLines.push(pdfText(`- ${note.scene.act.title} / ${note.scene.title}: ${note.note}`, 50, y, 8));
      y -= 13;
    }
  }

  const content = contentLines.join("\n");
  const objects: string[] = [];
  const offsets: number[] = [0];

  function appendObject(id: number, body: string) {
    offsets[id] = Buffer.byteLength(`%PDF-1.4\n${objects.join("")}`, "utf8");
    objects.push(`${id} 0 obj\n${body}\nendobj\n`);
  }

  appendObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  appendObject(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  appendObject(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"
  );
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

export function buildStageExportPng(plan: ExportableStagePlan) {
  const width = 960;
  const height = 640;
  const pixels = Buffer.alloc(width * height * 4, 255);

  fillRect(pixels, width, height, 0, 0, width, height, [248, 250, 247, 255]);
  fillRect(pixels, width, height, 48, 48, width - 96, height - 112, [238, 242, 236, 255]);
  drawRect(pixels, width, height, 48, 48, width - 96, height - 112, [40, 47, 55, 255]);

  for (let index = 1; index < 5; index += 1) {
    const x = Math.round(48 + ((width - 96) * index) / 5);
    const y = Math.round(48 + ((height - 112) * index) / 5);
    fillRect(pixels, width, height, x, 48, 1, height - 112, [207, 213, 207, 255]);
    fillRect(pixels, width, height, 48, y, width - 96, 1, [207, 213, 207, 255]);
  }

  for (const element of plan.elements) {
    const point = toPngStagePoint(element.x, element.y, width, height);
    const color = pngElementColor(element.kind);
    fillRect(pixels, width, height, point.x - 13, point.y - 13, 26, 26, color);
    drawRect(pixels, width, height, point.x - 13, point.y - 13, 26, 26, [30, 36, 42, 255]);
  }

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const rawOffset = row * (width * 4 + 1);
    raw[rawOffset] = 0;
    pixels.copy(raw, rawOffset + 1, row * width * 4, (row + 1) * width * 4);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", buildIhdr(width, height)),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
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

function toPdfStagePoint(x: number, y: number) {
  return {
    x: 40 + (clampPercent(x) / 100) * 515,
    y: 492 + ((100 - clampPercent(y)) / 100) * 260
  };
}

function toPngStagePoint(x: number, y: number, width: number, height: number) {
  return {
    x: Math.round(48 + (clampPercent(x) / 100) * (width - 96)),
    y: Math.round(48 + (clampPercent(y) / 100) * (height - 112))
  };
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}

function pdfElementColor(kind: string) {
  const colors: Record<string, string> = {
    ACTOR_SEAT: "0.27 0.47 0.95",
    MUSIC_STAND: "0.06 0.58 0.44",
    LIGHT: "0.95 0.68 0.20",
    SOUND: "0.50 0.35 0.86",
    PROP: "0.83 0.34 0.27",
    TABLE: "0.33 0.43 0.50",
    CHAIR: "0.20 0.53 0.75",
    ENTRANCE: "0.12 0.62 0.35"
  };
  return colors[kind] ?? "0.35 0.39 0.44";
}

function pngElementColor(kind: string): [number, number, number, number] {
  const colors: Record<string, [number, number, number, number]> = {
    ACTOR_SEAT: [67, 114, 229, 255],
    MUSIC_STAND: [16, 148, 112, 255],
    LIGHT: [242, 173, 51, 255],
    SOUND: [127, 89, 219, 255],
    PROP: [211, 87, 69, 255],
    TABLE: [84, 110, 128, 255],
    CHAIR: [51, 136, 191, 255],
    ENTRANCE: [31, 158, 89, 255]
  };
  return colors[kind] ?? [89, 99, 112, 255];
}

function buildIhdr(width: number, height: number) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return ihdr;
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function fillRect(
  pixels: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  color: [number, number, number, number]
) {
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(width, Math.ceil(x + rectWidth));
  const endY = Math.min(height, Math.ceil(y + rectHeight));
  for (let row = startY; row < endY; row += 1) {
    for (let col = startX; col < endX; col += 1) {
      const index = (row * width + col) * 4;
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = color[3];
    }
  }
}

function drawRect(
  pixels: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  color: [number, number, number, number]
) {
  fillRect(pixels, width, height, x, y, rectWidth, 2, color);
  fillRect(pixels, width, height, x, y + rectHeight - 2, rectWidth, 2, color);
  fillRect(pixels, width, height, x, y, 2, rectHeight, color);
  fillRect(pixels, width, height, x + rectWidth - 2, y, 2, rectHeight, color);
}
