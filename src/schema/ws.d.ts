interface WebSocketMessage {
  type: 'text';
  body: any;
}

export namespace WebSocket {
  type Message = TextMessage;

  interface TextMessage extends WebSocketMessage {
    type: 'text';
    body: string;
  }
}
