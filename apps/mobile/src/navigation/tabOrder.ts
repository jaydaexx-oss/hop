/** Bottom tab screens in visual order. Chats stays `index` so `href="/"` remains the inbox. */
export const TAB_SCREEN_ORDER = ['nearby', 'index', 'broadcast', 'contacts', 'settings'] as const;

export const DEFAULT_TAB_ROUTE = 'nearby';

export const TAB_HREFS = {
  nearby: '/(tabs)/nearby',
  chats: '/',
  chatsAlias: '/(tabs)',
  broadcast: '/(tabs)/broadcast',
  contacts: '/(tabs)/contacts',
  settings: '/(tabs)/settings',
} as const;

/** After login, land on Around Us — not the Chats index route. */
export const POST_LOGIN_HREF = '/(tabs)/nearby';
