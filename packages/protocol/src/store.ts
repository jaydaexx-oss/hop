import { mergePersistedStatus } from "./acks.js";
import { compareSenderStream, sortConversationMessages } from "./lifecycle.js";
import type { LocalReportRecord, PeerRelationship, PeerSafetyRecord, ReportCategory } from "./safety.js";
import type { PeerTrustRecord } from "./tofu.js";

/** Durable store is ciphertext + optional local_seal. Do not persist decrypted voice. */
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
  hop_count INTEGER NOT NULL DEFAULT 0,
  send_seq INTEGER,
  kind TEXT
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
  created_at TEXT NOT NULL,
  kind TEXT,
  title TEXT,
  event_id TEXT,
  archived INTEGER
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS peer_identities (
  user_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  state TEXT NOT NULL,
  pending_public_key TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbound_acks (
  ack_of TEXT NOT NULL,
  ack_type TEXT NOT NULL,
  ack_message_id TEXT NOT NULL,
  PRIMARY KEY (ack_of, ack_type)
);

CREATE TABLE IF NOT EXISTS inbound_receipts (
  ack_of TEXT NOT NULL,
  ack_type TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_pk TEXT,
  PRIMARY KEY (ack_of, ack_type)
);

CREATE TABLE IF NOT EXISTS peer_safety (
  peer_id TEXT PRIMARY KEY,
  relationship TEXT NOT NULL,
  muted INTEGER NOT NULL DEFAULT 0,
  intro_message_id TEXT,
  pre_block_relationship TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_reports (
  id TEXT PRIMARY KEY,
  peer_id TEXT NOT NULL,
  category TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_outbound_retry ON outbound_queue(next_retry_at);
`;

export interface SqliteDriver {
  execute(sql: string, params?: unknown[]): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction?(fn: () => Promise<void>): Promise<void>;
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
  /** Monotonic per-conversation sender sequence. Not a wall-clock timestamp. */
  send_seq?: number | null;
  /** Persisted when known. delivery_ack rows are hidden from chat lists. */
  kind?: "message" | "delivery_ack" | "voice" | null;
  duration_ms?: number;
  mime?: string;
  audio_b64?: string;
  codec?: string;
  seq?: number;
  total?: number;
  part_of?: string;
  /** Outbound retry count from outbound_queue. Not a SQLite messages column. */
  retry_attempts?: number;
}

export interface OutboundRow {
  message_id: string;
  attempts: number;
  next_retry_at: number;
}

export interface OutboundAckRow {
  ack_of: string;
  ack_type: string;
  ack_message_id: string;
}

export interface InboundReceiptRow {
  ack_of: string;
  ack_type: string;
  conversation_id: string;
  sender_id: string;
  sender_pk: string | null;
}

export interface StoredConversation {
  id: string;
  peer_id: string | null;
  peer_username: string | null;
  peer_public_key: string | null;
  created_at: string;
  kind?: "direct" | "event" | null;
  title?: string | null;
  event_id?: string | null;
  archived?: boolean | number | null;
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
    try {
      await this.db.execute("ALTER TABLE messages ADD COLUMN send_seq INTEGER");
    } catch {
      /* column already exists on new databases */
    }
    try {
      await this.db.execute("ALTER TABLE messages ADD COLUMN kind TEXT");
    } catch {
      /* column already exists on new databases */
    }
    try {
      await this.db.execute("ALTER TABLE conversations ADD COLUMN kind TEXT");
    } catch {
      /* column already exists on new databases */
    }
    try {
      await this.db.execute("ALTER TABLE conversations ADD COLUMN title TEXT");
    } catch {
      /* column already exists on new databases */
    }
    try {
      await this.db.execute("ALTER TABLE conversations ADD COLUMN event_id TEXT");
    } catch {
      /* column already exists on new databases */
    }
    try {
      await this.db.execute("ALTER TABLE conversations ADD COLUMN archived INTEGER");
    } catch {
      /* column already exists on new databases */
    }
    await this.db.execute("CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)");
    await this.db.execute("CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status)");
    await this.db.execute("CREATE INDEX IF NOT EXISTS idx_outbound_retry ON outbound_queue(next_retry_at)");
    await this.db.execute(
      `CREATE TABLE IF NOT EXISTS peer_safety (
        peer_id TEXT PRIMARY KEY,
        relationship TEXT NOT NULL,
        muted INTEGER NOT NULL DEFAULT 0,
        intro_message_id TEXT,
        pre_block_relationship TEXT,
        updated_at TEXT NOT NULL
      )`,
    );
    await this.db.execute(
      `CREATE TABLE IF NOT EXISTS local_reports (
        id TEXT PRIMARY KEY,
        peer_id TEXT NOT NULL,
        category TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
      )`,
    );
  }

  async getPeerSafety(peerId: string): Promise<PeerSafetyRecord | null> {
    const rows = await this.db.query<{
      peer_id: string;
      relationship: string;
      muted: number;
      intro_message_id: string | null;
      pre_block_relationship: string | null;
      updated_at: string;
    }>("SELECT * FROM peer_safety WHERE peer_id = ?", [peerId]);
    const row = rows[0];
    if (!row) return null;
    return {
      peerId: row.peer_id,
      relationship: row.relationship as PeerRelationship,
      muted: Boolean(row.muted),
      introMessageId: row.intro_message_id,
      preBlockRelationship: (row.pre_block_relationship as PeerRelationship | null) ?? null,
      updatedAt: row.updated_at,
    };
  }

  async listPeerSafety(): Promise<PeerSafetyRecord[]> {
    const rows = await this.db.query<{
      peer_id: string;
      relationship: string;
      muted: number;
      intro_message_id: string | null;
      pre_block_relationship: string | null;
      updated_at: string;
    }>("SELECT * FROM peer_safety ORDER BY updated_at DESC");
    return rows.map((row) => ({
      peerId: row.peer_id,
      relationship: row.relationship as PeerRelationship,
      muted: Boolean(row.muted),
      introMessageId: row.intro_message_id,
      preBlockRelationship: (row.pre_block_relationship as PeerRelationship | null) ?? null,
      updatedAt: row.updated_at,
    }));
  }

  async savePeerSafety(record: PeerSafetyRecord): Promise<void> {
    await this.db.execute(
      `INSERT INTO peer_safety (
        peer_id, relationship, muted, intro_message_id, pre_block_relationship, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(peer_id) DO UPDATE SET
        relationship=excluded.relationship,
        muted=excluded.muted,
        intro_message_id=excluded.intro_message_id,
        pre_block_relationship=excluded.pre_block_relationship,
        updated_at=excluded.updated_at`,
      [
        record.peerId,
        record.relationship,
        record.muted ? 1 : 0,
        record.introMessageId,
        record.preBlockRelationship,
        record.updatedAt,
      ],
    );
  }

  async saveLocalReport(record: LocalReportRecord): Promise<void> {
    await this.db.execute(
      `INSERT INTO local_reports (id, peer_id, category, note, created_at) VALUES (?, ?, ?, ?, ?)`,
      [record.id, record.peerId, record.category, record.note, record.createdAt],
    );
  }

  async listLocalReports(): Promise<LocalReportRecord[]> {
    const rows = await this.db.query<{
      id: string;
      peer_id: string;
      category: string;
      note: string | null;
      created_at: string;
    }>("SELECT * FROM local_reports ORDER BY created_at DESC");
    return rows.map((row) => ({
      id: row.id,
      peerId: row.peer_id,
      category: row.category as ReportCategory,
      note: row.note,
      createdAt: row.created_at,
    }));
  }

  async saveMessage(message: StoredMessage): Promise<void> {
    const existing = await this.getMessage(message.message_id);
    if (
      existing &&
      (existing.conversation_id !== message.conversation_id ||
        existing.sender_id !== message.sender_id ||
        existing.recipient_id !== message.recipient_id)
    ) {
      return;
    }
    const status = existing ? mergePersistedStatus(existing.status, message.status) : message.status;
    const kind = existing?.kind ?? message.kind ?? null;
    const ciphertext =
      existing?.encrypted_payload && existing.encrypted_payload.length > 0
        ? existing.encrypted_payload
        : message.encrypted_payload;
    await this.db.execute(
      `INSERT INTO messages (
        message_id, conversation_id, sender_id, recipient_id, text, encrypted_payload, local_seal,
        status, transport, created_at, expires_at, ttl, hop_count, send_seq, kind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET
        text=NULL,
        encrypted_payload=CASE
          WHEN length(COALESCE(messages.encrypted_payload, '')) > 0 THEN messages.encrypted_payload
          ELSE excluded.encrypted_payload
        END,
        local_seal=COALESCE(messages.local_seal, excluded.local_seal),
        status=excluded.status,
        transport=excluded.transport,
        kind=COALESCE(messages.kind, excluded.kind),
        send_seq=COALESCE(messages.send_seq, excluded.send_seq)`,
      [
        message.message_id,
        existing?.conversation_id ?? message.conversation_id,
        existing?.sender_id ?? message.sender_id,
        existing?.recipient_id ?? message.recipient_id,
        null,
        ciphertext,
        existing?.local_seal ?? message.local_seal ?? null,
        status,
        message.transport || existing?.transport || "local",
        existing?.created_at ?? message.created_at,
        existing?.expires_at ?? message.expires_at,
        existing?.ttl ?? message.ttl,
        existing?.hop_count ?? message.hop_count,
        existing?.send_seq ?? message.send_seq ?? null,
        kind,
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
    const rows = await this.db.query<StoredMessage>(
      `SELECT * FROM messages WHERE conversation_id = ?`,
      [conversationId],
    );
    return sortConversationMessages(rows);
  }

  async listMessagesByStatus(status: string): Promise<StoredMessage[]> {
    return this.db.query<StoredMessage>("SELECT * FROM messages WHERE status = ?", [status]);
  }

  async getConversation(id: string): Promise<StoredConversation | null> {
    const rows = await this.db.query<StoredConversation>(
      "SELECT id, peer_id, peer_username, peer_public_key, created_at, kind, title, event_id, archived FROM conversations WHERE id = ?",
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return { ...row, archived: row.archived === true || row.archived === 1 };
  }

  async nextSendSeq(conversationId: string, senderId?: string): Promise<number> {
    const legacyKey = `send_seq:${conversationId}`;
    const keyed = senderId ? `send_seq:${conversationId}:${senderId}` : legacyKey;
    const fromKeyed = Number.parseInt((await this.getSyncValue(keyed)) ?? "0", 10);
    const fromLegacy = senderId ? Number.parseInt((await this.getSyncValue(legacyKey)) ?? "0", 10) : 0;
    let fromRows = 0;
    if (senderId) {
      const rows = await this.db.query<{ m: number | null }>(
        `SELECT MAX(send_seq) AS m FROM messages WHERE conversation_id = ? AND sender_id = ?`,
        [conversationId, senderId],
      );
      fromRows = Number(rows[0]?.m ?? 0);
    } else {
      const rows = await this.db.query<{ m: number | null }>(
        `SELECT MAX(send_seq) AS m FROM messages WHERE conversation_id = ?`,
        [conversationId],
      );
      fromRows = Number(rows[0]?.m ?? 0);
    }
    const current = Math.max(
      0,
      Number.isFinite(fromKeyed) ? fromKeyed : 0,
      Number.isFinite(fromLegacy) ? fromLegacy : 0,
      Number.isFinite(fromRows) ? fromRows : 0,
    );
    const next = current + 1;
    await this.setSyncValue(keyed, String(next));
    if (senderId) await this.setSyncValue(legacyKey, String(next));
    return next;
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
    const archived =
      conversation.archived === true || conversation.archived === 1 ? 1 : conversation.archived === false ? 0 : null;
    await this.db.execute(
      `INSERT INTO conversations (id, peer_id, peer_username, peer_public_key, created_at, kind, title, event_id, archived)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         peer_id=COALESCE(conversations.peer_id, excluded.peer_id),
         peer_username=excluded.peer_username,
         peer_public_key=COALESCE(conversations.peer_public_key, excluded.peer_public_key),
         kind=COALESCE(excluded.kind, conversations.kind),
         title=COALESCE(excluded.title, conversations.title),
         event_id=COALESCE(excluded.event_id, conversations.event_id),
         archived=COALESCE(excluded.archived, conversations.archived)`,
      [
        conversation.id,
        conversation.peer_id,
        conversation.peer_username,
        conversation.peer_public_key ?? null,
        conversation.created_at,
        conversation.kind ?? null,
        conversation.title ?? null,
        conversation.event_id ?? null,
        archived,
      ],
    );
  }

  async listConversations(): Promise<StoredConversation[]> {
    const rows = await this.db.query<StoredConversation>(
      "SELECT id, peer_id, peer_username, peer_public_key, created_at, kind, title, event_id, archived FROM conversations ORDER BY created_at DESC",
    );
    return rows.map((row) => ({
      ...row,
      archived: row.archived === true || row.archived === 1,
    }));
  }

  async peerPublicKey(peerId: string): Promise<string | null> {
    const fromConvo = await this.db.query<{ peer_public_key: string | null }>(
      "SELECT peer_public_key FROM conversations WHERE peer_id = ? AND peer_public_key IS NOT NULL AND peer_public_key != '' LIMIT 1",
      [peerId],
    );
    if (fromConvo[0]?.peer_public_key) return fromConvo[0].peer_public_key;
    const fromIdentity = await this.db.query<{ public_key: string | null }>(
      "SELECT public_key FROM peer_identities WHERE user_id = ? AND public_key IS NOT NULL AND public_key != '' LIMIT 1",
      [peerId],
    );
    return fromIdentity[0]?.public_key ?? null;
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

  async saveQueuedOutbound(message: StoredMessage, attempts: number, nextRetryAt: number): Promise<void> {
    const write = async () => {
      await this.saveMessage(message);
      await this.enqueue(message.message_id, attempts, nextRetryAt);
    };
    if (this.db.transaction) {
      await this.db.transaction(write);
      return;
    }
    await write();
  }

  async getOutbound(messageId: string): Promise<OutboundRow | null> {
    const rows = await this.db.query<OutboundRow>(
      "SELECT message_id, attempts, next_retry_at FROM outbound_queue WHERE message_id = ?",
      [messageId],
    );
    return rows[0] ?? null;
  }

  async listOrphanOutbox(): Promise<StoredMessage[]> {
    return this.db.query<StoredMessage>(
      `SELECT m.* FROM messages m
       WHERE m.status IN ('QUEUED', 'RETRYING')
         AND NOT EXISTS (SELECT 1 FROM outbound_queue o WHERE o.message_id = m.message_id)`,
    );
  }

  async listOutbound(): Promise<OutboundRow[]> {
    return this.db.query<OutboundRow>(
      `SELECT o.message_id, o.attempts, o.next_retry_at
       FROM outbound_queue o
       JOIN messages m ON m.message_id = o.message_id
       ORDER BY CASE WHEN m.kind = 'delivery_ack' THEN 0 ELSE 1 END ASC,
         m.conversation_id ASC, COALESCE(m.send_seq, 0) ASC, m.created_at ASC, o.message_id ASC`,
    );
  }

  async hasEarlierOutbound(
    conversationId: string,
    createdAt: string,
    messageId: string,
    sendSeq?: number | null,
  ): Promise<boolean> {
    const rows = await this.db.query<{ message_id: string; created_at: string; send_seq: number | null }>(
      `SELECT o.message_id, m.created_at, m.send_seq
       FROM outbound_queue o
       JOIN messages m ON m.message_id = o.message_id
       WHERE m.conversation_id = ? AND o.message_id != ?
         AND (m.kind IS NULL OR m.kind != 'delivery_ack')`,
      [conversationId, messageId],
    );
    return rows.some((row) => {
      return (
        compareSenderStream(
          {
            message_id: row.message_id,
            sender_id: "",
            created_at: row.created_at,
            send_seq: row.send_seq,
          },
          { message_id: messageId, sender_id: "", created_at: createdAt, send_seq: sendSeq },
        ) < 0
      );
    });
  }

  async latestMessage(conversationId: string): Promise<StoredMessage | null> {
    const rows = (await this.listMessages(conversationId)).filter((row) => row.kind !== "delivery_ack");
    return rows[rows.length - 1] ?? null;
  }

  async removeOutbound(messageId: string): Promise<void> {
    await this.db.execute("DELETE FROM outbound_queue WHERE message_id = ?", [messageId]);
  }

  async rememberProcessed(messageId: string, at = new Date()): Promise<boolean> {
    try {
      await this.db.execute("INSERT INTO processed_ids (message_id, seen_at) VALUES (?, ?)", [
        messageId,
        at.toISOString(),
      ]);
      return true;
    } catch {
      return false;
    }
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

  async listPeerIdentities(): Promise<PeerTrustRecord[]> {
    const rows = await this.db.query<{
      user_id: string;
      public_key: string;
      state: string;
      pending_public_key: string | null;
    }>("SELECT user_id, public_key, state, pending_public_key FROM peer_identities");
    return rows
      .filter((row) => row.state === "TOFU_TRUSTED" || row.state === "VERIFIED" || row.state === "KEY_CHANGED")
      .map((row) => ({
        userId: row.user_id,
        publicKey: row.public_key,
        state: row.state as PeerTrustRecord["state"],
        pendingPublicKey: row.pending_public_key ?? undefined,
      }));
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.removeOutbound(messageId);
    await this.db.execute("DELETE FROM messages WHERE message_id = ?", [messageId]);
  }

  async unreadCount(conversationId: string, viewerId: string): Promise<number> {
    const rows = await this.db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM messages
       WHERE conversation_id = ?
         AND sender_id != ?
         AND status = 'DELIVERED'
         AND (kind IS NULL OR kind != 'delivery_ack')`,
      [conversationId, viewerId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async unreadCounts(viewerId: string): Promise<Record<string, number>> {
    const rows = await this.db.query<{ conversation_id: string; n: number }>(
      `SELECT conversation_id, COUNT(*) AS n FROM messages
       WHERE sender_id != ?
         AND status = 'DELIVERED'
         AND (kind IS NULL OR kind != 'delivery_ack')
       GROUP BY conversation_id`,
      [viewerId],
    );
    const out: Record<string, number> = {};
    for (const row of rows) out[row.conversation_id] = Number(row.n);
    return out;
  }

  async saveOutboundAck(ackOf: string, ackType: string, ackMessageId: string): Promise<boolean> {
    try {
      await this.db.execute(
        `INSERT INTO outbound_acks (ack_of, ack_type, ack_message_id) VALUES (?, ?, ?)`,
        [ackOf, ackType, ackMessageId],
      );
      return true;
    } catch {
      return false;
    }
  }

  async getOutboundAck(ackOf: string, ackType: string): Promise<OutboundAckRow | null> {
    const rows = await this.db.query<OutboundAckRow>(
      "SELECT ack_of, ack_type, ack_message_id FROM outbound_acks WHERE ack_of = ? AND ack_type = ?",
      [ackOf, ackType],
    );
    return rows[0] ?? null;
  }

  async listOutboundAcks(): Promise<OutboundAckRow[]> {
    return this.db.query<OutboundAckRow>("SELECT ack_of, ack_type, ack_message_id FROM outbound_acks");
  }

  async saveInboundReceipt(row: InboundReceiptRow): Promise<void> {
    await this.db.execute(
      `INSERT INTO inbound_receipts (ack_of, ack_type, conversation_id, sender_id, sender_pk)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(ack_of, ack_type) DO UPDATE SET
         sender_pk=CASE
           WHEN inbound_receipts.sender_pk IS NULL AND inbound_receipts.sender_id = excluded.sender_id
           THEN excluded.sender_pk
           ELSE inbound_receipts.sender_pk
         END`,
      [row.ack_of, row.ack_type, row.conversation_id, row.sender_id, row.sender_pk],
    );
  }

  async listInboundReceiptTargets(): Promise<string[]> {
    const rows = await this.db.query<{ ack_of: string }>("SELECT DISTINCT ack_of FROM inbound_receipts");
    return rows.map((row) => row.ack_of);
  }

  async listInboundReceipts(ackOf: string): Promise<InboundReceiptRow[]> {
    return this.db.query<InboundReceiptRow>(
      `SELECT ack_of, ack_type, conversation_id, sender_id, sender_pk
       FROM inbound_receipts WHERE ack_of = ?`,
      [ackOf],
    );
  }

  async listInboundNeedingAck(ackType: string, selfId: string): Promise<StoredMessage[]> {
    if (!selfId) return [];
    if (ackType === "READ_ACK") {
      return this.db.query<StoredMessage>(
        `SELECT m.* FROM messages m
         WHERE m.status = 'READ'
           AND m.recipient_id = ?
           AND (m.kind IS NULL OR m.kind != 'delivery_ack')
           AND NOT EXISTS (
             SELECT 1 FROM outbound_acks a
             WHERE a.ack_of = m.message_id AND a.ack_type = 'READ_ACK'
           )`,
        [selfId],
      );
    }
    return this.db.query<StoredMessage>(
      `SELECT m.* FROM messages m
       WHERE m.status IN ('DELIVERED', 'READ')
         AND m.recipient_id = ?
         AND (m.kind IS NULL OR m.kind != 'delivery_ack')
         AND NOT EXISTS (
           SELECT 1 FROM outbound_acks a
           WHERE a.ack_of = m.message_id AND a.ack_type = 'DELIVERED_ACK'
         )`,
      [selfId],
    );
  }

  async pruneProcessed(maxIds = 50_000): Promise<void> {
    const rows = await this.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM processed_ids");
    const n = Number(rows[0]?.n ?? 0);
    if (n > maxIds) {
      await this.db.execute(
        `DELETE FROM processed_ids WHERE message_id IN (
           SELECT message_id FROM processed_ids ORDER BY seen_at ASC LIMIT ?
         )`,
        [n - maxIds],
      );
    }
    const receipts = await this.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM inbound_receipts");
    const receiptCount = Number(receipts[0]?.n ?? 0);
    if (receiptCount > 10_000) {
      await this.db.execute(
        `DELETE FROM inbound_receipts WHERE rowid IN (
           SELECT rowid FROM inbound_receipts ORDER BY rowid ASC LIMIT ?
         )`,
        [receiptCount - 10_000],
      );
    }
  }

  async savePeerIdentity(record: PeerTrustRecord): Promise<void> {
    await this.db.execute(
      `INSERT INTO peer_identities (user_id, public_key, state, pending_public_key, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         public_key=excluded.public_key,
         state=excluded.state,
         pending_public_key=excluded.pending_public_key,
         updated_at=excluded.updated_at`,
      [
        record.userId,
        record.publicKey,
        record.state,
        record.pendingPublicKey ?? null,
        new Date().toISOString(),
      ],
    );
  }
}
