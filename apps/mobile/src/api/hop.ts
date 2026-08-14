import { API_URL } from './client';

export type User = { id: string; username: string; created_at: string };
export type AuthResponse = { token: string; user: User };
export type Conversation = { id: string; created_at: string; peer: { id: string; username: string } };
export type ChatMessage = {
  message_id: string;
  sender_id: string;
  recipient_id: string;
  conversation_id: string;
  text: string | null;
  status: string;
  created_at: string;
  e2ee: boolean;
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

export const api = {
  register: (username: string, password: string) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: { username, password } }),
  login: (username: string, password: string) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: { username, password } }),
  logout: (token: string) => request<{ status: string }>('/auth/logout', { method: 'POST', token }),
  me: (token: string) => request<User>('/users/me', { token }),
  conversations: (token: string) => request<Conversation[]>('/conversations', { token }),
  createConversation: (token: string, username: string) =>
    request<Conversation>('/conversations', { method: 'POST', token, body: { username } }),
  messages: (token: string, conversationId: string) =>
    request<ChatMessage[]>(`/conversations/${conversationId}/messages`, { token }),
  sendMessage: (token: string, conversationId: string, text: string) =>
    request<ChatMessage>(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      token,
      body: { text },
    }),
  ack: (token: string, messageId: string, status: 'DELIVERED' | 'READ') =>
    request<ChatMessage>(`/messages/${messageId}/acks`, { method: 'POST', token, body: { status } }),
};

export function wsUrl(token: string): string {
  const base = API_URL.replace(/^http/, 'ws');
  return `${base}/ws?token=${encodeURIComponent(token)}`;
}
