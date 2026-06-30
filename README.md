# Renovator proxy-feed

YML-фид объявлений СК «Реноватор» для B24U. Источник — Avito API (`core/v1/items`) по OAuth-ключам клиента.
Раздача: GitHub Pages (`feed.xml`). Auto-rebuild: каждые 6 ч (GitHub Actions cron).

Категории Вакансии (111) и Резюме (112) исключены — не объекты продажи.
Сборка: `RENOVATOR_AVITO_CLIENT_ID/SECRET/USER_ID` в env → `npm run build` → `public/feed.xml`.
Ключи в проде — в Settings → Secrets and variables → Actions.

Статус-фильтр: по умолчанию `all` (все объявления аккаунта). После переподнятия объявлений
переключить на `--status active`, чтобы бот предлагал только живые объекты.
