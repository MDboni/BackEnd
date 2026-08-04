# MessMate — Backend API

Mess management API built to the *MessMate Industrial Project Blueprint v1.0*.
Express 5 + TypeScript + Prisma 7 + PostgreSQL, membership-scoped RBAC, and an
atomic month-close engine.

## Quick start

```bash
pnpm install
cp .env.example .env          # then fill in DATABASE_URL and the JWT secrets
pnpm prisma migrate dev
pnpm seed                     # optional demo mess with a full month of data
pnpm dev                      # http://localhost:5000
```

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Watch mode via tsx |
| `pnpm build` | `prisma generate` + `tsc` → `dist/` |
| `pnpm start` | Run the compiled build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest (pure calculation + cutoff rules, no database needed) |
| `pnpm seed` | Idempotent demo data |
| `pnpm prisma:studio` | Browse the database |

## Seeded accounts

Password for all: `Messmate123` · invite code `DEMO2026`

`owner@` · `manager@` · `accountant@` · `cook@` · `member1@` · `member2@` — all `@messmate.test`.

`pnpm seed` is a **baseline reset**, not just an insert: it reopens closed periods,
drops their statements and restores passwords, so the API test suite can be run
repeatedly without the database drifting into an unusable state.

## Postman

[`postman/`](postman/) holds a 99-request collection covering every endpoint,
each with a description of what it does, who may call it and what to expect —
plus deliberate negative tests (RBAC denials, tenant isolation, validation).

Import `MessMate.postman_collection.json` and `MessMate.postman_environment.json`,
then read [`postman/TESTING-GUIDE.md`](postman/TESTING-GUIDE.md).

Folders `00`–`11` run clean end to end (96 requests, 103 assertions, 0 failures)
and are re-runnable without re-seeding. Folder `12` is destructive — run those by hand.

## Architecture

```
src/
├── app.ts                 Express wiring: helmet, CORS, compression, logging, rate limits
├── server.ts              Boot + graceful shutdown
├── config/                env (zod-validated), prisma singleton, pino logger
├── middlewares/           authenticate, authorize, validateRequest, rateLimit, errorHandler
├── modules/
│   ├── auth/              register, login, refresh rotation, logout, me, change-password
│   ├── mess/              create, settings, my-messes
│   ├── membership/        invitations, join, roles, status, ownership transfer
│   ├── period/            month lifecycle
│   ├── meal/              daily upsert, calendar, cook summary, cutoff, override
│   ├── expense/           CRUD + allocation rules
│   ├── deposit/           deposits, refunds, adjustments
│   ├── statement/         calculation engine, preview, close, reopen
│   ├── dashboard/         member / manager / cook views
│   └── audit/             audit log queries
├── routes/                index.ts (public) + mess.routes.ts (tenant-scoped)
└── shared/                errors, decimal/date/jwt/password utils, permission matrix
```

## The rules this backend enforces

**Money is never a float.** Every amount is a PostgreSQL `numeric` and is
computed with `Prisma.Decimal`. `splitEvenly` and the meal-cost allocator
distribute the remainder paisa by paisa, so allocations always sum back to the
exact bill — verified by `reconcile()` before any statement is written.

**Food goes into the meal rate; fixed costs never do.** Enforced in the expense
validator: `MEAL_BASED` is only valid for `FOOD`, and `FOOD` can never be split
`EQUAL`. Rent and utilities are allocated by their own rule and land in
`allocatedFixedCost`, not in `mealRate`.

**Authorization is per-membership, not per-user.** The same person can be OWNER
of one mess and MEMBER of another. `membershipScope` resolves `:messId` into the
caller's membership and pins it to the request; every query filters by it, so a
valid id from another mess returns 404 rather than data.

**A closed month is immutable.** Meal, expense and deposit writes all check the
period status. Reopening is OWNER-only, requires a reason, bumps
`calculationVersion`, and refuses to run out of order — the previous statement
set survives as superseded history.

**Month close is one Serializable transaction.** Validate → aggregate → write
statements → mark CLOSED. A duplicate submit gets 409, never a second statement
set. Closing balances carry forward as the next month's opening balances.

**Meal cutoff respects the mess timezone,** not the server clock. Members may
edit today until `mealCutoffTime` and up to `cutoffDaysAhead` days forward;
anything else needs a manager override, which requires a reason and is audited.

## API

Base path `/api/v1`. Success: `{ success, statusCode, message, data, meta? }`.
Error: `{ success: false, statusCode, code, message, details?, requestId }`.

### Auth
| Method | Route | Access |
| --- | --- | --- |
| POST | `/auth/register` | public |
| POST | `/auth/login` | public |
| POST | `/auth/refresh` | refresh cookie |
| POST | `/auth/logout` | any |
| GET | `/auth/me` | authenticated |
| PATCH | `/auth/change-password` | authenticated |

### Messes & invitations
| Method | Route | Access |
| --- | --- | --- |
| POST | `/messes` | authenticated |
| GET | `/messes/my` | authenticated |
| GET | `/invitations/:code` | public preview |
| POST | `/invitations/:code/join` | authenticated |

### Mess-scoped — all under `/messes/:messId`
| Method | Route | Access |
| --- | --- | --- |
| GET / PATCH | `/` | member / manager+ |
| GET | `/members` | manager+ |
| PATCH | `/members/:id/role` | owner |
| PATCH | `/members/:id/status` | manager+ |
| POST | `/transfer-ownership` | owner |
| POST GET DELETE | `/invitations` , `/invitations/:id` | manager+ |
| GET | `/meals/cutoff` , `/meals/my` | member |
| PUT | `/meals/my/:date` | active member |
| POST | `/meals/my/copy` | active member |
| GET | `/meals/daily` , `/meals/daily-summary` , `/meals/monthly-summary` | cook+ |
| PATCH | `/meals/override` | manager+ |
| POST GET PATCH DELETE | `/expenses` , `/expenses/:id` | accountant+ |
| GET | `/expenses/summary` , `/expenses/my-allocations` | accountant+ / member |
| POST GET PATCH DELETE | `/deposits` , `/deposits/:id` | accountant+ |
| GET | `/deposits/my` | member |
| POST GET | `/periods` , `/periods/current` , `/periods/:periodId` | manager+ / member |
| GET | `/periods/:periodId/preview` | accountant+ |
| POST | `/periods/:periodId/close` | manager+ |
| POST | `/periods/:periodId/reopen` | owner |
| GET | `/periods/:periodId/statements` , `/statements/my` | manager+ / member |
| GET | `/dashboard/member` , `/dashboard/manager` , `/dashboard/cook` | by role |
| GET | `/audit-logs` | accountant+ |

`DELETE` on expenses and deposits **voids** the row (requires a `reason`); financial
records are never hard-deleted.

### Health
`/health/live` (process) and `/health/ready` (touches the database).

## Security

httpOnly cookies with the refresh cookie path-scoped to `/api/v1/auth`; refresh
token rotation with reuse detection (a replayed token revokes every session);
bcrypt password hashing; refresh tokens and invite codes stored only as SHA-256
hashes; helmet; exact-origin CORS; rate limits on auth, invites and month close;
zod validation with unknown-key rejection; stack traces suppressed in production;
credentials redacted at the logger.

## Notes

- The Prisma generator sets `importFileExtension = "js"`. Without it the generated
  client emits extensionless imports that `moduleResolution: nodenext` cannot
  resolve, and its own `@ts-nocheck` hides the failure — every Prisma type
  silently degrades to `any`. Do not remove it.
- `generated/` is compiled with the app and is gitignored; run `prisma generate`
  after cloning (`pnpm build` does it for you).
