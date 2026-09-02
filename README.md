# HSE Radar

Полноценное Next.js-приложение для контроля работников, допусков, СИЗ, оборудования и документов.

## Локальный запуск

```bash
npm install
npm run dev
```

Без переменных окружения приложение запускается в demo-режиме и сохраняет CRUD-данные в браузере.

## Supabase

1. Создайте проект Supabase.
2. Выполните `supabase/schema.sql`, затем миграции из `supabase/migrations/` по имени файла.
3. Скопируйте `.env.example` в `.env.local` и добавьте Project URL и Publishable key.
4. Для Stripe webhook добавьте Service role key только в серверные переменные окружения.

## Stripe

Создайте recurring Price, укажите его как `STRIPE_PRICE_ID`, затем добавьте webhook:

`https://ВАШ-ДОМЕН/api/stripe/webhook`

События: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`.

## Kaspi Pay и пробный тариф

Примените `supabase/migrations/20260901_kaspi_trial_admin.sql`, затем добавьте в Vercel официальную ссылку удалённой оплаты как `NEXT_PUBLIC_KASPI_PAY_URL`.

Trial ограничен пятью работниками, пятью выдачами СИЗ, пятью документами и пятью единицами инвентаря. Ограничение работает в интерфейсе и на уровне Supabase trigger.

Kaspi Pay активируется с ручной проверкой: клиент оплачивает по ссылке, отправляет заявку, platform admin сверяет платёж в Kaspi Pay и подтверждает заявку. После подтверждения организация получает `plan=pro` и лимиты снимаются.

Platform admin назначается только вручную после регистрации пользователя:

```sql
insert into public.platform_admins(user_id)
select id from auth.users where email='ADMIN_EMAIL'
on conflict (user_id) do nothing;
```

## Vercel

Импортируйте GitHub-репозиторий в Vercel, добавьте переменные из `.env.example` для Production и Preview, затем выполните deploy.

Никогда не публикуйте `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` или `STRIPE_WEBHOOK_SECRET` в Git.

## Производственная проверка

- `npm run verify` проверяет ESLint и production build.
- `/api/health` используется для внешнего uptime-monitoring.
- Записи не удаляются из интерфейса: они архивируются, а изменения попадают в `audit_events`.
- Документы находятся в приватном bucket и открываются по краткоживущей signed URL.
- Stripe webhook сохраняет идентификаторы событий и безопасно повторяет незавершённую обработку.
- Supabase Database Backups не включают Storage objects: настройте отдельное резервное копирование bucket `hse-documents`.
