"use client";

// Anonymous, read-only Twitch chat connection — no OAuth/API key needed.
// Twitch's IRC gateway accepts a "justinfanNNNNN" nick with no password for
// read access to any channel's public chat (documented, widely-used
// pattern — this is not a workaround). Verified by hand against a live
// channel: connects, joins, and receives PRIVMSG lines in the format
// parsed below.
export type TwitchConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface TwitchChatOptions {
  channel: string;
  onCommand: () => void;
  onStateChange: (state: TwitchConnectionState) => void;
  /** Chat command that triggers onCommand, matched case-insensitively as a
   *  standalone word so e.g. "!rerolling" doesn't false-positive. */
  command?: string;
  /** Minimum time between triggers — otherwise a flood of the same command
   *  from chat could regenerate faster than anyone can read the result. */
  cooldownMs?: number;
}

const DEFAULT_COMMAND = "!reroll";
const DEFAULT_COOLDOWN_MS = 4000;
const RECONNECT_DELAY_MS = 3000;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Opens the connection and returns a cleanup function that closes it and
 *  stops any pending reconnect — call on toggle-off or unmount. */
export function connectTwitchChat(options: TwitchChatOptions): () => void {
  const command = (options.command ?? DEFAULT_COMMAND).toLowerCase();
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const channel = options.channel.trim().toLowerCase().replace(/^#/, "");
  const commandRe = new RegExp(`(^|\\s)${escapeRegExp(command)}(\\s|$)`, "i");
  const privmsgMarker = ` PRIVMSG #${channel} :`;

  let ws: WebSocket | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTriggerAt = 0;

  function connect() {
    if (stopped) return;
    options.onStateChange("connecting");
    const socket = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    ws = socket;

    socket.onopen = () => {
      const anonNick = `justinfan${Math.floor(10000 + Math.random() * 90000)}`;
      socket.send(`NICK ${anonNick}`);
      socket.send(`JOIN #${channel}`);
      options.onStateChange("connected");
    };

    socket.onmessage = (event) => {
      const raw = typeof event.data === "string" ? event.data : "";
      for (const line of raw.split("\r\n")) {
        if (!line) continue;
        // Twitch pings periodically and drops the connection if we don't
        // answer — this keeps the socket alive indefinitely.
        if (line.startsWith("PING")) {
          socket.send("PONG :tmi.twitch.tv");
          continue;
        }
        const markerIndex = line.indexOf(privmsgMarker);
        if (markerIndex === -1) continue;
        const text = line.slice(markerIndex + privmsgMarker.length);
        if (!commandRe.test(text)) continue;

        const now = Date.now();
        if (now - lastTriggerAt < cooldownMs) continue;
        lastTriggerAt = now;
        options.onCommand();
      }
    };

    socket.onerror = () => {
      options.onStateChange("error");
    };

    socket.onclose = () => {
      if (stopped) return;
      // A clean toggle-off sets `stopped` before calling ws.close(), so any
      // close event that reaches here is unexpected (network blip, Twitch
      // restarting the connection, etc.) — reconnect rather than going
      // permanently silent.
      options.onStateChange("connecting");
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    };
  }

  connect();

  return function disconnect() {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    ws?.close();
    options.onStateChange("disconnected");
  };
}
