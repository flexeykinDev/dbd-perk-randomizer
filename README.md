# DBD Perk Randomizer

[![CI](https://github.com/flexeykinDev/dbd-perk-randomizer/actions/workflows/ci.yml/badge.svg)](https://github.com/flexeykinDev/dbd-perk-randomizer/actions/workflows/ci.yml)
[![Deploy to GitHub Pages](https://github.com/flexeykinDev/dbd-perk-randomizer/actions/workflows/deploy.yml/badge.svg)](https://github.com/flexeykinDev/dbd-perk-randomizer/actions/workflows/deploy.yml)
[![Update DBD perk and loadout data](https://github.com/flexeykinDev/dbd-perk-randomizer/actions/workflows/update-perks.yml/badge.svg)](https://github.com/flexeykinDev/dbd-perk-randomizer/actions/workflows/update-perks.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

**🇬🇧 Reading the English version · 🇷🇺 [Читать по-русски](README.ru.md)**

A **Dead by Daylight** perk and loadout randomizer that never goes
stale — the full list of perks, items, add-ons, and offerings is
scraped straight from the official wiki, not hardcoded by hand. It used
to live as a section of [Vortex
Hub](https://github.com/flexeykinDev/Vortex-Hub), now it's its own
project.

**🔗 Live site:** https://flexeykindev.github.io/dbd-perk-randomizer/

## Contents

- [Screenshots](#screenshots)
- [Features](#features)
- [Battle Royale](#battle-royale)
- [Full Loadout](#full-loadout)
- [Loadout localization](#loadout-localization-items-add-ons-offerings)
- [Random Character](#random-character)
- [OBS Overlay](#obs-overlay)
- [Perks — no hardcoding](#perks--no-hardcoding)
- [Development](#development)
- [Firebase](#firebase-for-syncing-the-obs-overlay-across-browser-profiles)
- [Contributing](#contributing)
- [Deployment](#deployment)
- [Stack](#stack)
- [License](#license)

## Screenshots

<!-- prettier-ignore -->
| | |
|---|---|
| **Survivor build** | **Killer loadout + portrait badge** |
| ![Survivor build, dark theme](docs/screenshots/board-dark.png) | ![Killer loadout with the killer's portrait on the Power icon](docs/screenshots/loadout-killer-dark.png) |
| **Character picker** | **Manage the perk pool** |
| ![Character picker modal](docs/screenshots/character-picker.png) | ![Manage the perk pool](docs/screenshots/manage-pool.png) |
| **Perk card** | **Roll statistics** |
| ![Perk card with description](docs/screenshots/perk-modal.png) | ![Roll statistics](docs/screenshots/stats.png) |
| **Light theme** | |
| ![Light theme](docs/screenshots/board-light.png) | |

## Features

- 🎲 A random build of 0–4 survivor/killer perks + a separate **Full
  Loadout** mode (item/Power, add-ons, offering)
- 🧑 Pick a specific character — guarantees their teachables (Perks
  mode) or decides whose Power gets rolled (Loadout mode, killer)
- 🌍 EN/RU language switch — every name and description is pulled from
  the official wikis, not translated by hand
- 🔍 Flexible pool management: search, tags, sorting, favorites, bulk
  enable/disable
- 🔗 Share a build via a compact link, a deterministic Daily Challenge,
  or your own custom seed
- 🖼️ Export a build as an image (standard layout and a vertical
  "story" variant)
- 📺 An OBS overlay with live sync via `BroadcastChannel` + Firebase,
  fully configurable through the link's own query params
- 💬 Control rerolls from Twitch chat (`!reroll`, `!paste`) with
  flexible permission tiers
- ⚔️ **Battle Royale** mode — builds get eliminated from the pool
  until none are left
- 📊 Local roll statistics and a **History** of your last 20 builds
  (both Perks and Loadout) you can reopen any time
- 📲 PWA — installable, works offline

If you exclude more perks than a build needs, the site honestly says
there aren't enough perks rather than silently mixing excluded ones
back in.

## Battle Royale

A separate mode: a build that gets copied (or just regenerated —
either counts) is permanently removed from the pool for this session,
until every perk for that role is gone. Progress lives in localStorage
and survives a page reload; the "Start Over" button resets it.

## Full Loadout

The **Loadout** toggle next to **Perks** is a second roll mode
alongside perks: an item + 2 add-ons + an offering for survivors, 2
add-ons (for the rolled killer) + an offering for killers (DBD killers
don't carry an item — the UI shows their Power icon instead, with the
killer's own portrait riding along as a small badge on top). Each slot
(Item/Add-ons/Offering) toggles on and off independently. Cards are
laid out the way the game's own inventory does — columns of
"Item/Power → Add-ons → Offering" instead of a generic grid like perks
get.

The mode is fully compatible with seeds (Daily Challenge and a custom
seed give the same loadout to everyone who opens that link), Battle
Royale (elimination is shared between perks and loadout — same
progress pool), and the OBS overlay (a rolled loadout is mirrored to
the overlay too, as the same cards). An item/add-on/offering card
shows its description with the same "Core Effect/Full Text" toggle
perks get (see [Loadout
localization](#loadout-localization-items-add-ons-offerings) below).

The data (`data/items.json`, `data/addons.json`,
`data/offerings.json`, `data/killer-power-icons.json`) is also
generated by a scraper and refreshed by the same weekly Action as
perks:

```bash
npm run scrape:loadout
```

`scripts/scrape-loadout.ts` fetches the
[Items](https://deadbydaylight.fandom.com/wiki/Items),
[Add-ons](https://deadbydaylight.fandom.com/wiki/Add-ons), and
[Offerings](https://deadbydaylight.fandom.com/wiki/Offerings) pages via
the MediaWiki API, resolves which killer each Power add-on group
belongs to via the wiki's own redirects (not a hardcoded list — so a
new killer gets picked up automatically, no script changes needed),
and separately visits each killer's own character page for their Power
icon (the "Power:" heading on that page).

Items in the "map/event-only" category (Eye of Vecna, Lament
Configuration, Keycard, etc. — flagged "Limited Item" on the wiki)
never make it into the pool: a player never picks these themselves,
they spawn in a trial per that chapter's own game scenario, so the
randomizer can't honestly offer them as a loadout choice.

Scraped data isn't always the final word: when a specific
item's/add-on's own Fandom wiki page is temporarily broken (e.g.
Fandom's own description template errored out right after a patch
shipped) or its icon hasn't been uploaded yet,
`scripts/scrape-loadout.ts` can patch in a fix from another source
(e.g. [deadbydaylight.wiki.gg](https://deadbydaylight.wiki.gg)) via a
small map of known exceptions in the script itself — instead of
silently showing a broken image or the template's own error text.

## Loadout localization (items, add-ons, offerings)

Same as perks, Russian names and descriptions are pulled from the
[Russian wiki](https://dead-by-daylight.fandom.com/ru/) instead of
being translated by hand — but that took three scripts instead of one,
because the wiki lays these three categories out differently:

```bash
npm run sync:loadout-localization   # RU names for items and offerings
npm run sync:loadout-descriptions   # RU descriptions for items and offerings
npm run sync:loadout-addons         # RU names and descriptions for add-ons (all 795)
npm run scrape:loadout              # bakes it all into data/*.json
```

- **Items and offerings** — each has its own wiki page, like perks:
  `sync-loadout-localization.ts` looks up the RU name via
  `action=opensearch` and checks the match against a category
  ("Категория:Предметы" / "Категория:Подношения…"),
  `sync-loadout-descriptions.ts` then pulls the description from that
  same page. Items and offerings use different page markup (a
  "Особенности" section on items, "Использование" on offerings, and
  some items have no dedicated section at all — the description sits
  right after the infobox) — the script tries both shapes instead of
  assuming one layout fits everyone.
- **Add-ons** — there's no per-add-on page: the wiki groups them by
  item/killer power onto one combined page (e.g. "Медвежий капкан
  (улучшения)" — every Trapper add-on at once), the same way the
  English Add-ons page is laid out. So `sync-loadout-addons.ts` doesn't
  look each add-on up individually — it reads all ~50 combined pages
  (the list itself comes from "Категория:Улучшения", no hardcoded
  killer list) and matches each table row to the right add-on by the
  English name the wiki writes right next to the Russian one
  ("Кровавая пружина(англ. Bloody Coil)") — not by row order or any
  other guess that could silently mix up one killer's add-on with
  another's.

Add-on matching currently covers ~91% (mostly the newest killers, whose
wiki page group doesn't exist yet, account for the rest) — the missing
ones show English text with an honest note on the card instead of
breaking.

## Random Character

The **Choose Character** button (next to the theme filter/loadout slot
toggles) opens a modal with search and a portrait grid of every
character for the current role — pick a specific one, hit **Random**
right inside the modal, or clear the selection. The character list
comes from the same data perks themselves use (`Perk.character`), no
separate hardcoded list.

- **In Perks mode:** the **Guarantee teachables** toggle, which shows
  up next to the portrait, guarantees the selected character's own
  perks make it into the build (as long as they're not excluded from
  the pool) — the rest of the slots fill in randomly as usual.
- **In Loadout mode, for killers:** the character choice itself *is*
  the result — it decides whose Power add-ons get rolled, instead of
  an internal random pick. The portrait and Power in the HUD always
  match (the portrait rides along as a small badge on the Power icon).
  The pool management panel also narrows down to that killer's own
  add-ons once one is picked, instead of showing all ~750 add-ons at
  once. For survivors, items/add-ons aren't tied to a specific
  character (same as in the game itself), so there it's purely a
  visual choice.

## OBS Overlay

The **OBS Overlay** button opens a modal with a transparent link like
`.../#/obs` — add it as a **Browser** source in OBS, and it'll show
the same cards (perks or loadout, depending on the main tab's current
mode) in real time as whatever's on the main site (synced via
`BroadcastChannel` + localStorage locally, and via Firebase Realtime
Database across different browser profiles — see `lib/obs-sync.ts` and
the [Firebase](#firebase-for-syncing-the-obs-overlay-across-browser-profiles)
section below). The modal shows a live preview right above the
settings — you can drag each icon anywhere on the canvas (positions
save right into the URL) — and it's configured entirely through the
link's own query params, so everything's encoded in the URL itself:

| Param | Values | Default | What it does |
|---|---|---|---|
| `scale` | `50`–`200` | `135` | Card size, % (dragged via the slider in the modal) |
| `nameScale` | `100`–`300` | `170` | Extra width for the name label box, % |
| `names` | `1` / `0` | `1` | Show the card's name under the icon |
| `bg` | `transparent` / `dark` | `transparent` | Background — transparent (for OBS) or a dark backdrop (for previewing outside OBS) |
| `pos` | `x1,y1,x2,y2,…` (% of canvas) | — (default centered row) | Icon positions, set by dragging in the preview |

The modal builds the link itself from whatever you've picked — no need
to hand-edit the URL. Three ready-made style presets (Compact/
Standard/Roomy) set canvas size, card size, and name width in one
click; the "Custom" tab gives precise control over every parameter.
Links saved before the slider existed (with the old `size=sm/md/lg`
param) still keep working too — they just get converted to an
equivalent `scale`.

Want to show both perks and loadout in OBS at once? The simplest way
is two separate **Browser** sources: one tab of the main site in Perks
mode, another in Loadout mode, each with its own overlay `room` code
(the modal creates one automatically the first time it's opened).

Same place — reroll and paste-a-build settings for Twitch chat (who
can use commands: everyone / subs+VIPs only / mods only, a custom
command, a custom cooldown instead of the fixed 4 seconds), plus a
built-in constructor for preparing a `!paste` command by hand ahead of
time.

## Perks — no hardcoding

Perks live in `data/perks.json` — a file the scraper generates:

```bash
npm run scrape:perks
```

The script (`scripts/scrape-perks.ts`) fetches the current perk list,
their descriptions, and character portraits from the [official Dead by
Daylight wiki](https://deadbydaylight.fandom.com/wiki/Perks) via the
MediaWiki API, downloads and converts icons/portraits into
`public/perks/` and `public/characters/`, and bakes in the Russian
names/descriptions from `data/translations.ru.json` and
`data/description-translations.ru.json`. Downloaded icons are cached
by the actual source URL on the wiki (`data/icon-sources.json` /
`data/loadout-icon-sources.json`) — not just "a file already exists,"
but specifically "the source hasn't changed" — so an icon redesign on
the wiki gets picked up on the next run instead of going unnoticed
forever.

### Auto-updating when new perks ship (DLC/patch)

Nothing to touch by hand — once a week (Mondays, 06:00 UTC), the
**Update DBD perk and loadout data** GitHub Action runs both scrapers
(perks and loadout) and, if anything changed on the wiki, opens a
single PR with the icon/name/description diff for review.

If a new perk just shipped and you don't want to wait for Monday, run
the same workflow by hand:

1. The repo's **Actions** tab → the **Update DBD perk and loadout
   data** workflow.
2. The **Run workflow** button (this is `workflow_dispatch`, fires on
   click, no waiting on the schedule).
3. A PR titled `auto/update-perks` shows up in 1–2 minutes — check the
   diff to confirm icons/names came through correctly, then merge it.
4. Merging into `main` triggers **Deploy to GitHub Pages** on its own
   — the site updates in 2–3 minutes, no manual push/deploy needed.

If a new perk has no hand-authored Russian translation yet in
`data/translations.ru.json` / `data/description-translations.ru.json`,
it still shows up on the site — just with an English description and
an auto-generated (not hand-translated) short summary, until a
translation lands in a separate PR.

### Refreshing Russian perk names

Names in `data/translations.ru.json` can be typed by hand, or pulled
from the official [Russian Dead by Daylight
wiki](https://dead-by-daylight.fandom.com/ru/) (a separate wiki, not a
language variant of the English one — they don't even share a domain):

```bash
npm run sync:localization   # updates data/translations.ru.json
npm run scrape:perks        # bakes them into data/perks.json
```

The script (`scripts/sync-localization.ts`) looks each perk up by its
English name via `action=opensearch` — the wiki resolves it to the
right Russian article on its own — and checks the result against the
official categories (`Категория:Умения Выживших` /
`Категория:Умения Убийц`) before trusting the match. A perk that isn't
found or fails that check keeps its previous translation — the script
never overwrites data with an English fallback unless it has to.

### Refreshing Russian character names and perk descriptions

The same approach (search the wiki + verify the match, rather than
blindly trusting the first result) syncs two more files:

```bash
npm run sync:characters     # updates data/character-translations.ru.json
npm run sync:descriptions   # updates data/description-ru-raw.json
npm run scrape:perks        # bakes it all into data/perks.json
```

- `scripts/sync-characters.ts` — Russian character names. For
  Survivors, the name gets trimmed to the found article's first word
  (pages are titled "First Last"); for Killers, the article's full
  title is used as-is. Wiki service pages (DLC chapter pages, the
  "Survivors"/"Killer" hub pages) get filtered out separately — they
  land in the same category as real character pages but aren't perks
  themselves.
- `scripts/sync-descriptions.ts` — a raw Russian perk description from
  the perk's own wiki page (the "Описание" section). Some descriptions
  on the wiki are built from a template with a placeholder
  (`{процентов}`, `{метров}`, …) and a separate table of per-tier
  values — the script substitutes the computed value itself
  (`20/28/36 метров`). A perk whose page doesn't fit that template
  (several independent stats, non-standard markup) is simply skipped
  and keeps showing its English description — a silently wrong
  translation is worse than an honest fallback.

Both scripts, like `sync-localization.ts`, never overwrite an already
saved translation with a result they aren't confident in — they only
add.

## Development

```bash
npm install
npm run dev       # http://localhost:3000
npm run lint
npm run build      # static export into out/
npm run test:e2e   # Playwright smoke tests
```

### Firebase (for syncing the OBS overlay across browser profiles)

OBS Studio renders a Browser Source in its own isolated Chromium
profile — no cookies, localStorage, or `BroadcastChannel` shared with
the streamer's real browser. So the overlay (`#/obs`) has a second,
network transport on top of the local one: Firebase Realtime Database,
which the main tab publishes the current build to under a random
8-character room code (`?room=XXXXXXXX` in the overlay's own link),
and the overlay reads from — see `lib/obs-sync.ts` and
`lib/firebase.ts`.

**Nothing to configure for ordinary local development** —
`lib/firebase.ts` already ships a working config for the live project,
and `getObsDatabase()` is built so any initialization error (no
network, blocked by an extension, etc.) just returns `null` — the
overlay falls back to the local transport in that case, which already
works fine if you open `#/obs` in a second tab in the same browser.

If you fork the repo and want cross-profile sync to work on your own
deploy (instead of writing into someone else's database):

1. [console.firebase.google.com](https://console.firebase.google.com)
   → **Add project** → **Build → Realtime Database → Create Database**
   (any region, test mode is fine to start).
2. **Project settings → Your apps →** `</>` (Web) → register an app,
   copy the `firebaseConfig` object.
3. Paste it into `lib/firebase.ts` in place of the current one.
4. **Realtime Database → Rules**, paste this and publish:
   ```json
   {
     "rules": {
       ".read": false,
       ".write": false,
       "obs-rooms": {
         "$room": {
           ".read": "$room.length == 8",
           ".write": "$room.length == 8 && newData.hasChildren(['role', 'perks', 'language', 'updatedAt'])"
         }
       }
     }
   }
   ```
   The web app's Firebase config isn't secret (access is restricted by
   these rules, not by hiding the key) — committing it into
   `lib/firebase.ts` is fine.

## Contributing

PRs and issues are welcome.

- Before a PR: `npm run lint`, `npm run build` (includes type
  checking), and `npm run test:e2e` should all pass locally — CI runs
  the same set.
- `data/perks.json`, `data/meta.json`, `data/characters.json`,
  `data/perk-ids.json`, `data/icon-sources.json` are **generated** by
  the scraper (`npm run scrape:perks`) — don't hand-edit them, edits
  get overwritten on the next run. Same goes for `data/items.json`,
  `data/addons.json`, `data/offerings.json`, `data/loadout-meta.json`,
  `data/loadout-ids.json`, `data/killer-power-icons.json`, and
  `data/loadout-icon-sources.json` (`npm run scrape:loadout`).
- `data/translations.ru.json`, `data/character-translations.ru.json`,
  `data/description-translations.ru.json` are the source of truth for
  hand-authored translations — edit them directly (that's expected).
  `data/description-ru-raw.json` is also generated (`npm run
  sync:descriptions`), but as a lower-priority fallback than
  `description-translations.ru.json`.
- Changed the UI — refresh `docs/screenshots/*.png` too: `npm run
  capture:screenshots` (needs `npm run dev` running on port 3000)
  regenerates all of them automatically via Playwright.
- One PR, one topic — makes it much easier to review a screenshot/
  translation diff when it isn't tangled up with unrelated refactoring.

## Deployment

The site builds as a static export (`output: 'export'`) and publishes
to GitHub Pages via `.github/workflows/deploy.yml` automatically on
every push to `main` (including after the scraper's own PR gets
merged, above). It can also be triggered by hand via **Actions →
Deploy to GitHub Pages → Run workflow**, if you need to redeploy
without a new commit.

## Stack

Next.js · TypeScript · React · Tailwind CSS · Framer Motion ·
lucide-react · Firebase Realtime Database · cheerio + sharp (scraper) ·
Playwright (e2e + screenshots)

## License

[MIT](LICENSE) — the code is free to use, modify, and distribute.
Names, descriptions, perk icons, and character portraits are Dead by
Daylight data, © Behaviour Interactive; this site isn't affiliated
with Behaviour Interactive and exists as a fan tool.
