import { AsyncUnzipInflate, Unzip } from "fflate";

export type StreamableBlob = {
  stream: () => ReadableStream<Uint8Array>;
  size?: number;
};

export type NamedBlob = StreamableBlob & { name: string };

export type ZipEntryChunkHandler = (chunk: Uint8Array, final: boolean) => void;

export class ZipStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipStreamError";
  }
}

async function* blobChunks(
  blob: StreamableBlob,
  signal: AbortSignal
): AsyncGenerator<Uint8Array, void, undefined> {
  if (typeof blob.stream !== "function") {
    throw new ZipStreamError(
      "The browser does not support streaming ZIP files"
    );
  }
  const reader = blob.stream().getReader();
  try {
    while (true) {
      if (signal.aborted) {
        throw new DOMException("The import was cancelled", "AbortError");
      }
      const result = await reader.read();
      if (result.done) {
        return;
      }
      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function consumeZipEntry(
  archive: StreamableBlob,
  entryName: string,
  onChunk: ZipEntryChunkHandler,
  signal: AbortSignal,
  onRawChunk?: (chunk: Uint8Array) => void
): Promise<void> {
  let found = false;
  let entryFinished: Promise<void> | undefined;
  let resolveEntry: (() => void) | undefined;
  let rejectEntry: ((reason: Error) => void) | undefined;
  const unzip = new Unzip();
  unzip.register(AsyncUnzipInflate);
  unzip.onfile = (entry) => {
    if (entry.name !== entryName) {
      return;
    }
    if (found) {
      rejectEntry?.(
        new ZipStreamError(`ZIP contains duplicate ${entryName} entries`)
      );
      return;
    }
    found = true;
    entryFinished = new Promise<void>((resolve, reject) => {
      resolveEntry = resolve;
      rejectEntry = reject;
    });
    entry.ondata = (error, data, final) => {
      if (error !== null) {
        rejectEntry?.(
          new ZipStreamError("The selected ZIP entry could not be decompressed")
        );
        return;
      }
      onChunk(data, final);
      if (final) {
        resolveEntry?.();
      }
    };
    entry.start();
  };

  try {
    for await (const chunk of blobChunks(archive, signal)) {
      onRawChunk?.(chunk);
      unzip.push(chunk);
    }
    unzip.push(new Uint8Array(0), true);
    if (!found) {
      throw new ZipStreamError(`Required ZIP entry ${entryName} was not found`);
    }
    await entryFinished;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new ZipStreamError("The selected ZIP archive could not be read");
  }
}
