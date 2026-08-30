import express, { Request, Response } from "express";
import { db } from "./db/index.ts";
import { users, chats, participants, messages } from "./db/schema.ts";
import { requireAuth, AuthRequest } from "./middleware/auth.ts";
import { eq, or, and, like, inArray, desc, ilike, not } from "drizzle-orm";
import { wsManager } from "./socket.ts";
import { sendPushToUsers, getVapidPublicKey, savePushSubscription, removePushSubscription } from "./push.ts";
import fs from "fs";
import path from "path";

export const router = express.Router();

router.get("/firebase-config", (req, res) => {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), "firebase-applet-config.json"), "utf8"));
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: "Config not found" });
  }
});

router.post("/auth/register", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.uid;
  const { username, displayName } = req.body;
  
  const trimmedUsername = (username || "").trim().replace(/^@/, "").toLowerCase();
  
  if (!trimmedUsername) {
    return res.status(400).json({ detail: "Username is required" });
  }

  try {
    const newUser = await db.insert(users).values({
      id: userId,
      username: trimmedUsername,
      displayName: displayName || trimmedUsername,
    }).returning();
    
    res.json({ user: newUser[0] });
  } catch (err: any) {
    if (err.code === '23505') { // unique violation
      return res.status(400).json({ detail: "Юз уже занят" });
    }
    res.status(500).json({ detail: err.message });
  }
});

router.post("/auth/login", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.uid;
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId)
  });

  if (!user) {
    return res.status(404).json({ detail: "User not found in DB" });
  }

  res.json({ user });
});

router.get("/auth/me", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.uid;
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId)
  });
  if (!user) return res.status(404).json({ detail: "Not found" });
  res.json(user);
});

router.patch("/users/me", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.uid;
  const { displayName, bio, avatar } = req.body;
  
  const updated = await db.update(users)
    .set({ displayName, bio, avatar })
    .where(eq(users.id, userId))
    .returning();
    
  res.json(updated[0]);
});

router.get("/users/:userId", requireAuth, async (req: AuthRequest, res: Response) => {
  const user = await db.query.users.findFirst({
    where: eq(users.id, req.params.userId)
  });
  if (!user) return res.status(404).json({ detail: "Not found" });
  res.json(user);
});

router.get("/users", requireAuth, async (req: AuthRequest, res: Response) => {
  const q = (req.query.q as string) || "";
  const results = await db.query.users.findMany({
    where: or(
      ilike(users.username, `%${q}%`),
      ilike(users.displayName, `%${q}%`)
    ),
    limit: 50
  });
  res.json(results);
});

router.get("/chats", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.uid;
  
  // Get all chat IDs the user is in
  const userParts = await db.query.participants.findMany({
    where: eq(participants.userId, userId)
  });
  
  if (userParts.length === 0) {
    return res.json([]);
  }
  
  const chatIds = userParts.map(p => p.chatId);
  
  // Get those chats
  const userChats = await db.query.chats.findMany({
    where: inArray(chats.id, chatIds)
  });
  
  const result = [];
  
  for (const chat of userChats) {
    const parts = await db.query.participants.findMany({
      where: eq(participants.chatId, chat.id),
      with: { user: true }
    });
    
    const lastMsgArr = await db.query.messages.findMany({
      where: eq(messages.chatId, chat.id),
      orderBy: [desc(messages.createdAt)],
      limit: 1,
      with: { sender: true }
    });
    
    const unreadCount = await db.query.messages.findMany({
      where: and(
        eq(messages.chatId, chat.id),
        not(eq(messages.senderId, userId)) // Note: actually need to check createdAt > lastReadAt
      )
    });
    
    const userPart = parts.find(p => p.userId === userId);
    let count = 0;
    if (userPart) {
      count = unreadCount.filter(m => new Date(m.createdAt) > new Date(userPart.lastReadAt)).length;
    }
    
    result.push({
      id: chat.id,
      isGroup: chat.isGroup,
      name: chat.name,
      avatar: chat.avatar,
      members: parts.map(p => ({
        id: p.user.id,
        username: p.user.username,
        displayName: p.user.displayName,
        avatar: p.user.avatar
      })),
      lastMessage: lastMsgArr[0] || null,
      unreadCount: count
    });
  }
  
  result.sort((a, b) => {
    const timeA = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const timeB = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
    return timeB - timeA;
  });
  
  res.json(result);
});

router.post("/chats", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.uid;
  const { isGroup, name, memberUsernames, userId: targetUserId, avatar } = req.body;
  
  if (isGroup) {
    if (!name || !memberUsernames || memberUsernames.length === 0) {
      return res.status(400).json({ detail: "Name and members required for group" });
    }
    
    const members = await db.query.users.findMany({
      where: inArray(users.username, memberUsernames)
    });
    
    const newChat = await db.insert(chats).values({
      isGroup: true,
      name,
      avatar
    }).returning();
    
    const chat = newChat[0];
    
    const partRecords = members.map(m => ({ chatId: chat.id, userId: m.id }));
    partRecords.push({ chatId: chat.id, userId });
    
    await db.insert(participants).values(partRecords);
    
    res.json({ id: chat.id });
  } else {
    let target = null;
    if (targetUserId) {
      target = await db.query.users.findFirst({ where: eq(users.id, targetUserId) });
    }
    if (!target && req.body.username) {
      const username = req.body.username.replace(/^@/, '').toLowerCase();
      target = await db.query.users.findFirst({ where: eq(users.username, username) });
    }
    
    if (!target) return res.status(404).json({ detail: "User not found" });
    if (target.id === userId) return res.status(400).json({ detail: "Cannot chat with yourself" });
    
    // Check if chat exists
    // Hard to do exact match in drizzle without subqueries, do it manually
    const myParts = await db.query.participants.findMany({ where: eq(participants.userId, userId) });
    const targetParts = await db.query.participants.findMany({ where: eq(participants.userId, target.id) });
    
    const myChatIds = new Set(myParts.map(p => p.chatId));
    const commonChatIds = targetParts.map(p => p.chatId).filter(id => myChatIds.has(id));
    
    let existingChat = null;
    for (const cid of commonChatIds) {
      const c = await db.query.chats.findFirst({ where: eq(chats.id, cid) });
      if (c && !c.isGroup) {
        existingChat = c;
        break;
      }
    }
    
    if (existingChat) {
      return res.json({ id: existingChat.id });
    }
    
    const newChat = await db.insert(chats).values({ isGroup: false }).returning();
    const chat = newChat[0];
    
    await db.insert(participants).values([
      { chatId: chat.id, userId },
      { chatId: chat.id, userId: target.id }
    ]);
    
    res.json({ id: chat.id });
  }
});


router.get("/chats/:chatId/messages", requireAuth, async (req: AuthRequest, res: Response) => {
  const { chatId } = req.params;
  const userId = req.user!.uid;
  
  const part = await db.query.participants.findFirst({
    where: and(eq(participants.chatId, chatId), eq(participants.userId, userId))
  });
  
  if (!part) return res.status(403).json({ detail: "Not in chat" });
  
  const chatMessages = await db.query.messages.findMany({
    where: eq(messages.chatId, chatId),
    orderBy: [messages.createdAt],
    with: { sender: true }
  });
  
  res.json(chatMessages.map(m => ({
    ...m,
    sender: {
      id: m.sender.id,
      username: m.sender.username,
      displayName: m.sender.displayName,
      avatar: m.sender.avatar
    }
  })));
});

router.post("/chats/:chatId/messages", requireAuth, async (req: AuthRequest, res: Response) => {
  const { chatId } = req.params;
  const userId = req.user!.uid;
  
  const part = await db.query.participants.findFirst({
    where: and(eq(participants.chatId, chatId), eq(participants.userId, userId))
  });
  if (!part) return res.status(403).json({ detail: "Not in chat" });
  
  const newMsg = await db.insert(messages).values({
    chatId,
    senderId: userId,
    text: req.body.text || "",
    mediaType: req.body.mediaType,
    mediaUrl: req.body.mediaUrl,
    mediaMeta: req.body.mediaMeta,
    replyTo: req.body.replyTo,
    forwardedFrom: req.body.forwardedFrom
  }).returning();
  
  const m = newMsg[0];
  
  // fetch with sender
  const msgWithSender = await db.query.messages.findFirst({
    where: eq(messages.id, m.id),
    with: { sender: true }
  });
  
  const payload = {
    ...msgWithSender,
    sender: {
      id: msgWithSender!.sender.id,
      username: msgWithSender!.sender.username,
      displayName: msgWithSender!.sender.displayName,
      avatar: msgWithSender!.sender.avatar
    }
  };
  
  const allParts = await db.query.participants.findMany({ where: eq(participants.chatId, chatId) });
  const otherIds = allParts.map(p => p.userId); // Send to all including self to trigger UI
  
  wsManager.sendToUsers(otherIds, {
    type: "message",
    chatId,
    message: payload
  });
  
  res.json(payload);
});

router.patch("/chats/:chatId/messages/:messageId", requireAuth, async (req: AuthRequest, res: Response) => {
  const { chatId, messageId } = req.params;
  const userId = req.user!.uid;
  
  const msg = await db.query.messages.findFirst({ where: eq(messages.id, messageId) });
  if (!msg) return res.status(404).json({ detail: "Message not found" });
  if (msg.senderId !== userId) return res.status(403).json({ detail: "Not message author" });
  
  await db.update(messages).set({
    text: req.body.text,
    isEdited: true,
    editedAt: new Date()
  }).where(eq(messages.id, messageId));
  
  const updated = await db.query.messages.findFirst({
    where: eq(messages.id, messageId),
    with: { sender: true }
  });
  
  const payload = {
    ...updated,
    sender: {
      id: updated!.sender.id,
      username: updated!.sender.username,
      displayName: updated!.sender.displayName,
      avatar: updated!.sender.avatar
    }
  };
  
  const allParts = await db.query.participants.findMany({ where: eq(participants.chatId, chatId) });
  wsManager.sendToUsers(allParts.map(p => p.userId), {
    type: "message_edit",
    chatId,
    message: payload
  });
  
  res.json(payload);
});


router.delete("/chats/:chatId/messages/:messageId", requireAuth, async (req: AuthRequest, res: Response) => {
  const { chatId, messageId } = req.params;
  const userId = req.user!.uid;
  
  const msg = await db.query.messages.findFirst({ where: eq(messages.id, messageId) });
  if (!msg) return res.status(404).json({ detail: "Message not found" });
  if (msg.senderId !== userId) return res.status(403).json({ detail: "Not author" });
  
  await db.delete(messages).where(eq(messages.id, messageId));
  
  const allParts = await db.query.participants.findMany({ where: eq(participants.chatId, chatId) });
  wsManager.sendToUsers(allParts.map(p => p.userId), {
    type: "message_delete",
    chatId,
    messageId
  });
  
  res.json({ success: true });
});

router.post("/chats/:chatId/messages/:messageId/reactions", requireAuth, async (req: AuthRequest, res: Response) => {
  const { chatId, messageId } = req.params;
  const userId = req.user!.uid;
  const { emoji } = req.body;
  
  const msg = await db.query.messages.findFirst({ where: eq(messages.id, messageId) });
  if (!msg) return res.status(404).json({ detail: "Not found" });
  
  const reactions = (msg.reactions || {}) as Record<string, string[]>;
  let removed = false;
  
  for (const [e, users] of Object.entries(reactions)) {
    if (users.includes(userId)) {
      reactions[e] = users.filter(u => u !== userId);
      if (reactions[e].length === 0) delete reactions[e];
      removed = true;
      break; // assuming one reaction per user per message
    }
  }
  
  if (emoji && !removed) {
    if (!reactions[emoji]) reactions[emoji] = [];
    reactions[emoji].push(userId);
  }
  
  await db.update(messages).set({ reactions }).where(eq(messages.id, messageId));
  
  const allParts = await db.query.participants.findMany({ where: eq(participants.chatId, chatId) });
  wsManager.sendToUsers(allParts.map(p => p.userId), {
    type: "message_reaction",
    chatId,
    messageId,
    reactions,
    userId,
    emoji
  });
  
  res.json(reactions);
});

router.post("/chats/:chatId/read", requireAuth, async (req: AuthRequest, res: Response) => {
  const { chatId } = req.params;
  const userId = req.user!.uid;
  
  await db.update(participants)
    .set({ lastReadAt: new Date() })
    .where(and(eq(participants.chatId, chatId), eq(participants.userId, userId)));
    
  // Notify sender of last message (rough implementation of read receipts)
  const allParts = await db.query.participants.findMany({ where: eq(participants.chatId, chatId) });
  wsManager.sendToUsers(allParts.map(p => p.userId), {
    type: "message_status",
    chatId,
    status: "read"
  });
  
  res.json({ success: true });
});

// Push endpoints
router.get("/push/vapid-public-key", (req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

router.post("/push/subscribe", requireAuth, async (req: AuthRequest, res: Response) => {
  const { subscription, device } = req.body;
  await savePushSubscription(req.user!.uid, subscription, device, req.headers["user-agent"]);
  res.json({ success: true });
});

router.post("/push/unsubscribe", requireAuth, async (req: AuthRequest, res: Response) => {
  const { endpoint } = req.body;
  await removePushSubscription(req.user!.uid, endpoint);
  res.json({ success: true });
});

router.post("/push/test", requireAuth, async (req: AuthRequest, res: Response) => {
  await sendPushToUsers([req.user!.uid], {
    title: "Тестовое уведомление",
    body: "Всё работает отлично!"
  });
  res.json({ success: true });
});

