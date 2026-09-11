const MAX_PROFILE_BYTES = 1 * 1024 * 1024;

export async function readUtf8Stream(blob: Blob): Promise<string> {
  if (typeof blob.stream !== "function") {
    throw new Error("This browser cannot stream the selected file");
  }
  const reader = blob.stream().getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        chunks.push(decoder.decode());
        return chunks.join("");
      }
      bytes += result.value.byteLength;
      if (bytes > MAX_PROFILE_BYTES) {
        throw new Error("The profile file exceeds the 1 MiB limit");
      }
      chunks.push(decoder.decode(result.value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
}
