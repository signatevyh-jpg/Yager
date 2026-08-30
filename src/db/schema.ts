import { relations } from 'drizzle-orm';
import { boolean, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

// Define the 'users' table.
export const users = pgTable('users', {
  id: text('id').primaryKey(), // Firebase Auth UID
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  avatar: text('avatar'),
  bio: text('bio'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Define the 'chats' table.
export const chats = pgTable('chats', {
  id: uuid('id').defaultRandom().primaryKey(),
  isGroup: boolean('is_group').notNull().default(false),
  name: text('name'),
  avatar: text('avatar'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Define the 'participants' table.
export const participants = pgTable('participants', {
  id: uuid('id').defaultRandom().primaryKey(),
  chatId: uuid('chat_id')
    .references(() => chats.id, { onDelete: 'cascade' })
    .notNull(),
  userId: text('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  lastReadAt: timestamp('last_read_at').defaultNow().notNull(),
});

// Define the 'messages' table.
export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  chatId: uuid('chat_id')
    .references(() => chats.id, { onDelete: 'cascade' })
    .notNull(),
  senderId: text('sender_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  text: text('text').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  mediaType: varchar('media_type', { length: 50 }),
  mediaUrl: text('media_url'),
  mediaMeta: jsonb('media_meta'),
  replyTo: jsonb('reply_to'),
  forwardedFrom: jsonb('forwarded_from'),
  reactions: jsonb('reactions'),
  isEdited: boolean('is_edited').default(false).notNull(),
  editedAt: timestamp('edited_at'),
});

// Define the 'push_subscriptions' table.
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  endpoint: text('endpoint').notNull(),
  subscription: jsonb('subscription').notNull(),
  device: text('device'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Define relationships
export const usersRelations = relations(users, ({ many }) => ({
  participants: many(participants),
  messages: many(messages),
  pushSubscriptions: many(pushSubscriptions),
}));

export const chatsRelations = relations(chats, ({ many }) => ({
  participants: many(participants),
  messages: many(messages),
}));

export const participantsRelations = relations(participants, ({ one }) => ({
  chat: one(chats, { fields: [participants.chatId], references: [chats.id] }),
  user: one(users, { fields: [participants.userId], references: [users.id] }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  chat: one(chats, { fields: [messages.chatId], references: [chats.id] }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
}));
