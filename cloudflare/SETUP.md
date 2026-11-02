# SocialDesk Admin API setup (free-tier friendly)

This Worker is separate from the existing Gemini AI Worker. Do not replace or edit the Gemini Worker.

## 1. Create a KV namespace
In Cloudflare Dashboard, open **Workers & Pages → KV** and create a namespace named something like `SOCIALDESK_DATA`.

## 2. Create the Worker
Create a new Worker named `socialdesk-admin-api`. Copy the contents of `cloudflare/socialdesk-admin-api.js` into its editor and deploy.

## 3. Add the KV binding
In the new Worker settings, add a KV namespace binding:
- Variable name: `SOCIALDESK_KV`
- KV namespace: the namespace created in step 1

## 4. Add configuration
Add this plain-text Worker variable:
- `ALLOWED_ORIGIN` = `https://akhandpratap93-jpg.github.io`

Add these as **Worker secrets** (not plain-text variables and never in GitHub):
- `ADMIN_PASSWORD` = a new, strong, unique password that you keep privately
- `SESSION_SECRET` = a randomly generated value of at least 32 characters

Do not send either secret in chat or commit it to the repository.

## 5. Test the Worker
After deployment, open:
`https://YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev/public/config`

It should return JSON containing an empty `keywords` array until the initial portal data is migrated.

## 6. Important: do not migrate yet
The current portal still stores existing keywords and posts in the browser's localStorage. The Worker is not yet connected to the page, and the current public read-only patch only hides editing controls; it is not server-side access control. Keep the original browser/profile and its data intact. Do not clear browser data or uninstall/reset anything.

Once the Worker is deployed, share only its public `workers.dev` URL. Never share the Admin password or session secret. The next step is to connect the portal login, public keyword feed, and authenticated data sync, then migrate the existing local data without overwriting it.
