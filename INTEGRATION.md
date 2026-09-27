# Frontend setup and handoff

Use Node.js 22.19+ (required by the local HTTPS certificate helper). From the repository root:

```sh
npm install
npm run dev
npm run build
```

On Windows PowerShell with restricted script execution, use `npm.cmd` instead of `npm`. The build performs TypeScript checking and generates `dist`. Use `npm run preview` to preview it.

The Vite dev server uses HTTPS with a locally trusted certificate. On first `npm run dev`, `vite-plugin-mkcert` may download its helper and add a local certificate authority to the development computer's trust store. Share the `https://` Network URL printed by Vite with devices on the same network. Each other computer or phone must also trust the public root CA certificate before its browser accepts the site; the helper prints its CA location. Share only `rootCA.pem`, never `rootCA-key.pem`. On iOS, install the CA profile and enable full trust in Settings. Android and desktop devices have their own certificate installation steps. Restart Vite if your LAN IP changes so it can issue a certificate for the new address. HTTPS here is for local development only.

## Demo flow

The app always opens on login. In local development, enter a valid email, complete your profile, and join the server-backed in-memory queue. The browser asks for location permission when joining; exact coordinates are sent only to the local server for radius matching. Open four separate local sessions with compatible interests and nearby coordinates to form a group. The group prompt is generated through `IcebreakerGenerator`; set `OPENAI_API_KEY` for an LLM-generated question, otherwise it uses the built-in interest-based fallback. Queue, profile, and group data remain in the local server process and reset when it restarts. No audio or transcript is collected by this flow.

## Integration boundaries

### Pages and routing

React Router owns navigation in `apps/web/src/app/routes.tsx`, with `BrowserRouter` mounted in `main.tsx`:

| URL | Page |
| --- | --- |
| `/` | Home page when signed in; login landing when signed out. The Lavoirs logo always links here. |
| `/login` | Email/password or email-link login |
| `/signup` | Account creation using the auth adapter's signup intent |
| `/profile` | Profile setup and editing (requires login) |
| `/queue` | Breakout queue (requires a complete profile) |
| `/rooms/:roomId` | Room preview (requires the current matched room ID) |
| `/events` | Follow-up integration placeholder (requires a current group) |
| Other URLs | Not-found page with a return link |

Browser back/forward and internal links work without a full reload. Queue timers clean up when leaving the queue page. A room's demo preview button opens the events page; it does not simulate a completed 20-minute conversation. Leaving a room clears its group, so old room history cannot reopen it.

The app waits for session restoration before evaluating protected routes. Demo sessions and matches are in memory: refreshing a protected page returns to login. Live auth can restore a profile; restoring matched rooms after refresh still requires the matchmaking owner's group lookup. Frontend route guards are not a substitute for backend authorization. Vercel's existing SPA rewrite serves direct page URLs while preserving `/api/` routes.

Authentication and profile storage now use the replaceable `services.ts` adapter. See [AUTH_CONTRACT.md](AUTH_CONTRACT.md) for the exact teammate contract. The default adapter is still an in-memory demo; live adapters can restore sessions and existing profiles.

- `apps/web/src/app/App.tsx` owns login → profile → queue → room screen state. Replace demo email continuation with Supabase authentication before exposing protected features.
- `packages/shared/src/profile.ts` defines the profile contract: approximate location, matching radius, interests, and optional transcription consent (off by default).
- `packages/shared/src/matching.ts` defines participants, groups, and queue states. `MatchingPage.tsx` joins `/api/dev/queue`, polls for a match, displays compatible nearby counts, and lets the member leave while waiting.
- The local API creates `User` instances, selects matches through `MatchQueue`, stores active `Group` instances in `Groups`, and assigns members their group IDs. `RoomPage` displays the prompt generated for that group. The LiveKit room token checks the assigned group ID.
- Local matching state is in memory for development only. It is not yet backed by Supabase, so separate server instances cannot share queue entries or groups and a restart clears state. Production matchmaking still needs a transactional database operation and authenticated group lookup.
- Prompt voting, the 20-minute timer, real event recommendations, and mutual contact exchange remain teammate integration work.
- Vercel builds from the repository root using `vercel.json`. Deployment has not been performed. API files remain empty placeholders and require implementation before backend use.

## Manual smoke check

1. Open the app and confirm the login screen and demo notice appear.
2. Continue with a valid email. Name and city are required; at least one interest must be selected.
3. Save a profile and check the chosen location, radius, and interests on the queue screen.
4. Join, leave before completion, and verify all three seats reset. Rejoin and wait for all four seats.
5. Enter the preview, leave, edit the profile, and sign out.
6. Check narrow mobile and desktop layouts. Refresh should return to login.
