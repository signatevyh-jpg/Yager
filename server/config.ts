import webpush from "web-push";

export const PORT = 3000;
export const JWT_SECRET = process.env.JWT_SECRET || "yager-secret-key-development-ai-studio";

// Setup VAPID keys for Web Push Notifications
export let vapidKeys = {
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
