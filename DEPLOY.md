# Deploy: GitHub Pages + Railway (free tiers)

This gets a **shareable game link** (GitHub Pages) and a **WebSocket relay** (Railway) so friends can use **Find game → Online (relay)** from anywhere.

## 1. Push this repo to GitHub

Create a new repository on GitHub, then from your machine:

```bash
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git branch -M main
git push -u origin main
```

## 2. Deploy the relay on Railway

1. Open [railway.com](https://railway.com) and sign in (GitHub login is fine).
2. **New project** → **Deploy from GitHub repo** → choose this repository.
3. Railway should detect Node and use `railway.toml` / `Procfile`: start command is `node server/relay.mjs`.
4. After the first deploy succeeds, open your service → **Settings** → **Networking** → **Generate domain** (or use the default public URL).
5. Copy the **HTTPS** URL of the service, then form the WebSocket URL:
   - If the app URL is `https://something.up.railway.app`, your relay is usually  
     **`wss://something.up.railway.app`**  
     (same host, `wss://` instead of `https://`).

Keep this `wss://…` string for the next step.

## 3. GitHub secret for the game site

1. On GitHub: your repo → **Settings** → **Secrets and variables** → **Actions**.
2. **New repository secret**:
   - Name: `BREW_RELAY_WSS_URL`
   - Value: your Railway WebSocket URL, e.g. `wss://something.up.railway.app`

## 4. Enable GitHub Pages (Actions)

1. Repo → **Settings** → **Pages**.
2. **Build and deployment** → **Source**: **GitHub Actions** (not “Deploy from a branch”).

## 5. Run the deploy workflow

- Push any commit to `main`, or  
- **Actions** → **Deploy to GitHub Pages** → **Run workflow**.

When it finishes, Pages shows your site URL (often `https://YOUR_USER.github.io/YOUR_REPO/`).

## 6. Send the link

Share **only the GitHub Pages URL** with friends. The build injects the Railway `wss://` address into the page automatically (via the secret).

### If multiplayer does not connect

- Confirm the Railway service is **running** (not sleeping on a cold free tier — retry after a few seconds).
- Confirm `BREW_RELAY_WSS_URL` is **`wss://`**, not `https://` or `ws://` (Pages is HTTPS; the browser requires secure WebSockets).
- Redeploy Pages after changing the secret: **Actions** → re-run the last workflow, or push an empty commit.

## Local development

- Game: `npm start` → open the printed URL.
- Relay: `npm run relay` (port **8787** by default).
- Default relay in `index.html` is `ws://127.0.0.1:8787` for local testing; production uses the secret only in the CI-built `_site` output.
