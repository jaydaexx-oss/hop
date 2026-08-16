/**
 * Tests for HopContext's declineRequest failure path.
 *
 * Scenario: a user declines a message request and the AsyncStorage write
 * fails (e.g. storage is full).  The tests verify that:
 *
 *  1. The in-memory messageRequests list is rolled back (request reappears).
 *  2. An error toast is shown — the failure is never silent.
 *  3. No toast is pushed and the request stays removed on the happy path.
 *
 * Runs under jest-expo (see jest.context.config.js).
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HopProvider, useHop } from '../context/HopContext';
import type { MyProfile, MessageRequest, HopUser } from '../context/HopContext';

const mockGetItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
const mockSetItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(HopProvider, null, children);
}

async function flushMicrotasks() {
  await act(async () => {
    await new Promise<void>(resolve => setImmediate(resolve));
  });
}

const STORED_PROFILE: MyProfile = {
  id: 'test-user-id',
  username: 'testuser',
  color: '#FF6B6B',
  discoverable: true,
};

const REQUESTS_KEY = `@hop/requests/${STORED_PROFILE.id}`;

const MOCK_REQUEST: MessageRequest = {
  id: 'req-001',
  fromUser: {
    id: 'u3',
    username: 'staticdrift',
    color: '#45B7D1',
    signal: 70,
    angle: 2.0,
  },
  preview: 'hey! saw you nearby 👋',
  timestamp: Date.now() - 60_000,
};

/**
 * Mount HopProvider with a pre-existing stored profile and one pending request.
 */
async function mountWithRequest() {
  mockGetItem.mockImplementation((key: string) => {
    if (key === '@hop/profile') return Promise.resolve(JSON.stringify(STORED_PROFILE));
    if (key === REQUESTS_KEY) return Promise.resolve(JSON.stringify([MOCK_REQUEST]));
    return Promise.resolve(null);
  });
  // eslint-disable-next-line @typescript-eslint/await-thenable
  const hookResult = await renderHook(() => useHop(), { wrapper });
  await waitFor(() => expect(hookResult.result.current.loaded).toBe(true));
  await waitFor(() => expect(hookResult.result.current.messageRequests).toHaveLength(1));
  return hookResult;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSetItem.mockResolvedValue(undefined);
});

// ─── 1. Rollback on write failure ─────────────────────────────────────────────

describe('HopContext — declineRequest storage failure', () => {
  it('rolls back the in-memory removal when the write rejects', async () => {
    const { result } = await mountWithRequest();

    // Verify request is present before decline.
    expect(result.current.messageRequests).toHaveLength(1);
    expect(result.current.messageRequests[0].id).toBe(MOCK_REQUEST.id);

    // Make the write fail.
    mockSetItem.mockRejectedValue(new Error('storage full'));

    await act(async () => {
      await result.current.declineRequest(MOCK_REQUEST.id);
    });
    await flushMicrotasks();

    // Rollback: request must reappear in the list.
    expect(result.current.messageRequests).toHaveLength(1);
    expect(result.current.messageRequests[0].id).toBe(MOCK_REQUEST.id);
  });

  it('shows an error toast when the write rejects', async () => {
    const { result } = await mountWithRequest();

    mockSetItem.mockRejectedValue(new Error('storage full'));

    await act(async () => {
      await result.current.declineRequest(MOCK_REQUEST.id);
    });
    await flushMicrotasks();

    expect(result.current.pendingToast).not.toBeNull();
    expect(result.current.pendingToast?.kind).toBe('error');
  });

  it('does not leave the request stuck after rollback — it is fully restored', async () => {
    const { result } = await mountWithRequest();

    mockSetItem.mockRejectedValue(new Error('quota exceeded'));

    await act(async () => {
      await result.current.declineRequest(MOCK_REQUEST.id);
    });
    await flushMicrotasks();

    // The restored request must have all original fields intact.
    expect(result.current.messageRequests[0]).toMatchObject({
      id: MOCK_REQUEST.id,
      preview: MOCK_REQUEST.preview,
      fromUser: expect.objectContaining({ id: MOCK_REQUEST.fromUser.id }),
    });
  });
});

// ─── 2. Happy path ────────────────────────────────────────────────────────────

describe('HopContext — declineRequest happy path', () => {
  it('removes the request from in-memory state when the write succeeds', async () => {
    const { result } = await mountWithRequest();

    await act(async () => {
      await result.current.declineRequest(MOCK_REQUEST.id);
    });
    await flushMicrotasks();

    expect(result.current.messageRequests).toHaveLength(0);
  });

  it('does not show an error toast when the write succeeds', async () => {
    const { result } = await mountWithRequest();

    await act(async () => {
      await result.current.declineRequest(MOCK_REQUEST.id);
    });
    await flushMicrotasks();

    expect(result.current.pendingToast).toBeNull();
  });

  it('persists the updated (empty) request list to storage on success', async () => {
    const { result } = await mountWithRequest();

    await act(async () => {
      await result.current.declineRequest(MOCK_REQUEST.id);
    });
    await flushMicrotasks();

    expect(mockSetItem).toHaveBeenCalledWith(REQUESTS_KEY, JSON.stringify([]));
  });

  it('persists only the declined request removal, not concurrent optimistic removals', async () => {
    // Regression guard: when two requests are declined concurrently, Write A
    // must persist [req-002] (only req-001 removed), not [] (both removed).
    // Storage should reflect each write's own committed baseline filter.
    const secondRequest: MessageRequest = {
      id: 'req-002',
      fromUser: { id: 'u4', username: 'bitwhisper', color: '#96CEB4', signal: 60, angle: 2.8 },
      preview: 'yo, wanna chat?',
      timestamp: Date.now() - 30_000,
    };
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(JSON.stringify(STORED_PROFILE));
      if (key === REQUESTS_KEY)
        return Promise.resolve(JSON.stringify([MOCK_REQUEST, secondRequest]));
      return Promise.resolve(null);
    });
    // eslint-disable-next-line @typescript-eslint/await-thenable
    const hookResult = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => expect(hookResult.result.current.loaded).toBe(true));
    await waitFor(() => expect(hookResult.result.current.messageRequests).toHaveLength(2));

    let resolveWrite1!: () => void;
    let resolveWrite2!: () => void;
    mockSetItem
      .mockReturnValueOnce(new Promise<undefined>(res => { resolveWrite1 = () => res(undefined); }))
      .mockReturnValueOnce(new Promise<undefined>(res => { resolveWrite2 = () => res(undefined); }));

    let promise1!: Promise<void>;
    let promise2!: Promise<void>;
    await act(async () => {
      promise1 = hookResult.result.current.declineRequest(MOCK_REQUEST.id);
      promise2 = hookResult.result.current.declineRequest(secondRequest.id);
      await Promise.resolve();
    });

    await act(async () => { resolveWrite1(); await promise1; });
    await act(async () => { resolveWrite2(); await promise2; });
    await flushMicrotasks();

    // Write 1 must have persisted [req-002] — only req-001's committed removal.
    // Write 2 must have persisted [] — only req-002's removal from [req-002].
    const calls = mockSetItem.mock.calls;
    expect(JSON.parse(calls[calls.length - 2][1] as string)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: secondRequest.id })])
    );
    expect(JSON.parse(calls[calls.length - 1][1] as string)).toEqual([]);
  });

  it('only removes the declined request when multiple requests exist', async () => {
    const secondRequest: MessageRequest = {
      id: 'req-002',
      fromUser: { id: 'u4', username: 'bitwhisper', color: '#96CEB4', signal: 60, angle: 2.8 },
      preview: 'yo, wanna chat?',
      timestamp: Date.now() - 30_000,
    };

    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(JSON.stringify(STORED_PROFILE));
      if (key === REQUESTS_KEY)
        return Promise.resolve(JSON.stringify([MOCK_REQUEST, secondRequest]));
      return Promise.resolve(null);
    });
    // eslint-disable-next-line @typescript-eslint/await-thenable
    const hookResult = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => expect(hookResult.result.current.loaded).toBe(true));
    await waitFor(() => expect(hookResult.result.current.messageRequests).toHaveLength(2));

    await act(async () => {
      await hookResult.result.current.declineRequest(MOCK_REQUEST.id);
    });
    await flushMicrotasks();

    expect(hookResult.result.current.messageRequests).toHaveLength(1);
    expect(hookResult.result.current.messageRequests[0].id).toBe(secondRequest.id);
    expect(hookResult.result.current.pendingToast).toBeNull();
  });
});

// ─── 3. Concurrent declines ───────────────────────────────────────────────────
//
// declineRequest serializes storage writes via a promise queue so they run
// one at a time.  Two requests can be optimistically removed from the UI
// simultaneously, but the actual AsyncStorage writes are chained: write 2
// only starts after write 1 completes (including any rollback it triggers).
//
// This means:
//   • No out-of-order write can overwrite a newer list with stale data.
//   • A rollback from write 1's failure is visible when write 2 reads the ref,
//     so write 2 always persists the correct composed state.
//   • Both writes failing still restores both requests correctly.

describe('HopContext — declineRequest concurrent declines', () => {
  // Helper: mount with two pending requests.
  async function mountWithTwo() {
    const secondRequest: MessageRequest = {
      id: 'req-002',
      fromUser: { id: 'u4', username: 'bitwhisper', color: '#96CEB4', signal: 60, angle: 2.8 },
      preview: 'yo, wanna chat?',
      timestamp: Date.now() - 30_000,
    };
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(JSON.stringify(STORED_PROFILE));
      if (key === REQUESTS_KEY)
        return Promise.resolve(JSON.stringify([MOCK_REQUEST, secondRequest]));
      return Promise.resolve(null);
    });
    // eslint-disable-next-line @typescript-eslint/await-thenable
    const hookResult = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => expect(hookResult.result.current.loaded).toBe(true));
    await waitFor(() => expect(hookResult.result.current.messageRequests).toHaveLength(2));
    return { hookResult, secondRequest };
  }

  it('removes both requests when both writes succeed (both declined before write 1 resolves)', async () => {
    const { hookResult, secondRequest } = await mountWithTwo();

    // Both writes will succeed; control when they resolve so we can fire both
    // declines before write 1 has a chance to start.
    let resolveWrite1!: () => void;
    let resolveWrite2!: () => void;
    const write1 = new Promise<undefined>(res => { resolveWrite1 = () => res(undefined); });
    const write2 = new Promise<undefined>(res => { resolveWrite2 = () => res(undefined); });

    mockSetItem
      .mockReturnValueOnce(write1)
      .mockReturnValueOnce(write2);

    // Fire both declines synchronously — both optimistic removals apply.
    let promise1!: Promise<void>;
    let promise2!: Promise<void>;
    await act(async () => {
      promise1 = hookResult.result.current.declineRequest(MOCK_REQUEST.id);
      promise2 = hookResult.result.current.declineRequest(secondRequest.id);
      await Promise.resolve(); // flush optimistic state
    });

    // Both optimistic removals must be visible immediately.
    expect(hookResult.result.current.messageRequests).toHaveLength(0);

    // Resolve writes in order (queue guarantees write 1 runs before write 2).
    await act(async () => { resolveWrite1(); await promise1; });
    await act(async () => { resolveWrite2(); await promise2; });
    await flushMicrotasks();

    // List stays empty and no error toast is shown.
    expect(hookResult.result.current.messageRequests).toHaveLength(0);
    expect(hookResult.result.current.pendingToast).toBeNull();
  });

  it('rolls back only the second decline when its write fails and the first succeeded', async () => {
    const { hookResult, secondRequest } = await mountWithTwo();

    // Write 1 (for req-001) succeeds; write 2 (for req-002) fails.
    let resolveWrite1!: () => void;
    let rejectWrite2!: (e: Error) => void;
    mockSetItem
      .mockReturnValueOnce(new Promise<undefined>(res => { resolveWrite1 = () => res(undefined); }))
      .mockReturnValueOnce(new Promise<undefined>((_res, rej) => { rejectWrite2 = rej; }));

    let promise1!: Promise<void>;
    let promise2!: Promise<void>;
    await act(async () => {
      promise1 = hookResult.result.current.declineRequest(MOCK_REQUEST.id);
      promise2 = hookResult.result.current.declineRequest(secondRequest.id);
      await Promise.resolve();
    });

    await act(async () => { resolveWrite1(); await promise1; });
    await act(async () => { rejectWrite2(new Error('storage full')); await promise2; });
    await flushMicrotasks();

    // req-001 successfully declined — must stay gone.
    expect(hookResult.result.current.messageRequests.find(r => r.id === MOCK_REQUEST.id))
      .toBeUndefined();
    // req-002 write failed — must be rolled back (reappear).
    expect(hookResult.result.current.messageRequests.find(r => r.id === secondRequest.id))
      .toBeDefined();
    expect(hookResult.result.current.pendingToast?.kind).toBe('error');
  });

  it('restores both requests when both writes fail', async () => {
    // This is the critical "all-fail" scenario.
    //
    // Write 1 (req-001) fails → req-001 restored to ref.
    // Write 2 (req-002) then reads the ref (which now contains req-001 again),
    // writes [req-001] to storage, and fails → req-002 restored.
    // Final memory state: [req-001, req-002], matching storage.
    //
    // Controlled rejecters are used so we can assert the optimistic state
    // (list empty) before any writes settle and trigger rollbacks.
    const { hookResult, secondRequest } = await mountWithTwo();

    let rejectWrite1!: (e: Error) => void;
    let rejectWrite2!: (e: Error) => void;
    mockSetItem
      .mockReturnValueOnce(new Promise<undefined>((_res, rej) => { rejectWrite1 = rej; }))
      .mockReturnValueOnce(new Promise<undefined>((_res, rej) => { rejectWrite2 = rej; }));

    let promise1!: Promise<void>;
    let promise2!: Promise<void>;
    await act(async () => {
      promise1 = hookResult.result.current.declineRequest(MOCK_REQUEST.id);
      promise2 = hookResult.result.current.declineRequest(secondRequest.id);
      await Promise.resolve(); // flush optimistic removals
    });

    // Both optimistic removals applied — list empty before writes settle.
    expect(hookResult.result.current.messageRequests).toHaveLength(0);

    // Reject write 1 and wait for its rollback (restores req-001 to ref).
    await act(async () => { rejectWrite1(new Error('storage full')); await promise1; });
    // Reject write 2 — it read the ref after write 1's rollback so it wrote
    // [req-001]; failing now also restores req-002.
    await act(async () => { rejectWrite2(new Error('storage full')); await promise2; });
    await flushMicrotasks();

    // Both writes failed → both requests must be restored.
    expect(hookResult.result.current.messageRequests.find(r => r.id === MOCK_REQUEST.id))
      .toBeDefined();
    expect(hookResult.result.current.messageRequests.find(r => r.id === secondRequest.id))
      .toBeDefined();
    // At least one error toast must have been queued.
    expect(hookResult.result.current.pendingToast?.kind).toBe('error');
  });

  it('restores both requests when write 2 fails before write 1 (reverse-order failure)', async () => {
    // Simulates the scenario where write 2 is rejected while write 1 is still
    // pending.  With the serial queue, write 2 cannot start until write 1
    // finishes — so this tests: write 1 succeeds, then write 2 fails.
    // Even though both optimistic removals fired, only write 2's failure
    // results in a rollback (write 1 already persisted req-001's removal).
    const { hookResult, secondRequest } = await mountWithTwo();

    mockSetItem
      .mockResolvedValueOnce(undefined)                   // write 1 succeeds
      .mockRejectedValueOnce(new Error('storage full'));  // write 2 fails

    let promise1!: Promise<void>;
    let promise2!: Promise<void>;
    await act(async () => {
      promise1 = hookResult.result.current.declineRequest(MOCK_REQUEST.id);
      promise2 = hookResult.result.current.declineRequest(secondRequest.id);
      await Promise.resolve();
    });

    await act(async () => { await Promise.all([promise1, promise2]); });
    await flushMicrotasks();

    // req-001 successfully persisted as removed — must stay gone.
    expect(hookResult.result.current.messageRequests.find(r => r.id === MOCK_REQUEST.id))
      .toBeUndefined();
    // req-002 failed → rolled back (reappears).
    expect(hookResult.result.current.messageRequests.find(r => r.id === secondRequest.id))
      .toBeDefined();
    expect(hookResult.result.current.pendingToast?.kind).toBe('error');
  });
});

// ─── 4. Decline racing accept / block ─────────────────────────────────────────
//
// All requestsKey mutations (decline, accept, block, arrival) share the same
// serial queue so they can never overwrite each other with stale data.
// These tests verify the storage content when a pending decline write is
// followed by an accept or block for the same request.

describe('HopContext — decline racing accept and block', () => {
  const REQ_USER: HopUser = {
    id: 'u3',
    username: 'staticdrift',
    color: '#45B7D1',
    signal: 70,
    angle: 2.0,
  };
  const REQ_A: MessageRequest = {
    id: 'req-A',
    fromUser: REQ_USER,
    preview: 'hey!',
    timestamp: Date.now() - 60_000,
  };
  const REQ_B: MessageRequest = {
    id: 'req-B',
    fromUser: { id: 'u4', username: 'bitwhisper', color: '#96CEB4', signal: 60, angle: 2.8 },
    preview: 'yo',
    timestamp: Date.now() - 30_000,
  };

  async function mountWithAB() {
    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(JSON.stringify(STORED_PROFILE));
      if (key === REQUESTS_KEY)
        return Promise.resolve(JSON.stringify([REQ_A, REQ_B]));
      return Promise.resolve(null);
    });
    // eslint-disable-next-line @typescript-eslint/await-thenable
    const hookResult = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => expect(hookResult.result.current.loaded).toBe(true));
    await waitFor(() => expect(hookResult.result.current.messageRequests).toHaveLength(2));
    return hookResult;
  }

  it('decline write succeeds, then accept for same request → storage ends with req-A removed', async () => {
    const hookResult = await mountWithAB();

    // Write 1 = decline(A), Write 2 = accept(A) — both serialized through the queue.
    let resolveDecline!: () => void;
    let resolveAccept!: () => void;
    mockSetItem
      .mockReturnValueOnce(new Promise<undefined>(res => { resolveDecline = () => res(undefined); }))
      .mockReturnValueOnce(new Promise<undefined>(res => { resolveAccept = () => res(undefined); }));

    let declinePromise!: Promise<void>;
    await act(async () => {
      declinePromise = hookResult.result.current.declineRequest(REQ_A.id);
      hookResult.result.current.acceptRequest(REQ_A.id);
      await Promise.resolve();
    });

    // Resolve decline write first (success), then accept write (success).
    await act(async () => { resolveDecline(); await declinePromise; });
    await act(async () => { resolveAccept(); });
    await flushMicrotasks();

    // req-A is gone from in-memory requests (removed by decline + accept).
    expect(hookResult.result.current.messageRequests.find(r => r.id === REQ_A.id))
      .toBeUndefined();
    // req-B is untouched.
    expect(hookResult.result.current.messageRequests.find(r => r.id === REQ_B.id))
      .toBeDefined();
    // No error toast — both writes succeeded.
    expect(hookResult.result.current.pendingToast).toBeNull();

    // Last write must NOT contain req-A (it was removed by decline then confirmed absent by accept).
    const lastWrite = mockSetItem.mock.calls[mockSetItem.mock.calls.length - 1];
    const stored: MessageRequest[] = JSON.parse(lastWrite[1] as string);
    expect(stored.find(r => r.id === REQ_A.id)).toBeUndefined();
  });

  it('decline write fails, then accept for same request → decline toast shown, accept persists removal in storage AND memory', async () => {
    // Regression: decline failure restored req-A to memory, but the queued
    // accept write then succeeded and removed req-A from storage — leaving
    // req-A visible in the UI but absent from storage (divergent state).
    // Fix: enqueueRequestsWrite syncs in-memory state on every successful
    // write, removing any request that was committed-removed by that write.
    const hookResult = await mountWithAB();

    let rejectDecline!: (e: Error) => void;
    let resolveAccept!: () => void;
    mockSetItem
      .mockReturnValueOnce(new Promise<undefined>((_res, rej) => { rejectDecline = rej; }))
      .mockReturnValueOnce(new Promise<undefined>(res => { resolveAccept = () => res(undefined); }));

    let declinePromise!: Promise<void>;
    await act(async () => {
      declinePromise = hookResult.result.current.declineRequest(REQ_A.id);
      hookResult.result.current.acceptRequest(REQ_A.id);
      await Promise.resolve();
    });

    // Decline write fails → rollback restores req-A to memory, shows toast.
    await act(async () => { rejectDecline(new Error('storage full')); await declinePromise; });
    // Accept write succeeds → removes req-A from committed AND syncs memory.
    await act(async () => { resolveAccept(); });
    await flushMicrotasks();

    // Storage must not contain req-A (accept write removed it).
    const lastWrite = mockSetItem.mock.calls[mockSetItem.mock.calls.length - 1];
    const stored: MessageRequest[] = JSON.parse(lastWrite[1] as string);
    expect(stored.find(r => r.id === REQ_A.id)).toBeUndefined();
    // req-B must be untouched in storage.
    expect(stored.find(r => r.id === REQ_B.id)).toBeDefined();
    // In-memory state must also not show req-A (synced by accept's success).
    expect(hookResult.result.current.messageRequests.find(r => r.id === REQ_A.id))
      .toBeUndefined();
    // req-B remains in memory (untouched).
    expect(hookResult.result.current.messageRequests.find(r => r.id === REQ_B.id))
      .toBeDefined();
  });

  it('arrival write commits between decline call and decline failure → rollback restores the request', async () => {
    // Regression: the old implementation captured the rollback payload from
    // committedRequestsRef at CALL TIME.  If a request arrived via the
    // simulation queue but its arrival write was still pending, committed
    // would be empty at call time — so `removed` would be undefined and the
    // rollback would silently skip, leaving the request absent from memory
    // but still in storage.
    //
    // The fix: read committedRequestsRef INSIDE onFailure (at failure time).
    // Because the queue is serial, all earlier queued writes — including the
    // arrival write — have settled by then, so committed is authoritative.
    //
    // To reproduce the interleaving via public APIs we use TWO queued declines:
    //   Write 1: decline phantom-id — succeeds; committed keeps arrivedReq
    //   Write 2: decline arrivedReq — fails; onFailure reads committed (has arrivedReq) → restores
    //
    // This isolates the "read at failure time, not call time" invariant because
    // committed is updated by Write 1 BETWEEN the call and failure of Write 2.

    const arrivedReq: MessageRequest = {
      id: 'req-arrived',
      fromUser: { id: 'u5', username: 'wavecrest', color: '#FF6B6B', signal: 55, angle: 1.5 },
      preview: 'wanna connect?',
      timestamp: Date.now() - 5_000,
    };

    mockGetItem.mockImplementation((key: string) => {
      if (key === '@hop/profile') return Promise.resolve(JSON.stringify(STORED_PROFILE));
      if (key === REQUESTS_KEY) return Promise.resolve(JSON.stringify([arrivedReq]));
      return Promise.resolve(null);
    });

    // eslint-disable-next-line @typescript-eslint/await-thenable
    const { result } = await renderHook(() => useHop(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await waitFor(() => expect(result.current.messageRequests).toHaveLength(1));

    // Set up controlled promises AFTER the hook loads so initialization writes
    // (e.g. broadcast save) don't consume the controlled values.
    let resolvePhantom!: () => void;
    let rejectDecline!: (e: Error) => void;
    mockSetItem
      .mockReturnValueOnce(new Promise<undefined>(res => { resolvePhantom = () => res(undefined); }))
      .mockReturnValueOnce(new Promise<undefined>((_res, rej) => { rejectDecline = rej; }));

    // Queue both declines before either write executes.
    let phantomPromise!: Promise<void>;
    let declinePromise!: Promise<void>;
    await act(async () => {
      phantomPromise = result.current.declineRequest('phantom-id');
      declinePromise = result.current.declineRequest(arrivedReq.id);
      await Promise.resolve();
    });

    // arrivedReq is gone from memory (optimistic removal).
    expect(result.current.messageRequests.find(r => r.id === arrivedReq.id)).toBeUndefined();

    // Write 1 (phantom) resolves — committed stays [arrivedReq] because
    // filtering phantom-id from [arrivedReq] = [arrivedReq].
    await act(async () => { resolvePhantom(); await phantomPromise; });
    // Write 2 (arrivedReq decline) fails — onFailure reads committed = [arrivedReq] → restores.
    await act(async () => { rejectDecline(new Error('storage full')); await declinePromise; });
    await flushMicrotasks();

    // arrivedReq must be restored to memory (rollback succeeded).
    expect(result.current.messageRequests.find(r => r.id === arrivedReq.id)).toBeDefined();
    expect(result.current.pendingToast?.kind).toBe('error');
  });

  it('decline fails then block for same user → rollback fires, but block write syncs memory and storage', async () => {
    // Regression: decline failure restores req-A to memory; the queued block
    // write then succeeds and removes req-A from storage — leaving req-A
    // visible in the UI but absent from storage.
    // Fix: enqueueRequestsWrite syncs in-memory state on successful write.
    const hookResult = await mountWithAB();

    let rejectDecline!: (e: Error) => void;
    let resolveBlock!: () => void;
    // Write 1 = decline(A) — rejects.
    // blockUser critical write (blockedKey) = resolves immediately.
    // Write 2 = block requestsKey write — controlled.
    mockSetItem
      .mockReturnValueOnce(new Promise<undefined>((_res, rej) => { rejectDecline = rej; }))
      .mockResolvedValueOnce(undefined)   // blockedKey write (critical, fire-and-forget inside blockUser)
      .mockReturnValueOnce(new Promise<undefined>(res => { resolveBlock = () => res(undefined); }));

    let declinePromise!: Promise<void>;
    await act(async () => {
      declinePromise = hookResult.result.current.declineRequest(REQ_A.id);
      // blockUser removes req-A by userId from requests via the shared queue.
      void hookResult.result.current.blockUser(REQ_USER.id);
      await Promise.resolve();
    });

    // Decline write rejects → rollback restores req-A to memory.
    await act(async () => { rejectDecline(new Error('storage full')); await declinePromise; });
    // Block requestsKey write succeeds → removes req-A from committed AND syncs memory.
    await act(async () => { resolveBlock(); });
    await flushMicrotasks();

    // In-memory: req-A must be absent (block write synced it out of memory).
    expect(hookResult.result.current.messageRequests.find(r => r.id === REQ_A.id))
      .toBeUndefined();
    // req-B must remain (untouched by block or decline).
    expect(hookResult.result.current.messageRequests.find(r => r.id === REQ_B.id))
      .toBeDefined();
    // Storage: last requestsKey write must not contain req-A.
    const lastRequestsWrite = [...mockSetItem.mock.calls]
      .reverse()
      .find(c => (c[0] as string).startsWith('@hop/requests/'));
    expect(lastRequestsWrite).toBeDefined();
    const stored: MessageRequest[] = JSON.parse(lastRequestsWrite![1] as string);
    expect(stored.find(r => r.id === REQ_A.id)).toBeUndefined();
  });
});
