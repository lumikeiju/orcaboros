import { SessionRepository, StagedSession, StoredSession } from "./types";

export class MemorySessionRepository implements SessionRepository {
  private activeSessionId: string | undefined;
  private readonly sessions = new Map<
    string,
    StoredSession & { status: "staging" | "active" }
  >();

  async getActiveSessionId(): Promise<string | undefined> {
    return this.activeSessionId;
  }

  async getActiveSession(): Promise<StoredSession | undefined> {
    if (this.activeSessionId === undefined) {
      return undefined;
    }
    const session = this.sessions.get(this.activeSessionId);
    return session === undefined ? undefined : withoutStatus(session);
  }

  async getSession(sessionId: string): Promise<StoredSession | undefined> {
    const session = this.sessions.get(sessionId);
    return session === undefined ? undefined : withoutStatus(session);
  }

  async putStagingSession(session: StagedSession): Promise<void> {
    if (session.status !== "staging") {
      throw new Error("Only staging sessions can be inserted");
    }
    if (this.sessions.has(session.manifest.sessionId)) {
      throw new Error(`Session ${session.manifest.sessionId} already exists`);
    }
    this.sessions.set(session.manifest.sessionId, { ...session });
  }

  async activateStagingSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session === undefined || session.status !== "staging") {
      throw new Error(`Staging session ${sessionId} does not exist`);
    }
    session.status = "active";
    this.activeSessionId = sessionId;
  }

  async putActiveSession(session: StoredSession): Promise<void> {
    if (this.activeSessionId !== session.manifest.sessionId) {
      throw new Error(`Session ${session.manifest.sessionId} is not active`);
    }
    this.sessions.set(session.manifest.sessionId, {
      ...session,
      status: "active"
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = undefined;
    }
  }

  async resetActiveSession(): Promise<void> {
    if (this.activeSessionId !== undefined) {
      this.sessions.delete(this.activeSessionId);
      this.activeSessionId = undefined;
    }
  }
}

function withoutStatus(
  session: StoredSession & { status: "staging" | "active" }
): StoredSession {
  const { status: _status, ...stored } = session;
  return stored;
}
