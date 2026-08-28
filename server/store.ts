import { UserRecord, ChatRecord, ChatParticipantRecord, MessageRecord, StoredSubscription } from "./models";
import bcrypt from "bcryptjs";
import { wsManager } from "./websockets";

// In-Memory Data Store
export const users = new Map<string, UserRecord>();
export const chats = new Map<string, ChatRecord>();
export const participants = new Map<string, ChatParticipantRecord>();
export const messages: MessageRecord[] = [];
export const pushSubscriptions = new Map<string, Map<string, StoredSubscription>>();

export function savePushSubscription(userId: string, sub: any, userAgent?: string) {
  if (!pushSubscriptions.has(userId)) {
    pushSubscriptions.set(userId, new Map());
  }
  const userSubs = pushSubscriptions.get(userId)!;
  userSubs.set(sub.endpoint, {
    subscription: sub,
    userAgent,
    createdAt: new Date().toISOString(),
  });
}

export function removePushSubscription(userId: string, endpoint: string) {
  const userSubs = pushSubscriptions.get(userId);
  if (userSubs) {
    userSubs.delete(endpoint);
    if (userSubs.size === 0) {
      pushSubscriptions.delete(userId);
    }
  }
}

export function findUserByUsername(username: string): UserRecord | undefined {
  const norm = username.trim().replace(/^@/, "").toLowerCase();
  for (const u of users.values()) {
    if (u.username.toLowerCase() === norm) return u;
  }
  return undefined;
}

export function findUserByIdOrUsername(idOrUsername: string): UserRecord | undefined {
  const trimmed = idOrUsername.trim().replace(/^@/, "");
  if (users.has(trimmed)) return users.get(trimmed);
  return findUserByUsername(trimmed);
}

export function getChatParticipants(chatId: string): ChatParticipantRecord[] {
  const list: ChatParticipantRecord[] = [];
  for (const p of participants.values()) {
    if (p.chatId === chatId) list.push(p);
  }
  return list;
}

export function getUserChats(userId: string): ChatParticipantRecord[] {
  const list: ChatParticipantRecord[] = [];
  for (const p of participants.values()) {
    if (p.userId === userId) list.push(p);
  }
  return list;
}

export function getChatOtherUserIds(userId: string): Set<string> {
  const chatIds = getUserChats(userId).map((p) => p.chatId);
  const otherIds = new Set<string>();
  for (const p of participants.values()) {
    if (chatIds.includes(p.chatId) && p.userId !== userId) {
      otherIds.add(p.userId);
    }
  }
  return otherIds;
}

export function formatChatOut(chat: ChatRecord, currentUser: UserRecord) {
  const parts = getChatParticipants(chat.id);
  const otherIds = parts.filter((p) => p.userId !== currentUser.id).map((p) => p.userId);

  let name = chat.name || "Без названия";
  let avatar = chat.avatar || null;
  let online = false;
  let otherUserId: string | null = null;
  let bio: string | undefined = undefined;

  if (!chat.isGroup && otherIds.length > 0) {
    const other = users.get(otherIds[0]);
    if (other) {
      name = other.displayName;
      avatar = other.avatar || null;
      online = wsManager.isOnline(other.id);
      otherUserId = other.id;
      bio = other.bio;
    }
  }

  const chatMessages = messages
    .filter((m) => m.chatId === chat.id)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const lastMessage = chatMessages[chatMessages.length - 1];

  const myPart = parts.find((p) => p.userId === currentUser.id);
  let unread = 0;
  if (myPart) {
    const lastReadTime = new Date(myPart.lastReadAt).getTime();
    unread = chatMessages.filter(
      (m) => new Date(m.createdAt).getTime() > lastReadTime && m.senderId !== currentUser.id
    ).length;
  }

  const participantsList = parts.map((p) => {
    const u = users.get(p.userId);
    return u
      ? {
          id: u.id,
          username: u.username,
          displayName: u.displayName,
          avatar: u.avatar || null,
          bio: u.bio || "",
          online: wsManager.isOnline(u.id),
        }
      : null;
  }).filter(Boolean);

  return {
    id: chat.id,
    name,
    avatar,
    isGroup: chat.isGroup,
    isBot: false,
    online,
    lastMessageAt: lastMessage ? lastMessage.createdAt : chat.createdAt,
    unread,
    otherUserId,
    bio,
    participants: participantsList,
  };
}

// Seed initial demo users & chat
export function seedInitialData() {
  const hash = bcrypt.hashSync("password", 10);
  const now = new Date();

  const user1: UserRecord = {
    id: "user_ivan",
    username: "ivan_petrov",
    displayName: "Иван Петров",
    passwordHash: hash,
    createdAt: new Date(now.getTime() - 86400000 * 5).toISOString(),
  };
  const user2: UserRecord = {
    id: "user_anna",
    username: "anna_smirnova",
    displayName: "Анна Смирнова",
    passwordHash: hash,
    createdAt: new Date(now.getTime() - 86400000 * 5).toISOString(),
  };
  const user3: UserRecord = {
    id: "user_pavel",
    username: "pavel_durov",
    displayName: "Павел Дуров",
    passwordHash: hash,
    createdAt: new Date(now.getTime() - 86400000 * 5).toISOString(),
  };

  users.set(user1.id, user1);
  users.set(user2.id, user2);
  users.set(user3.id, user3);

  // Chat between Ivan and Anna
  const chat1: ChatRecord = {
    id: "chat_ivan_anna",
    isGroup: false,
    name: null,
    createdAt: new Date(now.getTime() - 86400000 * 2).toISOString(),
  };
  chats.set(chat1.id, chat1);

  const part1: ChatParticipantRecord = {
    id: "part_1",
    chatId: chat1.id,
    userId: user1.id,
    lastReadAt: new Date().toISOString(),
  };
  const part2: ChatParticipantRecord = {
    id: "part_2",
    chatId: chat1.id,
    userId: user2.id,
    lastReadAt: new Date(now.getTime() - 3600000).toISOString(),
  };
  participants.set(part1.id, part1);
  participants.set(part2.id, part2);

  messages.push({
    id: "msg_1",
    chatId: chat1.id,
    senderId: user2.id,
    text: "Привет! Как продвигается проект?",
    createdAt: new Date(now.getTime() - 7200000).toISOString(),
  });
  messages.push({
    id: "msg_2",
    chatId: chat1.id,
    senderId: user1.id,
    text: "Привет! Всё отлично, запускаем сервер на Node.js с поддержкой WebSocket!",
    createdAt: new Date(now.getTime() - 3600000).toISOString(),
  });
  messages.push({
    id: "msg_3",
    chatId: chat1.id,
    senderId: user2.id,
    text: "Супер! Теперь сообщения доставляются мгновенно.",
    createdAt: new Date(now.getTime() - 1800000).toISOString(),
  });
}
