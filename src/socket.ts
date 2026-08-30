import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import { adminAuth } from "./lib/firebase-admin.ts";

export class WSManager {
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

export const wsManager = new WSManager();

export function setupWebSocket(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (request, socket, head) => {
    try {
      const url = new URL(request.url || "", `http://${request.headers.host}`);
      const token = url.searchParams.get("token");

      if (!token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      let userId: string;
      try {
        const decodedToken = await adminAuth.verifyIdToken(token);
        userId = decodedToken.uid;
      } catch (err) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      (request as any).userId = userId;
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } catch (err) {
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
    }
  });

  wss.on("connection", (ws: WebSocket, req: any) => {
    const userId = req.userId;
    wsManager.connect(userId, ws);
    
    // Broadcast presence online
    wsManager.sendToUsers(
      [userId], // we'd normally send this to all contacts, but for now just basic
      { type: "presence", userId, online: true }
    );

    ws.on("message", (message: string) => {
      try {
        const data = JSON.parse(message);
        if (data.type === "typing") {
          // In a real app we'd resolve chat participants and broadcast
          // For simplicity, we assume data.chatId and just broadcast to participants
        }
      } catch (e) {
        // invalid JSON
      }
    });

    ws.on("close", () => {
      wsManager.disconnect(userId, ws);
      if (!wsManager.isOnline(userId)) {
        // Broadcast presence offline
        wsManager.sendToUsers(
           // would be contacts
          [userId],
          { type: "presence", userId, online: false }
        );
      }
    });
  });

  return wss;
}
