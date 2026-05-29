import { expandOccupiedNights } from "./booking-hold.js";

const ALLOWED_ROOMS = new Set(["G1", "G2", "G3", "G4"]);
const LEGACY_TO_ROOM = { A: "G1", B: "G2", C: "G3", D: "G4" };
const EXTERNAL_BOOKING_TABLE = "external_booking";
const ICAL_FETCH_TIMEOUT_MS = Math.max(
  1000,
  parseInt(process.env.ICAL_FETCH_TIMEOUT_MS || "8000", 10) || 8000,
);
const ICAL_CACHE_TTL_MS = Math.max(
  60_000,
  parseInt(process.env.ICAL_CACHE_TTL_MS || "600000", 10) || 600_000,
);

var occupiedNightsCache = new Map();

/** Airbnb → GRAFFORD import 일시 중단 (코드 유지, env로만 제어) */
export function isIcalImportDisabled() {
  var v = String(process.env.ICAL_IMPORT_DISABLED || "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function normalizeRoomType(raw) {
  var room = String(raw || "")
    .trim()
    .toUpperCase();
  if (ALLOWED_ROOMS.has(room)) {
    return room;
  }
  return LEGACY_TO_ROOM[room] || "";
}

export function escapeIcsText(v) {
  return String(v == null ? "" : v)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function ymdToIcsDate(ymd) {
  return String(ymd || "").replace(/-/g, "");
}

export function parseIcsDateToYmd(raw) {
  var text = String(raw || "").trim();
  if (!text) {
    return "";
  }
  var m = text.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) {
    return "";
  }
  return m[1] + "-" + m[2] + "-" + m[3];
}

export function unfoldIcsLines(text) {
  return String(text || "")
    .replace(/\r\n[ \t]/g, "")
    .split(/\r?\n/);
}

function parseIcsPropertyValue(line) {
  var idx = line.indexOf(":");
  if (idx < 0) {
    return "";
  }
  return line.slice(idx + 1).trim();
}

export function parseIcsEvents(icsText) {
  var lines = unfoldIcsLines(icsText);
  var events = [];
  var inEvent = false;
  var current = null;

  function flushEvent() {
    if (!current) {
      return;
    }
    var status = String(current.status || "").trim().toUpperCase();
    if (status === "CANCELLED") {
      current = null;
      return;
    }
    var ci = parseIcsDateToYmd(current.dtStart);
    var co = parseIcsDateToYmd(current.dtEnd);
    if (ci && !co) {
      co = ci;
    }
    if (ci && co && ci <= co) {
      if (ci === co) {
        var parts = ci.split("-");
        var dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        dt.setDate(dt.getDate() + 1);
        co =
          dt.getFullYear() +
          "-" +
          String(dt.getMonth() + 1).padStart(2, "0") +
          "-" +
          String(dt.getDate()).padStart(2, "0");
      }
      if (ci < co) {
        events.push({
          uid: String(current.uid || "").trim(),
          summary: String(current.summary || "").trim(),
          dtStart: ci,
          dtEnd: co,
          status: status,
          dtStamp: String(current.dtStamp || "").trim(),
          lastModified: String(current.lastModified || "").trim(),
        });
      }
    }
    current = null;
  }

  lines.forEach(function (line) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      current = {
        uid: "",
        summary: "",
        dtStart: "",
        dtEnd: "",
        status: "",
        dtStamp: "",
        lastModified: "",
      };
      return;
    }
    if (line === "END:VEVENT") {
      flushEvent();
      inEvent = false;
      return;
    }
    if (!inEvent || !current) {
      return;
    }
    if (line.startsWith("UID")) {
      current.uid = parseIcsPropertyValue(line);
      return;
    }
    if (line.startsWith("SUMMARY")) {
      current.summary = parseIcsPropertyValue(line);
      return;
    }
    if (line.startsWith("STATUS")) {
      current.status = parseIcsPropertyValue(line);
      return;
    }
    if (line.startsWith("DTSTAMP")) {
      current.dtStamp = parseIcsPropertyValue(line);
      return;
    }
    if (line.startsWith("LAST-MODIFIED")) {
      current.lastModified = parseIcsPropertyValue(line);
      return;
    }
    if (line.startsWith("DTSTART")) {
      current.dtStart = parseIcsPropertyValue(line);
      return;
    }
    if (line.startsWith("DTEND")) {
      current.dtEnd = parseIcsPropertyValue(line);
    }
  });

  return events;
}

export function collectIcsOccupiedNights(icsText) {
  var occupied = Object.create(null);
  parseIcsEvents(icsText).forEach(function (ev) {
    expandOccupiedNights(ev.dtStart, ev.dtEnd).forEach(function (n) {
      occupied[n] = true;
    });
  });
  return Object.keys(occupied);
}

function parseRoomFromIcalImportEntry(raw) {
  var t = String(raw || "").trim();
  if (!t) {
    return { room: "", url: "" };
  }
  var at = t.indexOf("@");
  if (at > 0) {
    return {
      room: normalizeRoomType(t.slice(0, at)),
      url: t.slice(at + 1).trim(),
    };
  }
  return { room: "", url: t };
}

export function getIcalImportUrls(room) {
  var out = [];
  var roomScoped = String(process.env["ICAL_IMPORT_URLS_" + room] || "").trim();
  if (roomScoped) {
    roomScoped
      .split(",")
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean)
      .forEach(function (u) {
        out.push(u);
      });
  }

  var common = String(process.env.ICAL_IMPORT_URLS || "").trim();
  if (!common) {
    return out;
  }
  common
    .split(",")
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean)
    .forEach(function (entry) {
      var parsed = parseRoomFromIcalImportEntry(entry);
      if (!parsed.url) {
        return;
      }
      if (!parsed.room || parsed.room === room) {
        out.push(parsed.url);
      }
    });
  return out;
}

export function getAllIcalImportTargets() {
  var targets = [];
  ["G1", "G2", "G3", "G4"].forEach(function (room) {
    getIcalImportUrls(room).forEach(function (url) {
      targets.push({ room: room, url: url });
    });
  });
  return targets;
}

function getCachedOccupiedNights(room) {
  var entry = occupiedNightsCache.get(room);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.fetchedAt > ICAL_CACHE_TTL_MS) {
    occupiedNightsCache.delete(room);
    return null;
  }
  return entry.nights.slice();
}

function setCachedOccupiedNights(room, nights) {
  occupiedNightsCache.set(room, {
    fetchedAt: Date.now(),
    nights: nights.slice(),
  });
}

export function clearIcalOccupiedNightsCache(room) {
  if (room) {
    occupiedNightsCache.delete(room);
    return;
  }
  occupiedNightsCache.clear();
}

async function fetchIcsText(url) {
  var controller = new AbortController();
  var timer = setTimeout(function () {
    controller.abort();
  }, ICAL_FETCH_TIMEOUT_MS);
  try {
    var r = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "text/calendar, text/plain;q=0.9, */*;q=0.8" },
    });
    if (!r.ok) {
      return { ok: false, text: "", status: r.status };
    }
    return { ok: true, text: await r.text(), status: r.status };
  } catch (e) {
    return { ok: false, text: "", error: String(e && e.message ? e.message : e) };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchExternalOccupiedNights(room, options) {
  if (isIcalImportDisabled()) {
    return { nights: [], ok: true, configured: false, cached: false, disabled: true };
  }
  var opts = options || {};
  var useCache = opts.useCache !== false;
  if (useCache) {
    var cached = getCachedOccupiedNights(room);
    if (cached) {
      return { nights: cached, ok: true, configured: getIcalImportUrls(room).length > 0, cached: true };
    }
  }

  var urls = getIcalImportUrls(room);
  if (!urls.length) {
    return { nights: [], ok: true, configured: false, cached: false };
  }

  var occupied = Object.create(null);
  var successCount = 0;
  for (var i = 0; i < urls.length; i++) {
    var fetched = await fetchIcsText(urls[i]);
    if (!fetched.ok) {
      continue;
    }
    successCount += 1;
    collectIcsOccupiedNights(fetched.text).forEach(function (d) {
      occupied[d] = true;
    });
  }

  var nights = Object.keys(occupied).sort();
  var ok = successCount > 0;
  if (useCache && ok) {
    setCachedOccupiedNights(room, nights);
  }
  return { nights: nights, ok: ok, configured: true, cached: false };
}

export async function fetchIcalOccupiedNightsForRoom(room, options) {
  var result = await fetchExternalOccupiedNights(room, options);
  return result.nights;
}

export async function fetchIcalEventsForUrl(url) {
  var fetched = await fetchIcsText(url);
  if (!fetched.ok) {
    return { ok: false, events: [], error: fetched.error || "fetch_failed", status: fetched.status };
  }
  return { ok: true, events: parseIcsEvents(fetched.text), status: fetched.status };
}

function rowDateToYMD(v) {
  if (v == null || v === "") {
    return "";
  }
  if (typeof v === "string") {
    return v.slice(0, 10);
  }
  if (v instanceof Date && !isNaN(v.getTime())) {
    var y = v.getUTCFullYear();
    var m = String(v.getUTCMonth() + 1).padStart(2, "0");
    var day = String(v.getUTCDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }
  return "";
}

export function buildIcalCalendar(rows, rowDateFn) {
  var toYmd = rowDateFn || rowDateToYMD;
  var now = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  var lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GRAFFORD//Reservation Calendar//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:GRAFFORD Reservations",
  ];

  (rows || []).forEach(function (row) {
    var ci = toYmd(row.check_in_date);
    var co = toYmd(row.check_out_date);
    if (!ci || !co || ci >= co) {
      return;
    }
    var room = normalizeRoomType(row.room_type) || String(row.room_type || "");
    var number = String(row.reservation_number || "");
    var isBlock = row.is_block === true || /^BLOCK-/.test(number);
    var uid = escapeIcsText(number + "-" + room + "@grafford.local");
    lines.push("BEGIN:VEVENT");
    lines.push("UID:" + uid);
    lines.push("DTSTAMP:" + now);
    lines.push("DTSTART;VALUE=DATE:" + ymdToIcsDate(ci));
    lines.push("DTEND;VALUE=DATE:" + ymdToIcsDate(co));
    lines.push(
      "SUMMARY:" + escapeIcsText("GRAFFORD " + room + (isBlock ? " 방막기" : " 예약")),
    );
    lines.push(
      "DESCRIPTION:" +
        escapeIcsText(isBlock ? "Admin block " + number : "Reservation " + number),
    );
    lines.push("END:VEVENT");
  });

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export async function getExternalBookingCalendarRows(pool) {
  if (isIcalImportDisabled()) {
    return [];
  }
  try {
    var result = await pool.query(
      `SELECT room_type, external_uid, source, check_in_date, check_out_date, summary
       FROM ${EXTERNAL_BOOKING_TABLE}
       WHERE check_out_date > CURRENT_DATE - INTERVAL '1 day'
       ORDER BY check_in_date ASC, room_type ASC`,
    );
    return (result.rows || []).map(function (row) {
      var source = String(row.source || "ical").trim().toLowerCase();
      var uid = String(row.external_uid || "").trim();
      return {
        reservationNumber:
          "EXT-" + (uid ? uid.slice(0, 24) : "unknown"),
        guestName: source === "airbnb" ? "Airbnb" : "외부 예약",
        contact: "",
        email: "",
        roomType: row.room_type,
        checkIn: rowDateToYMD(row.check_in_date),
        checkOut: rowDateToYMD(row.check_out_date),
        guestCount: null,
        totalAmount: 0,
        guestRequest: row.summary || "",
        paymentMethod: "",
        isExternal: true,
        externalSource: source,
      };
    });
  } catch (e) {
    if (e && (e.code === "42P01" || e.code === "42703")) {
      return [];
    }
    throw e;
  }
}

export async function getExternalBookingOccupiedNights(pool, room) {
  if (isIcalImportDisabled()) {
    return [];
  }
  try {
    var result = await pool.query(
      `SELECT check_in_date, check_out_date
       FROM ${EXTERNAL_BOOKING_TABLE}
       WHERE room_type = $1
         AND check_out_date > CURRENT_DATE - INTERVAL '1 day'
       ORDER BY check_in_date`,
      [room],
    );
    var occupied = Object.create(null);
    (result.rows || []).forEach(function (row) {
      var ci = rowDateToYMD(row.check_in_date);
      var co = rowDateToYMD(row.check_out_date);
      if (!ci || !co || ci >= co) {
        return;
      }
      expandOccupiedNights(ci, co).forEach(function (n) {
        occupied[n] = true;
      });
    });
    return Object.keys(occupied).sort();
  } catch (e) {
    if (e && (e.code === "42P01" || e.code === "42703")) {
      return [];
    }
    throw e;
  }
}

export async function hasExternalBookingOverlap(pool, roomName, checkIn, checkOut) {
  if (isIcalImportDisabled()) {
    return false;
  }
  var room = normalizeRoomType(roomName);
  if (!ALLOWED_ROOMS.has(room)) {
    return false;
  }

  var fetched = await fetchExternalOccupiedNights(room, { useCache: false });
  var nights = fetched.nights;

  if (!fetched.configured) {
    return false;
  }

  if (!fetched.ok) {
    try {
      var result = await pool.query(
        `SELECT 1
         FROM ${EXTERNAL_BOOKING_TABLE}
         WHERE room_type = $1
           AND check_in_date < $3::date
           AND check_out_date > $2::date
         LIMIT 1`,
        [room, checkIn, checkOut],
      );
      return !!(result.rows && result.rows.length);
    } catch (e) {
      if (e && (e.code === "42P01" || e.code === "42703")) {
        return false;
      }
      throw e;
    }
  }

  if (!nights.length) {
    return false;
  }
  var stayNights = expandOccupiedNights(checkIn, checkOut);
  return stayNights.some(function (n) {
    return nights.indexOf(n) >= 0;
  });
}

function inferSourceFromUrl(url) {
  var lower = String(url || "").toLowerCase();
  if (lower.indexOf("airbnb") >= 0) {
    return "airbnb";
  }
  return "ical";
}

function syntheticUidForEvent(ev, room, url, index) {
  if (ev.uid) {
    return ev.uid;
  }
  return (
    "fallback-" +
    room +
    "-" +
    ev.dtStart +
    "-" +
    ev.dtEnd +
    "-" +
    index +
    "@" +
    String(url || "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 32)
  );
}

export async function syncExternalBookingsForTarget(pool, room, url) {
  if (isIcalImportDisabled()) {
    return {
      room: room,
      url: url,
      ok: false,
      disabled: true,
      error: "ical_import_disabled",
      upserted: 0,
      deleted: 0,
    };
  }
  var fetched = await fetchIcalEventsForUrl(url);
  if (!fetched.ok) {
    return {
      room: room,
      url: url,
      ok: false,
      error: fetched.error || "fetch_failed",
      status: fetched.status || null,
      upserted: 0,
      deleted: 0,
    };
  }

  var source = inferSourceFromUrl(url);
  var seenUids = Object.create(null);
  var upserted = 0;

  for (var i = 0; i < fetched.events.length; i++) {
    var ev = fetched.events[i];
    var uid = syntheticUidForEvent(ev, room, url, i);
    seenUids[uid] = true;
    await pool.query(
      `INSERT INTO ${EXTERNAL_BOOKING_TABLE} (
         room_type, external_uid, source, check_in_date, check_out_date,
         summary, import_url, dt_stamp, last_synced_at
       ) VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, NOW())
       ON CONFLICT (room_type, external_uid)
       DO UPDATE SET
         source = EXCLUDED.source,
         check_in_date = EXCLUDED.check_in_date,
         check_out_date = EXCLUDED.check_out_date,
         summary = EXCLUDED.summary,
         import_url = EXCLUDED.import_url,
         dt_stamp = EXCLUDED.dt_stamp,
         last_synced_at = NOW()`,
      [room, uid, source, ev.dtStart, ev.dtEnd, ev.summary || null, url, ev.dtStamp || null],
    );
    upserted += 1;
  }

  var existing = await pool.query(
    `SELECT external_uid
     FROM ${EXTERNAL_BOOKING_TABLE}
     WHERE room_type = $1 AND import_url = $2`,
    [room, url],
  );
  var toDelete = (existing.rows || [])
    .map(function (row) {
      return String(row.external_uid || "");
    })
    .filter(function (uid) {
      return uid && !seenUids[uid];
    });

  if (toDelete.length) {
    await pool.query(
      `DELETE FROM ${EXTERNAL_BOOKING_TABLE}
       WHERE room_type = $1 AND import_url = $2 AND external_uid = ANY($3::text[])`,
      [room, url, toDelete],
    );
  }

  clearIcalOccupiedNightsCache(room);

  return {
    room: room,
    url: url,
    ok: true,
    upserted: upserted,
    deleted: toDelete.length,
    eventCount: fetched.events.length,
  };
}

export async function syncExternalBookingsForRoom(pool, room) {
  var urls = getIcalImportUrls(room);
  var results = [];
  for (var i = 0; i < urls.length; i++) {
    results.push(await syncExternalBookingsForTarget(pool, room, urls[i]));
  }
  return {
    room: room,
    urlCount: urls.length,
    results: results,
  };
}

export async function syncAllExternalBookings(pool, roomFilter) {
  if (isIcalImportDisabled()) {
    return {
      targetCount: 0,
      results: [],
      disabled: true,
    };
  }
  var targets = getAllIcalImportTargets();
  if (roomFilter) {
    var room = normalizeRoomType(roomFilter);
    targets = targets.filter(function (t) {
      return t.room === room;
    });
  }
  var results = [];
  for (var i = 0; i < targets.length; i++) {
    var target = targets[i];
    results.push(await syncExternalBookingsForTarget(pool, target.room, target.url));
  }
  return {
    targetCount: targets.length,
    results: results,
  };
}

export async function getMergedOccupiedNightsForRoom(pool, room) {
  var fetched = await fetchExternalOccupiedNights(room, { useCache: true });
  if (fetched.ok || !fetched.configured) {
    return fetched.nights;
  }

  return getExternalBookingOccupiedNights(pool, room);
}
