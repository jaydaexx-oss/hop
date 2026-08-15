import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { saveConvs, saveGroups, saveBroadcasts } from './storage';
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

export interface LeftGroup {
  group: GroupConversation;
  leftAt: number;
}

export interface MyProfile {
  id: string;
  username: string;
  color: string;
  discoverable: boolean;
  avatarUri?: string;
}

export type ToastNotification =
  | { kind: 'dm' | 'group'; targetId: string; senderName: string; senderColor: string; senderAvatarUri?: string; content: string }
  | { kind: 'error'; content: string };

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
  leftGroups: LeftGroup[];
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
  leaveGroup: (groupId: string) => Promise<void>;
  rejoinGroup: (groupId: string) => void;
  undoDeleteConversation: (conv: Conversation) => void;
  undoDeleteGroup: (group: GroupConversation) => void;
  openDirectMessage: (user: HopUser) => string;
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

// ─── Sort helpers ─────────────────────────────────────────────────────────────

function lastTs(msgs: { timestamp: number }[]): number {
  return msgs.length > 0 ? msgs[msgs.length - 1].timestamp : 0;
}

function sortedConvs(list: Conversation[]): Conversation[] {
  return list.slice().sort((a, b) => lastTs(b.messages) - lastTs(a.messages));
}

function sortedGroups(list: GroupConversation[]): GroupConversation[] {
  return list.slice().sort((a, b) => lastTs(b.messages) - lastTs(a.messages));
}

// ─── Exported toast updater (used by showStorageError inside HopProvider) ────
//
// Exported so tests can import the REAL function and assert deduplication
// without duplicating the logic.  HopProvider calls setToastQueue with this
// exact reference, so any change here is reflected in both production code
// and tests simultaneously.
export function storageErrorToastUpdater(prev: ToastNotification[]): ToastNotification[] {
  if (prev.some(t => t.kind === 'error')) return prev;
  return [...prev, { kind: 'error', content: "Couldn't save messages — storage may be full." }];
}

export function profileErrorToastUpdater(prev: ToastNotification[]): ToastNotification[] {
  if (prev.some(t => t.kind === 'error')) return prev;
  return [...prev, { kind: 'error', content: "Couldn't save your profile — please try again." }];
}

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
  const [leftGroups, setLeftGroups] = useState<LeftGroup[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [toastQueue, setToastQueue] = useState<ToastNotification[]>([]);
  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());
  const scanRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const groupConversationsRef = useRef<GroupConversation[]>([]);

  // ── Storage key helpers ───────────────────────────────────────────────────

  const muteKey      = (profileId: string) => `@hop/muted/${profileId}`;
  const blockedKey   = (profileId: string) => `@hop/blocked/${profileId}`;
  const requestsKey  = (profileId: string) => `@hop/requests/${profileId}`;
  const leftGroupKey = (profileId: string) => `@hop/leftGroups/${profileId}`;

  // Keep refs so async callbacks always have the latest values without
  // needing to be recreated every time the state changes.
  const profileRef = useRef<MyProfile | null>(null);
  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => { groupConversationsRef.current = groupConversations; }, [groupConversations]);

  // ── Persistence load ──────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      // Collect whether to enter onboarding and set it in the finally block
      // together with setLoaded(true), so both state updates are batched in
      // a single React flush.  This prevents the mid-IIFE setIsOnboarding(true)
      // call from firing outside of act() in the test environment.
      let shouldOnboard = false;
      try {
        // Load profile first so we can scope the muted key to this profile.
        const profStr = await AsyncStorage.getItem('@hop/profile');
        let profileId: string | null = null;
        if (profStr) {
          const parsed: MyProfile = JSON.parse(profStr);
          setProfileState(parsed);
          profileId = parsed.id;
        } else {
          shouldOnboard = true;
        }

        // ── One-time migration: lift legacy unscoped keys → profile-scoped keys ──
        // Before reading the scoped keys, check if legacy data exists and the
        // scoped key is absent.  Copy the data over, then delete the old key so
        // the migration never runs again.
        //
        // Keys that were ever stored without a profile suffix:
        //   @hop/blocked   — introduced without a suffix, scoped in a later build
        //   @hop/requests  — same as above
        //   @hop/muted     — introduced bare in "Add per-conversation mute toggle",
        //                    then namespaced to @hop/muted/<profileId> in a later
        //                    build; returning users need this migrated or their
        //                    muted list is silently lost after an update.
        if (profileId) {
          const [legacyBlocked, legacyRequests, legacyMuted, scopedBlocked, scopedRequests, scopedMuted] = await Promise.all([
            AsyncStorage.getItem('@hop/blocked'),
            AsyncStorage.getItem('@hop/requests'),
            AsyncStorage.getItem('@hop/muted'),
            AsyncStorage.getItem(blockedKey(profileId)),
            AsyncStorage.getItem(requestsKey(profileId)),
            AsyncStorage.getItem(muteKey(profileId)),
          ]);
          const migrations: Promise<void>[] = [];
          if (legacyBlocked && !scopedBlocked) {
            migrations.push(
              AsyncStorage.setItem(blockedKey(profileId), legacyBlocked).then(() =>
                AsyncStorage.removeItem('@hop/blocked')
              )
            );
          } else if (legacyBlocked) {
            migrations.push(AsyncStorage.removeItem('@hop/blocked'));
          }
          if (legacyRequests && !scopedRequests) {
            migrations.push(
              AsyncStorage.setItem(requestsKey(profileId), legacyRequests).then(() =>
                AsyncStorage.removeItem('@hop/requests')
              )
            );
          } else if (legacyRequests) {
            migrations.push(AsyncStorage.removeItem('@hop/requests'));
          }
          if (legacyMuted && !scopedMuted) {
            migrations.push(
              AsyncStorage.setItem(muteKey(profileId), legacyMuted).then(() =>
                AsyncStorage.removeItem('@hop/muted')
              )
            );
          } else if (legacyMuted) {
            migrations.push(AsyncStorage.removeItem('@hop/muted'));
          }
          if (migrations.length > 0) {
            try {
              await Promise.all(migrations);
            } catch (e) {
              console.warn('[HOP] Migration write failed:', e);
              // Surface the failure without aborting the rest of the load.
              setToastQueue(storageErrorToastUpdater);
            }
          }
        }

        const [convStr, groupStr, bcastStr, mutedStr, reqStr, blockedStr, leftGroupStr] = await Promise.all([
          AsyncStorage.getItem('@hop/conversations'),
          AsyncStorage.getItem('@hop/groups'),
          AsyncStorage.getItem('@hop/broadcasts'),
          profileId ? AsyncStorage.getItem(muteKey(profileId))      : Promise.resolve(null),
          profileId ? AsyncStorage.getItem(requestsKey(profileId))  : Promise.resolve(null),
          profileId ? AsyncStorage.getItem(blockedKey(profileId))   : Promise.resolve(null),
          profileId ? AsyncStorage.getItem(leftGroupKey(profileId)) : Promise.resolve(null),
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
        if (leftGroupStr) setLeftGroups(JSON.parse(leftGroupStr));
        if (bcastStr) {
          setBroadcasts(JSON.parse(bcastStr));
        } else {
          const seed: Broadcast[] = [
            { id: createMessageId(), senderId: 'u1', senderName: 'wavejockey', senderColor: '#FF6B6B', content: 'anyone at the coffee shop on 5th?', timestamp: Date.now() - 300_000 },
            { id: createMessageId(), senderId: 'u3', senderName: 'staticdrift', senderColor: '#45B7D1', content: 'looking for people to jam with nearby', timestamp: Date.now() - 120_000 },
          ];
          setBroadcasts(seed);
          // Use saveBroadcasts so a write failure surfaces an error toast
          // rather than being swallowed by the outer catch.
          saveBroadcasts(seed, () => setToastQueue(storageErrorToastUpdater));
        }
      } catch {
        shouldOnboard = true;
      } finally {
        // Batch isOnboarding + loaded in a single React flush so no
        // intermediate "half-loaded" state is visible in the UI or tests.
        if (shouldOnboard) setIsOnboarding(true);
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
                const pid = profileRef.current?.id;
                if (pid) AsyncStorage.setItem(requestsKey(pid), JSON.stringify(updated));
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

  const showStorageError = useCallback(() => {
    setToastQueue(storageErrorToastUpdater);
  }, []);

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
    try {
      await AsyncStorage.setItem('@hop/profile', JSON.stringify(p));
    } catch {
      // Roll back the optimistic in-memory update so the displayed profile
      // stays consistent with what was actually persisted.
      setProfileState(profile);
      setToastQueue(profileErrorToastUpdater);
    }
  };

  const completeOnboarding = async (username: string, color: string, avatarUri?: string) => {
    // New profile → start with clean per-profile state so nothing carries over.
    setMutedIds(new Set());
    setBlockedIds([]);
    setMessageRequests([]);
    const newProfile: MyProfile = { id: createMessageId(), username, color, discoverable: true, avatarUri };
    // Optimistically update in-memory state so the UI feels instant…
    setProfileState(newProfile);
    try {
      await AsyncStorage.setItem('@hop/profile', JSON.stringify(newProfile));
    } catch {
      // Storage write failed — roll back the optimistic update so the app
      // remains in onboarding and the user can retry.  No partial state should
      // leak to a subsequent launch because the key was never written.
      setProfileState(null);
      setToastQueue(profileErrorToastUpdater);
      return;
    }
    setIsOnboarding(false);
  };

  // ── Block / Report ────────────────────────────────────────────────────────

  const blockUser = useCallback(async (userId: string) => {
    setBlockedIds(prev => {
      if (prev.includes(userId)) return prev;
      const next = [...prev, userId];
      const pid = profileRef.current?.id;
      if (pid) AsyncStorage.setItem(blockedKey(pid), JSON.stringify(next));
      return next;
    });
    setNearbyUsers(prev => prev.filter(u => u.id !== userId));
    setConversations(prev => {
      const next = prev.filter(c => c.userId !== userId);
      saveConvs(next, showStorageError);
      return next;
    });
    setMessageRequests(prev => {
      const next = prev.filter(r => r.fromUser.id !== userId);
      const pid = profileRef.current?.id;
      if (pid) AsyncStorage.setItem(requestsKey(pid), JSON.stringify(next));
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
      const pid = profileRef.current?.id;
      if (pid) AsyncStorage.setItem(requestsKey(pid), JSON.stringify(next));
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
        const updated = sortedConvs([newConv, ...convs]);
        saveConvs(updated, showStorageError);
        return updated;
      });
      return next;
    });
  }, []);

  const declineRequest = useCallback((requestId: string) => {
    setMessageRequests(prev => {
      const next = prev.filter(r => r.id !== requestId);
      const pid = profileRef.current?.id;
      if (pid) AsyncStorage.setItem(requestsKey(pid), JSON.stringify(next));
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
      const raw = existing
        ? prev.map(c => c.userId === userId ? { ...c, messages: [...c.messages, msg], unread: 0 } : c)
        : [{ userId, user: { ...user, signal: nearbyUsers.find(u => u.id === userId)?.signal ?? 80 }, messages: [msg], unread: 0 }, ...prev];
      const updated = sortedConvs(raw);
      saveConvs(updated, showStorageError);
      return updated;
    });

    setTimeout(() => {
      const reply: Message = { id: replyId, senderId: userId, content: replyContent, timestamp: Date.now(), status: MessageStatus.DELIVERED };
      setConversations(curr => {
        const updated = sortedConvs(curr.map(c => c.userId === userId ? { ...c, messages: [...c.messages, reply], unread: 1 } : c));
        saveConvs(updated, showStorageError);
        return updated;
      });
      const sender = USER_POOL.find(u => u.id === userId);
      setMutedIds(currentMuted => {
        if (!currentMuted.has(userId)) {
          setToastQueue(prev => {
              const filtered = prev.filter(t => t.kind === 'error' || t.targetId !== userId);
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
      const updated = sortedGroups(prev.map(g => g.id === groupId ? { ...g, messages: [...g.messages, msg], unread: 0 } : g));
      saveGroups(updated, showStorageError);
      return updated;
    });

    setTimeout(() => {
      setGroupConversations(curr => {
        const group = curr.find(g => g.id === groupId);
        if (!group) return curr;
        const bot = group.members[Math.floor(Math.random() * group.members.length)];
        const replyText = BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)];
        const reply: Message = { id: replyId, senderId: bot.id, senderName: bot.username, senderColor: bot.color, content: replyText, timestamp: Date.now(), status: MessageStatus.DELIVERED };
        const updated = sortedGroups(curr.map(g => g.id === groupId ? { ...g, messages: [...g.messages, reply], unread: 1 } : g));
        saveGroups(updated, showStorageError);
        setMutedIds(currentMuted => {
          if (!currentMuted.has(groupId)) {
            setToastQueue(prev => {
              const filtered = prev.filter(t => t.kind === 'error' || t.targetId !== groupId);
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
    setGroupConversations(prev => { const updated = [group, ...prev]; saveGroups(updated, showStorageError); return updated; });
    return group;
  };

  // ── Read / lookup ─────────────────────────────────────────────────────────

  const markRead = (userId: string) => setConversations(prev => { const u = prev.map(c => c.userId === userId ? { ...c, unread: 0 } : c); saveConvs(u, showStorageError); return u; });
  const markGroupRead = (groupId: string) => setGroupConversations(prev => { const u = prev.map(g => g.id === groupId ? { ...g, unread: 0 } : g); saveGroups(u, showStorageError); return u; });
  const getConversation = (userId: string) => conversations.find(c => c.userId === userId);
  const getGroupConversation = (groupId: string) => groupConversations.find(g => g.id === groupId);

  // ── Broadcast ─────────────────────────────────────────────────────────────

  const sendBroadcast = (content: string) => {
    if (!profile) return;
    const b: Broadcast = { id: createMessageId(), senderId: profile.id, senderName: profile.username, senderColor: profile.color, content, timestamp: Date.now() };
    setBroadcasts(prev => { const u = [b, ...prev]; saveBroadcasts(u, showStorageError); return u; });
  };

  const clearHistory = async () => {
    setConversations([]);
    setGroupConversations([]);
    setLeftGroups([]);
    const pid = profileRef.current?.id;
    const removes: Promise<void>[] = [
      AsyncStorage.removeItem('@hop/conversations'),
      AsyncStorage.removeItem('@hop/groups'),
    ];
    if (pid) removes.push(AsyncStorage.removeItem(leftGroupKey(pid)));
    await Promise.all(removes);
  };

  // ── Open / create DM from QR scan ────────────────────────────────────────

  const openDirectMessage = useCallback((user: HopUser): string => {
    setConversations(prev => {
      if (prev.find(c => c.userId === user.id)) return prev;
      const newConv: Conversation = { userId: user.id, user, messages: [], unread: 0 };
      const updated = [newConv, ...prev];
      saveConvs(updated);
      return updated;
    });
    return user.id;
  }, []);

  // ── Delete conversation / group ───────────────────────────────────────────

  const deleteConversation = async (userId: string) => {
    setConversations(prev => {
      const updated = prev.filter(c => c.userId !== userId);
      saveConvs(updated, showStorageError);
      return updated;
    });
  };

  const deleteGroup = async (groupId: string) => {
    setGroupConversations(prev => {
      const updated = prev.filter(g => g.id !== groupId);
      saveGroups(updated, showStorageError);
      return updated;
    });
  };

  const leaveGroup = async (groupId: string) => {
    // Read the leaving group from the ref so we don't need a stale closure.
    const leaving = groupConversationsRef.current.find(g => g.id === groupId);

    // Remove the group from active conversations. Because totalUnread is derived
    // from groupConversations, this zeroes the group's unread contribution in the
    // same render — no intermediate render can show a stale badge.
    setGroupConversations(prev => {
      const updated = prev.filter(g => g.id !== groupId);
      saveGroups(updated, showStorageError);
      return updated;
    });

    // Update leftGroups as a separate top-level call so React can batch both
    // state updates into a single render (avoids the nested-setter anti-pattern).
    if (leaving) {
      setLeftGroups(left => {
        // Avoid duplicate entries for the same group id.
        // Strip messages so no chat history can leak back via rejoin.
        const deduped = left.filter(l => l.group.id !== groupId);
        const stripped: GroupConversation = { ...leaving, messages: [], unread: 0 };
        const next = [{ group: stripped, leftAt: Date.now() }, ...deduped];
        const pid = profileRef.current?.id;
        if (pid) AsyncStorage.setItem(leftGroupKey(pid), JSON.stringify(next)).catch(() => {});
        return next;
      });
    }
  };

  const rejoinGroup = (groupId: string) => {
    setLeftGroups(prev => {
      const entry = prev.find(l => l.group.id === groupId);
      if (!entry) return prev;
      const next = prev.filter(l => l.group.id !== groupId);
      const pid = profileRef.current?.id;
      if (pid) AsyncStorage.setItem(leftGroupKey(pid), JSON.stringify(next)).catch(() => {});
      // Re-add with cleared unread so the user sees a fresh slate
      setGroupConversations(groups => {
        if (groups.find(g => g.id === groupId)) return groups;
        const rejoined: GroupConversation = { ...entry.group, unread: 0 };
        const updated = sortedGroups([rejoined, ...groups]);
        saveGroups(updated, showStorageError);
        return updated;
      });
      return next;
    });
  };

  const undoDeleteConversation = (conv: Conversation) => {
    setConversations(prev => {
      if (prev.find(c => c.userId === conv.userId)) return prev;
      const updated = sortedConvs([conv, ...prev]);
      saveConvs(updated, showStorageError);
      return updated;
    });
  };

  const undoDeleteGroup = (group: GroupConversation) => {
    setGroupConversations(prev => {
      if (prev.find(g => g.id === group.id)) return prev;
      const updated = sortedGroups([group, ...prev]);
      saveGroups(updated, showStorageError);
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
      messageRequests, blockedIds, leftGroups,
      isScanning, totalUnread,
      pendingToast, dismissToast,
      mutedIds, toggleMute, isMuted,
      setProfile, sendMessage, sendGroupMessage, sendBroadcast,
      createGroup, getConversation, getGroupConversation,
      markRead, markGroupRead, completeOnboarding, clearHistory,
      blockUser, reportUser, acceptRequest, declineRequest,
      deleteConversation, deleteGroup, leaveGroup, rejoinGroup, undoDeleteConversation, undoDeleteGroup, openDirectMessage,
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
