import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { saveConvs, saveGroups } from './storage';
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

export interface MessageRequest {
  id: string;
  fromUser: HopUser;
  preview: string;
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
  kind: 'dm' | 'group';
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
  messageRequests: MessageRequest[];
  blockedIds: string[];
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
  blockUser: (userId: string) => Promise<void>;
  reportUser: (userId: string) => void;
  acceptRequest: (requestId: string) => void;
  declineRequest: (requestId: string) => void;
  deleteConversation: (userId: string) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;
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

const REQUEST_OPENERS = [
  'hey! saw you nearby 👋', 'yo, wanna chat?', 'are you at the park?',
  'hi! HOP is so cool lol', 'hey stranger 👀', 'you near the coffee shop?',
  "what's good?", 'nice to meet you!',
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
  const [messageRequests, setMessageRequests] = useState<MessageRequest[]>([]);
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [toastQueue, setToastQueue] = useState<ToastNotification[]>([]);
  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());
  const scanRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Mute key helper ───────────────────────────────────────────────────────

  const muteKey = (profileId: string) => `@hop/muted/${profileId}`;

  // ── Persistence load ──────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        // Load profile first so we can scope the muted key to this profile.
        const profStr = await AsyncStorage.getItem('@hop/profile');
        let profileId: string | null = null;
        if (profStr) {
          const parsed: MyProfile = JSON.parse(profStr);
          setProfileState(parsed);
          profileId = parsed.id;
        } else {
          setIsOnboarding(true);
        }

        const [convStr, groupStr, bcastStr, mutedStr, reqStr, blockedStr] = await Promise.all([
          AsyncStorage.getItem('@hop/conversations'),
          AsyncStorage.getItem('@hop/groups'),
          AsyncStorage.getItem('@hop/broadcasts'),
          profileId ? AsyncStorage.getItem(muteKey(profileId)) : Promise.resolve(null),
          AsyncStorage.getItem('@hop/requests'),
          AsyncStorage.getItem('@hop/blocked'),
        ]);
        if (convStr) {
          const parsed: Conversation[] = JSON.parse(convStr);
          const byUserId: Record<string, Conversation> = {};
          for (const conv of parsed) {
            if (!byUserId[conv.userId]) {
              byUserId[conv.userId] = conv;
            } else {
              const merged = [...byUserId[conv.userId].messages, ...conv.messages];
              const seenMsgIds = new Set<string>();
              const dedupedMsgs = merged
                .filter(m => { if (seenMsgIds.has(m.id)) return false; seenMsgIds.add(m.id); return true; })
                .sort((a, b) => a.timestamp - b.timestamp);
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
          const hydrated = parsed.map(group => ({
            ...group,
            messages: group.messages.map(msg => {
              const member = group.members.find(m => m.id === msg.senderId);
              return member ? { ...msg, senderColor: member.color, senderName: member.username } : msg;
            }),
          }));
          setGroupConversations(hydrated);
        }
        if (mutedStr) setMutedIds(new Set(JSON.parse(mutedStr) as string[]));
        if (reqStr) setMessageRequests(JSON.parse(reqStr));
        if (blockedStr) setBlockedIds(JSON.parse(blockedStr));
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

  // ── BT scan simulation ────────────────────────────────────────────────────

  useEffect(() => {
    if (!loaded) return;
    setIsScanning(true);
    const scan = () => {
      const count = 2 + Math.floor(Math.random() * 4);
      const shuffled = [...USER_POOL].sort(() => Math.random() - 0.5).slice(0, count);
      setNearbyUsers(
        shuffled
          .filter(u => !blockedIds.includes(u.id))
          .map(u => ({ ...u, signal: 25 + Math.floor(Math.random() * 75) }))
      );
    };
    scan();
    scanRef.current = setInterval(scan, 5000);
    return () => { if (scanRef.current) clearInterval(scanRef.current); setIsScanning(false); };
  }, [loaded, blockedIds]);

  // ── Message request simulation ────────────────────────────────────────────

  useEffect(() => {
    if (!loaded) return;
    const scheduleNext = () => {
      const delay = 18_000 + Math.random() * 22_000;
      requestRef.current = setTimeout(() => {
        setConversations(currentConvs => {
          setBlockedIds(currentBlocked => {
            setMessageRequests(currentRequests => {
              const existingUserIds = new Set([
                ...currentConvs.map(c => c.userId),
                ...currentRequests.map(r => r.fromUser.id),
                ...currentBlocked,
              ]);
              const candidates = USER_POOL.filter(u => !existingUserIds.has(u.id));
              if (candidates.length > 0) {
                const sender = candidates[Math.floor(Math.random() * candidates.length)];
                const preview = REQUEST_OPENERS[Math.floor(Math.random() * REQUEST_OPENERS.length)];
                const req: MessageRequest = { id: createMessageId(), fromUser: sender, preview, timestamp: Date.now() };
                const updated = [req, ...currentRequests];
                AsyncStorage.setItem('@hop/requests', JSON.stringify(updated));
                return updated;
              }
              return currentRequests;
            });
            return currentBlocked;
          });
          return currentConvs;
        });
        scheduleNext();
      }, delay);
    };
    scheduleNext();
    return () => { if (requestRef.current) clearTimeout(requestRef.current); };
  }, [loaded]);

  // ── Toast ─────────────────────────────────────────────────────────────────

  const pendingToast = toastQueue[0] ?? null;
  const dismissToast = () => setToastQueue(prev => prev.slice(1));

  // ── Mute ──────────────────────────────────────────────────────────────────

  const toggleMute = async (id: string) => {
    if (!profile) return;
    const key = muteKey(profile.id);
    setMutedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      AsyncStorage.setItem(key, JSON.stringify([...next]));
      return next;
    });
  };
  const isMuted = (id: string) => mutedIds.has(id);

  // ── Profile ───────────────────────────────────────────────────────────────

  const setProfile = async (p: MyProfile) => {
    setProfileState(p);
    await AsyncStorage.setItem('@hop/profile', JSON.stringify(p));
  };

  const completeOnboarding = async (username: string, color: string, avatarUri?: string) => {
    // New profile → start with a clean mute list so state doesn't carry over.
    setMutedIds(new Set());
    await setProfile({ id: createMessageId(), username, color, discoverable: true, avatarUri });
    setIsOnboarding(false);
  };

  // ── Block / Report ────────────────────────────────────────────────────────

  const blockUser = useCallback(async (userId: string) => {
    setBlockedIds(prev => {
      if (prev.includes(userId)) return prev;
      const next = [...prev, userId];
      AsyncStorage.setItem('@hop/blocked', JSON.stringify(next));
      return next;
    });
    setNearbyUsers(prev => prev.filter(u => u.id !== userId));
    setConversations(prev => {
      const next = prev.filter(c => c.userId !== userId);
      saveConvs(next);
      return next;
    });
    setMessageRequests(prev => {
      const next = prev.filter(r => r.fromUser.id !== userId);
      AsyncStorage.setItem('@hop/requests', JSON.stringify(next));
      return next;
    });
  }, []);

  const reportUser = useCallback((userId: string) => {
    const user = USER_POOL.find(u => u.id === userId);
    Alert.alert(
      `Report @${user?.username ?? userId}`,
      'Why are you reporting this user?',
      [
        { text: 'Spam', onPress: () => Alert.alert('Reported', 'Thanks — we\'ll review this user.') },
        { text: 'Harassment', onPress: () => Alert.alert('Reported', 'Thanks — we\'ll review this user.') },
        { text: 'Inappropriate content', onPress: () => Alert.alert('Reported', 'Thanks — we\'ll review this user.') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }, []);

  // ── Message requests ──────────────────────────────────────────────────────

  const acceptRequest = useCallback((requestId: string) => {
    setMessageRequests(prev => {
      const req = prev.find(r => r.id === requestId);
      if (!req) return prev;
      const next = prev.filter(r => r.id !== requestId);
      AsyncStorage.setItem('@hop/requests', JSON.stringify(next));
      setConversations(convs => {
        if (convs.find(c => c.userId === req.fromUser.id)) return convs;
        const initMsg: Message = {
          id: createMessageId(),
          senderId: req.fromUser.id,
          content: req.preview,
          timestamp: req.timestamp,
          status: MessageStatus.DELIVERED,
        };
        const newConv: Conversation = {
          userId: req.fromUser.id,
          user: { ...req.fromUser, signal: 80 },
          messages: [initMsg],
          unread: 1,
        };
        const updated = [newConv, ...convs];
        saveConvs(updated);
        return updated;
      });
      return next;
    });
  }, []);

  const declineRequest = useCallback((requestId: string) => {
    setMessageRequests(prev => {
      const next = prev.filter(r => r.id !== requestId);
      AsyncStorage.setItem('@hop/requests', JSON.stringify(next));
      return next;
    });
  }, []);

  // ── DM send ───────────────────────────────────────────────────────────────

  const sendMessage = (userId: string, content: string) => {
    if (!profile) return;
    const user = USER_POOL.find(u => u.id === userId) ?? nearbyUsers.find(u => u.id === userId);
    if (!user) return;

    const msgId = createMessageId();
    if (!sentIds.remember(msgId)) return;

    const msg: Message = { id: msgId, senderId: profile.id, content, timestamp: Date.now(), status: MessageStatus.SENT };
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
      const sender = USER_POOL.find(u => u.id === userId);
      setMutedIds(currentMuted => {
        if (!currentMuted.has(userId)) {
          setToastQueue(prev => {
              const filtered = prev.filter(t => t.targetId !== userId);
              return [...filtered, { kind: 'dm', targetId: userId, senderName: sender?.username ?? 'Someone', senderColor: sender?.color ?? '#888', senderAvatarUri: sender?.avatarUri, content: replyContent }];
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

    const msg: Message = { id: msgId, senderId: profile.id, senderName: profile.username, senderColor: profile.color, content, timestamp: Date.now(), status: MessageStatus.SENT };
    const replyDelay = 1500 + Math.random() * 3000;
    const replyId = createMessageId();

    setGroupConversations(prev => {
      const group = prev.find(g => g.id === groupId);
      if (!group) return prev;
      const updated = prev.map(g => g.id === groupId ? { ...g, messages: [...g.messages, msg], unread: 0 } : g);
      saveGroups(updated);
      return updated;
    });

    setTimeout(() => {
      setGroupConversations(curr => {
        const group = curr.find(g => g.id === groupId);
        if (!group) return curr;
        const bot = group.members[Math.floor(Math.random() * group.members.length)];
        const replyText = BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)];
        const reply: Message = { id: replyId, senderId: bot.id, senderName: bot.username, senderColor: bot.color, content: replyText, timestamp: Date.now(), status: MessageStatus.DELIVERED };
        const updated = curr.map(g => g.id === groupId ? { ...g, messages: [...g.messages, reply], unread: 1 } : g);
        saveGroups(updated);
        setMutedIds(currentMuted => {
          if (!currentMuted.has(groupId)) {
            setToastQueue(prev => {
              const filtered = prev.filter(t => t.targetId !== groupId);
              return [...filtered, { kind: 'group', targetId: groupId, senderName: bot.username, senderColor: bot.color, senderAvatarUri: bot.avatarUri, content: replyText }];
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
    const group: GroupConversation = { id: `g_${createMessageId()}`, name: name.trim() || members.map(m => m.username).join(', '), members, messages: [], unread: 0, createdAt: Date.now() };
    setGroupConversations(prev => { const updated = [group, ...prev]; saveGroups(updated); return updated; });
    return group;
  };

  // ── Read / lookup ─────────────────────────────────────────────────────────

  const markRead = (userId: string) => setConversations(prev => { const u = prev.map(c => c.userId === userId ? { ...c, unread: 0 } : c); saveConvs(u); return u; });
  const markGroupRead = (groupId: string) => setGroupConversations(prev => { const u = prev.map(g => g.id === groupId ? { ...g, unread: 0 } : g); saveGroups(u); return u; });
  const getConversation = (userId: string) => conversations.find(c => c.userId === userId);
  const getGroupConversation = (groupId: string) => groupConversations.find(g => g.id === groupId);

  // ── Broadcast ─────────────────────────────────────────────────────────────

  const sendBroadcast = (content: string) => {
    if (!profile) return;
    const b: Broadcast = { id: createMessageId(), senderId: profile.id, senderName: profile.username, senderColor: profile.color, content, timestamp: Date.now() };
    setBroadcasts(prev => { const u = [b, ...prev]; AsyncStorage.setItem('@hop/broadcasts', JSON.stringify(u)); return u; });
  };

  const clearHistory = async () => {
    setConversations([]); setGroupConversations([]);
    await Promise.all([AsyncStorage.removeItem('@hop/conversations'), AsyncStorage.removeItem('@hop/groups')]);
  };

  // ── Delete conversation / group ───────────────────────────────────────────

  const deleteConversation = async (userId: string) => {
    setConversations(prev => {
      const updated = prev.filter(c => c.userId !== userId);
      saveConvs(updated);
      return updated;
    });
  };

  const deleteGroup = async (groupId: string) => {
    setGroupConversations(prev => {
      const updated = prev.filter(g => g.id !== groupId);
      saveGroups(updated);
      return updated;
    });
  };

  const totalUnread =
    conversations.reduce((s, c) => s + c.unread, 0) +
    groupConversations.reduce((s, g) => s + g.unread, 0);

  return (
    <HopContext.Provider value={{
      profile, isOnboarding, loaded, nearbyUsers,
      conversations, groupConversations, broadcasts,
      messageRequests, blockedIds,
      isScanning, totalUnread,
      pendingToast, dismissToast,
      mutedIds, toggleMute, isMuted,
      setProfile, sendMessage, sendGroupMessage, sendBroadcast,
      createGroup, getConversation, getGroupConversation,
      markRead, markGroupRead, completeOnboarding, clearHistory,
      blockUser, reportUser, acceptRequest, declineRequest,
      deleteConversation, deleteGroup,
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
