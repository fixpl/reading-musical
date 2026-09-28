// Attachment filenames are display metadata, never file-system paths or raw header values.
export function attachmentDisposition(asset: { fileName?: string | null; storageKey: string; mime: string }, download: boolean) {
  const original = asset.fileName || (asset.storageKey.split("/").pop() ?? "attachment").replace(/^[a-f0-9-]{36}-/i, "");
  const clean = Buffer.from(original, "utf8").toString("utf8").replace(/[\\/\u0000-\u001f\u007f]/g, "_");
  const name = Array.from(clean).slice(0, 200).join("") || "attachment";
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const extensions: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "text/plain": "txt", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx" };
  const inline = ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain"].includes(asset.mime) || asset.mime.startsWith("audio/") || asset.mime.startsWith("video/");
  const mode = download || !inline ? "attachment" : "inline";
  return `${mode}; filename="attachment.${extensions[asset.mime] ?? 'bin'}"; filename*=UTF-8''${encoded}`;
}
