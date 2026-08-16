export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  text TEXT,
  encrypted_payload TEXT NOT NULL,
  local_seal TEXT,
  status TEXT NOT NULL,
  transport TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ttl INTEGER NOT NULL,
  hop_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS outbound_queue (
  message_id TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  next_retry_at INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(message_id)
);

CREATE TABLE IF NOT EXISTS processed_ids (
  message_id TEXT PRIMARY KEY,
  seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  peer_id TEXT,
  peer_username TEXT,
  peer_public_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export interface SqliteDriver {
  execute(sql: string, params?: unknown[]): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface StoredMessage {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  text: string | null;
  encrypted_payload: string;
  local_seal?: string | null;
  status: string;
  transport: string;
  created_at: string;
  expires_at: string;
  ttl: number;
  hop_count: number;
  /** In-memory only after decrypt. Never written to the SQLite text column. */
  kind?: "message" | "delivery_ack" | "voice";
  duration_ms?: number;
  mime?: string;
  audio_b64?: string;
  codec?: string;
  seq?: number;
  total?: number;
  part_of?: string;
}

export interface OutboundRow {
  message_id: string;
  attempts: number;
  next_retry_at: number;
}

export interface StoredConversation {
  id: string;
  peer_id: string | null;
  peer_username: string | null;
  peer_public_key: string | null;
  created_at: string;
}

export class HopSqliteStore {
  constructor(private readonly db: SqliteDriver) {}

  async init(): Promise<void> {
    for (const statement of SCHEMA_SQL.split(";").map((part) => part.trim()).filter(Boolean)) {
      await this.db.execute(`${statement};`);
    }
    try {
      await this.db.execute("ALTER TABLE conversations ADD COLUMN peer_public_key TEXT");
    } catch {
      /* column already exists on new databases */
    }
    try {
      await this.db.execute("ALTER TABLE messages ADD COLUMN local_seal TEXT");
    } catch {
      /* column already exists on new databases */
    }
  }

  async saveMessage(message: StoredMessage): Promise<void> {
    await this.db.execute(
      `INSERT INTO messages (
        message_id, conversation_id, sender_id, recipient_id, text, encrypted_payload, local_seal,
        status, transport, created_at, expires_at, ttl, hop_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET
        text=excluded.text,
        encrypted_payload=excluded.encrypted_payload,
        local_seal=excluded.local_seal,
        status=excluded.status,
        transport=excluded.transport`,
      [
        message.message_id,
        message.conversation_id,
        message.sender_id,
        message.recipient_id,
        message.text,
        message.encrypted_payload,
        message.local_seal ?? null,
        message.status,
        message.transport,
        message.created_at,
        message.expires_at,
        message.ttl,
        message.hop_count,
      ],
    );
  }

  async getMessage(messageId: string): Promise<StoredMessage | null> {
    const rows = await this.db.query<StoredMessage>(
      "SELECT * FROM messages WHERE message_id = ?",
      [messageId],
    );
    return rows[0] ?? null;
  }

  async listMessages(conversationId: string): Promise<StoredMessage[]> {
    return this.db.query<StoredMessage>(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
      [conversationId],
    );
  }

  async listConversationIds(): Promise<string[]> {
    const rows = await this.db.query<{ conversation_id: string }>(
      "SELECT DISTINCT conversation_id FROM messages",
    );
    const fromMessages = rows.map((row) => row.conversation_id);
    const convos = await this.db.query<{ id: string }>("SELECT id FROM conversations");
    return [...new Set([...convos.map((row) => row.id), ...fromMessages])];
  }

  async saveConversation(conversation: StoredConversation): Promise<void> {
    await this.db.execute(
      `INSERT INTO conversations (id, peer_id, peer_username, peer_public_key, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         peer_id=excluded.peer_id,
         peer_username=excluded.peer_username,
         peer_public_key=excluded.peer_public_key`,
      [
        conversation.id,
        conversation.peer_id,
        conversation.peer_username,
        conversation.peer_public_key ?? null,
        conversation.created_at,
      ],
    );
  }

  async listConversations(): Promise<StoredConversation[]> {
    return this.db.query<StoredConversation>(
      "SELECT id, peer_id, peer_username, peer_public_key, created_at FROM conversations ORDER BY created_at DESC",
    );
  }

  async peerPublicKey(peerId: string): Promise<string | null> {
    const rows = await this.db.query<{ peer_public_key: string | null }>(
      "SELECT peer_public_key FROM conversations WHERE peer_id = ? AND peer_public_key IS NOT NULL AND peer_public_key != '' LIMIT 1",
      [peerId],
    );
    return rows[0]?.peer_public_key ?? null;
  }

  async queuedCount(): Promise<number> {
    const rows = await this.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM outbound_queue");
    return Number(rows[0]?.n ?? 0);
  }

  async enqueue(messageId: string, attempts: number, nextRetryAt: number): Promise<void> {
    await this.db.execute(
      `INSERT INTO outbound_queue (message_id, attempts, next_retry_at) VALUES (?, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET attempts=excluded.attempts, next_retry_at=excluded.next_retry_at`,
      [messageId, attempts, nextRetryAt],
    );
  }

  async listOutbound(): Promise<OutboundRow[]> {
    return this.db.query<OutboundRow>(
      "SELECT message_id, attempts, next_retry_at FROM outbound_queue ORDER BY next_retry_at ASC",
    );
  }

  async removeOutbound(messageId: string): Promise<void> {
    await this.db.execute("DELETE FROM outbound_queue WHERE message_id = ?", [messageId]);
  }

  async rememberProcessed(messageId: string, at = new Date()): Promise<boolean> {
    const existing = await this.db.query("SELECT message_id FROM processed_ids WHERE message_id = ?", [
      messageId,
    ]);
    if (existing.length > 0) return false;
    await this.db.execute("INSERT INTO processed_ids (message_id, seen_at) VALUES (?, ?)", [
      messageId,
      at.toISOString(),
    ]);
    return true;
  }

  async hasProcessed(messageId: string): Promise<boolean> {
    const rows = await this.db.query("SELECT message_id FROM processed_ids WHERE message_id = ?", [
      messageId,
    ]);
    return rows.length > 0;
  }

  async setSyncValue(key: string, value: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO sync_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      [key, value],
    );
  }

  async getSyncValue(key: string): Promise<string | null> {
    const rows = await this.db.query<{ value: string }>("SELECT value FROM sync_state WHERE key = ?", [key]);
    return rows[0]?.value ?? null;
  }
}
