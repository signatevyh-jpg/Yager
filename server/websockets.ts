import { WebSocket } from "ws";

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
