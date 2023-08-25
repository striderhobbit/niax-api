interface WebSocketMessage {
  type: 'text';
  body: any;
}

export namespace WebSocket {
  interface TextMessage extends WebSocketMessage {
    type: 'text';
    subType: 'error' | 'info' | 'warning';
    body: string;
  }

  type Message = TextMessage;
}
