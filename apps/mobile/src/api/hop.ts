import { API_URL, assertSafeApiUrl } from './client';
import { identityPublishBody } from '@hop/protocol';

export type User = {
  id: string;
  username: string;
  created_at: string;
  identity_public_key?: string;
  has_avatar?: boolean;
  avatar_url?: string | null;
};
export type AuthResponse = { token: string; user: User };
export type Conversation = {
  id: string;
  created_at: string;
  peer: {
    id: string;
    username: string;
    identity_public_key?: string;
    has_avatar?: boolean;
    avatar_url?: string | null;
  };
};
export type ChatMessage = {
  message_id: string;
  sender_id: string;
  recipient_id: string;
  conversation_id: string;
  text: string | null;
  status: string;
  created_at: string;
  e2ee: boolean;
  encrypted_payload?: string;
  expires_at?: string;
  ttl?: number;
  hop_count?: number;
  transport?: string;
  kind?: "message" | "delivery_ack" | "voice";
  duration_ms?: number;
  mime?: string;
  audio_b64?: string;
  retry_attempts?: number;
  send_seq?: number | null;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  opts: { method?: string; token?: string | null; body?: unknown } = {},
): Promise<T> {
  assertSafeApiUrl(API_URL);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    throw new ApiError(err instanceof Error ? err.message : 'Network error', 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : `Request failed (${response.status})`;
    throw new ApiError(detail, response.status);
  }
  return data as T;
}

async function putJpeg<T>(path: string, token: string, body: Blob | ArrayBuffer): Promise<T> {
  assertSafeApiUrl(API_URL);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/jpeg',
      },
      body,
    });
  } catch (err) {
    throw new ApiError(err instanceof Error ? err.message : 'Network error', 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : `Request failed (${response.status})`;
    throw new ApiError(detail, response.status);
  }
  return data as T;
}

export const api = {
  register: (username: string, password: string) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: { username, password } }),
  login: (username: string, password: string) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: { username, password } }),
  logout: (token: string) => request<{ status: string }>('/auth/logout', { method: 'POST', token }),
  me: (token: string) => request<User>('/users/me', { token }),
  putAvatar: (token: string, jpeg: Blob | ArrayBuffer) => putJpeg<User>('/users/me/avatar', token, jpeg),
  deleteAvatar: (token: string) => request<User>('/users/me/avatar', { method: 'DELETE', token }),
  avatarPath: (userId: string) => `/users/id/${encodeURIComponent(userId)}/avatar`,
  userById: (token: string, userId: string) => request<User>(`/users/id/${userId}`, { token }),
  putIdentity: (token: string, publicKey: string) =>
    request<User>('/users/me/identity', { method: 'PUT', token, body: identityPublishBody(publicKey) }),
  blockUser: (token: string, username: string) =>
    request<{ status: string }>('/users/me/blocks', { method: 'POST', token, body: { username } }),
  unblockUser: (token: string, username: string) =>
    request<{ status: string }>(`/users/me/blocks/${encodeURIComponent(username)}`, { method: 'DELETE', token }),
  listBlocks: (token: string) => request<{ usernames: string[] }>('/users/me/blocks', { token }),
  reportUser: (token: string, username: string, category: string, note?: string) =>
    request<{ status: string }>('/users/me/reports', {
      method: 'POST',
      token,
      body: { username, category, note: note || undefined },
    }),
  userByUsername: (token: string, username: string) => request<User>(`/users/${encodeURIComponent(username)}`, { token }),
  conversations: (token: string) => request<Conversation[]>('/conversations', { token }),
  createConversation: (token: string, username: string) =>
    request<Conversation>('/conversations', { method: 'POST', token, body: { username } }),
  messages: (token: string, conversationId: string) =>
    request<ChatMessage[]>(`/conversations/${conversationId}/messages`, { token }),
  sendMessage: (token: string, conversationId: string, encryptedPayload: string, messageId?: string) =>
    request<ChatMessage>(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      token,
      body: { encrypted_payload: encryptedPayload, message_id: messageId },
    }),
  ack: (token: string, messageId: string, status: 'DELIVERED' | 'READ') =>
    request<ChatMessage>(`/messages/${messageId}/acks`, { method: 'POST', token, body: { status } }),
};

export function wsUrl(): string {
  assertSafeApiUrl(API_URL);
  return `${API_URL.replace(/^http/, 'ws')}/ws`;
}
