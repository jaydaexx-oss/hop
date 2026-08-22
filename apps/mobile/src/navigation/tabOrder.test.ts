import { describe, expect, it } from 'vitest';

import { DEFAULT_TAB_ROUTE, POST_LOGIN_HREF, TAB_HREFS, TAB_SCREEN_ORDER } from './tabOrder';

describe('bottom tab order', () => {
  it('places Around Us first and keeps Chats on the index route', () => {
    expect([...TAB_SCREEN_ORDER]).toEqual(['nearby', 'index', 'broadcast', 'contacts', 'settings']);
    expect(DEFAULT_TAB_ROUTE).toBe('nearby');
    expect(TAB_SCREEN_ORDER[0]).toBe(DEFAULT_TAB_ROUTE);
    expect(TAB_HREFS.chats).toBe('/');
    expect(TAB_HREFS.nearby).toBe('/(tabs)/nearby');
    expect(TAB_HREFS.broadcast).toBe('/(tabs)/broadcast');
    expect(TAB_HREFS.contacts).toBe('/(tabs)/contacts');
    expect(TAB_HREFS.settings).toBe('/(tabs)/settings');
    expect(POST_LOGIN_HREF).toBe('/(tabs)/nearby');
    expect(POST_LOGIN_HREF).not.toBe(TAB_HREFS.chats);
  });
});
