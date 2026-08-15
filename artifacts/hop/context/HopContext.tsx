import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createMessageId, MessageStatus } from '@/protocol/message';
import { ProcessedIdSet } from '@/protocol/duplicates';

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface HopUser {
  id: string;
  username: string;
  color: string;
  signal: number;
  angle: number;
  avatarUri?: string;
}

export interface Message {
  id: string;
  senderId: string;
  senderName?: string;
  senderColor?: string;
  content: string;
  timestamp: number;
  status: MessageStatus;
}

export interface Conversation {
  userId: string;
  user: HopUser;
  messages: Message[];
  unread: number;
}

export interface GroupConversation {
  id: string;
  name: string;
  members: HopUser[];
  messages: Message[];
  unread: number;
  createdAt: number;
}

export interface Broadcast {
  id: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  content: string;
  timestamp: number;
}

export interface MyProfile {
  id: string;
  username: string;
  color: string;
  discoverable: boolean;
  avatarUri?: string;
}

export interface ToastNotification {
  /** 'dm' | 'group' */
  kind: 'dm' | 'group';
  /** userId for DMs, groupId for groups */
  targetId: string;
  senderName: string;
  senderColor: string;
  senderAvatarUri?: string;
  content: string;
}

interface HopContextType {
  profile: MyProfile | null;
  isOnboarding: boolean;
  loaded: boolean;
  nearbyUsers: HopUser[];
  conversations: Conversation[];
  groupConversations: GroupConversation[];
  broadcasts: Broadcast[];
  isScanning: boolean;
  totalUnread: number;
  pendingToast: ToastNotification | null;
  dismissToast: () => void;
  mutedIds: Set<string>;
  toggleMute: (id: string) => Promise<void>;
  isMuted: (id: string) => boolean;
  setProfile: (profile: MyProfile) => Promise<void>;
  sendMessage: (userId: string, content: string) => void;
  sendGroupMessage: (groupId: string, content: string) => void;
  sendBroadcast: (content: string) => void;
  createGroup: (name: string, memberIds: string[]) => GroupConversation | null;
  getConversation: (userId: string) => Conversation | undefined;
  getGroupConversation: (groupId: string) => GroupConversation | undefined;
  markRead: (userId: string) => void;
  markGroupRead: (groupId: string) => void;
  completeOnboarding: (username: string, color: string, avatarUri?: string) => Promise<void>;
  clearHistory: () => Promise<void>;
}

// ─── Simulated nearby user pool ───────────────────────────────────────────────

const USER_POOL: HopUser[] = [
  { id: 'u1', username: 'wavejockey',  color: '#FF6B6B', signal: 0, angle: 0.4, avatarUri: 'https://api.dicebear.com/9.x/pixel-art/png?seed=wavejockey&size=80' },
  { id: 'u2', username: 'neonpulse',   color: '#4ECDC4', signal: 0, angle: 1.1, avatarUri: 'https://api.dicebear.com/9.x/pixel-art/png?seed=neonpulse&size=80' },
  { id: 'u3', username: 'staticdrift', color: '#45B7D1', signal: 0, angle: 2.0 },
  { id: 'u4', username: 'bitwhisper',  color: '#96CEB4', signal: 0, angle: 2.8, avatarUri: 'https://api.dicebear.com/9.x/pixel-art/png?seed=bitwhisper&size=80' },
  { id: 'u5', username: 'phaseloop',   color: '#DDA0DD', signal: 0, angle: 3.8 },
  { id: 'u6', username: 'cipherwave',  color: '#F0A500', signal: 0, angle: 4.7, avatarUri: 'https://api.dicebear.com/9.x/pixel-art/png?seed=cipherwave&size=80' },
  { id: 'u7', username: 'darkfreq',    color: '#FF8C94', signal: 0, angle: 5.5 },
];

const BOT_REPLIES = [
  "hey, what's up", 'yo!', 'cool, same here', 'where are you?', 'say less',
  'facts', 'nice one', 'haha true', 'no way', 'bro same', 'lmk',
  'for real though', 'on my way', 'bet',
];

export const AVATAR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#DDA0DD',
  '#F0A500', '#FF8C94', '#6C5CE7', '#00CEC9', '#FD79A8',
];

const sentIds = new ProcessedIdSet(10_000);

const HopContext = createContext<HopContextType | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function HopProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfileState] = useState<MyProfile | null>(null);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [nearbyUsers, setNearbyUsers] = useState<HopUser[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [groupConversations, setGroupConversations] = useState<GroupConversation[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [pendingToast, setPendingToast] = useState<ToastNotification | null>(null);
  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());
  const scanRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [profStr, convStr, groupStr, bcastStr, mutedStr] = await Promise.all([
          AsyncStorage.getItem('@hop/profile'),
          AsyncStorage.getItem('@hop/conversations'),
          AsyncStorage.getItem('@hop/groups'),
          AsyncStorage.getItem('@hop/broadcasts'),
          AsyncStorage.getItem('@hop/muted'),
        ]);

        if (profStr) {
          setProfileState(JSON.parse(profStr));
        } else {
          setIsOnboarding(true);
        }
        if (convStr) {
          const parsed: Conversation[] = JSON.parse(convStr);
          // Dedup by userId: merge duplicate entries (can happen if simulated IDs shift),
          // preserving all messages sorted by timestamp.
          const byUserId: Record<string, Conversation> = {};
          for (const conv of parsed) {
            if (!byUserId[conv.userId]) {
              byUserId[conv.userId] = conv;
            } else {
              // Merge messages, deduplicate by id, sort chronologically
              const merged = [...byUserId[conv.userId].messages, ...conv.messages];
              const seenMsgIds = new Set<string>();
              const dedupedMsgs = merged.filter(m => {
                if (seenMsgIds.has(m.id)) return false;
                seenMsgIds.add(m.id);
                return true;
              }).sort((a, b) => a.timestamp - b.timestamp);
              // Keep the more recently active entry's metadata (user info)
              const existingLast = byUserId[conv.userId].messages.at(-1)?.timestamp ?? 0;
              const incomingLast = conv.messages.at(-1)?.timestamp ?? 0;
              const winner = incomingLast > existingLast ? conv : byUserId[conv.userId];
              byUserId[conv.userId] = { ...winner, messages: dedupedMsgs };
            }
          }
          setConversations(Object.values(byUserId));
        }
        if (groupStr) {
          const parsed: GroupConversation[] = JSON.parse(groupStr);
          // Re-hydrate senderColor and senderName from the stored members array so
          // that stale colors written at send-time are corrected on reload.
          const hydrated = parsed.map(group => ({
            ...group,
            messages: group.messages.map(msg => {
              const member = group.members.find(m => m.id === msg.senderId);
              if (member) {
                return { ...msg, senderColor: member.color, senderName: member.username };
              }
              return msg;
            }),
          }));
          setGroupConversations(hydrated);
        }
        if (mutedStr) {
          setMutedIds(new Set(JSON.parse(mutedStr) as string[]));
        }
        if (bcastStr) {
          setBroadcasts(JSON.parse(bcastStr));
        } else {
          const seed: Broadcast[] = [
            { id: createMessageId(), senderId: 'u1', senderName: 'wavejockey', senderColor: '#FF6B6B', content: 'anyone at the coffee shop on 5th?', timestamp: Date.now() - 300_000 },
            { id: createMessageId(), senderId: 'u3', senderName: 'staticdrift', senderColor: '#45B7D1', content: 'looking for people to jam with nearby', timestamp: Date.now() - 120_000 },
          ];
          setBroadcasts(seed);
          await AsyncStorage.setItem('@hop/broadcasts', JSON.stringify(seed));
        }
      } catch {
        setIsOnboarding(true);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    setIsScanning(true);
    const scan = () => {
      const count = 2 + Math.floor(Math.random() * 4);
      const shuffled = [...USER_POOL].sort(() => Math.random() - 0.5).slice(0, count);
      setNearbyUsers(shuffled.map(u => ({ ...u, signal: 25 + Math.floor(Math.random() * 75) })));
    };
    scan();
    scanRef.current = setInterval(scan, 5000);
    return () => {
      if (scanRef.current) clearInterval(scanRef.current);
      setIsScanning(false);
    };
  }, [loaded]);

  const saveConvs = async (convs: Conversation[]) =>
    AsyncStorage.setItem('@hop/conversations', JSON.stringify(convs));
  const saveGroups = async (groups: GroupConversation[]) =>
    AsyncStorage.setItem('@hop/groups', JSON.stringify(groups));

  const dismissToast = () => setPendingToast(null);

  const toggleMute = async (id: string) => {
    setMutedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      AsyncStorage.setItem('@hop/muted', JSON.stringify([...next]));
      return next;
    });
  };

  const isMuted = (id: string) => mutedIds.has(id);

  const setProfile = async (p: MyProfile) => {
    setProfileState(p);
    await AsyncStorage.setItem('@hop/profile', JSON.stringify(p));
  };

  const completeOnboarding = async (username: string, color: string, avatarUri?: string) => {
    await setProfile({ id: createMessageId(), username, color, discoverable: true, avatarUri });
    setIsOnboarding(false);
  };

  // ── DM send ──────────────────────────────────────────────────────────────

  const sendMessage = (userId: string, content: string) => {
    if (!profile) return;
    const user = USER_POOL.find(u => u.id === userId) ?? nearbyUsers.find(u => u.id === userId);
    if (!user) return;

    const msgId = createMessageId();
    if (!sentIds.remember(msgId)) return;

    const msg: Message = {
      id: msgId,
      senderId: profile.id,
      content,
      timestamp: Date.now(),
      status: MessageStatus.SENT,
    };

    const replyDelay = 1000 + Math.random() * 2500;
    const replyContent = BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)];
    const replyId = createMessageId();

    setConversations(prev => {
      const existing = prev.find(c => c.userId === userId);
      const updated = existing
        ? prev.map(c => c.userId === userId ? { ...c, messages: [...c.messages, msg], unread: 0 } : c)
        : [{ userId, user: { ...user, signal: nearbyUsers.find(u => u.id === userId)?.signal ?? 80 }, messages: [msg], unread: 0 }, ...prev];
      saveConvs(updated);
      return updated;
    });

    setTimeout(() => {
      const reply: Message = { id: replyId, senderId: userId, content: replyContent, timestamp: Date.now(), status: MessageStatus.DELIVERED };
      setConversations(curr => {
        const u = curr.map(c => c.userId === userId ? { ...c, messages: [...c.messages, reply], unread: 1 } : c);
        saveConvs(u);
        return u;
      });
      // Fire toast so the global overlay can decide whether to show it
      const sender = USER_POOL.find(u => u.id === userId);
      setMutedIds(currentMuted => {
        if (!currentMuted.has(userId)) {
          setPendingToast({
            kind: 'dm',
            targetId: userId,
            senderName: sender?.username ?? 'Someone',
            senderColor: sender?.color ?? '#888',
            senderAvatarUri: sender?.avatarUri,
            content: replyContent,
          });
        }
        return currentMuted;
      });
    }, replyDelay);
  };

  // ── Group send ────────────────────────────────────────────────────────────

  const sendGroupMessage = (groupId: string, content: string) => {
    if (!profile) return;
    const msgId = createMessageId();
    if (!sentIds.remember(msgId)) return;

    const msg: Message = {
      id: msgId,
      senderId: profile.id,
      senderName: profile.username,
      senderColor: profile.color,
      content,
      timestamp: Date.now(),
      status: MessageStatus.SENT,
    };

    let groupMembers: HopUser[] = [];

    setGroupConversations(prev => {
      const group = prev.find(g => g.id === groupId);
      if (!group) return prev;
      groupMembers = group.members;
      const updated = prev.map(g =>
        g.id === groupId ? { ...g, messages: [...g.messages, msg], unread: 0 } : g
      );
      saveGroups(updated);
      return updated;
    });

    // Simulate a random member replying
    const replyDelay = 1500 + Math.random() * 3000;
    const replyId = createMessageId();

    setTimeout(() => {
      setGroupConversations(curr => {
        const group = curr.find(g => g.id === groupId);
        if (!group) return curr;
        const bots = group.members;
        if (bots.length === 0) return curr;
        const bot = bots[Math.floor(Math.random() * bots.length)];
        const replyText = BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)];
        const reply: Message = {
          id: replyId,
          senderId: bot.id,
          senderName: bot.username,
          senderColor: bot.color,
          content: replyText,
          timestamp: Date.now(),
          status: MessageStatus.DELIVERED,
        };
        const updated = curr.map(g =>
          g.id === groupId ? { ...g, messages: [...g.messages, reply], unread: 1 } : g
        );
        saveGroups(updated);
        // Fire toast for the group reply (skip if conversation is muted)
        setMutedIds(currentMuted => {
          if (!currentMuted.has(groupId)) {
            setPendingToast({
              kind: 'group',
              targetId: groupId,
              senderName: bot.username,
              senderColor: bot.color,
              senderAvatarUri: bot.avatarUri,
              content: replyText,
            });
          }
          return currentMuted;
        });
        return updated;
      });
    }, replyDelay);
  };

  // ── Create group ──────────────────────────────────────────────────────────

  const createGroup = (name: string, memberIds: string[]): GroupConversation | null => {
    if (!profile) return null;
    const members = memberIds
      .map(id => USER_POOL.find(u => u.id === id) ?? nearbyUsers.find(u => u.id === id))
      .filter((u): u is HopUser => u !== undefined);
    if (members.length === 0) return null;

    const group: GroupConversation = {
      id: `g_${createMessageId()}`,
      name: name.trim() || members.map(m => m.username).join(', '),
      members,
      messages: [],
      unread: 0,
      createdAt: Date.now(),
    };

    setGroupConversations(prev => {
      const updated = [group, ...prev];
      saveGroups(updated);
      return updated;
    });

    return group;
  };

  // ── Read / lookup ─────────────────────────────────────────────────────────

  const markRead = (userId: string) => {
    setConversations(prev => {
      const u = prev.map(c => c.userId === userId ? { ...c, unread: 0 } : c);
      saveConvs(u);
      return u;
    });
  };

  const markGroupRead = (groupId: string) => {
    setGroupConversations(prev => {
      const u = prev.map(g => g.id === groupId ? { ...g, unread: 0 } : g);
      saveGroups(u);
      return u;
    });
  };

  const getConversation = (userId: string) => conversations.find(c => c.userId === userId);
  const getGroupConversation = (groupId: string) => groupConversations.find(g => g.id === groupId);

  // ── Broadcast ─────────────────────────────────────────────────────────────

  const sendBroadcast = (content: string) => {
    if (!profile) return;
    const b: Broadcast = { id: createMessageId(), senderId: profile.id, senderName: profile.username, senderColor: profile.color, content, timestamp: Date.now() };
    setBroadcasts(prev => {
      const u = [b, ...prev];
      AsyncStorage.setItem('@hop/broadcasts', JSON.stringify(u));
      return u;
    });
  };

  const clearHistory = async () => {
    setConversations([]);
    setGroupConversations([]);
    await Promise.all([
      AsyncStorage.removeItem('@hop/conversations'),
      AsyncStorage.removeItem('@hop/groups'),
    ]);
  };

  const totalUnread =
    conversations.reduce((s, c) => s + c.unread, 0) +
    groupConversations.reduce((s, g) => s + g.unread, 0);

  return (
    <HopContext.Provider value={{
      profile, isOnboarding, loaded, nearbyUsers,
      conversations, groupConversations, broadcasts,
      isScanning, totalUnread,
      pendingToast, dismissToast,
      mutedIds, toggleMute, isMuted,
      setProfile, sendMessage, sendGroupMessage, sendBroadcast,
      createGroup, getConversation, getGroupConversation,
      markRead, markGroupRead, completeOnboarding, clearHistory,
    }}>
      {children}
    </HopContext.Provider>
  );
}

export function useHop() {
  const ctx = useContext(HopContext);
  if (!ctx) throw new Error('useHop must be used inside HopProvider');
  return ctx;
}
