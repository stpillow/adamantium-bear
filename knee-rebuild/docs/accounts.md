# Accounts: invite codes, sessions, and Shawn's setup

Built Nov 9, 2026 (M-U2; docs/multiuser-and-release-plan.md section 7 item 2; PROGRAM-QUESTIONS 213 to 222). This is the accounts half of Shawn's Nov 8 decisions. Sync (M-U4), tester mode (M-U3) and the admin screen (M-U5) are not built.

**The standing gate:** no tester code goes out before Shawn has had the professional conversation (docs/multiuser-and-release-plan.md section 5).

## What it is

- **An account** is a name (1 to 40 characters) and a role, `admin` or `tester`, held in Neon Postgres. In this build the role only shows on screen. Nothing else about the person is stored. The log never leaves the phone.
- **An invite code** looks like `7K3M-Q9X2-T4HB-8RD7`.
  - It is 16 Crockford base32 symbols (there is no I, L, O or U): 75 random bits plus a check symbol that catches a mistyped character.
  - The database stores only an HMAC of the code, keyed by `AUTH_CODE_PEPPER`. Nobody can read a code back, so a lost code gets replaced with `recode`.
  - A code belongs to a person, not to a browser. On iPhone, Safari and the home-screen app keep separate cookies, so the same code is typed in each one, and both sign in as the same account.
- **A session** is a sealed (AES-GCM) cookie: `kr_session`, HttpOnly, Secure, `SameSite=Strict`, `Path=/api`, 400 days.
  - It holds the account id, the time it was issued and the key generation.
  - The account's `revoked_at` is checked on every request.
  - Settings re-issues a session older than 30 days whenever it opens online. A phone that doesn't open Settings for 400 days types its code again.
- **The gate.** When accounts are on, every `/api` route except `/api/auth`'s `redeem` and `me` needs a session. That includes `/api/strava`.
  - Strava's callback is exempt, because Strava's return is a cross-site navigation and the Strict cookie isn't sent on it. Connect seals the account into the short-lived state cookie, and the callback re-checks that account instead.
  - The app shell stays public and static. The service worker and offline use don't depend on accounts.
- **The switch** has three states:

  | State | When | What happens |
  |---|---|---|
  | Off | `DATABASE_URL` or `AUTH_COOKIE_KEY` is missing | Everything behaves as before accounts. Settings shows no Account section. |
  | On | Both are set, both secrets are 32 or more characters with nothing around them, and `AUTH_KEY_GENERATION` reads as a whole number | Accounts work as described above. |
  | Broken | Both are set, but anything else is wrong | Every gated route answers 503 "Accounts are half set up on this deployment", and Settings says the same. It fails closed. |

- **Redeem limits.**
  - 10 tries per client (by IP, or by /64 for IPv6, hashed) and 200 from everyone, per 15 minutes. Successes count too.
  - Under concurrency: each try is recorded first and then counted, itself included, and a refused try takes its row back. So redeems arriving at once can only be over-counted (a burst may refuse a few tries that would have fitted), never let through together past the limit. A client at its limit adds no rows, so it can't use up the 200 alone.
  - Attempt rows are kept for 24 hours.
  - A wrong, revoked or unknown code always gets the same words.
- **Sign out** clears this context's session and its Strava cookie. If Strava is connected, it revokes Strava first, which frees the athlete slot. Strava's revoke takes every token the app holds for that athlete, so signing out in Safari disconnects Strava in the home-screen app too (and on any other phone or browser the account uses); each connects again after signing back in. The app says so. Your log is untouched, and Reset all data doesn't sign you out.

## Shawn's setup, in order

Every value marked **(Sensitive)** is write-only in Vercel once saved. **Save each one in your password manager before you paste it.**

0. **Ship the release first.** The release that contains M-U2 must be live on production (dev → main, on your word).
   - Check that https://knee-rebuild.vercel.app/api/auth?action=me answers `{"configured":false}`.
   - **Then bring both contexts onto the new version.** The app updates on prompt, never by itself, so a context still on the old version keeps running it: it has no Account section, and once accounts are on its Strava screen misreports the connection. On the iPhone, open knee-rebuild.vercel.app **in Safari** and then **open the home-screen app**. In each, wait for "A new version is ready. It will not reload on its own." at the top and tap **Reload now**. If no prompt shows, close that context fully, reopen it and look again.
   - How to tell: while accounts are off, the M-U2 version looks exactly like the one before it, so there is no visible sign yet; accepting the prompt in each context is the step. From step 6 there is one: Settings shows an **Account** section. A context whose Settings has none after step 6 is still on the old version: accept the prompt there before step 7.
   - Nothing else changes for you until step 6.
1. **Add Neon.** In Vercel, open Storage, then the Marketplace, add **Neon** on the free plan, and connect it to the `knee-rebuild` project.
   - Give it **Production** only.
   - Leave preview branching off.
   - Then check Settings, Environment Variables: there should be a `DATABASE_URL` for Production.
   - The exact variable name is **unverified**. If the integration names it something else, tell Claude before going on.
2. **Make two secrets.** Run `openssl rand -base64 48` twice and save both results in your password manager. Then set:
   - `AUTH_CODE_PEPPER` = the first value (Production, Sensitive). Never change it: changing it voids every code.
   - Keep the second value for step 6.
   - Paste each value exactly as printed, with no space or newline. A value with whitespace around it puts accounts into the broken state.
3. **Make the bootstrap code.** In `knee-rebuild/`, run `npm run accounts -- code`.
   - Save the printed code in your password manager.
   - Set `AUTH_BOOTSTRAP_CODE` to it (Production, Sensitive).
   - Set `AUTH_BOOTSTRAP_NAME=Shawn` (Production). Without it the admin is named "Admin".
4. *(Optional)* Set `AUTH_KEY_GENERATION=1` (Production). Unset means 1.
5. **Create the tables now, so switching on is quick.**
   - Put two lines in `knee-rebuild/.env.accounts`, which is gitignored and stays on your Mac:
     - `DATABASE_URL=...`, copied from Vercel, Storage, Neon, "Show secret" (or from Neon's own console);
     - `AUTH_CODE_PEPPER=...`, from your password manager.
   - Then run `npm run accounts -- migrate`. It should say "Tables are up to date."
   - The function would also create the tables on first use, but doing it now avoids a cold-start race at switch-on.
6. **The switch.** Set `AUTH_COOKIE_KEY` = the second value from step 2 (Production, Sensitive), then **redeploy production**.
   - **Check:** https://knee-rebuild.vercel.app/api/auth?action=me should now answer `{"configured":true,"signedIn":false}`.
     - `{"configured":false}`: the Neon variable isn't called `DATABASE_URL`, and the gate is silently off. Stop and tell Claude.
     - `"problem":"setup"`: a secret is short or has whitespace around it, or the generation isn't a whole number.
   - From this moment, Import from Strava on every phone needs a signed-in account. Do step 7 straight away, phone in hand.
7. **Sign in, twice.**
   - Each context must show Settings, Account first (step 0). If one doesn't, accept "A new version is ready" there before going on.
   - On the iPhone, open knee-rebuild.vercel.app **in Safari**. Go to Settings, Account, type the bootstrap code and tap Redeem. It should say "Signed in as Shawn, the admin."
   - Then **open the home-screen app** and do the same, because it has its own cookie jar.
   - Strava's existing connection survives in each context.
   - **Tester mode (M-U3).** Redeem your admin code right away in Safari and in the home-screen app. Until you do, each shows the program as written (tester mode): no loads, no readings, no gate verdict, no red-flag stop, and a line under Today's date says so. Nothing logged is lost, and the next screen after the redeem is back to normal. The same applies after a key-generation bump (step 12), a revocation or a stale cookie: sign in again in each context.
8. **Remove `AUTH_BOOTSTRAP_CODE`** from Vercel and redeploy. **This step isn't optional.**
   - The code keeps working as your own code, because its hash is stored.
   - Left in the project, it would be your permanent credential, visible to anyone with project access and to `vercel env pull`.
   - If anyone else has access to the Vercel project, also run `npm run accounts -- list` to get your id, then `npm run accounts -- recode <id>`, and save the new code.
9. **Mint a tester code**, only after the professional conversation: `npm run accounts -- mint --name "Alex"`.
   - The command prints the account id and `Code (shown once): XXXX-XXXX-XXXX-XXXX`. Send the code privately.
   - The tester then:
     - opens the URL in Safari;
     - adds the app to the home screen and opens it;
     - completes first run;
     - enters the code in Settings, Account, and in Safari too if they use it there.
   - `mint`, `recode` and `bootstrap` refuse to run if your local pepper isn't the deployment's. They know because the function stores a keyed check value on every redeem.
10. **List accounts:** `npm run accounts -- list`. It shows id, name, role, made, revoked and last seen, but never a code.
11. **Revoke one:** `npm run accounts -- revoke <id>`.
    - It takes effect on that phone's next `/api` call, and the code redeems nothing after that.
    - Their Strava authorization stays at Strava until they remove it at strava.com/settings/apps. Check the athlete count on your Strava API app's page, because the self-serve cap is 10.
12. **Revoke every session:** change `AUTH_KEY_GENERATION` (for example 1 to 2) and redeploy.
    - Everyone types their code again in each context.
    - Codes still work. To shut someone out, revoke them.
13. **Lift a redeem lockout** (someone used up the 200-per-15-minutes cap): `npm run accounts -- unblock`.
14. **Turn accounts off:** first make sure Safari and the home-screen app on your phone are both signed in as admin (Settings, Account), then delete `AUTH_COOKIE_KEY` and redeploy. The server behaves as before accounts. A phone that last heard "accounts on, signed out" stays in tester mode after this, on purpose: an "accounts off" answer never overrides one that saw them on, so a preview or a mistyped variable can't hand a tester the engine (PROGRAM-QUESTIONS 237). If that happens to your phone, Export JSON, Reset, then import the file: the import brings your sets from before Nov 10, 2026, and with no account answer kept the phone runs in full.
    - Since M-U3 a phone that has seen accounts on keeps that answer: a `{"configured":false}` never replaces it (PROGRAM-QUESTIONS 224). Your admin phone stays in full mode; a tester's phone stays in tester mode. To put a phone back to how it was before accounts, clear the site's data in that context (Safari: Settings, Safari, Advanced, Website Data), after an export.
15. **If a secret leaks:**
    - **Cookie key:** set a new one. That signs everyone out.
    - **Pepper:** set a new one, then `recode` every account and send out the new codes.
    - **`DATABASE_URL`:** rotate the password in Neon. The integration updates the variable. Check that it did.
    - **Bootstrap code:** `recode` your account.

**Previews** stay off. The `AUTH_*` variables are on Production only, so a preview behaves as before accounts. Whether Vercel's deployment protection covers previews is **unverified**: until it does, a preview is as open as it was before.
- **Since M-U3 this is a release precondition for testers** (PROGRAM-QUESTIONS 235): a preview with accounts off runs the full engine for any phone that opens it. Before any tester installs, either verify that deployment protection covers previews, or set the `AUTH_*` variables on Preview too.

## To check on the first deploy and on the phone (unverified until then)

- The functions' `./_session.js` imports deploy. Check that the PR preview's `/api/strava?action=status` and `/api/auth?action=me` both answer JSON, not a 500.
- `new URL(request.url).origin` equals the browser's `Origin` on Vercel, aliases included. If it doesn't, Redeem answers 403 "This only works from inside the app".
- A Strict cookie holds in the installed iOS app.
- **After Strava's return:** WebKit may withhold a Strict cookie from the requests of a page reached through a cross-site redirect. If the screen reads "Strava needs an account" right after "Connected to Strava", leave the screen and come back. Tell Claude: the fix is for the callback to answer a small page that refreshes to the app, which makes the next load same-site.
- The Neon variable's name (step 1).

## Who can see what

- **The server holds:** account names and roles, code hashes, creation, revocation and last-seen times, and hashed client addresses for 24 hours. These are server-held personal data, which is an input to the privacy note (docs/multiuser-and-release-plan.md section 5).
- **The server never holds:** the log, Strava data, or a code.
- `last_app_version` stays empty until sync (M-U4) can fill it without an in-app telemetry call.
