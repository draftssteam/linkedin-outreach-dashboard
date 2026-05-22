'use strict';

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const config    = require('./config.json');
const db        = require('./database');

const app  = express();
const PORT = process.env.PORT || config.server_port || 3000;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── LOGGING ──────────────────────────────────────────────────────────────────

const logsDir  = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
const logStream = fs.createWriteStream(path.join(logsDir, 'webhook.log'), { flags: 'a' });

function logWebhook(payload, note = '') {
  const line = JSON.stringify({ ts: new Date().toISOString(), note, payload }) + '\n';
  logStream.write(line);
}

// ─── SSE CLIENTS ──────────────────────────────────────────────────────────────

const sseClients = new Set();

function broadcastSSE(event, data) {
  const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(chunk); } catch (_) { sseClients.delete(res); }
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function resolveName(profileId) {
  if (!profileId) return null;
  return config.profiles[profileId] || profileId;
}

function parsePayload(raw) {
  const event_type = raw.event || raw.type || raw.event_type || 'unknown';

  const linkedin_profile_id = raw.account?.email
    || raw.account?.id
    || raw.profile_id
    || raw.sender_account
    || null;

  const linkedin_profile_name = resolveName(linkedin_profile_id);

  const contact = raw.contact || raw.lead || raw.prospect || {};
  const contact_name         = contact.full_name || contact.name || raw.contact_name || null;
  const contact_linkedin_url = contact.linkedin_url || contact.profile_url || raw.linkedin_url || null;
  const contact_email        = contact.email || raw.contact_email || null;
  const contact_phone        = contact.phone || raw.contact_phone || null;

  const campaign_name = raw.campaign?.name || raw.campaign_name || raw.sequence_name || null;

  const message_content   = raw.message?.text || raw.message?.body || raw.reply_text || raw.message_content || null;
  const message_direction = raw.message?.direction || (event_type === 'reply_received' ? 'inbound' : null);

  const tag_name     = raw.tag?.name || raw.tag_name  || null;
  const note_content = raw.note?.text || raw.note_content || null;

  const event_timestamp = raw.timestamp || raw.event_at || raw.created_at || new Date().toISOString();
  const received_at     = Date.now();
  const d               = new Date(event_timestamp);
  const day_of_week     = DAYS[d.getDay()];
  const hour_of_day     = d.getHours();

  return {
    event_type,
    linkedin_profile_id,
    linkedin_profile_name,
    contact_name,
    contact_linkedin_url,
    contact_email,
    contact_phone,
    campaign_name,
    message_content,
    message_direction,
    tag_name,
    note_content,
    event_timestamp,
    received_at,
    day_of_week,
    hour_of_day,
    raw_payload: JSON.stringify(raw),
  };
}

// ─── WEBHOOK RECEIVER ─────────────────────────────────────────────────────────

app.post('/webhook/closely', (req, res) => {
  res.status(200).json({ ok: true });

  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
      logWebhook(body, 'EMPTY_OR_MALFORMED');
      return;
    }

    logWebhook(body);
    const row = parsePayload(body);
    const id  = db.saveEvent(row);
    const saved = db.getEventById(id);
    broadcastSSE('new_event', saved);

  } catch (err) {
    logWebhook(req.body, `ERROR: ${err.message}`);
  }
});

// ─── TEST WEBHOOK ─────────────────────────────────────────────────────────────

app.post('/api/test-webhook', (req, res) => {
  const samples = require('./test-payload.json');
  const types   = Object.keys(samples);
  const type    = req.body?.type || types[Math.floor(Math.random() * types.length)];
  const payload = samples[type] || samples[types[0]];

  const row   = parsePayload(payload);
  const id    = db.saveEvent(row);
  const saved = db.getEventById(id);
  logWebhook(payload, 'TEST');
  broadcastSSE('new_event', saved);

  res.json({ ok: true, event: saved });
});

// ─── SSE ENDPOINT ─────────────────────────────────────────────────────────────

app.get('/api/live-feed', (req, res) => {
  res.set({
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (_) { clearInterval(heartbeat); }
  }, 20000);

  res.write('event: connected\ndata: ' + JSON.stringify({ ts: Date.now() }) + '\n\n');

  sseClients.add(res);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// ─── API ENDPOINTS ────────────────────────────────────────────────────────────

app.get('/api/events', (req, res) => {
  try { res.json(db.getEvents(req.query)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/stats', (_req, res) => {
  try { res.json(db.getStats()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/profiles', (_req, res) => {
  try { res.json(db.getProfiles()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/campaigns', (_req, res) => {
  try { res.json(db.getCampaigns()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/timeline', (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    res.json(db.getTimeline(days));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/breakdown', (_req, res) => {
  try { res.json(db.getEventBreakdown()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── START ────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  const base = process.env.RAILWAY_PUBLIC_DOMAIN
    ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN
    : 'http://localhost:' + PORT;
  console.log('\n LinkedIn Outreach Dashboard running!');
  console.log('   Dashboard : ' + base);
  console.log('   Webhook   : ' + base + '/webhook/closely');
  console.log('   Test      : ' + base + '/api/test-webhook\n');
});
