interface WebSocketMessage {
  type: 'error' | 'text';
  body: any;
}

export namespace WebSocket {
  type Message = ErrorMessage | TextMessage;

  interface ErrorMessage extends WebSocketMessage {
    type: 'error';
    body: string;
  }

  interface TextMessage extends WebSocketMessage {
    type: 'text';
    body: string;
  }
}
