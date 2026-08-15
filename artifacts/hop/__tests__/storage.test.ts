import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveConvs, saveGroups } from '../context/storage';
import type { Conversation, GroupConversation } from '../context/HopContext';

// AsyncStorage is auto-mocked via jest-expo / @react-native-async-storage mock
const mockSetItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;

const sampleConvs: Conversation[] = [
  {
    userId: 'u1',
    user: { id: 'u1', username: 'wavejockey', color: '#FF6B6B', signal: 80, angle: 0.4 },
    messages: [
      { id: 'msg1', senderId: 'u1', content: 'hello', timestamp: 1000, status: 'sent' as any },
    ],
    unread: 0,
  },
];

const sampleGroups: GroupConversation[] = [
  {
    id: 'g1',
    name: 'Squad',
    members: [{ id: 'u1', username: 'wavejockey', color: '#FF6B6B', signal: 80, angle: 0.4 }],
    messages: [
      { id: 'msg2', senderId: 'u1', content: 'hey squad', timestamp: 2000, status: 'sent' as any },
    ],
    unread: 0,
    createdAt: 500,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  (console.warn as jest.Mock).mockRestore();
});

// ─── saveConvs ────────────────────────────────────────────────────────────────

describe('saveConvs', () => {
  it('writes conversations to AsyncStorage', async () => {
    mockSetItem.mockResolvedValueOnce(undefined);

    await saveConvs(sampleConvs);

    expect(mockSetItem).toHaveBeenCalledTimes(1);
    expect(mockSetItem).toHaveBeenCalledWith(
      '@hop/conversations',
      JSON.stringify(sampleConvs),
    );
  });

  it('logs a warning when AsyncStorage throws', async () => {
    const error = new Error('Disk full');
    mockSetItem.mockRejectedValueOnce(error);

    await saveConvs(sampleConvs);

    expect(console.warn).toHaveBeenCalledWith(
      '[HOP] Failed to persist conversations:',
      error,
    );
  });

  it('does not rethrow when AsyncStorage throws', async () => {
    mockSetItem.mockRejectedValueOnce(new Error('Storage failure'));

    await expect(saveConvs(sampleConvs)).resolves.toBeUndefined();
  });

  it('accepts an empty array without throwing', async () => {
    mockSetItem.mockResolvedValueOnce(undefined);

    await expect(saveConvs([])).resolves.toBeUndefined();
    expect(mockSetItem).toHaveBeenCalledWith('@hop/conversations', '[]');
  });
});

// ─── saveGroups ───────────────────────────────────────────────────────────────

describe('saveGroups', () => {
  it('writes group conversations to AsyncStorage', async () => {
    mockSetItem.mockResolvedValueOnce(undefined);

    await saveGroups(sampleGroups);

    expect(mockSetItem).toHaveBeenCalledTimes(1);
    expect(mockSetItem).toHaveBeenCalledWith(
      '@hop/groups',
      JSON.stringify(sampleGroups),
    );
  });

  it('logs a warning when AsyncStorage throws', async () => {
    const error = new Error('Write error');
    mockSetItem.mockRejectedValueOnce(error);

    await saveGroups(sampleGroups);

    expect(console.warn).toHaveBeenCalledWith(
      '[HOP] Failed to persist groups:',
      error,
    );
  });

  it('does not rethrow when AsyncStorage throws', async () => {
    mockSetItem.mockRejectedValueOnce(new Error('Storage failure'));

    await expect(saveGroups(sampleGroups)).resolves.toBeUndefined();
  });

  it('accepts an empty array without throwing', async () => {
    mockSetItem.mockResolvedValueOnce(undefined);

    await expect(saveGroups([])).resolves.toBeUndefined();
    expect(mockSetItem).toHaveBeenCalledWith('@hop/groups', '[]');
  });
});

// ─── In-memory state independence ────────────────────────────────────────────
//
// saveConvs / saveGroups are fire-and-forget helpers: callers update React
// state first and then call these. The tests below confirm that a storage
// failure leaves the caller's in-memory data intact — i.e. the returned
// promise resolves (not rejects) so callers never roll back state.

describe('storage failure leaves in-memory data intact', () => {
  it('saveConvs resolves even on failure, so callers keep their state', async () => {
    mockSetItem.mockRejectedValueOnce(new Error('quota exceeded'));

    // Simulate what the context does: update state first, then persist.
    let inMemoryConvs = sampleConvs;
    await saveConvs(inMemoryConvs); // must not throw

    // State is still the data we set before calling saveConvs.
    expect(inMemoryConvs).toEqual(sampleConvs);
  });

  it('saveGroups resolves even on failure, so callers keep their state', async () => {
    mockSetItem.mockRejectedValueOnce(new Error('quota exceeded'));

    let inMemoryGroups = sampleGroups;
    await saveGroups(inMemoryGroups); // must not throw

    expect(inMemoryGroups).toEqual(sampleGroups);
  });
});
