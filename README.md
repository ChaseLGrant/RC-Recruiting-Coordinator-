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

## Bring in your list & live season stats

- **Import your list** (`/import`): upload a CSV or Excel (.xlsx) file, or paste a Google Sheets link. RC matches the columns automatically, whatever they're called ("Player", "Pos", "Grad", "HS", "Ht", "EV", "Priority", "MaxPreps link", "Notes"). The coach checks a preview, then everyone lands in My Players with their board status and notes. Cells RC can't read are reported, never guessed. Re-importing doesn't duplicate players or notes.
- **Season stat tracking**: link a player's public stats page once (on their profile, or a `profile_url` / link column in an imported list). RC re-checks it on a schedule (every 12 hours by default), records any stat that changed with its date and a link back, and reports it in the Daily Brief ("Batting avg .312 → .341 (MaxPreps)").
  - Reads only pages your staff linked. It identifies itself, rate-limits per site (one request per 8 seconds or slower), obeys robots.txt, uses conditional requests, and never logs in or gets around paywalls or CAPTCHAs.
  - The extractor is site-agnostic. It reads stat tables (AVG/OBP/SLG/HR/RBI/SB, ERA/IP/SO/BB/WHIP) and embedded page data, picks this season's row (not career), and rejects impossible values.
  - **Status:** tested against a local test server with realistic pages, but **not yet against live MaxPreps or Perfect Game pages**, because the development environment can't reach those sites. Watch the first real checks. If a site's layout isn't read, the player's page says so, and adding a site-specific reader is a small change in `src/lib/watch/extract.ts`. Each site's terms of use are the program's own call.

## Program demos

Build a branded, clearly labeled demo for any program:

```bash
npm run demo:create -- demos/palomar.json
```

The demo is built from the program's campus, colors and staff, with fictional players from real nearby towns. Drop the official logo at `demos/palomar-logo.png` (or .svg/.jpg/.webp) before running, or upload it later in Settings → Branding.

## Player page finder & adding players by hand

- **Finds each player's pages automatically.** For every player RC matches, imports, or a coach adds, it uses an official search API (Google Programmable Search or Brave Search) to look for his MaxPreps, Perfect Game and PBR stat pages, Hudl and YouTube film, and X and Instagram accounts.
  - Each result is scored against what RC knows. The name alone isn't enough: class, school or hometown must also match.
  - Coaches **keep or dismiss** each link. Kept stat pages update stats and schedules automatically. Socials and film become one-tap buttons on the player's page.
  - Dismissed links are never suggested again. Opted-out players are never searched.
  - It searches a small batch each hour (`RC_FINDER_PER_RUN`, default 8 per program) to stay within free search limits.
  - **Setup:** add `GOOGLE_CSE_KEY` + `GOOGLE_CSE_ID`, or `BRAVE_SEARCH_API_KEY`. Until then, Settings shows "Not connected" and nothing is searched.
- **Add a player** (the "+" in the header, on every screen): a quick form built for a phone. Only the name is required, and the player goes straight onto the board.
  - Optional: what you saw (height, weight, exit velo, 60 time, FB velo, all labeled "Seen by <coach>"), where you saw him (logged as "Saw him play"), phone, X handle, links, a staff note and a board status.
  - RC then searches for his pages to approve.
- **Not tested against the live search services or real MaxPreps/Perfect Game pages yet** (the development environment can't reach them). The request formats are covered by tests with simulated responses. Watch the first real searches.

## Reaching every program (outreach & tracking)

Owner page → **Outreach** (`/admin/outreach`):

1. **Add schools.** Upload a CSV with these columns: Program, Team, ZIP, Primary color, Secondary color, Accent color, Logo URL, Coach, Email, Conference. Only Program and ZIP are required, and there's a blank template to download. RC downloads each logo from its link. Upload again any time to add schools or fix colors; existing links keep working.
2. **Send the links.** "Download mail-merge file" gives one row per school with the coach's first name, email and personal preview link (`/p/<school>-<code>`), ready for Gmail mail merge, Mailchimp, YAMM or Instantly.
3. **The coach taps the link** and lands on a page in their school's colors: "Coach Ben, your recruiting staff is ready." They tap **Open my demo** and get their own demo, branded for their school, with fictional players near their campus. No sign-up.
4. **One tap to go live.** Inside the demo, "Set it up for real" creates the school's real account with the same branding, and the coach sets up their login and staff. The 90-day trial starts with no card.
5. **See who's interested.** Every school shows its stage: Not opened → Clicked link → Opened demo → Explored demo (5+ pages viewed) → Signed up → Using RC (5+ players on the board). Schools that signed up also show staff, players, plan and last sign-in.
   - "Clicked link" can be an email virus-scanner, so only "Opened demo" counts as a real try.

Also:
- **Try RC now, no sign-up** on the sign-in page opens a private generic demo.
- Try-it demos don't run scheduled jobs, never call paid search or AI, and are deleted after 14 days (`RC_GUEST_DEMO_DAYS`). Their open and view counts are kept.
- Limits: `RC_GUEST_DEMOS_PER_HOUR` (default 60) and `RC_PREVIEWS_PER_SCHOOL_PER_DAY` (default 25).
- **Before a mass send:** cold email in the US needs your business mailing address and an unsubscribe line (CAN-SPAM). Send in batches of 30 to 50 a day from a warmed-up domain, not your main one, or schools' spam filters will block you. Use school logos only in each school's own private preview, never in public ads.

## Subscriptions, free trial & school invites

- **Coaches are never locked out.** The board, players, notes, contact log, search, imports and exports always work, paid or not. A subscription pays for the automatic staff work: AI research, daily saved searches, automatic stat and schedule tracking, and the page finder.
- **90-day free trial, no card.** It starts the first time anyone at the school signs in. When it ends without a subscription, the automatic updates pause and the board stays free.
  - Set `RC_TRIAL_REQUIRES_CARD=true` to require a card up front instead.
  - A school that subscribes mid-trial keeps its remaining free days, then Stripe charges automatically and renews.
- **Every school subscribes** monthly or yearly. Prices live in your Stripe account (`STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`), so changing them needs no code. Schools update their card, switch plans or cancel through Stripe's billing page, and RC never sees card numbers. Promo codes are accepted.
- **Stripe keeps RC in sync** through the webhook at `/api/stripe/webhook`. Every request is signature-checked, and older events that arrive out of order are ignored.
- **Billing is only enforced once the Stripe keys are set.** Until then everything is included.
- **School invites** (owner page → "Add a school", or "Set it up for real" from a preview): a branded school plus a one-time setup link, valid 30 days. The head coach creates their login, lists the staff and sets the shared staff login.
- **Owner page** (`/admin`, for emails in `RC_ADMIN_EMAILS`): every school's status, staff and players, AI usage and estimated cost, new invite links, complimentary access, "paid by invoice through <date>", and AI checks per month.
- **AI research** is included up to 200 checks a month during the trial and 400 a month when paid, adjustable per school. Demos never run AI research, because their players are fictional.

## Snap a roster & download your board

- **Snap a photo** (Import page): take a photo of a printed roster, a showcase program, a lineup card or a handwritten list, up to 6 pages. RC reads it with Claude and copies only what's written; unreadable cells stay blank. Every row goes through the normal import preview before anything is saved. It needs `ANTHROPIC_API_KEY`, costs about a cent or two per photo (shown on the owner page), and doesn't count against a school's AI checks. Limit: `RC_PHOTO_IMPORTS_PER_DAY` (default 40).
- **Download my board** (My Players): one CSV with every player, status, contact info, sourced numbers, last contact, links and staff notes. It opens in Excel or Google Sheets and is always available. Contact info is left out for players who opted out.

## AI research agent (keeps every board current)

_Included in every subscription (monthly limit per school)._

On a schedule (every 7 days per player by default, up to 25 players a day per program), RC's agent researches each player on a coach's board using Claude (`claude-opus-5-5`) with web search. It looks for new stats, commitments, school or team changes, upcoming games, film, socials and news, and proposes each one as an update with the page it came from and a quote.

- **RC double-checks every proposal in code.** The cited page must be one the search actually returned. Stats must be plausible and actually new. Health, injury, grades and family information are dropped. If the agent can't confirm it found the right player, it proposes nothing.
- **Coaches approve or skip each update.** Approved stats keep their source link. Commitments and news become staff notes with the link. Nothing is marked "verified".
- **Where to use it:** "Update with AI now" on a player's page, "Update my board with AI" on My Players, and Settings → AI research agent (on/off, how often, daily cap, real usage and estimated cost).
- **Setup:** add `ANTHROPIC_API_KEY`. Research runs in the hourly GitHub job, which needs the `DATABASE_URL` secret because research can take longer than a web request allows.
  - The model can be changed with `RC_AGENT_MODEL`.
  - The request also uses server-side fallbacks (`fallbacks: "default"`), so a request one model declines can be retried on another.
- **Cost:** roughly 10–30 cents per player check at list prices, shown in Settings. The daily cap limits spending.
- **Status:** tested with a simulated Claude response, not yet against the live API (no key in the development environment).

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

## Put it online (about 15 minutes, free to start)

You need a Vercel account (you already have one) and this GitHub repo.

1. **Create the site.** On vercel.com, click **Add New → Project**, pick this repository and the `claude/determined-bohr-nzx42q` branch (or merge it to `main` first), then click **Deploy**. The first deploy works without a database, but data won't persist until step 2.
2. **Add the database.** In the Vercel project, go to **Storage → Create Database → Supabase** (or Neon), and connect it to the project. Vercel adds `POSTGRES_URL` automatically, and RC creates its tables on first start.
3. **Add one secret.** Under **Settings → Environment Variables**, add `CRON_SECRET` with any long random value (for example, generate one with a password manager). Then go to **Deployments → ⋯ → Redeploy**.
4. **Build the Palomar demo** (once). Run this from any terminal, or ask Claude to run it:

   ```bash
   curl -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" "https://YOUR-SITE.vercel.app/api/admin/setup-demo?name=palomar&password=CHOOSE-A-STAFF-PASSWORD"
   ```

   Sign in with `staff@palomar.demo` and that password, then tap a coach's name. On a phone, use Share → **Add to Home Screen** to install it like an app.
5. **Keep it live hourly.** In GitHub, go to **Settings → Secrets and variables → Actions** and add `RC_URL` (your site address) and `CRON_SECRET` (the same value). The included workflow `.github/workflows/rc-hourly.yml` then runs saved searches and re-checks linked stat and schedule pages every hour. Vercel's own cron (in `vercel.json`) also runs once a day as a backup.

**Optional:**
- **Email sending:** `RESEND_API_KEY`, `RC_EMAIL_FROM`.
- **Your own domain:** in Vercel, go to **Settings → Domains**.
- **Running your own server instead:** `npm run build && npm start` plus `npm run worker` on any Node 22 host with `DATABASE_URL` set.

The same SQL runs on SQLite and Postgres. To run the full test suite against Postgres:

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
