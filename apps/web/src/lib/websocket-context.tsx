import { createContext, useContext, type ReactNode } from "react";

interface WebSocketState {
  connected: boolean;
  connectionHint: string;
}

const WebSocketContext = createContext<WebSocketState>({
  connected: false,
  connectionHint: "Mocked",
});

export function WebSocketProvider({ children }: { children: ReactNode }) {
  return (
    <WebSocketContext.Provider
      value={{ connected: false, connectionHint: "Mock mode" }}
    >
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocketState() {
  return useContext(WebSocketContext);
}
