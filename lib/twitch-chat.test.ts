// The chat command rules, which decide whether a stranger in someone's
// Twitch chat can reroll the build on their live stream. Until
// createChatDispatcher was split out of socket.onmessage none of this was
// reachable without a real WebSocket and a real chat, so it had never been
// tested at all.
//
// Lines below are shaped like the real thing — IRCv3 tags, the
// nick!user@host prefix, the `PRIVMSG #channel :` marker — because the
// parsing is all string surgery on that exact layout, and a simplified
// stand-in would only prove that the parser handles the simplification.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createChatDispatcher,
  hasPermission,
  type TwitchCommand,
  type TwitchSenderRoles,
} from "./twitch-chat";

const CHANNEL = "flexeykin";

/** One real PRIVMSG line. `tags` is the IRCv3 prefix, verbatim. */
function line(tags: string, text: string, channel = CHANNEL): string {
  const prefix = tags ? `@${tags} ` : "";
  return `${prefix}:viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #${channel} :${text}`;
}

const VIEWER = "badge-info=;badges=;color=;display-name=Viewer;mod=0;subscriber=0";
const VIP = "badge-info=;badges=vip/1;color=;display-name=Viewer;mod=0;subscriber=0";
const SUB = "badge-info=subscriber/9;badges=subscriber/9;display-name=Viewer;mod=0;subscriber=1";
const FOUNDER = "badge-info=subscriber/24;badges=founder/0;display-name=Viewer;mod=0;subscriber=0";
const MOD = "badge-info=;badges=moderator/1;display-name=Viewer;mod=1;subscriber=0";
const BROADCASTER = "badge-info=;badges=broadcaster/1;display-name=Viewer;mod=0;subscriber=0";

/** A dispatcher plus the log of what it triggered, and a clock you move by
 *  hand so a cooldown can be tested in no time at all. */
function harness(overrides: Partial<TwitchCommand> = {}, extra: TwitchCommand[] = []) {
  const triggered: Array<{ args: string; roles: TwitchSenderRoles }> = [];
  let clock = 0;
  const command: TwitchCommand = {
    trigger: "!reroll",
    permission: "everyone",
    cooldownMs: 0,
    onTrigger: (args, roles) => triggered.push({ args, roles }),
    ...overrides,
  };
  const handle = createChatDispatcher(CHANNEL, [command, ...extra], () => clock);
  return {
    triggered,
    handle,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

test("a plain viewer's command is dispatched with its argument", () => {
  const { handle, triggered } = harness();
  assert.equal(handle(line(VIEWER, "!reroll 3")), "triggered");
  assert.equal(triggered.length, 1);
  assert.equal(triggered[0].args, "3");
});

test("a command with no argument passes an empty string, not undefined", () => {
  const { handle, triggered } = harness();
  handle(line(VIEWER, "!reroll"));
  assert.equal(triggered[0].args, "");
});

test("the trigger matches as a whole word, so !rerolling is not a reroll", () => {
  const { handle, triggered } = harness();
  assert.equal(handle(line(VIEWER, "!rerolling")), "no-match");
  assert.equal(triggered.length, 0);
});

test("a trigger mid-sentence does not fire — it has to lead the message", () => {
  const { handle } = harness();
  assert.equal(handle(line(VIEWER, "maybe you should !reroll")), "no-match");
});

test("matching ignores case in both the trigger and the message", () => {
  const { handle } = harness({ trigger: "!ReRoll" });
  assert.equal(handle(line(VIEWER, "!REROLL")), "triggered");
});

test("a trigger containing regex metacharacters is matched literally", () => {
  // Unescaped, "!re+roll" would match "!reeeroll" and not "!re+roll".
  const { handle } = harness({ trigger: "!re+roll" });
  assert.equal(handle(line(VIEWER, "!reeeroll")), "no-match");
  assert.equal(handle(line(VIEWER, "!re+roll")), "triggered");
});

test("subs_vips refuses a plain viewer", () => {
  const { handle, triggered } = harness({ permission: "subs_vips" });
  assert.equal(handle(line(VIEWER, "!reroll")), "denied");
  assert.equal(triggered.length, 0);
});

test("subs_vips accepts a VIP, a subscriber, and a founder", () => {
  for (const tags of [VIP, SUB, FOUNDER]) {
    const { handle } = harness({ permission: "subs_vips" });
    assert.equal(handle(line(tags, "!reroll")), "triggered", tags);
  }
});

test("mods refuses even a VIP and a subscriber", () => {
  for (const tags of [VIP, SUB]) {
    const { handle } = harness({ permission: "mods" });
    assert.equal(handle(line(tags, "!reroll")), "denied", tags);
  }
});

test("a moderator and the broadcaster get past every tier", () => {
  for (const permission of ["everyone", "subs_vips", "mods"] as const) {
    for (const tags of [MOD, BROADCASTER]) {
      const { handle } = harness({ permission });
      assert.equal(handle(line(tags, "!reroll")), "triggered", `${permission}/${tags}`);
    }
  }
});

test("roles come from the tag prefix, so a viewer cannot type their way to mod", () => {
  const { handle } = harness({ permission: "mods" });
  // The badge text appears in the *message*, which is where a viewer can
  // put anything they like.
  assert.equal(handle(line(VIEWER, "!reroll badges=broadcaster/1;mod=1")), "denied");
});

test("a line with no tag prefix at all is treated as a plain viewer", () => {
  const open = harness();
  assert.equal(open.handle(line("", "!reroll")), "triggered");
  const gated = harness({ permission: "subs_vips" });
  assert.equal(gated.handle(line("", "!reroll")), "denied");
});

test("a command in a different channel is ignored", () => {
  const { handle, triggered } = harness();
  assert.equal(handle(line(MOD, "!reroll", "someone-else")), "ignored");
  assert.equal(triggered.length, 0);
});

test("a cooldown blocks the second call and releases exactly when it expires", () => {
  const { handle, advance, triggered } = harness({ cooldownMs: 10_000 });
  assert.equal(handle(line(VIEWER, "!reroll")), "triggered");
  advance(9_999);
  assert.equal(handle(line(VIEWER, "!reroll")), "cooling-down");
  advance(1);
  assert.equal(handle(line(VIEWER, "!reroll")), "triggered");
  assert.equal(triggered.length, 2);
});

test("a refused call does not restart the cooldown", () => {
  // Otherwise chat can hold a command hostage forever by spamming it.
  const { handle, advance } = harness({ cooldownMs: 10_000 });
  handle(line(VIEWER, "!reroll"));
  advance(5_000);
  handle(line(VIEWER, "!reroll")); // refused
  advance(5_000);
  assert.equal(handle(line(VIEWER, "!reroll")), "triggered");
});

test("cooldowns are per command, not shared", () => {
  const second: TwitchCommand = {
    trigger: "!build",
    permission: "everyone",
    cooldownMs: 10_000,
    onTrigger: () => {},
  };
  const { handle } = harness({ cooldownMs: 10_000 }, [second]);
  assert.equal(handle(line(VIEWER, "!reroll")), "triggered");
  assert.equal(handle(line(VIEWER, "!build")), "triggered");
});

test("a keepalive asks for a pong and nothing else", () => {
  const { handle, triggered } = harness();
  assert.equal(handle("PING :tmi.twitch.tv"), "pong");
  assert.equal(triggered.length, 0);
});

test("server chatter and blank lines are ignored", () => {
  const { handle } = harness();
  assert.equal(handle(""), "ignored");
  assert.equal(handle(":tmi.twitch.tv 001 justinfan12345 :Welcome, GLHF!"), "ignored");
  assert.equal(handle(":justinfan1!justinfan1@justinfan1.tmi.twitch.tv JOIN #flexeykin"), "ignored");
});

test("hasPermission ranks the tiers the way the settings UI describes them", () => {
  const nobody: TwitchSenderRoles = {
    isBroadcaster: false,
    isModerator: false,
    isVip: false,
    isSubscriber: false,
  };
  assert.equal(hasPermission(nobody, "everyone"), true);
  assert.equal(hasPermission(nobody, "subs_vips"), false);
  assert.equal(hasPermission(nobody, "mods"), false);
  assert.equal(hasPermission({ ...nobody, isVip: true }, "subs_vips"), true);
  assert.equal(hasPermission({ ...nobody, isVip: true }, "mods"), false);
  assert.equal(hasPermission({ ...nobody, isModerator: true }, "mods"), true);
});
