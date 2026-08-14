# DBD Perk Randomizer

Рандомайзер перков Dead by Daylight. TypeScript + React + Next.js (App
Router) + Tailwind CSS. Раньше жил как раздел [Vortex
Hub](https://github.com/flexeykinDev/Vortex-Hub), теперь отдельный проект.

**Живой сайт:** https://flexeykindev.github.io/dbd-perk-randomizer/

## Что это

Генератор случайного билда из 0–4 перков выжившего/убийцы, с переключением
языка EN/RU, копированием названия перка в буфер обмена по клику,
исключением перков из пула, шэрингом билда по ссылке и режимом Battle
Royale (скопированные перки навсегда выбывают из пула, пока не закончатся
все).

## Перки — без хардкода

Перки живут в `data/perks.json` — файле, который генерирует скрапер:

```bash
npm run scrape:perks
```

Скрипт (`scripts/scrape-perks.ts`) забирает актуальный список перков, их
описания и портреты персонажей с [официальной wiki Dead by
Daylight](https://deadbydaylight.fandom.com/wiki/Perks) через MediaWiki
API, скачивает и конвертирует иконки/портреты в `public/perks/` и
`public/characters/`, и подмешивает русские названия из
`data/translations.ru.json`.

Раз в неделю это происходит автоматически — GitHub Action
(`.github/workflows/update-perks.yml`) прогоняет скрапер и открывает PR с
изменениями, если что-то поменялось.

## Разработка

```bash
npm install
npm run dev       # http://localhost:3000
npm run lint
npm run build      # статический экспорт в out/
npm run test:e2e   # Playwright smoke tests
```

## Деплой

Сайт собирается как статический экспорт (`output: 'export'`) и
публикуется на GitHub Pages через `.github/workflows/deploy.yml` при
каждом пуше в `main`.

## Стек

Next.js · TypeScript · React · Tailwind CSS · Framer Motion ·
lucide-react · cheerio + sharp (скрапер)
