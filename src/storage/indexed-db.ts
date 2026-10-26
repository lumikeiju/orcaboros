import { SessionRepository, StagedSession, StoredSession } from "./types";

const DATABASE_NAME = "orcaboros";
const DATABASE_VERSION = 1;
const META_STORE = "meta";
const SESSION_STORE = "sessions";
const ACTIVE_KEY = "activeSessionId";

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new StorageError("IndexedDB request failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(new StorageError("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(new StorageError("IndexedDB transaction was aborted"));
  });
}

export class IndexedDbSessionRepository implements SessionRepository {
  private readonly databasePromise: Promise<IDBDatabase>;

  constructor(databaseName = DATABASE_NAME) {
    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE);
        }
        if (!database.objectStoreNames.contains(SESSION_STORE)) {
          database.createObjectStore(SESSION_STORE, {
            keyPath: "manifest.sessionId"
          });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(new StorageError("Could not open IndexedDB"));
    });
  }

  async getActiveSessionId(): Promise<string | undefined> {
    const database = await this.databasePromise;
    const transaction = database.transaction(META_STORE, "readonly");
    const value = await requestResult(
      transaction.objectStore(META_STORE).get(ACTIVE_KEY)
    );
    return typeof value === "string" ? value : undefined;
  }

  async getActiveSession(): Promise<StoredSession | undefined> {
    const id = await this.getActiveSessionId();
    return id === undefined ? undefined : this.getSession(id);
  }

  async getSession(sessionId: string): Promise<StoredSession | undefined> {
    const database = await this.databasePromise;
    const transaction = database.transaction(SESSION_STORE, "readonly");
    const value = await requestResult(
      transaction.objectStore(SESSION_STORE).get(sessionId)
    );
    if (!isStoredRecord(value)) {
      if (value !== undefined) {
        throw new StorageError(
          "The stored session is invalid. Reset it before importing again."
        );
      }
      return undefined;
    }
    const { status: _status, ...session } = value;
    return session;
  }

  async putStagingSession(session: StagedSession): Promise<void> {
    if (session.status !== "staging") {
      throw new StorageError("Only staging sessions can be inserted");
    }
    const database = await this.databasePromise;
    const transaction = database.transaction(SESSION_STORE, "readwrite");
    transaction.objectStore(SESSION_STORE).add(session);
    await transactionComplete(transaction);
  }

  async activateStagingSession(sessionId: string): Promise<void> {
    const database = await this.databasePromise;
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        [META_STORE, SESSION_STORE],
        "readwrite"
      );
      const sessions = transaction.objectStore(SESSION_STORE);
      let settled = false;
      transaction.oncomplete = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      transaction.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new StorageError("IndexedDB transaction failed"));
        }
      };
      transaction.onabort = () => {
        if (!settled) {
          settled = true;
          reject(
            new StorageError(`Staging session ${sessionId} does not exist`)
          );
        }
      };
      const request = sessions.get(sessionId);
      request.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new StorageError("IndexedDB request failed"));
        }
      };
      request.onsuccess = () => {
        const existing = request.result;
        if (!isStoredRecord(existing) || existing.status !== "staging") {
          transaction.abort();
          return;
        }
        sessions.put({ ...existing, status: "active" });
        transaction.objectStore(META_STORE).put(sessionId, ACTIVE_KEY);
      };
    });
  }

  async putActiveSession(session: StoredSession): Promise<void> {
    const database = await this.databasePromise;
    const transaction = database.transaction(
      [META_STORE, SESSION_STORE],
      "readwrite"
    );
    const complete = transactionComplete(transaction);
    let inactive = false;
    const request = transaction.objectStore(META_STORE).get(ACTIVE_KEY);
    request.onsuccess = () => {
      if (request.result !== session.manifest.sessionId) {
        inactive = true;
        transaction.abort();
        return;
      }
      transaction
        .objectStore(SESSION_STORE)
        .put({ ...session, status: "active" });
    };
    try {
      await complete;
    } catch (error: unknown) {
      if (inactive) {
        throw new StorageError(
          `Session ${session.manifest.sessionId} is not active`
        );
      }
      throw error;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const database = await this.databasePromise;
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        [META_STORE, SESSION_STORE],
        "readwrite"
      );
      const meta = transaction.objectStore(META_STORE);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(new StorageError("IndexedDB transaction failed"));
      transaction.onabort = () =>
        reject(new StorageError("IndexedDB transaction was aborted"));
      transaction.objectStore(SESSION_STORE).delete(sessionId);
      const request = meta.get(ACTIVE_KEY);
      request.onerror = () =>
        reject(new StorageError("IndexedDB request failed"));
      request.onsuccess = () => {
        if (request.result === sessionId) {
          meta.delete(ACTIVE_KEY);
        }
      };
    });
  }

  async resetActiveSession(): Promise<void> {
    const active = await this.getActiveSessionId();
    if (active !== undefined) {
      await this.deleteSession(active);
    }
  }
}

function isStoredRecord(
  value: unknown
): value is StoredSession & { status: "staging" | "active" } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as {
    manifest?: { sessionId?: unknown };
    status?: unknown;
  };
  return (
    typeof record.manifest?.sessionId === "string" &&
    (record.status === "staging" || record.status === "active")
  );
}
