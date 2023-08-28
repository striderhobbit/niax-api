import 'express-session';

declare module 'express-session' {
  interface SessionData {
    table: {
      token: string;
    };
  }
}
