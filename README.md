# DBD Perk Randomizer

[![CI](https://github.com/flexeykinDev/dbd-perk-randomizer/actions/workflows/ci.yml/badge.svg)](https://github.com/flexeykinDev/dbd-perk-randomizer/actions/workflows/ci.yml)
[![Update DBD perk and loadout data](https://github.com/flexeykinDev/dbd-perk-randomizer/actions/workflows/update-perks.yml/badge.svg)](https://github.com/flexeykinDev/dbd-perk-randomizer/actions/workflows/update-perks.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**English · [Русский](README.ru.md)**

A random build generator for **Dead by Daylight**. Perks, items, add-ons and
offerings are scraped from the official wiki on a schedule, so a new chapter
shows up on the site without anyone editing a list.

**https://flexeykindev.github.io/dbd-perk-randomizer/**

<!-- prettier-ignore -->
| | |
|---|---|
| ![Survivor build, dark theme](docs/screenshots/board-dark.png) | ![Killer loadout with the killer's portrait on the Power icon](docs/screenshots/loadout-killer-dark.png) |
| ![Perk card with description](docs/screenshots/perk-modal.png) | ![Manage the perk pool](docs/screenshots/manage-pool.png) |

## What it does

- Rolls 0–4 perks, or a full loadout (item or Power, add-ons, offering).
- Pin a perk to keep it through the next roll; reroll one slot without
  touching the other three.
- Pick a character to guarantee their teachables, or to decide whose Power
  gets rolled.
- Three ways to watch a roll happen: a plain grid, a vortex that deals the
  build as cards, or a slot machine.
- Pool management: search, tags, favourites, bulk enable/disable, and
  filtering add-ons by several killers at once.
- Share a build as a link, export it as an image, or hand it to OBS as a
  browser source.
- Eight preset builds per role, for when 300 perks is too many to choose
  from.
- Daily Challenge (everyone gets the same build on a given UTC day), Battle
  Royale (builds retire as you use them), roll statistics, and a history of
  your last 20.
- EN/RU throughout, names and descriptions taken from the wikis rather than
  translated by hand.
- Installable, and works offline.

## Keyboard

| Key             | Action            |
| --------------- | ----------------- |
| `Space`/`Enter` | Roll a new build  |
| `1`–`4`         | Reroll that slot  |
| `C`             | Copy the build    |
| `S`             | Copy a share link |

Shortcuts stay out of the way while you are typing or a dialog is open, and
never shadow a browser shortcut.

## Where the data comes from

`data/perks.json` and the loadout files are generated, not written:

```bash
npm run scrape:perks
npm run scrape:loadout
```

Both read the wiki through the MediaWiki API and download icons into
`public/`. Icons are cached by their source URL, so a redesigned icon is
picked up on the next run instead of the local copy going stale.

A GitHub Action runs both every Monday and opens a PR if anything changed.
To pull a new chapter in sooner, run **Update DBD perk and loadout data**
from the Actions tab; merging the PR it opens deploys the site on its own.

A scrape that comes back with far fewer perks than last time fails instead
of publishing — a wiki outage should not silently empty the pool.

## Development

```bash
npm install
npm run dev        # localhost:3000
npm run lint
npm run build      # static export into out/
npm test           # unit tests
npm run test:e2e   # builds first, then Playwright against the export
```

Two things about the tests are worth knowing.

`test:e2e` builds before it runs, and drives the static export on port 3100
rather than `next dev` — the export is the artifact that actually deploys,
and a dev server left open on 3000 can't be mistaken for it. **If the build
fails, the tests run against a stale `out/` and pass for the wrong reason,**
so never send that build's output to `/dev/null`.

The suite is split by what actually differs: desktop covers behaviour,
`e2e/mobile.spec.ts` covers only overflow, tap targets and modal height, and
`e2e/viewports.spec.ts` measures layout from a 360px phone to a 4K TV.
Whether a perk rolls correctly is tested once, not per device.

## OBS overlay

OBS renders a browser source in its own Chromium profile, with no
`localStorage` or `BroadcastChannel` shared with your real browser. So the
overlay has a second transport: the main tab publishes the build to Firebase
under a random 8-character room code, and the overlay reads it back
(`lib/obs-sync.ts`).

Nothing to configure — `lib/firebase.ts` ships a working config, and if
Firebase is unreachable the local transport still covers a second tab in the
same browser.

If you fork this and want cross-profile sync on your own deploy, create a
Realtime Database, paste your `firebaseConfig` into `lib/firebase.ts`, and
restrict writes to 8-character room codes:

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

A web app's Firebase config is not a secret; access is restricted by those
rules, not by hiding the key.

## Contributing

Issues and PRs are welcome. Run `npm run lint`, `npm run build` and
`npm run test:e2e` first — CI runs the same three.

Two things that are easy to get wrong:

- **Generated files.** Everything the scrapers produce (`data/perks.json`,
  `data/items.json`, `data/addons.json`, `data/offerings.json`, the `*-ids`
  and `*-icon-sources` files, `data/author.json`) is overwritten on the next
  run. The hand-authored translations — `data/translations.ru.json`,
  `data/character-translations.ru.json`,
  `data/description-translations.ru.json` — are meant to be edited directly.
- **Screenshots.** If you change the UI, `npm run capture:screenshots`
  regenerates `docs/screenshots/` (it drives the dev server on port 3000).

## Deployment

A static export, published to GitHub Pages by `.github/workflows/deploy.yml`
on every push to `main`.

## Stack

Next.js · TypeScript · React · Tailwind CSS · Framer Motion · WebGL ·
Firebase Realtime Database · cheerio + sharp for the scrapers · Playwright

## License

[MIT](LICENSE) for the code. Perk names, descriptions, icons and portraits
are Dead by Daylight data, © Behaviour Interactive — this is a fan tool and
is not affiliated with them.
