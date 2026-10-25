export function createDefaultOsmFileName(date = new Date()): string {
  // Colons are invalid in Windows filenames, so use a hyphen for the time separator.
  const timestamp = date.toISOString().slice(0, 16).replace(":", "-");
  return `orcaboros-${timestamp}Z.osm`;
}

export function downloadTextFile(
  content: string,
  fileName: string,
  mimeType: string
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
