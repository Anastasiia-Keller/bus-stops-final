const express = require("express");
const mysql = require("mysql2");
const app = express();
const PORT = 3000;

// ===== DB =====
const db = mysql.createConnection({
  host: "d26893.mysql.zonevs.eu",
  user: "user",
  password: "password",
  database: "d26893_busstops"
});

db.connect(err => {
  if (err) {
    console.error("DB error:", err);
    return;
  }
  console.log("Connected to DB");
});

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.static(__dirname));

// ===== Simple in-memory cache for buses =====
const busesCache = new Map(); // stopId -> {expiresAt:number, data:any}
const BUSES_TTL_MS = 5 * 60 * 1000;

function getCachedBuses(stopId) {
  const hit = busesCache.get(String(stopId));
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    busesCache.delete(String(stopId));
    return null;
  }
  return hit.data;
}

function setCachedBuses(stopId, data) {
  busesCache.set(String(stopId), { expiresAt: Date.now() + BUSES_TTL_MS, data });
}

// ===== REGIONS =====
app.get("/regions", (req, res) => {
  const q = req.query.q || "";
  const sql = `
    SELECT DISTINCT authority AS region
    FROM anastasiia_k_stops
    WHERE authority IS NOT NULL
      AND authority <> ''
      AND authority LIKE CONCAT(?, '%')
    ORDER BY authority
    LIMIT 1000
  `;
  db.query(sql, [q], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

// ===== STOPS =====
app.get("/stops", (req, res) => {
  const { region, q = "" } = req.query;

  if (!region) return res.status(400).json({ error: "region is required" });

  const sql = `
    SELECT s.stop_id, s.stop_name, s.stop_lat, s.stop_lon, s.stop_desc
    FROM anastasiia_k_stops s
    WHERE s.authority = ?
      AND s.stop_name LIKE CONCAT(?, '%')
      AND EXISTS (
        SELECT 1
        FROM anastasiia_k_stop_times st
        WHERE st.stop_id = s.stop_id
        LIMIT 1
      )
    ORDER BY s.stop_name
    LIMIT 2000
  `;

  db.query(sql, [region, q], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows);
  });
});

// ===== BUSES (optimized + cached) =====
app.get("/buses", (req, res) => {
  const stopId = req.query.stopId;
  if (!stopId) return res.status(400).json({ error: "stopId is required" });

  const cached = getCachedBuses(stopId);
  if (cached) return res.json(cached);

  const sql = `
    SELECT
      r.route_short_name,
      COALESCE(NULLIF(TRIM(t.trip_headsign), ''), 'none') AS trip_headsign
    FROM anastasiia_k_trips t
    JOIN anastasiia_k_routes r ON t.route_id = r.route_id
    WHERE EXISTS (
      SELECT 1
      FROM anastasiia_k_stop_times st
      WHERE st.trip_id = t.trip_id
        AND st.stop_id = ?
    )
    GROUP BY r.route_short_name, trip_headsign
    ORDER BY r.route_short_name, trip_headsign
  `;

  db.query(sql, [stopId], (err, rows) => {
    if (err) return res.status(500).json(err);

    setCachedBuses(stopId, rows);
    res.json(rows);
  });
});

// ===== ARRIVALS (all within next 24h) =====
app.get("/arrivals", (req, res) => {
  const { stopId, route, headsign } = req.query;
  if (!stopId || !route) {
    return res.status(400).json({ error: "stopId and route are required" });
  }

  let sql = `
    SELECT DISTINCT st.departure_time
    FROM anastasiia_k_stop_times st
    JOIN anastasiia_k_trips t ON st.trip_id = t.trip_id
    JOIN anastasiia_k_routes r ON t.route_id = r.route_id
    WHERE st.stop_id = ?
      AND r.route_short_name = ?
  `;
  const params = [stopId, route];

  if (headsign === "none") {
    sql += " AND (t.trip_headsign IS NULL OR TRIM(t.trip_headsign) = '')";
  } else if (headsign) {
    sql += " AND t.trip_headsign = ?";
    params.push(headsign);
  }

  sql += " ORDER BY st.departure_time LIMIT 500";

  db.query(sql, params, (err, rows) => {
    if (err) return res.status(500).json(err);

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    const upcoming = rows
      .map(r => String(r.departure_time))
      .map(t => {
        const [hh, mm] = t.split(":").map(Number);
        if (Number.isNaN(hh) || Number.isNaN(mm)) return null;

        let raw = hh * 60 + mm;       // can be > 1440 in GTFS
        let adjusted = raw;

        // If time is in 0..1439 but already passed today, treat as tomorrow
        if (raw < 1440 && raw < nowMin) adjusted = raw + 1440;

        const diff = adjusted - nowMin;
        if (diff < 0 || diff > 1440) return null; // only next 24 hours

        const isTomorrow = adjusted >= 1440;
        const hhOut = Math.floor((adjusted % 1440) / 60);
        const mmOut = (adjusted % 1440) % 60;

        const timeStr = `${String(hhOut).padStart(2, "0")}:${String(mmOut).padStart(2, "0")}`;
        return { adjusted, timeStr, isTomorrow };
      })
      .filter(Boolean)
      .sort((a, b) => a.adjusted - b.adjusted)
      .slice(0, 200)
      .map(x => (x.isTomorrow ? `${x.timeStr} (tomorrow)` : x.timeStr));

    res.json(upcoming);
  });
});

// ===== NEAREST STOP =====
app.get("/nearest-stop", (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: "lat and lon are required" });

  const sql = `
    SELECT s.stop_id, s.stop_name, s.stop_lat, s.stop_lon, s.authority AS region
    FROM anastasiia_k_stops s
    WHERE EXISTS (
      SELECT 1
      FROM anastasiia_k_stop_times st
      WHERE st.stop_id = s.stop_id
      LIMIT 1
    )
    ORDER BY POW(s.stop_lat - ?, 2) + POW(s.stop_lon - ?, 2)
    LIMIT 1
  `;

  db.query(sql, [lat, lon], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows[0]);
  });
});

// ===== STOP STATS (debug) =====
app.get("/stop-stats", (req, res) => {
  const { stopId } = req.query;
  if (!stopId) return res.status(400).json({ error: "stopId is required" });

  const sql = `
    SELECT
      (SELECT COUNT(*) FROM anastasiia_k_stop_times WHERE stop_id = ?) AS stop_times_rows,
      (SELECT COUNT(DISTINCT trip_id) FROM anastasiia_k_stop_times WHERE stop_id = ?) AS distinct_trips
  `;
  db.query(sql, [stopId, stopId], (err, rows) => {
    if (err) return res.status(500).json(err);
    res.json(rows[0]);
  });
});

// ===== START =====
app.listen(PORT, () => {
  console.log("Server running on http://localhost:" + PORT);
});
