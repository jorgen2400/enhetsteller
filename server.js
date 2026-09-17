"use strict";

const path = require("path");
const express = require("express");
const { Pool } = require("pg");

const ITEM_IDS = ["ol_033", "ol_04", "ol_05", "ol_06", "ol_075", "vin_25", "vin_75", "drink", "shot"];

// Samme omregningsfaktorer til "0,5 L øl-ekvivalenter" som i public/app.js
// (ITEMS). Holdes i sync manuelt — brukes til å regne ut totalen på
// resultattavlen direkte i SQL.
const ITEM_FACTORS = {
  ol_033: 0.66,
  ol_04: 0.8,
  ol_05: 1.0,
  ol_06: 1.2,
  ol_075: 1.5,
  vin_25: 1.0,
  vin_75: 4.0,
  drink: 1.0,
  shot: 1.0
};

const DEVICE_RE = /^[a-zA-Z0-9-]{8,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NAME_RE = /^.{1,40}$/;

function unitsCaseSql(itemIdColumn, countColumn) {
  const cases = ITEM_IDS.map((id) => `WHEN '${id}' THEN ${ITEM_FACTORS[id]}`).join(" ");
  return `(CASE ${itemIdColumn} ${cases} ELSE 0 END) * ${countColumn}`;
}

const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.warn(
    "ADVARSEL: DATABASE_URL er ikke satt. Legg til en Postgres-database i Railway-prosjektet " +
      "og koble den til denne tjenesten (variabelen settes da automatisk)."
  );
}

// Railway sin interne Postgres krever vanligvis ikke SSL, men eksterne/andre
// leverandører gjør ofte det. rejectUnauthorized:false takler selvsignerte
// sertifikater. Sett PGSSL=disable som miljøvariabel om du får SSL-feil mot
// en database som ikke bruker SSL i det hele tatt.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entries (
      device_id   TEXT NOT NULL,
      entry_date  DATE NOT NULL,
      item_id     TEXT NOT NULL,
      count       INTEGER NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (device_id, entry_date, item_id)
    );
  `);

  // Navn knyttet til en enhets-ID — kun de som har satt et navn vises på
  // resultattavlen (side 3).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      device_id   TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "connected" });
  } catch (e) {
    res.status(500).json({ ok: false, db: "unreachable", error: String(e.message || e) });
  }
});

// Hent all lagret data for én anonym enhets-ID: { "YYYY-MM-DD": { itemId: count, ... }, ... }
app.get("/api/entries", async (req, res) => {
  const device = String(req.query.device || "");
  if (!DEVICE_RE.test(device)) {
    return res.status(400).json({ error: "ugyldig device-id" });
  }
  try {
    const { rows } = await pool.query(
      "SELECT entry_date, item_id, count FROM entries WHERE device_id = $1",
      [device]
    );
    const data = {};
    rows.forEach((r) => {
      const dateKey = r.entry_date.toISOString().slice(0, 10);
      if (!data[dateKey]) data[dateKey] = {};
      data[dateKey][r.item_id] = r.count;
    });
    res.json(data);
  } catch (e) {
    console.error("GET /api/entries feilet:", e);
    res.status(500).json({ error: "serverfeil" });
  }
});

// Sett antall for én (device, dato, type) — 0 sletter raden.
app.put("/api/entries", async (req, res) => {
  const body = req.body || {};
  const device = String(body.device || "");
  const date = String(body.date || "");
  const itemId = String(body.itemId || "");
  const count = Number.parseInt(body.count, 10);

  if (!DEVICE_RE.test(device)) return res.status(400).json({ error: "ugyldig device-id" });
  if (!DATE_RE.test(date)) return res.status(400).json({ error: "ugyldig dato" });
  if (!ITEM_IDS.includes(itemId)) return res.status(400).json({ error: "ugyldig type" });
  if (!Number.isFinite(count) || count < 0) return res.status(400).json({ error: "ugyldig antall" });

  try {
    if (count === 0) {
      await pool.query(
        "DELETE FROM entries WHERE device_id = $1 AND entry_date = $2 AND item_id = $3",
        [device, date, itemId]
      );
    } else {
      await pool.query(
        `INSERT INTO entries (device_id, entry_date, item_id, count, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (device_id, entry_date, item_id)
         DO UPDATE SET count = EXCLUDED.count, updated_at = now()`,
        [device, date, itemId, count]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("PUT /api/entries feilet:", e);
    res.status(500).json({ error: "serverfeil" });
  }
});

// Hent navnet som er lagret for én enhets-ID (for å forhåndsutfylle feltet).
app.get("/api/player", async (req, res) => {
  const device = String(req.query.device || "");
  if (!DEVICE_RE.test(device)) return res.status(400).json({ error: "ugyldig device-id" });
  try {
    const { rows } = await pool.query("SELECT name FROM players WHERE device_id = $1", [device]);
    res.json({ name: rows.length ? rows[0].name : null });
  } catch (e) {
    console.error("GET /api/player feilet:", e);
    res.status(500).json({ error: "serverfeil" });
  }
});

// Sett/oppdater navnet knyttet til denne enhets-IDen.
app.put("/api/player", async (req, res) => {
  const body = req.body || {};
  const device = String(body.device || "");
  const name = String(body.name || "").trim();

  if (!DEVICE_RE.test(device)) return res.status(400).json({ error: "ugyldig device-id" });
  if (!NAME_RE.test(name)) return res.status(400).json({ error: "ugyldig navn" });

  try {
    await pool.query(
      `INSERT INTO players (device_id, name, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (device_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
      [device, name]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("PUT /api/player feilet:", e);
    res.status(500).json({ error: "serverfeil" });
  }
});

// Resultattavle: navn + total antall enheter (omregnet til 0,5L øl), kun for
// enheter som har satt et navn — sortert høyest total først.
app.get("/api/scoreboard", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.name AS name,
             COALESCE(SUM(${unitsCaseSql("e.item_id", "e.count")}), 0) AS total_units
      FROM players p
      LEFT JOIN entries e ON e.device_id = p.device_id
      GROUP BY p.device_id, p.name
      ORDER BY total_units DESC, p.name ASC
    `);
    const scoreboard = rows.map((r) => ({
      name: r.name,
      totalUnits: Math.round(Number(r.total_units) * 10) / 10
    }));
    res.json(scoreboard);
  } catch (e) {
    console.error("GET /api/scoreboard feilet:", e);
    res.status(500).json({ error: "serverfeil" });
  }
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Enhetsteller kjører på port ${PORT}`);
    });
  })
  .catch((e) => {
    console.error("Klarte ikke å sette opp databasen:", e);
    process.exit(1);
  });
