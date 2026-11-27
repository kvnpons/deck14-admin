# Deck14 Admin

NestJS MVC app for managing events, liquidation (income/expense/loans/petty cash), and a menu catalogue. Server-rendered with Handlebars, Postgres via Prisma, JWT auth in an httpOnly cookie, Dockerized, and ready for Railway.

## Stack

- NestJS 10 + TypeScript
- Handlebars (`hbs`) for server-rendered views
- PostgreSQL + Prisma
- JWT cookie auth (single env-seeded admin)
- PDFKit for menu PDF export
- Docker + Railway

## Features

- **Auth** — single admin account, credentials read from env (`ADMIN_USERNAME` / `ADMIN_PASSWORD`)
- **Dashboard** — top 10 pending bookings (by event date asc), main fund / income / expense / loans / petty cash, per-event earnings
- **Events** — admin CRUD plus a public Step 1 booking-request form at `/book` (no auth)
- **Liquidation** — record `INCOME` / `EXPENSE` (tied to an event) and `LOAN` / `PETTY_CASH` (tied to an employee name)
- **Menu catalogue** — CRUD across categories (Cocktail, Cocktail Shooter, Beer, Hard Drink, Add-on); export to PDF

## Routes

| Path | Auth | Purpose |
| --- | --- | --- |
| `GET /` | yes | Dashboard |
| `GET /auth/login` `POST /auth/login` `GET /auth/logout` | public | Sign in / out |
| `GET /events` | yes | List events (filter by status) |
| `GET /events/new` `POST /events` | yes | Create event |
| `GET /events/:id` `GET /events/:id/edit` `POST /events/:id` `POST /events/:id/delete` | yes | Show / edit / delete |
| `GET /book` `POST /book` `GET /book/thanks` | **public** | Public Step 1 booking-request form |
| `GET /liquidation` `GET /liquidation/new` `POST /liquidation` `POST /liquidation/:id/delete` | yes | Transactions + employee ledger |
| `GET /menu` `GET /menu/new` `POST /menu` `GET /menu/:id/edit` `POST /menu/:id` `POST /menu/:id/delete` | yes | Menu CRUD |
| `GET /menu/export.pdf` | yes | PDF export |
| `GET /healthz` | public | Health check (used by Railway) |

## Local development

```bash
cp .env.example .env
# edit .env: set ADMIN_USERNAME, ADMIN_PASSWORD, JWT_SECRET, SESSION_SECRET

npm install
docker compose up -d db        # or run your own postgres
npm run prisma:migrate         # creates schema
npm run prisma:seed            # optional sample menu items
npm run start:dev
```

Open <http://localhost:3000> and sign in with your `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

## Run everything in Docker

```bash
docker compose up --build
```

App on `:3000`, Postgres on `:5432`. Migrations run automatically on boot (`prisma migrate deploy`).

## Deploy to Railway

1. Push this repo to GitHub.
2. In Railway, create a new project → **Deploy from GitHub repo**, pick this repo.
3. Add a **Postgres** plugin. Railway will set `DATABASE_URL` automatically.
4. Set the following service variables:
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
   - `JWT_SECRET` (long random string)
   - `JWT_EXPIRES_IN` (e.g. `12h`)
   - `SESSION_SECRET` (long random string)
   - `NODE_ENV=production`
5. `railway.json` is already configured — Railway will build the Dockerfile, run `prisma migrate deploy`, and start the server. Health check path is `/healthz`.

## Project layout

```
src/
  main.ts                 // hbs / session / flash / cookie wiring
  app.module.ts           // global JwtModule + middleware + guard
  health.controller.ts
  prisma/                 // PrismaService
  common/
    decorators/           // @Public(), @CurrentUser()
    guards/               // JwtAuthGuard (global)
    filters/              // AuthExceptionFilter — redirects unauth'd users to /auth/login
    middleware/           // JwtAuthMiddleware (reads cookie), ViewLocalsMiddleware
  auth/                   // env-seeded admin login
  dashboard/              // dashboard aggregates
  events/                 // admin CRUD + public booking form
  liquidation/            // transactions + employee ledger
  menu/                   // menu CRUD + PDFKit export
views/
  partials/               // head, nav, flash, footer
  auth/  dashboard/  events/  liquidation/  menu/  errors/
public/css/style.css      // served at /static/css/style.css
prisma/
  schema.prisma           // Event, Transaction, MenuItem + enums
  seed.ts                 // sample menu items
```

## Notes

- All authenticated routes are protected by a global guard. Mark public routes with `@Public()`.
- Flash messages use `express-session` + `connect-flash`, surfaced via `ViewLocalsMiddleware` as `flashSuccess` / `flashError`.
- The cookie is `httpOnly` + `sameSite=lax` and `secure` only in production.
- The dashboard's "Main fund" is `INCOME − EXPENSE − outstanding LOANs − outstanding PETTY_CASH` (loans/petty cash here are amounts disbursed; if you want to track repayments you can record them as INCOME entries).
