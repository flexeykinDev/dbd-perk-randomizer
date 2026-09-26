"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectTwitchChat,
  type TwitchCommand,
  type TwitchConnectionState,
  type TwitchPermission,
} from "./twitch-chat";
import { safeGet, safeSet } from "./safe-storage";
import {
  closeVote,
  NO_VOTE,
  openVote,
  recordVote,
  type VoteResult,
  type VoteState,
} from "./chat-vote";

// Everything behind "let chat reroll my build": the settings, where they
// persist, and the chat connection they configure.
//
// This was ten pieces of state, eight setters, a hydration block and a
// connection effect scattered through the board component, which is a lot
// of surface for a feature most visitors never turn on. Nothing here is
// presentational — it is settings plus a socket — so it reads far better
// as one unit that owns its own storage than as a tenth of a 2500-line
// component.

const CHANNEL_KEY = "dbd-randomizer:twitch-channel";
const ENABLED_KEY = "dbd-randomizer:twitch-enabled";
const REROLL_COMMAND_KEY = "dbd-randomizer:twitch-reroll-command";
const REROLL_PERMISSION_KEY = "dbd-randomizer:twitch-reroll-permission";
const COOLDOWN_KEY = "dbd-randomizer:twitch-cooldown-sec";
const PASTE_ENABLED_KEY = "dbd-randomizer:twitch-paste-enabled";
const PASTE_COMMAND_KEY = "dbd-randomizer:twitch-paste-command";
const PASTE_PERMISSION_KEY = "dbd-randomizer:twitch-paste-permission";
const VOTE_ENABLED_KEY = "dbd-randomizer:twitch-vote-enabled";
const VOTE_COMMAND_KEY = "dbd-randomizer:twitch-vote-command";
const VOTE_PERMISSION_KEY = "dbd-randomizer:twitch-vote-permission";
const VOTE_DURATION_KEY = "dbd-randomizer:twitch-vote-duration-sec";

export const DEFAULT_TWITCH_REROLL_COMMAND = "!reroll";
export const DEFAULT_TWITCH_PASTE_COMMAND = "!paste";
export const DEFAULT_TWITCH_VOTE_COMMAND = "!vote";
const DEFAULT_COOLDOWN_SEC = 4;
export const MIN_TWITCH_COOLDOWN_SEC = 1;
export const MAX_TWITCH_COOLDOWN_SEC = 300;
/** Long enough for chat to notice and answer, short enough that the stream
 *  is not sitting still waiting for it. */
const DEFAULT_VOTE_DURATION_SEC = 30;
export const MIN_TWITCH_VOTE_SEC = 5;
export const MAX_TWITCH_VOTE_SEC = 300;

const VALID_PERMISSIONS: readonly TwitchPermission[] = [
  "everyone",
  "subs_vips",
  "mods",
];

/** Reads a stored permission, falling back when the value isn't one this
 *  build knows — the setting outlives any particular set of options. */
function loadPermission(key: string, fallback: TwitchPermission): TwitchPermission {
  const stored = safeGet("local", key);
  return VALID_PERMISSIONS.includes(stored as TwitchPermission)
    ? (stored as TwitchPermission)
    : fallback;
}

function loadVoteDurationSec(): number {
  const n = Number(safeGet("local", VOTE_DURATION_KEY));
  return Number.isFinite(n) && n >= MIN_TWITCH_VOTE_SEC && n <= MAX_TWITCH_VOTE_SEC
    ? n
    : DEFAULT_VOTE_DURATION_SEC;
}

function loadCooldownSec(): number {
  const n = Number(safeGet("local", COOLDOWN_KEY));
  return Number.isFinite(n) && n >= MIN_TWITCH_COOLDOWN_SEC && n <= MAX_TWITCH_COOLDOWN_SEC
    ? n
    : DEFAULT_COOLDOWN_SEC;
}

export interface TwitchSettings {
  channel: string;
  enabled: boolean;
  state: TwitchConnectionState;
  rerollCommand: string;
  rerollPermission: TwitchPermission;
  cooldownSec: number;
  pasteEnabled: boolean;
  pasteCommand: string;
  pastePermission: TwitchPermission;
  voteEnabled: boolean;
  voteCommand: string;
  votePermission: TwitchPermission;
  voteDurationSec: number;
  /** The vote currently running, or NO_VOTE. Exposed so the panel can show
   *  it and so chunk 3 can publish the tally to the overlay. */
  vote: VoteState;
  setChannel: (value: string) => void;
  setEnabled: (value: boolean) => void;
  setRerollCommand: (value: string) => void;
  setRerollPermission: (value: TwitchPermission) => void;
  setCooldownSec: (value: number) => void;
  setPasteEnabled: (value: boolean) => void;
  setPasteCommand: (value: string) => void;
  setPastePermission: (value: TwitchPermission) => void;
  setVoteEnabled: (value: boolean) => void;
  setVoteCommand: (value: string) => void;
  setVotePermission: (value: TwitchPermission) => void;
  setVoteDurationSec: (value: number) => void;
}

export function useTwitchSettings({
  mounted,
  onReroll,
  onPaste,
  onVoteEnd,
}: {
  /** Gates both hydration and connecting, so nothing here runs during the
   *  server render or before the client has caught up. */
  mounted: boolean;
  onReroll: () => void;
  onPaste: (argsText: string) => void;
  /** Runs when a vote's timer expires. `winner` is null when nobody voted —
   *  the caller decides what that means rather than this pretending chat
   *  chose the first slot. */
  onVoteEnd?: (result: VoteResult) => void;
}): TwitchSettings {
  const [channel, setChannelState] = useState("");
  const [enabled, setEnabledState] = useState(false);
  const [state, setState] = useState<TwitchConnectionState>("disconnected");
  const [rerollCommand, setRerollCommandState] = useState(DEFAULT_TWITCH_REROLL_COMMAND);
  const [rerollPermission, setRerollPermissionState] =
    useState<TwitchPermission>("everyone");
  const [cooldownSec, setCooldownSecState] = useState(DEFAULT_COOLDOWN_SEC);
  const [pasteEnabled, setPasteEnabledState] = useState(false);
  const [pasteCommand, setPasteCommandState] = useState(DEFAULT_TWITCH_PASTE_COMMAND);
  const [pastePermission, setPastePermissionState] =
    useState<TwitchPermission>("subs_vips");
  const [voteEnabled, setVoteEnabledState] = useState(false);
  const [voteCommand, setVoteCommandState] = useState(DEFAULT_TWITCH_VOTE_COMMAND);
  /* Mods by default, unlike reroll: starting a vote parks the build for half
     a minute and commits the stream to whatever chat says, which is not
     something any passer-by should be able to do on a whim. */
  const [votePermission, setVotePermissionState] = useState<TwitchPermission>("mods");
  const [voteDurationSec, setVoteDurationSecState] = useState(DEFAULT_VOTE_DURATION_SEC);
  const [vote, setVote] = useState<VoteState>(NO_VOTE);

  // Hydrated on mount rather than in useState initialisers: localStorage
  // doesn't exist during the server render, and reading it there would
  // make the first client render disagree with the server's. The one
  // extra render that costs is inherent to SSR-safe persisted state, and
  // is the same trade the board makes for every other saved setting.
  //
  // Gathered into a named function, matching how the board hydrates the
  // rest of its settings — it keeps the whole restore readable as one
  // unit, and keeps react-hooks/set-state-in-effect off a pattern where
  // the cascade it guards against is the entire point.
  useEffect(() => {
    if (!mounted) return;
    function restoreSavedSettings() {
      const savedChannel = safeGet("local", CHANNEL_KEY) ?? "";
      setChannelState(savedChannel);
      // Only reconnect automatically when there is somewhere to connect
      // to — "enabled" with an empty channel just fails on every load.
      if (safeGet("local", ENABLED_KEY) === "1" && savedChannel.trim()) {
        setEnabledState(true);
      }
      setRerollCommandState(
        safeGet("local", REROLL_COMMAND_KEY) || DEFAULT_TWITCH_REROLL_COMMAND,
      );
      setRerollPermissionState(loadPermission(REROLL_PERMISSION_KEY, "everyone"));
      setCooldownSecState(loadCooldownSec());
      setPasteEnabledState(safeGet("local", PASTE_ENABLED_KEY) === "1");
      setPasteCommandState(
        safeGet("local", PASTE_COMMAND_KEY) || DEFAULT_TWITCH_PASTE_COMMAND,
      );
      setPastePermissionState(loadPermission(PASTE_PERMISSION_KEY, "subs_vips"));
      setVoteEnabledState(safeGet("local", VOTE_ENABLED_KEY) === "1");
      setVoteCommandState(
        safeGet("local", VOTE_COMMAND_KEY) || DEFAULT_TWITCH_VOTE_COMMAND,
      );
      setVotePermissionState(loadPermission(VOTE_PERMISSION_KEY, "mods"));
      setVoteDurationSecState(loadVoteDurationSec());
    }
    restoreSavedSettings();
  }, [mounted]);

  // Each setter writes through to storage, so a setting is saved by being
  // changed rather than by a separate effect watching for it.
  const persist = <T,>(
    key: string,
    apply: (value: T) => void,
    encode: (value: T) => string,
  ) => (value: T) => {
    apply(value);
    safeSet("local", key, encode(value));
  };

  const setChannel = persist<string>(CHANNEL_KEY, setChannelState, (v) => v);
  const setEnabled = persist<boolean>(ENABLED_KEY, setEnabledState, (v) => (v ? "1" : "0"));
  const setRerollCommand = persist<string>(REROLL_COMMAND_KEY, setRerollCommandState, (v) => v);
  const setRerollPermission = persist<TwitchPermission>(
    REROLL_PERMISSION_KEY,
    setRerollPermissionState,
    (v) => v,
  );
  const setPasteEnabled = persist<boolean>(
    PASTE_ENABLED_KEY,
    setPasteEnabledState,
    (v) => (v ? "1" : "0"),
  );
  const setPasteCommand = persist<string>(PASTE_COMMAND_KEY, setPasteCommandState, (v) => v);
  const setPastePermission = persist<TwitchPermission>(
    PASTE_PERMISSION_KEY,
    setPastePermissionState,
    (v) => v,
  );
  const setVoteEnabled = persist<boolean>(
    VOTE_ENABLED_KEY,
    setVoteEnabledState,
    (v) => (v ? "1" : "0"),
  );
  const setVoteCommand = persist<string>(VOTE_COMMAND_KEY, setVoteCommandState, (v) => v);
  const setVotePermission = persist<TwitchPermission>(
    VOTE_PERMISSION_KEY,
    setVotePermissionState,
    (v) => v,
  );

  /** Clamped rather than validated: the control is a number input, and
   *  silently correcting an out-of-range value beats refusing it. */
  const setCooldownSec = (seconds: number) => {
    const clamped = Math.min(
      MAX_TWITCH_COOLDOWN_SEC,
      Math.max(MIN_TWITCH_COOLDOWN_SEC, seconds),
    );
    setCooldownSecState(clamped);
    safeSet("local", COOLDOWN_KEY, String(clamped));
  };

  const setVoteDurationSec = (seconds: number) => {
    const clamped = Math.min(MAX_TWITCH_VOTE_SEC, Math.max(MIN_TWITCH_VOTE_SEC, seconds));
    setVoteDurationSecState(clamped);
    safeSet("local", VOTE_DURATION_KEY, String(clamped));
  };

  /* The vote itself.
   *
   * Held in a ref as well as in state, for one specific reason: the chat
   * message handler is baked into the socket by the effect below, and a
   * handler that closed over `vote` would make the vote a dependency of the
   * connection — every single message would tear down the WebSocket and
   * reconnect. The ref is what the handler reads; the state is what the UI
   * renders, and it is only for rendering. */
  const voteRef = useRef<VoteState>(NO_VOTE);
  const voteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Same trick the board uses for regenerate: the callback can change every
  // render without that reaching the socket.
  const onVoteEndRef = useRef(onVoteEnd);
  useEffect(() => {
    onVoteEndRef.current = onVoteEnd;
  }, [onVoteEnd]);

  const finishVote = useCallback(() => {
    voteTimer.current = null;
    const result = closeVote(voteRef.current);
    voteRef.current = NO_VOTE;
    setVote(NO_VOTE);
    onVoteEndRef.current?.(result);
  }, []);

  const startVote = useCallback(
    (durationSec: number) => {
      // A second !vote while one is running restarts it rather than opening
      // a rival: two live votes would split chat between two tallies that
      // neither the streamer nor the viewers can tell apart.
      if (voteTimer.current) clearTimeout(voteTimer.current);
      const ms = durationSec * 1000;
      const opened = openVote(ms, Date.now());
      voteRef.current = opened;
      setVote(opened);
      voteTimer.current = setTimeout(finishVote, ms);
    },
    [finishVote],
  );

  /** Stable on purpose — see voteRef above. Reads the ref, writes both. */
  const handleChatMessage = useCallback((user: string, text: string) => {
    const next = recordVote(voteRef.current, user, text, Date.now());
    // recordVote returns the same object when nothing changed, so an
    // ordinary chat line costs one comparison and no render.
    if (next === voteRef.current) return;
    voteRef.current = next;
    setVote(next);
  }, []);

  // A vote must not outlive the page, or its timer fires into a component
  // that is gone.
  useEffect(() => () => {
    if (voteTimer.current) clearTimeout(voteTimer.current);
  }, []);

  // The connection itself. Rebuilt whenever anything it configures
  // changes, since a command's trigger, permission or cooldown is baked
  // into the handler chat sees.
  useEffect(() => {
    function markDisconnected() {
      setState("disconnected");
    }
    if (!mounted || !enabled || !channel.trim()) {
      markDisconnected();
      return;
    }
    const commands: TwitchCommand[] = [
      {
        trigger: rerollCommand.trim() || DEFAULT_TWITCH_REROLL_COMMAND,
        permission: rerollPermission,
        cooldownMs: cooldownSec * 1000,
        onTrigger: () => onReroll(),
      },
    ];
    if (pasteEnabled) {
      commands.push({
        trigger: pasteCommand.trim() || DEFAULT_TWITCH_PASTE_COMMAND,
        permission: pastePermission,
        cooldownMs: cooldownSec * 1000,
        onTrigger: (args) => onPaste(args),
      });
    }
    if (voteEnabled) {
      commands.push({
        trigger: voteCommand.trim() || DEFAULT_TWITCH_VOTE_COMMAND,
        permission: votePermission,
        cooldownMs: cooldownSec * 1000,
        onTrigger: () => startVote(voteDurationSec),
      });
    }
    return connectTwitchChat({
      channel,
      commands,
      onStateChange: setState,
      // Only while the feature is on: a channel that never votes should not
      // have every line it says routed through a tallier.
      onMessage: voteEnabled ? handleChatMessage : undefined,
    });
  }, [
    mounted,
    enabled,
    channel,
    rerollCommand,
    rerollPermission,
    cooldownSec,
    pasteEnabled,
    pasteCommand,
    pastePermission,
    voteEnabled,
    voteCommand,
    votePermission,
    voteDurationSec,
    startVote,
    handleChatMessage,
    onReroll,
    onPaste,
  ]);

  return {
    channel,
    enabled,
    state,
    rerollCommand,
    rerollPermission,
    cooldownSec,
    pasteEnabled,
    pasteCommand,
    pastePermission,
    setChannel,
    setEnabled,
    setRerollCommand,
    setRerollPermission,
    setCooldownSec,
    setPasteEnabled,
    setPasteCommand,
    setPastePermission,
    voteEnabled,
    voteCommand,
    votePermission,
    voteDurationSec,
    vote,
    setVoteEnabled,
    setVoteCommand,
    setVotePermission,
    setVoteDurationSec,
  };
}
