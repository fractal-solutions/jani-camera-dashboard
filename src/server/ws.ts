type WsClient = { send: (data: string) => void; close: () => void };

export class WsHub {
  private clients = new Set<WsClient>();

  add(client: WsClient) {
    this.clients.add(client);
  }

  remove(client: WsClient) {
    this.clients.delete(client);
  }

  broadcast(event: string, data: unknown) {
    const payload = JSON.stringify({ event, data });
    for (const client of this.clients) {
      try {
        client.send(payload);
      } catch {
        // ignore
      }
    }
  }
}

