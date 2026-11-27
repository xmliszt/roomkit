const revokeDelayMs = 10_000;

/** Hand `blob` to the browser as a download named `fileName`. */
export function downloadBlob(options: { blob: Blob; fileName: string }) {
  const url = URL.createObjectURL(options.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = options.fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), revokeDelayMs);
}
