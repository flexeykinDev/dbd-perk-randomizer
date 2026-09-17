# Contributing

Issues and pull requests are welcome. Russian is fine, in issues and in PRs.

## Before a pull request

```bash
npm install
npm run lint
npm run build
npm run test:e2e
```

CI runs the same three. `npm test` alone runs the unit tests if you want a
faster loop.

## Two things that are easy to get wrong

**Generated files.** Everything the scrapers write is overwritten on the next
run, so editing it by hand is lost work:

`data/perks.json`, `data/items.json`, `data/addons.json`,
`data/offerings.json`, the `*-ids` and `*-icon-sources` files,
`data/author.json`, and the icons under `public/`.

These are hand-written and meant to be edited:

`data/translations.ru.json`, `data/character-translations.ru.json`,
`data/overrides/perks.json`, `data/overrides/loadout.json`.

**Screenshots.** If you change the UI, run `npm run capture:screenshots` to
rebuild `docs/screenshots/`. It drives the dev server on port 3000.

## Fixing perk text

The wiki is the source, and it lags behind a patch by a few days. If a perk on
the site is out of date, put the correct text in `data/overrides/perks.json`
and run `npm run scrape:perks` to bake it in. An override stops having any
effect once the wiki catches up, so there is nothing to clean up later.

Use the official patch notes as the source, not another fan site.

## Tests

The e2e suite runs against the static export on port 3100, because the export
is what deploys. The server refuses an export older than the sources, so a
failed build cannot quietly pass old tests.

Tests are split by what actually differs: desktop specs cover behaviour,
`e2e/mobile.spec.ts` covers overflow, tap targets and modal height, and
`e2e/viewports.spec.ts` measures layout from a 360px phone to a 4K TV. Whether
a perk rolls correctly is tested once, not per device.

If you add a test, check it can fail. Break the thing it covers on purpose and
watch it go red, then put it back.

## Style

Match the code around you. Comments explain why something is the way it is,
not what the line does.

## Data and licensing

Perk names, descriptions, icons and portraits belong to Behaviour Interactive.
Don't add art or audio from sources whose licence you cannot point to.
