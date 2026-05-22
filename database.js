'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'outreach.db'));

// Performance pragmas
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// ─── SCHEMA ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type            TEXT NOT NULL,
    linkedin_profile_id   TEXT,
    linkedin_profile_name TEXT,
    contact_name          TEXT,
    contact_linkedin_url  TEXT,
    contact_email         TEXT,
    contact_phone         TEXT,
    campaign_name         TEXT,
    message_content       TEXT,
    message_direction     TEXT,
    tag_name              TEXT,
    note_content          TEXT,
    event_timestamp       TEXT,
    received_at           INTEGER NOT NULL,
    day_of_week           TEXT,
    hour_of_day           INTEGER,
    raw_payload           TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_event_type       ON events(event_type);
  CREATE INDEX IF NOT EXISTS idx_profile_id       ON events(linkedin_profile_id);
  CREATE INDEX IF NOT EXISTS idx_campaign         ON events(campaign_name);
  CREATE INDEX IF NOT EXISTS idx_received_at      ON events(received_at);
  CREATE INDEX IF NOT EXISTS idx_event_timestamp  ON events(event_timestamp);
`);

// ─── INSERT ───────────────────────────────────────────────────────────────────

const insertEvent = db.prepare(`
  INSERT INTO events (
    event_type, linkedin_profile_id, linkedin_profile_name,
    contact_name, contact_linkedin_url, contact_email, contact_phone,
    campaign_name, message_content, message_direction, tag_name, note_content,
    event_timestamp, received_at, day_of_week, hour_of_day, raw_payload
  ) VALUES (
    @event_type, @linkedin_profile_id, @linkedin_profile_name,
    @contact_name, @contact_linkedin_url, @contact_email, @contact_phone,
    @campaign_name, @message_content, @message_direction, @tag_name, @note_content,
    @event_timestamp, @received_at, @day_of_week, @hour_of_day, @raw_payload
  )
`);

function saveEvent(data) {
  const info = insertEvent.run(data);
  return info.lastInsertRowid;
}

// ─── LIST EVENTS (paginated, filtered) ───────────────────────────────────────

function getEvents({ profile, event_type, campaign, date_from, date_to, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = {};

  if (profile)     { conditions.push('linkedin_profile_id = @profile');     params.profile = profile; }
  if (event_type)  { conditions.push('event_type = @event_type');            params.event_type = event_type; }
  if (campaign)    { conditions.push('campaign_name = @campaign');           params.campaign = campaign; }
  if (date_from)   { conditions.push('event_timestamp >= @date_from');       params.date_from = date_from; }
  if (date_to)     { conditions.push('event_timestamp <= @date_to');         params.date_to = date_to + 'T23:59:59'; }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.limit  = parseInt(limit, 10)  || 50;
  params.offset = parseInt(offset, 10) || 0;

  const rows  = db.prepare(`SELECT * FROM events ${where} ORDER BY received_at DESC LIMIT @limit OFFSET @offset`).all(params);
  const total = db.prepare(`SELECT COUNT(*) as count FROM events ${where}`).get(params).count;

  return { rows, total };
}

function getEventById(id) {
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id);
}

// ─── AGGREGATE STATS ──────────────────────────────────────────────────────────

function getStats() {
  const overall = db.prepare(`
    SELECT
      COUNT(CASE WHEN event_type = 'connection_accepted' THEN 1 END) AS accepted,
      COUNT(CASE WHEN event_type = 'reply_received'      THEN 1 END) AS replied,
      COUNT(DISTINCT CASE WHEN event_type = 'reply_received' THEN contact_linkedin_url END) AS conversations
    FROM events
  `).get();

  // Invites sent = connection_accepted events (each acceptance implies an invite)
  // In real usage you may also track invite_sent events; for now accepted = proxy
  overall.invites_sent = overall.accepted;
  overall.acceptance_rate = overall.invites_sent > 0
    ? ((overall.accepted / overall.invites_sent) * 100).toFixed(1)
    : '0.0';
  overall.reply_rate = overall.accepted > 0
    ? ((overall.replied / overall.accepted) * 100).toFixed(1)
    : '0.0';

  // Per profile
  const byProfile = db.prepare(`
    SELECT
      linkedin_profile_id,
      linkedin_profile_name,
      COUNT(CASE WHEN event_type = 'connection_accepted' THEN 1 END) AS accepted,
      COUNT(CASE WHEN event_type = 'reply_received'      THEN 1 END) AS replied,
      COUNT(DISTINCT CASE WHEN event_type = 'reply_received' THEN contact_linkedin_url END) AS conversations
    FROM events
    WHERE linkedin_profile_id IS NOT NULL
    GROUP BY linkedin_profile_id
  `).all();

  byProfile.forEach(p => {
    p.invites_sent    = p.accepted;
    p.acceptance_rate = p.invites_sent > 0 ? ((p.accepted / p.invites_sent) * 100).toFixed(1) : '0.0';
    p.reply_rate      = p.accepted > 0     ? ((p.replied / p.accepted) * 100).toFixed(1)       : '0.0';
  });

  // Per campaign
  const byCampaign = db.prepare(`
    SELECT
      campaign_name,
      GROUP_CONCAT(DISTINCT linkedin_profile_name) AS profiles,
      MIN(event_timestamp) AS start_date,
      COUNT(CASE WHEN event_type = 'connection_accepted' THEN 1 END) AS accepted,
      COUNT(CASE WHEN event_type = 'reply_received'      THEN 1 END) AS replied
    FROM events
    WHERE campaign_name IS NOT NULL
    GROUP BY campaign_name
    ORDER BY accepted DESC
  `).all();

  byCampaign.forEach(c => {
    c.invites_sent    = c.accepted;
    c.acceptance_rate = c.invites_sent > 0 ? ((c.accepted / c.invites_sent) * 100).toFixed(1) : '0.0';
    c.reply_rate      = c.accepted > 0     ? ((c.replied / c.accepted) * 100).toFixed(1)       : '0.0';
  });

  return { overall, byProfile, byCampaign };
}

// ─── PROFILES LIST ────────────────────────────────────────────────────────────

function getProfiles() {
  const profiles = db.prepare(`
    SELECT
      linkedin_profile_id,
      linkedin_profile_name,
      COUNT(*)                                                          AS total_events,
      COUNT(CASE WHEN event_type = 'connection_accepted' THEN 1 END)   AS accepted,
      COUNT(CASE WHEN event_type = 'reply_received'      THEN 1 END)   AS replied,
      MAX(received_at)                                                  AS last_active,
      GROUP_CONCAT(DISTINCT campaign_name)                              AS campaigns
    FROM events
    WHERE linkedin_profile_id IS NOT NULL
    GROUP BY linkedin_profile_id
    ORDER BY last_active DESC
  `).all();

  profiles.forEach(p => {
    p.invites_sent    = p.accepted;
    p.acceptance_rate = p.invites_sent > 0 ? ((p.accepted / p.invites_sent) * 100).toFixed(1) : '0.0';
    p.reply_rate      = p.accepted > 0     ? ((p.replied / p.accepted) * 100).toFixed(1)       : '0.0';
    p.campaigns       = p.campaigns ? p.campaigns.split(',').filter(Boolean) : [];
  });

  return profiles;
}

// ─── CAMPAIGNS LIST ───────────────────────────────────────────────────────────

function getCampaigns() {
  const campaigns = db.prepare(`
    SELECT
      campaign_name,
      GROUP_CONCAT(DISTINCT linkedin_profile_name)                     AS profiles,
      MIN(event_timestamp)                                             AS start_date,
      MAX(event_timestamp)                                             AS last_event,
      COUNT(*)                                                         AS total_events,
      COUNT(CASE WHEN event_type = 'connection_accepted' THEN 1 END)  AS accepted,
      COUNT(CASE WHEN event_type = 'reply_received'      THEN 1 END)  AS replied
    FROM events
    WHERE campaign_name IS NOT NULL
    GROUP BY campaign_name
    ORDER BY accepted DESC
  `).all();

  campaigns.forEach(c => {
    c.invites_sent    = c.accepted;
    c.acceptance_rate = c.invites_sent > 0 ? ((c.accepted / c.invites_sent) * 100).toFixed(1) : '0.0';
    c.reply_rate      = c.accepted > 0     ? ((c.replied / c.accepted) * 100).toFixed(1)       : '0.0';
    c.profiles        = c.profiles ? c.profiles.split(',').filter(Boolean) : [];
    // Consider active if an event in last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    c.status = c.last_event >= sevenDaysAgo ? 'Active' : 'Completed';
  });

  return campaigns;
}

// ─── TIMELINE ─────────────────────────────────────────────────────────────────

function getTimeline(days = 30) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  return db.prepare(`
    SELECT
      DATE(event_timestamp) AS date,
      event_type,
      COUNT(*) AS count
    FROM events
    WHERE event_timestamp >= @since
    GROUP BY date, event_type
    ORDER BY date ASC
  `).all({ since });
}

// ─── EVENT TYPE BREAKDOWN ─────────────────────────────────────────────────────

function getEventBreakdown() {
  return db.prepare(`
    SELECT event_type, COUNT(*) AS count
    FROM events
    GROUP BY event_type
    ORDER BY count DESC
  `).all();
}

module.exports = {
  db,
  saveEvent,
  getEvents,
  getEventById,
  getStats,
  getProfiles,
  getCampaigns,
  getTimeline,
  getEventBreakdown,
};
