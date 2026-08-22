import { describe, expect, it } from 'vitest';

import {
  NearbyBroadcastFeed,
  createNearbyBroadcast,
  planBroadcastReply,
  viewBroadcastCreatesConversation,
} from '@hop/protocol';

import { buildChatRoute } from '@/src/chat/chatRoute';

describe('broadcast reply vs view', () => {
  it('view does not create a conversation; explicit reply opens a DM route', () => {
    const feed = new NearbyBroadcastFeed(() => 'maya');
    const post = createNearbyBroadcast({
      authorId: 'blake',
      displayName: 'blake',
      body: 'Anyone here?',
    });
    feed.ingest(post);
    expect(viewBroadcastCreatesConversation()).toBe(false);
    expect(feed.list()).toHaveLength(1);

    const plan = planBroadcastReply(post, { selfId: 'maya', blockedIds: [] });
    expect(plan.action).toBe('open_private_chat');
    expect(plan.action === 'open_private_chat' && plan.publicPost).toBe(false);

    const replyRoute = buildChatRoute('convo-1', { id: 'blake', username: 'blake' }, { broadcastId: post.id });
    expect(replyRoute).toContain('/chat/convo-1');
    expect(replyRoute).toContain('broadcastId=');
    expect(buildChatRoute('convo-1', { id: 'blake', username: 'blake' })).not.toContain('broadcastId=');
  });

  it('own posts are marked you and cannot be replied to as a public follow-up', () => {
    const mine = createNearbyBroadcast({ authorId: 'maya', displayName: 'maya', body: 'Hi nearby' });
    expect(planBroadcastReply(mine, { selfId: 'maya', blockedIds: [] })).toEqual({ action: 'none', reason: 'own_post' });
  });

  it('removing a broadcast from the feed does not change an existing private reply route', () => {
    const post = createNearbyBroadcast({
      authorId: 'blake',
      displayName: 'blake',
      body: 'Anyone here?',
    });
    const feed = new NearbyBroadcastFeed(() => 'maya');
    feed.ingest(post);
    const plan = planBroadcastReply(post, { selfId: 'maya', blockedIds: [] });
    expect(plan.action).toBe('open_private_chat');
    const replyRoute = buildChatRoute('convo-1', { id: 'blake', username: 'blake' }, { broadcastId: post.id });
    feed.remove(post.id);
    expect(feed.list()).toEqual([]);
    expect(planBroadcastReply(post, { selfId: 'maya', blockedIds: [] }).action).toBe('open_private_chat');
    expect(buildChatRoute('convo-1', { id: 'blake', username: 'blake' }, { broadcastId: post.id })).toBe(replyRoute);
  });
});
