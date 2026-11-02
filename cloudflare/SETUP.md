# SocialDesk Admin API setup (free-tier friendly)

This Worker is separate from the existing Gemini AI Worker. Do not replace or edit the Gemini Worker.

## Already completed
- KV namespace `SOCIALDESK_DATA` was created in Cloudflare.
- Worker source is in `cloudflare/socialdesk-admin-api.js`.
- This API uses short-lived signed bearer tokens (not third-party cookies), to avoid common cross-site cookie restrictions.

## 1. Create the Worker
In Cloudflare Dashboard, open **Workers & Pages → Create → Worker**. Name it `socialdesk-admin-api`. Open its code editor, replace the starter code with the complete contents of `cloudflare/socialdesk-admin-api.js`, and Deploy.

## 2. Add the KV binding
In the new Worker settings, add a KV namespace binding:
- Variable name: `SOCIALDESK_KV`
- KV namespace: the existing `SOCIALDESK_DATA`

Do not create another namespace.

## 3. Add configuration
Add this plain-text Worker variable:
- `ALLOWED_ORIGIN` = `https://akhandpratap93-jpg.github.io`

Add these as **Worker secrets** (not plain-text variables and never in GitHub):
- `ADMIN_PASSWORD` = a new, strong, unique password that you keep privately
- `SESSION_SECRET` = a randomly generated value of at least 32 characters

Do not send either secret in chat or commit it to the repository.

## 4. Test the public endpoint
After deployment, open:
`https://YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev/public/config`

It should return JSON containing an empty `keywords` array until initial portal data is migrated.

## 5. Share only the Worker URL
Once deployed, share only its public `workers.dev` URL. Never share the Admin password or session secret. The next step is to connect the portal login, public keyword feed, and authenticated data sync, then migrate existing local data without overwriting it.

## Important data-safety note
The current portal still stores existing keywords and posts in the browser's localStorage. The Worker is not yet connected to the page, and the current public read-only patch only hides editing controls; it is not server-side access control. Keep the original browser/profile and its data intact. Do not clear browser data or uninstall/reset anything. Export a backup before any migration.
