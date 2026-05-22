# 🔗 LinkedIn Outreach Dashboard

A real-time dashboard that catches webhooks from **CloselyHQ** and shows everything happening across all your LinkedIn outreach campaigns — connections, replies, tags, notes — live in your browser.

---

## What This Does

Whenever something happens in CloselyHQ (someone accepts a connection, someone replies, a tag is added), CloselyHQ fires an automatic notification to your server. This dashboard catches those notifications and shows them instantly — no manual refresh needed.

---

## Step 1 — Install Node.js

Node.js is the engine that runs this server.

1. Go to **https://nodejs.org**
2. Click the big green **"LTS"** download button (the recommended version)
3. Run the installer — just click Next through everything
4. When done, open a **Terminal** (Mac) or **Command Prompt** (Windows) and type:
   ```
   node --version
   ```
   You should see something like `v20.11.0`. That means it worked!

---

## Step 2 — Set Up the Dashboard

1. **Download or copy** this entire `linkedin-dashboard` folder to your computer

2. Open a **Terminal** / **Command Prompt** and navigate into the folder:
   ```
   cd path/to/linkedin-dashboard
   ```
   *(Tip: on Mac, drag the folder into the Terminal window after typing `cd ` — it fills the path automatically)*

3. Install the required packages:
   ```
   npm install
   ```
   This downloads the tools the server needs. You'll see a progress bar. Wait for it to finish.

---

## Step 3 — Add Your LinkedIn Profile Names

Open the file `config.json` in any text editor (Notepad works fine).

You'll see:
```json
{
  "profiles": {
    "john@company.com": "John Smith — Sales",
    "sarah@company.com": "Sarah Khan — Partnerships",
    "mike@company.com": "Mike Rao — Founder"
  },
  "server_port": 3000
}
```

**Replace the email addresses** with the actual email addresses used in your CloselyHQ accounts, and replace the names with the real names of the people. Save the file.

> 💡 The email here is the account email linked to each LinkedIn profile in CloselyHQ — not the LinkedIn login email.

---

## Step 4 — Start the Server

In your Terminal (still inside the `linkedin-dashboard` folder), run:
```
node server.js
```

You should see:
```
✅  LinkedIn Outreach Dashboard is running!
   Dashboard  → http://localhost:3000
   Webhook    → http://localhost:3000/webhook/closely
   Test event → POST http://localhost:3000/api/test-webhook
```

**Leave this Terminal window open** — the server runs as long as it's open.

Open your browser and go to: **http://localhost:3000**

You'll see the dashboard (it will show zeros until real webhooks arrive).

---

## Step 5 — Get a Public URL with ngrok

CloselyHQ needs to reach your server over the internet, but your laptop isn't publicly accessible. **ngrok** creates a public tunnel to your local server.

### Install ngrok

1. Go to **https://ngrok.com** and create a free account
2. Download ngrok for your operating system
3. Follow the setup instructions on their website to authenticate (you'll run one command with your auth token)

### Start the tunnel

Open a **second Terminal window** (keep the first one running `node server.js`) and run:
```
ngrok http 3000
```

You'll see output like:
```
Forwarding   https://abc123def456.ngrok-free.app → http://localhost:3000
```

**Copy that `https://...ngrok-free.app` URL** — you'll need it in the next step.

> ⚠️ This ngrok URL changes every time you restart ngrok (on the free plan). Each time you restart, you'll need to update the webhook URL in CloselyHQ.

---

## Step 6 — Set Up the Webhook in CloselyHQ

1. Log into your CloselyHQ account
2. Go to **Settings** → **Integrations** → **Webhooks**
3. Click **Add Webhook** (or similar button)
4. In the **URL** field, paste:
   ```
   https://YOUR-NGROK-URL/webhook/closely
   ```
   *(Replace `YOUR-NGROK-URL` with the actual URL you copied from ngrok)*
5. Enable these event triggers:
   - ✅ `connection_accepted`
   - ✅ `reply_received`
   - ✅ `tag_added`
   - ✅ `tag_removed`
   - ✅ `note_added`
6. Save the webhook

---

## Step 7 — Test It Works

### Option A — Built-in test button
Open your dashboard at `http://localhost:3000` and click the **"🧪 Fire Test Event"** link at the bottom. You should see a live event appear in the feed within a second.

### Option B — Test with curl (Terminal)
Run this command (replace the URL with your ngrok URL or use localhost for local testing):
```
curl -X POST http://localhost:3000/api/test-webhook \
  -H "Content-Type: application/json" \
  -d '{"type": "connection_accepted"}'
```

You should see a green toast notification pop up in the dashboard and a new entry appear in the Live Feed.

### Option C — Real CloselyHQ test
In CloselyHQ's webhook settings, there's usually a **"Send Test"** or **"Test Webhook"** button. Click it and watch your dashboard update.

---

## Understanding the Dashboard

| Section | What it shows |
|---|---|
| **Top cards** | At-a-glance totals across all profiles |
| **Profile cards** | Stats per LinkedIn account |
| **Live Feed** | Every event as it happens, newest first |
| **Events table** | Full searchable/filterable history — export to CSV |
| **Charts** | Visual trends over time |
| **Campaign table** | Side-by-side comparison of all campaigns |

---

## Troubleshooting

**Dashboard shows "OFFLINE"**
→ The SSE connection is broken. Check that `node server.js` is still running in your Terminal. Refresh the browser page.

**Webhooks arrive but dashboard doesn't update**
→ Hard-refresh the browser (Ctrl+Shift+R / Cmd+Shift+R). Check the Terminal for any error messages.

**"Cannot find module 'better-sqlite3'"**
→ You haven't run `npm install` yet. Run it in the `linkedin-dashboard` folder.

**ngrok URL says "Tunnel not found"**
→ ngrok has stopped. Re-run `ngrok http 3000` and update the webhook URL in CloselyHQ with the new URL.

**No events showing up**
→ Make sure the webhook URL in CloselyHQ is the correct ngrok URL. Make sure CloselyHQ has the webhook enabled. Fire a manual test event using the curl command above.

**Port 3000 already in use**
→ Change `"server_port": 3001` (or any free port) in `config.json` and restart the server. Update ngrok to use the same port: `ngrok http 3001`.

---

## GitHub Setup

To push this to GitHub:

```bash
git init
git add .
git commit -m "Initial LinkedIn Outreach Dashboard"
git remote add origin https://github.com/YOUR_USERNAME/linkedin-dashboard.git
git push -u origin main
```

> The `.gitignore` file already excludes your database, logs, and `node_modules` — so only the code is committed, not your data.

---

## File Structure

```
linkedin-dashboard/
├── server.js           ← The web server (run this)
├── database.js         ← Database queries (auto-loaded by server)
├── config.json         ← Your profile names — EDIT THIS
├── package.json        ← Package info (don't edit)
├── test-payload.json   ← Sample webhook data for testing
├── .gitignore          ← Files excluded from git
├── logs/
│   └── webhook.log     ← Every raw webhook payload (auto-created)
├── data/
│   └── outreach.db     ← Your data — SQLite (auto-created)
└── public/
    ├── index.html      ← The dashboard page
    ├── style.css       ← Dashboard styles
    └── app.js          ← Dashboard logic
```

---

*Built for CloselyHQ webhook integration. Works with Node.js 18+.*
