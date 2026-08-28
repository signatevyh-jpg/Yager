import webpush from "web-push";

export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  avatar?: string | null;
  bio?: string;
  passwordHash: string;
  createdAt: string;
}

export interface ChatRecord {
  id: string;
  isGroup: boolean;
  name: string | null;
  avatar?: string | null;
  createdAt: string;
}

export interface ChatParticipantRecord {
  id: string;
  chatId: string;
  userId: string;
  lastReadAt: string;
}

export interface MessageRecord {
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
  replyTo?: {
    id: string;
    senderName: string;
    text: string;
    mediaType?: string;
  };
  forwardedFrom?: {
    senderName: string;
    chatName?: string;
  };
  reactions?: Record<string, string[]>;
  isEdited?: boolean;
  editedAt?: string;
}

export interface StoredSubscription {
  subscription: webpush.PushSubscription;
  device?: string;
  userAgent?: string;
  createdAt: string;
}
