# 🚀 Deploying to GitHub + Railway

This guide gets your dashboard live on the internet — with a permanent public URL your whole team and clients can visit, no ngrok needed.

**Time needed:** ~15 minutes  
**Cost:** Free (Railway free tier is enough to start)

---

## Part 1 — Push to GitHub

### Step 1 — Create a GitHub account (if you don't have one)
Go to **https://github.com** and sign up. It's free.

### Step 2 — Install Git

**Mac:** Open Terminal and type `git --version`. If it's not installed, it'll prompt you to install it automatically.

**Windows:** Download from **https://git-scm.com/download/win** → run the installer (click Next through everything).

### Step 3 — Create a new GitHub repository

1. Log into GitHub
2. Click the **+** icon (top-right) → **New repository**
3. Name it: `linkedin-outreach-dashboard`
4. Set it to **Private** (so only people you invite can see it)
5. Leave everything else unchecked
6. Click **Create repository**

### Step 4 — Update your profile names in config.json

Before pushing, open `config.json` and replace the example emails and names with your real ones:
```json
{
  "profiles": {
    "your-actual-email@company.com": "Your Name — Your Role",
    "second-person@company.com": "Their Name — Their Role"
  },
  "server_port": 3000
}
```
Save the file.

### Step 5 — Push your code to GitHub

Open Terminal / Command Prompt inside the `linkedin-dashboard` folder and run these commands **one by one**:

```bash
git init
git add .
git commit -m "Initial LinkedIn Outreach Dashboard"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/linkedin-outreach-dashboard.git
git push -u origin main
```

> 💡 Replace `YOUR_USERNAME` with your actual GitHub username. GitHub will ask for your username and password the first time.

Your code is now on GitHub! Visit `https://github.com/YOUR_USERNAME/linkedin-outreach-dashboard` to see it.

---

## Part 2 — Deploy Live with Railway

Railway hosts your Node.js server on the internet 24/7, giving you a permanent URL like `https://linkedin-dashboard-production.up.railway.app`.

### Step 1 — Create a Railway account

1. Go to **https://railway.app**
2. Click **Login** → **Login with GitHub** (connect your GitHub account)
3. This lets Railway automatically pull your code

### Step 2 — Create a new project

1. Click **New Project**
2. Select **Deploy from GitHub repo**
3. Find and select `linkedin-outreach-dashboard`
4. Click **Deploy Now**

Railway will start building your app. This takes 2–3 minutes the first time (it's compiling the SQLite library). You'll see build logs scrolling — this is normal.

### Step 3 — Set up a Volume (so your data survives restarts)

By default, Railway wipes the filesystem when it restarts. To keep your outreach data, you need a **Volume**:

1. In your Railway project, click **+ New** → **Volume**
2. Set **Mount Path** to: `/app/data`
3. Click **Add**

This tells Railway: "keep the `data/` folder permanently, even when the server restarts."

### Step 4 — Get your public URL

1. Click on your service (the main box in the project)
2. Go to the **Settings** tab
3. Under **Networking** → **Public Networking**, click **Generate Domain**
4. Copy your URL — it looks like: `https://linkedin-dashboard-production.up.railway.app`

Open it in your browser — your dashboard is live! 🎉

### Step 5 — Update CloselyHQ with your permanent URL

1. Go to CloselyHQ → **Settings** → **Integrations** → **Webhooks**
2. Update the webhook URL to:
   ```
   https://YOUR-RAILWAY-URL/webhook/closely
   ```
3. Save

No more ngrok! This URL works 24/7 and never changes.

---

## Part 3 — Invite Your Team to GitHub

So your team can see the code and make changes:

1. Go to your GitHub repo → **Settings** → **Collaborators**
2. Click **Add people** and enter their GitHub username or email
3. They'll get an email invite

To invite a **client** who just wants to view (read-only):
- Keep the repo private and add them as a collaborator with "Read" access
- Or make the repo public if you're comfortable with that

---

## Keeping the Dashboard Updated

Whenever you change any code (e.g., add a new profile to `config.json`), update Railway automatically:

```bash
git add .
git commit -m "Add new LinkedIn profile"
git push
```

Railway detects the push and redeploys automatically — usually takes under 2 minutes.

---

## Architecture Overview

```
CloselyHQ
    │
    │ POST /webhook/closely
    ▼
Railway (your live server — 24/7)
    │ stores events in
    ▼
SQLite DB (Railway Volume — persistent)
    │ serves dashboard at
    ▼
https://your-app.up.railway.app
    │
    ├── Your Team (browser)
    ├── Your Client (browser)
    └── You (browser)
```

---

## Troubleshooting

**Build fails on Railway**
→ Check the build logs in Railway for the exact error. Most common cause: Railway couldn't compile better-sqlite3. The `nixpacks.toml` file already handles this — if it still fails, go to Railway → your service → Settings → Environment and add: `NODE_ENV=production`

**Dashboard shows "OFFLINE"**
→ The SSE connection dropped. Hard-refresh the browser (Ctrl+Shift+R). If it stays offline, check Railway logs for server errors.

**Data disappears after redeploy**
→ You haven't set up the Volume yet. Follow Step 3 in Part 2 above.

**"Application failed to respond" on Railway**
→ The server crashed. Check Railway logs. Usually a missing `node_modules` — Railway should handle this but you can trigger a manual redeploy from the Railway dashboard.

**CloselyHQ webhooks not arriving**
→ Make sure the webhook URL in CloselyHQ is your Railway URL (not the old ngrok URL). Test using the 🧪 button at the bottom of the dashboard.
