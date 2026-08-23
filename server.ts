import express, { Request, Response, NextFunction } from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || "yager-secret-key-development-ai-studio";

interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  avatar?: string | null;
  bio?: string;
  passwordHash: string;
  createdAt: string;
}

interface ChatRecord {
  id: string;
  isGroup: boolean;
  name: string | null;
  avatar?: string | null;
  createdAt: string;
}

interface ChatParticipantRecord {
  id: string;
  chatId: string;
  userId: string;
  lastReadAt: string;
}

interface MessageRecord {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  createdAt: string;
  mediaType?: "text" | "voice" | "round_video" | "image" | "video" | "file";
  mediaUrl?: string;
  mediaMeta?: {
    duration?: number;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
  };
}

// In-Memory Data Store
const users = new Map<string, UserRecord>();
const chats = new Map<string, ChatRecord>();
const participants = new Map<string, ChatParticipantRecord>();
const messages: MessageRecord[] = [];

// WebSocket Connection Manager
class WSManager {
  private userSockets = new Map<string, Set<WebSocket>>();

  connect(userId: string, socket: WebSocket) {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(socket);
  }

  disconnect(userId: string, socket: WebSocket) {
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);
      }
    }
  }

  isOnline(userId: string): boolean {
    const sockets = this.userSockets.get(userId);
    return !!sockets && sockets.size > 0;
  }

  sendToUsers(userIds: string[], data: unknown) {
    const payload = JSON.stringify(data);
    for (const uid of userIds) {
      const sockets = this.userSockets.get(uid);
      if (sockets) {
        for (const socket of sockets) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(payload);
          }
        }
      }
    }
  }
}

const wsManager = new WSManager();

// Seed initial demo users & chat
function seedInitialData() {
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

seedInitialData();

// Helper Functions
function findUserByUsername(username: string): UserRecord | undefined {
  const norm = username.trim().toLowerCase();
  for (const u of users.values()) {
    if (u.username.toLowerCase() === norm) return u;
  }
  return undefined;
}

function getChatParticipants(chatId: string): ChatParticipantRecord[] {
  const list: ChatParticipantRecord[] = [];
  for (const p of participants.values()) {
    if (p.chatId === chatId) list.push(p);
  }
  return list;
}

function getUserChats(userId: string): ChatParticipantRecord[] {
  const list: ChatParticipantRecord[] = [];
  for (const p of participants.values()) {
    if (p.userId === userId) list.push(p);
  }
  return list;
}

function getChatOtherUserIds(userId: string): Set<string> {
  const chatIds = getUserChats(userId).map((p) => p.chatId);
  const otherIds = new Set<string>();
  for (const p of participants.values()) {
    if (chatIds.includes(p.chatId) && p.userId !== userId) {
      otherIds.add(p.userId);
    }
  }
  return otherIds;
}

function formatChatOut(chat: ChatRecord, currentUser: UserRecord) {
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

// Authentication Middleware
interface AuthenticatedRequest extends Request {
  user?: UserRecord;
}

function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ detail: "Не авторизован" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string };
    const user = users.get(decoded.sub);
    if (!user) {
      res.status(401).json({ detail: "Пользователь не найден" });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ detail: "Недействительный токен" });
  }
}

// Express App Setup
const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/auth/register", (req, res) => {
  const { username, password } = req.body || {};
  const trimmed = typeof username === "string" ? username.trim() : "";
  const pwd = typeof password === "string" ? password : "";

  if (trimmed.length < 3) {
    res.status(400).json({ detail: "Имя пользователя — минимум 3 символа" });
    return;
  }
  if (pwd.length < 4) {
    res.status(400).json({ detail: "Пароль — минимум 4 символа" });
    return;
  }

  if (findUserByUsername(trimmed)) {
    res.status(400).json({ detail: "Это имя пользователя уже занято" });
    return;
  }

  const user: UserRecord = {
    id: `user_${randomUUID().slice(0, 8)}`,
    username: trimmed,
    displayName: trimmed,
    passwordHash: bcrypt.hashSync(pwd, 10),
    createdAt: new Date().toISOString(),
  };
  users.set(user.id, user);

  const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: "7d" });
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar || null,
      bio: user.bio || "",
    },
  });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const trimmed = typeof username === "string" ? username.trim() : "";
  const pwd = typeof password === "string" ? password : "";

  const user = findUserByUsername(trimmed);
  if (!user || !bcrypt.compareSync(pwd, user.passwordHash)) {
    res.status(400).json({ detail: "Неверное имя пользователя или пароль" });
    return;
  }

  const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: "7d" });
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar || null,
      bio: user.bio || "",
    },
  });
});

app.get("/api/auth/me", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  res.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar || null,
    bio: user.bio || "",
  });
});

app.patch("/api/users/me", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { displayName, avatar, bio } = req.body || {};

  if (typeof displayName === "string" && displayName.trim()) {
    user.displayName = displayName.trim().slice(0, 50);
  }
  if (avatar !== undefined) {
    user.avatar = typeof avatar === "string" && avatar.trim() ? avatar : null;
  }
  if (bio !== undefined) {
    user.bio = typeof bio === "string" ? bio.trim().slice(0, 100) : "";
  }

  res.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar || null,
    bio: user.bio || "",
  });
});

app.get("/api/users/:userId", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const target = users.get(req.params.userId);
  if (!target) {
    res.status(404).json({ detail: "Пользователь не найден" });
    return;
  }
  res.json({
    id: target.id,
    username: target.username,
    displayName: target.displayName,
    avatar: target.avatar || null,
    bio: target.bio || "",
    online: wsManager.isOnline(target.id),
  });
});

app.get("/api/users", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const currentUser = req.user!;
  const query = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  if (!query) {
    res.json([]);
    return;
  }
  const list: { id: string; username: string; displayName: string; avatar: string | null; bio: string; online: boolean }[] = [];

  for (const u of users.values()) {
    if (u.id === currentUser.id) continue;
    if (
      u.username.toLowerCase().includes(query) ||
      u.displayName.toLowerCase().includes(query)
    ) {
      list.push({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatar: u.avatar || null,
        bio: u.bio || "",
        online: wsManager.isOnline(u.id),
      });
    }
  }

  res.json(list);
});

app.get("/api/chats", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const userParts = getUserChats(user.id);
  const outList = userParts
    .map((p) => {
      const chat = chats.get(p.chatId);
      return chat ? formatChatOut(chat, user) : null;
    })
    .filter(Boolean) as ReturnType<typeof formatChatOut>[];

  outList.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  res.json(outList);
});

app.post("/api/chats", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { username, isGroup, name, avatar, memberUsernames } = req.body || {};

  // Group chat creation
  if (isGroup) {
    const groupName = typeof name === "string" && name.trim() ? name.trim() : "Групповой чат";
    const groupAvatar = typeof avatar === "string" && avatar.trim() ? avatar : null;
    const usernamesList: string[] = Array.isArray(memberUsernames) ? memberUsernames : [];

    const memberUsers = [user];
    for (const uName of usernamesList) {
      const found = findUserByUsername(String(uName).trim());
      if (found && !memberUsers.some((m) => m.id === found.id)) {
        memberUsers.push(found);
      }
    }

    const chat: ChatRecord = {
      id: `chat_group_${randomUUID().slice(0, 8)}`,
      isGroup: true,
      name: groupName,
      avatar: groupAvatar,
      createdAt: new Date().toISOString(),
    };
    chats.set(chat.id, chat);

    for (const member of memberUsers) {
      const part: ChatParticipantRecord = {
        id: `part_${randomUUID().slice(0, 8)}`,
        chatId: chat.id,
        userId: member.id,
        lastReadAt: new Date().toISOString(),
      };
      participants.set(part.id, part);
    }

    // Optional initial welcome message
    const welcomeMsg: MessageRecord = {
      id: `msg_${randomUUID().slice(0, 8)}`,
      chatId: chat.id,
      senderId: user.id,
      text: `Группа «${groupName}» создана`,
      createdAt: new Date().toISOString(),
      mediaType: "text",
    };
    messages.push(welcomeMsg);

    res.json(formatChatOut(chat, user));
    return;
  }

  // 1-on-1 chat creation
  const targetUsername = typeof username === "string" ? username.trim() : "";

  const target = findUserByUsername(targetUsername);
  if (!target) {
    res.status(404).json({ detail: "Пользователь с таким именем не найден" });
    return;
  }
  if (target.id === user.id) {
    res.status(400).json({ detail: "Нельзя начать чат с самим собой" });
    return;
  }

  // Check if a 1-on-1 chat already exists between user and target
  const myParts = getUserChats(user.id);
  for (const myP of myParts) {
    const chat = chats.get(myP.chatId);
    if (chat && !chat.isGroup) {
      const otherPart = getChatParticipants(chat.id).find((p) => p.userId === target.id);
      if (otherPart) {
        res.json(formatChatOut(chat, user));
        return;
      }
    }
  }

  // Create new chat
  const chat: ChatRecord = {
    id: `chat_${randomUUID().slice(0, 8)}`,
    isGroup: false,
    name: null,
    createdAt: new Date().toISOString(),
  };
  chats.set(chat.id, chat);

  const part1: ChatParticipantRecord = {
    id: `part_${randomUUID().slice(0, 8)}`,
    chatId: chat.id,
    userId: user.id,
    lastReadAt: new Date().toISOString(),
  };
  const part2: ChatParticipantRecord = {
    id: `part_${randomUUID().slice(0, 8)}`,
    chatId: chat.id,
    userId: target.id,
    lastReadAt: new Date().toISOString(),
  };
  participants.set(part1.id, part1);
  participants.set(part2.id, part2);

  res.json(formatChatOut(chat, user));
});

app.get("/api/chats/:chatId/messages", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const chatId = req.params.chatId;

  const parts = getChatParticipants(chatId);
  const isPart = parts.some((p) => p.userId === user.id);
  if (!isPart) {
    res.status(403).json({ detail: "Нет доступа к этому чату" });
    return;
  }

  // Find other participant's lastReadAt to calculate read status accurately
  const otherParts = parts.filter((p) => p.userId !== user.id);
  const otherLastRead = otherParts.length > 0
    ? Math.max(...otherParts.map((p) => new Date(p.lastReadAt).getTime()))
    : 0;

  const chatMessages = messages
    .filter((m) => m.chatId === chatId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((m) => {
      const msgTime = new Date(m.createdAt).getTime();
      const isRead = m.senderId !== user.id || msgTime <= otherLastRead;
      return {
        id: m.id,
        chatId: m.chatId,
        senderId: m.senderId,
        text: m.text,
        createdAt: m.createdAt,
        status: isRead ? "read" : "sent",
        mediaType: m.mediaType || "text",
        mediaUrl: m.mediaUrl,
        mediaMeta: m.mediaMeta,
      };
    });

  res.json(chatMessages);
});

app.post("/api/chats/:chatId/messages", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const chatId = req.params.chatId;
  const { text, mediaType, mediaUrl, mediaMeta } = req.body || {};
  const msgText = typeof text === "string" ? text.trim() : "";
  const validMediaType = mediaType || "text";

  const parts = getChatParticipants(chatId);
  const isPart = parts.some((p) => p.userId === user.id);
  if (!isPart) {
    res.status(403).json({ detail: "Нет доступа к этому чату" });
    return;
  }

  if (!msgText && !mediaUrl) {
    res.status(400).json({ detail: "Пустое сообщение" });
    return;
  }

  const msg: MessageRecord = {
    id: `msg_${randomUUID().slice(0, 8)}`,
    chatId,
    senderId: user.id,
    text: msgText,
    createdAt: new Date().toISOString(),
    mediaType: validMediaType,
    mediaUrl: typeof mediaUrl === "string" ? mediaUrl : undefined,
    mediaMeta: mediaMeta && typeof mediaMeta === "object" ? mediaMeta : undefined,
  };
  messages.push(msg);

  // Update sender's lastReadAt
  const myPart = parts.find((p) => p.userId === user.id);
  if (myPart) {
    myPart.lastReadAt = msg.createdAt;
  }

  const outMessage = {
    id: msg.id,
    chatId: msg.chatId,
    senderId: msg.senderId,
    text: msg.text,
    createdAt: msg.createdAt,
    status: "sent",
    mediaType: msg.mediaType || "text",
    mediaUrl: msg.mediaUrl,
    mediaMeta: msg.mediaMeta,
  };

  const participantUserIds = parts.map((p) => p.userId);
  wsManager.sendToUsers(participantUserIds, {
    type: "message",
    chatId,
    message: outMessage,
  });

  res.json(outMessage);
});

app.post("/api/chats/:chatId/read", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const chatId = req.params.chatId;

  const parts = getChatParticipants(chatId);
  const part = parts.find((p) => p.userId === user.id);
  if (part) {
    part.lastReadAt = new Date().toISOString();
  }

  // Notify all other participants that messages were read
  const otherUserIds = parts.filter((p) => p.userId !== user.id).map((p) => p.userId);
  if (otherUserIds.length > 0) {
    const chatMsgs = messages.filter((m) => m.chatId === chatId);
    chatMsgs.forEach((m) => {
      if (m.senderId !== user.id) {
        wsManager.sendToUsers([m.senderId], {
          type: "message_status",
          chatId,
          messageId: m.id,
          status: "read",
        });
      }
    });
  }

  res.json({ ok: true });
});

// Serve frontend static assets from yager/ directory
const staticDir = path.join(process.cwd(), "yager");
app.use(express.static(staticDir));

app.get("*", (req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

// Create HTTP server & WebSocket server
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "", `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
  const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
  const token = url.searchParams.get("token");

  if (!token) {
    ws.close(4401);
    return;
  }

  let userId: string;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string };
    userId = decoded.sub;
    if (!users.has(userId)) {
      ws.close(4401);
      return;
    }
  } catch {
    ws.close(4401);
    return;
  }

  wsManager.connect(userId, ws);

  // Broadcast presence online to shared contacts
  const otherContactIds = Array.from(getChatOtherUserIds(userId));
  if (otherContactIds.length > 0) {
    wsManager.sendToUsers(otherContactIds, { type: "presence", userId, online: true });
  }

  ws.on("message", (rawData: Buffer | string) => {
    try {
      const data = JSON.parse(rawData.toString());
      if (data.type === "typing" && data.chatId) {
        const parts = getChatParticipants(data.chatId);
        const otherIds = parts.filter((p) => p.userId !== userId).map((p) => p.userId);
        wsManager.sendToUsers(otherIds, {
          type: "typing",
          chatId: data.chatId,
          userId,
          isTyping: !!data.isTyping,
        });
      }
    } catch {
      // ignore malformed payloads
    }
  });

  ws.on("close", () => {
    wsManager.disconnect(userId, ws);
    if (!wsManager.isOnline(userId)) {
      const contacts = Array.from(getChatOtherUserIds(userId));
      if (contacts.length > 0) {
        wsManager.sendToUsers(contacts, { type: "presence", userId, online: false });
      }
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Ягерь server running on http://0.0.0.0:${PORT}`);
});
