# Security

## Reporting

Report a vulnerability privately:
[open a security advisory](https://github.com/flexeykinDev/dbd-perk-randomizer/security/advisories/new).

Please don't open a public issue for something exploitable. Expect a reply
within a few days. This is a hobby project with one maintainer, so there is no
bounty.

## What this project is

A static site on GitHub Pages. There are no accounts, no logins, no analytics,
and no server of our own. Almost everything runs in your browser and is stored
there.

One external service is used, a Firebase Realtime Database, for two things:

- **The OBS overlay.** The main tab publishes your current build under a
  random 8-character room code so the overlay, which OBS runs in a separate
  browser profile, can read it. The code is the capability: anyone who knows
  it can read and overwrite that one room. Room codes cannot be listed.
- **The Daily Challenge counter.** One anonymous number per UTC day, which can
  only go up by one per write. No per-visitor record exists.

The Firebase web config in `lib/firebase.ts` is public on purpose. It is not a
secret, and access is restricted by the database rules, which are in the
README.

## Worth knowing

- A room code is not a password. If you show your OBS overlay URL on stream,
  someone can change what that overlay displays. Generating a new one is a
  matter of clearing the site's storage for your browser.
- Builds published to a room are just a build: role, language, perk slugs and
  a timestamp. Nothing identifies you.

## Out of scope

- Reports produced by a scanner with no working example.
- Missing headers that a static GitHub Pages site cannot set.
- The public Firebase web config, on its own.
- Anything about Dead by Daylight itself. Report that to Behaviour
  Interactive.
