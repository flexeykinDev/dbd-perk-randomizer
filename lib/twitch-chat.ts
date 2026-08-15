"use client";

// Anonymous, read-only Twitch chat connection — no OAuth/API key needed.
// Twitch's IRC gateway accepts a "justinfanNNNNN" nick with no password for
// read access to any channel's public chat (documented, widely-used
// pattern). Requests the `tags` capability so each message line carries
// badge/role info (moderator, VIP, subscriber, broadcaster) — that's what
// permission-gating a command is checked against; Twitch's plain IRC has no
// concept of "donator" on its own (that lives on a separate platform like
// StreamElements/Streamlabs, which would need its own integration), so
// subscriber/VIP is the closest built-in proxy for a "paid supporter" tier.
export type TwitchConnectionState = "disconnected" | "connecting" | "connected" | "error";

/** Who's allowed to trigger a command. Moderators and the broadcaster can
 *  always trigger anything, regardless of the configured tier. */
export type TwitchPermission = "everyone" | "subs_vips" | "mods";

export interface TwitchSenderRoles {
  isBroadcaster: boolean;
  isModerator: boolean;
  isVip: boolean;
  isSubscriber: boolean;
}

export interface TwitchCommand {
  /** Matched case-insensitively as a standalone leading word, e.g. "!reroll"
   *  — "!rerolling" won't match. Whatever follows it (trimmed) is passed to
   *  onTrigger as `args`. */
  trigger: string;
  permission: TwitchPermission;
  cooldownMs: number;
  onTrigger: (args: string, roles: TwitchSenderRoles) => void;
}

export interface TwitchChatOptions {
  channel: string;
  commands: TwitchCommand[];
  onStateChange: (state: TwitchConnectionState) => void;
}

const RECONNECT_DELAY_MS = 3000;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasPermission(roles: TwitchSenderRoles, required: TwitchPermission): boolean {
  if (roles.isBroadcaster || roles.isModerator) return true;
  if (required === "mods") return false;
  if (required === "subs_vips") return roles.isVip || roles.isSubscriber;
  return true; // "everyone"
}

/** IRCv3 message tags look like `@key1=val1;key2=val2 :rest-of-the-line` —
 *  splits that prefix off (if present) and returns both parts. */
function parseTags(line: string): { tags: Record<string, string>; rest: string } {
  if (!line.startsWith("@")) return { tags: {}, rest: line };
  const spaceIndex = line.indexOf(" ");
  if (spaceIndex === -1) return { tags: {}, rest: line };
  const tags: Record<string, string> = {};
  for (const pair of line.slice(1, spaceIndex).split(";")) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) continue;
    tags[pair.slice(0, eqIndex)] = pair.slice(eqIndex + 1);
  }
  return { tags, rest: line.slice(spaceIndex + 1) };
}

function rolesFromTags(tags: Record<string, string>): TwitchSenderRoles {
  const badges = tags.badges ?? "";
  return {
    isBroadcaster: badges.includes("broadcaster/"),
    isModerator: tags.mod === "1",
    isVip: badges.includes("vip/"),
    isSubscriber: tags.subscriber === "1" || badges.includes("subscriber/") || badges.includes("founder/"),
  };
}

/** Opens the connection and returns a cleanup function that closes it and
 *  stops any pending reconnect — call on toggle-off or unmount. */
export function connectTwitchChat(options: TwitchChatOptions): () => void {
  const channel = options.channel.trim().toLowerCase().replace(/^#/, "");
  const privmsgMarker = ` PRIVMSG #${channel} :`;
  const commandMatchers = options.commands.map((command) => ({
    command,
    re: new RegExp(`^${escapeRegExp(command.trigger.toLowerCase())}(?:\\s+(.*))?$`, "i"),
    lastTriggerAt: 0,
  }));

  let ws: WebSocket | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (stopped) return;
    options.onStateChange("connecting");
    const socket = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    ws = socket;

    socket.onopen = () => {
      const anonNick = `justinfan${Math.floor(10000 + Math.random() * 90000)}`;
      socket.send("CAP REQ :twitch.tv/tags");
      socket.send(`NICK ${anonNick}`);
      socket.send(`JOIN #${channel}`);
      options.onStateChange("connected");
    };

    socket.onmessage = (event) => {
      const raw = typeof event.data === "string" ? event.data : "";
      for (const rawLine of raw.split("\r\n")) {
        if (!rawLine) continue;
        if (rawLine.startsWith("PING")) {
          socket.send("PONG :tmi.twitch.tv");
          continue;
        }

        const { tags, rest: line } = parseTags(rawLine);
        const markerIndex = line.indexOf(privmsgMarker);
        if (markerIndex === -1) continue;
        const text = line.slice(markerIndex + privmsgMarker.length).trim();
        const roles = rolesFromTags(tags);

        for (const matcher of commandMatchers) {
          const match = text.match(matcher.re);
          if (!match) continue;
          if (!hasPermission(roles, matcher.command.permission)) continue;
          const now = Date.now();
          if (now - matcher.lastTriggerAt < matcher.command.cooldownMs) continue;
          matcher.lastTriggerAt = now;
          matcher.command.onTrigger(match[1]?.trim() ?? "", roles);
        }
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
