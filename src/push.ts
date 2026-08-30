import webpush from "web-push";
import { db } from "./db/index.ts";
import { pushSubscriptions } from "./db/schema.ts";
import { eq } from "drizzle-orm";

let vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY || "",
  privateKey: process.env.VAPID_PRIVATE_KEY || "",
};

if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
  vapidKeys = webpush.generateVAPIDKeys();
}

webpush.setVapidDetails(
  "mailto:support@yager.app",
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

export const getVapidPublicKey = () => vapidKeys.publicKey;

export async function savePushSubscription(userId: string, sub: webpush.PushSubscription, device?: string, userAgent?: string) {
  await db.insert(pushSubscriptions).values({
    userId,
    endpoint: sub.endpoint,
    subscription: sub as any,
    device,
    userAgent
  });
}

export async function removePushSubscription(userId: string, endpoint: string) {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function sendPushToUsers(
  userIds: string[],
  notificationData: {
    title: string;
    body: string;
    icon?: string;
    badge?: string;
    tag?: string;
    data?: Record<string, unknown>;
  }
) {
  const payloadString = JSON.stringify({
    title: notificationData.title,
    body: notificationData.body,
    icon: notificationData.icon || "/icons/icon-192.png",
    badge: notificationData.badge || "/icons/icon-192.png",
    tag: notificationData.tag || "yager-notification",
    data: notificationData.data || { url: "/" },
  });

  for (const uid of userIds) {
    const userSubs = await db.query.pushSubscriptions.findMany({
      where: (ps, { eq }) => eq(ps.userId, uid)
    });
    
    for (const storedSub of userSubs) {
      try {
        await webpush.sendNotification(storedSub.subscription as any, payloadString);
      } catch (err: any) {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, storedSub.endpoint));
        }
      }
    }
  }
}
