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
2. Выполните `supabase/schema.sql` в SQL Editor.
3. Скопируйте `.env.example` в `.env.local` и добавьте Project URL и Publishable key.
4. Для Stripe webhook добавьте Service role key только в серверные переменные окружения.

## Stripe

Создайте recurring Price, укажите его как `STRIPE_PRICE_ID`, затем добавьте webhook:

`https://ВАШ-ДОМЕН/api/stripe/webhook`

События: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.

## Vercel

Импортируйте GitHub-репозиторий в Vercel, добавьте переменные из `.env.example` для Production и Preview, затем выполните deploy.

Никогда не публикуйте `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` или `STRIPE_WEBHOOK_SECRET` в Git.
