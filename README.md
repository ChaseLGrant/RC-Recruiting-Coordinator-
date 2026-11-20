# RC — Recruiting Coordinator

**Powered by The Athlete Market.**

> Your standards. Your evaluations. Your recruiting decisions. RC does the legwork.

RC is a recruiting staff that works in the background for college programs. It finds athletes who meet the coach's **own** standards, sorts the evidence, watches schedules, and prepares outreach. The coach makes every decision.

Coaches don't have to trust AI. Every number shows its source, the date it was measured, the date RC last checked it, and whether it was verified. Every action RC reports comes from a saved system record.

---

## Quick start

Requires **Node 22.5+**. Node's built-in SQLite is the default database, so there is nothing else to install.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000 and choose **Create an account**. You have two options:

- **My program** starts empty. Add data you're authorized to use through **Settings → Data sources → Import a CSV**. Try `samples/athletes-example.csv` first.
- **Demo workspace** loads about 140 **fictional** athletes from two demo sources and runs a real mission right away. A purple banner and a `DEMO` tag on every athlete mark the data as fictional. Demo data cannot be loaded into a real program.

Run the background worker in a second terminal. It runs recurring missions when they're due:

```bash
npm run worker
```

Run the tests:

```bash
npm test
```

## What's built

| Area | What it does | Where |
|---|---|---|
| **Coach-defined standards** | Grad years, positions (with secondary), radius/states/nationwide, any measurable, each marked required, preferred or optional, plus a "verified only" option. Uncommitted-only counts only when verified. The coach chooses whether missing data excludes a prospect. | `src/lib/domain/criteria.ts` |
| **Objective matching** | "Matches 5 of your 6 criteria." Each standard is marked as meets, doesn't meet, missing info, not verified, or sources disagree. **There are no talent scores.** | same |
| **Evidence Mode** | Click any number to see every observation behind it, with its source, measured date, last-checked date, freshness, verification level and original link. Conflicting values all appear side by side. The green ✓ badge shows only when the value is independently verified or officially published, dated, and no equally trusted source contradicts it. | `src/lib/domain/provenance.ts`, `src/components/evidence.tsx`, `/athletes/[id]` |
| **Geographic search** | Real distances from US ZIP centroid data, computed offline from the bundled `zipcodes` dataset. Search by radius from campus, a ZIP code or a city. Presets run from 25 to 500 miles, or enter your own. | `src/lib/domain/geo.ts` |
| **Plain-English search** | Type a request like the flagship example. RC shows exactly what it understood and warns about anything it couldn't read. It doesn't guess. | `src/lib/domain/parser.ts`, `/discover` |
| **Data ingestion** | Modular providers. Identity matching handles nicknames, schools and grad years. A strong match merges records; a borderline one goes to the coach as a possible duplicate. Includes change detection, conflict detection, and logging of schedule changes. | `src/lib/ingest.ts`, `src/lib/providers/*` |
| **Recurring missions** | Runs daily, weekly or manually. Each run checks sources, re-evaluates standards, flags new matches, tracks games, creates scouting tasks, suggests itineraries and builds camp invitation lists. Failures are recorded and shown, never hidden. | `src/lib/jobs/runner.ts`, `scripts/worker.ts`, `/api/cron` |
| **Needs Your Approval** | New prospects, camp lists, outreach drafts (editable), itineraries, data conflicts, possible duplicates and compliance reviews. Each can be approved, rejected, edited or saved for later. Everything is audit-logged. | `src/lib/repo/approvals.ts`, `/`, `/approvals` |
| **Outreach** | Drafts are built only from facts on record and quote only **verified** metrics. Compliance is checked when a draft is approved and again when it's sent. **Nothing is ever sent automatically.** | `src/lib/domain/outreach.ts`, `src/lib/domain/compliance.ts` |
| **Compliance** | Each program enters its own contact dates by class, its recruiting calendar and guardian-consent rules. If RC is unsure, the message goes to compliance review. Opted-out athletes are blocked. | `/settings#compliance` |
| **Daily brief** | "Here's what your recruiting staff accomplished." It's built from the saved event log since your last briefing, with timestamps and links. | `/` |
| **Impact / time saved** | Counts are measured. Time saved is clearly labeled as an **estimate**, and the coach can edit the minutes-per-task assumptions. | `/impact` |
| **Camps** | Target prospects with any saved profile (radius, position, year, size, metrics). RC builds the invitation list for approval and tracks invitation and registration status. | `/camps` |
| **Following / Compare / Schedule** | One-click follow, a board with statuses, side-by-side comparison with sources, and a schedule labeled "participation not confirmed". | `/following`, `/compare`, `/schedule` |
| **Security** | scrypt password hashing. Session tokens are hashed before storage. Role-based permissions (head coach, assistant, compliance, viewer). Every query is scoped by `org_id`, and tenant isolation is tested. Audit log. | `src/lib/auth.ts`, `src/lib/domain/permissions.ts` |

## Trust & safety guarantees (each one is enforced by a test in `tests/trust.test.ts` or `tests/workflow.test.ts`)

- **No fabricated data.** Real programs start empty. Fictional demo data can't be loaded into a real program.
- **No talent scores.** RC only reports how an athlete compares to the coach's own standards.
- **Every number has a source.** The verified badge also says who vouched for it. A program's own import is labeled "per your import" so it's never mistaken for independent verification.
- **Disagreements are shown, never hidden.** Conflicting values from different sources appear side by side.
- **Nothing is sent without a coach.** Every message is checked for compliance when approved and again when sent. An opt-out always wins, even over an earlier compliance clearance.
- **Minors' privacy.** An admin can permanently delete an athlete's records after entering a reason. The deletion is logged without the athlete's details. The public database API can't read anything (RLS is on with no policies).
- **Only safe links.** Links that aren't plain web addresses are dropped when data is imported, including `javascript:` and `data:` links.
- **Account security.** Passwords use scrypt hashing. Session tokens are stored hashed. Five failed sign-ins lock the account for 15 minutes, and sign-in timing doesn't reveal whether an account exists. Security headers are on (CSP, no framing, HSTS). Roles, per-program data isolation and an audit log are all covered by tests.

## Data sources: what is and isn't connected

RC **never scrapes** and never claims to have searched a source it can't access.

| Provider | Status |
|---|---|
| **CSV import** | ✅ Works. The coach confirms the program is authorized to use the data, and every value is stamped with the import as its source. Templates are in `samples/`. |
| **MaxPreps** | ⛔ Not connected. Requires a licensed data agreement. The adapter is a stub that reports "Not connected". |
| **Perfect Game** | ⛔ Not connected. Same as above. |
| **Prep Baseball Report** | ⛔ Not connected. Same as above. |
| **Demo showcase + demo team feed** | ✅ Fictional, and only in demo workspaces. |

To add a licensed provider, implement `sync()` in `src/lib/providers/licensed.ts` against the API spec supplied under your agreement. The rest of RC (provenance, identity matching, missions, the brief) works with it automatically.

## Production deployment (Supabase / Postgres)

1. Create a Supabase project and run the schema migration, either with the Supabase CLI or by pasting it into the SQL editor:

   ```bash
   supabase db push
   ```

   The schema is in `supabase/migrations/0001_rc_schema.sql`. RLS is enabled with **no policies**, so the public API keys can't read any athlete data. Only RC's server connection can.
2. Set `DATABASE_URL` (the Postgres connection string) and `CRON_SECRET`. See `.env.example`.
3. Deploy, for example to Vercel. `vercel.json` sets up an hourly cron on `/api/cron`, which runs any missions that are due. Alternatively, run `npm run worker` on any always-on host.
4. Optional: set `RESEND_API_KEY` and `RC_EMAIL_FROM` for email. Sending also has to be turned on in Settings, and every send is still a coach's click.
5. Optional: set `ANTHROPIC_API_KEY` to enable the AI provider abstraction (`src/lib/ai/provider.ts`). AI is limited to turning a search request into criteria, and the coach still reviews the result. It is never used to grade athletes.

The same SQL runs on SQLite and Postgres. The full workflow test suite passes on both:

```bash
PG_TEST_URL=postgresql://user@localhost:5432/rc_test npm test
```

## Path to "gold standard": what code alone can't finish

1. **Licensed data agreements** with MaxPreps, Perfect Game, PBR and other providers. This is the biggest gap. Until those exist, RC only knows what a program imports.
2. **An independent security review / penetration test** before any school puts real athlete data in, followed by SOC 2 when you sell to larger athletic departments.
3. **Legal review** of the privacy policy, terms and data-processing agreement. Minors' data falls under state privacy laws, and FERPA applies if academic records like GPA are involved.
4. **Compliance-office review** of the outreach workflow at a pilot school.
5. **A pilot with 2–3 real college staffs** to confirm the matching, Evidence Mode and approvals fit how they actually work.

## Honest status: not done yet

- **Licensed provider integrations** (MaxPreps, Perfect Game, PBR) are stubs. They need data agreements and API specs.
- **The AI search assist** is written but not yet wired into the Discover page. Discover uses the deterministic parser, and the Anthropic adapter hasn't been exercised against the live API.
- **Email sending** goes through Resend and is coded, but it hasn't been tested against the live API.
- **Auth** is built in (email/password and sessions). There's no password reset, SSO or Supabase Auth integration yet. New staff get a temporary password from the head coach.
- **Geocoding** uses ZIP and city centroids, so distances are accurate to the ZIP area, not the street address. The UI says which precision was used.
- **Recruiting rules** aren't preloaded. Each program's compliance office enters them on purpose.
- **UI components** are custom Tailwind components in the shadcn style. The shadcn/ui CLI package isn't used yet.
- **Time zones**: game times display in UTC.

## Project layout

```
src/lib/domain/    pure, tested logic: criteria, provenance, geo, identity, parser, compliance, permissions, outreach, time savings
src/lib/db/        portable SQL schema + SQLite/Postgres adapters
src/lib/repo/      tenant-scoped data access, approvals, outreach, camps
src/lib/providers/ data provider interface, CSV import, licensed stubs, demo fixtures, email
src/lib/jobs/      mission runner (the "recruiting staff")
src/app/           Next.js App Router pages + server actions
tests/             unit + full workflow tests
```
