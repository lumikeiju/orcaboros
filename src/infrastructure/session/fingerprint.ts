import { sha256 } from "@noble/hashes/sha2.js";

export async function fingerprintByteStream(
  chunks: AsyncIterable<Uint8Array>,
  signal?: AbortSignal
): Promise<string> {
  const digest = sha256.create();
  for await (const chunk of chunks) {
    if (signal?.aborted) {
      throw new DOMException("The operation was cancelled", "AbortError");
    }
    digest.update(chunk);
  }
  return [...digest.digest()]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
