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
  let entryError: Error | undefined;
  let resolveEntry: () => void = () => undefined;
  const entryFinished = new Promise<void>((resolve) => {
    resolveEntry = resolve;
  });
  let terminateEntry: (() => void) | undefined;
  const failEntry = (error: Error): void => {
    entryError ??= error;
    terminateEntry?.();
    resolveEntry();
  };
  const cancel = (): void =>
    failEntry(new DOMException("The import was cancelled", "AbortError"));
  const unzip = new Unzip();
  unzip.register(AsyncUnzipInflate);
  unzip.onfile = (entry) => {
    if (entry.name !== entryName) {
      return;
    }
    if (found) {
      failEntry(
        new ZipStreamError(`ZIP contains duplicate ${entryName} entries`)
      );
      return;
    }
    found = true;
    terminateEntry = () => entry.terminate();
    entry.ondata = (error, data, final) => {
      if (entryError !== undefined) {
        return;
      }
      if (error !== null) {
        failEntry(
          new ZipStreamError("The selected ZIP entry could not be decompressed")
        );
        return;
      }
      try {
        onChunk(data, final);
      } catch (caught: unknown) {
        failEntry(
          caught instanceof Error
            ? caught
            : new ZipStreamError(
                "The selected ZIP entry could not be processed"
              )
        );
        return;
      }
      if (final) {
        resolveEntry();
      }
    };
    entry.start();
  };

  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) {
      cancel();
      throw entryError;
    }
    for await (const chunk of blobChunks(archive, signal)) {
      onRawChunk?.(chunk);
      unzip.push(chunk);
      if (entryError !== undefined) {
        throw entryError;
      }
    }
    unzip.push(new Uint8Array(0), true);
    if (!found) {
      throw new ZipStreamError(`Required ZIP entry ${entryName} was not found`);
    }
    await entryFinished;
    if (entryError !== undefined) {
      throw entryError;
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new ZipStreamError("The selected ZIP archive could not be read");
  } finally {
    signal.removeEventListener("abort", cancel);
    terminateEntry?.();
  }
}
