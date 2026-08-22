import {
  normalizeStaySegments,
  validateStaySegments,
  isRoomChangeItinerary,
  guestDisplayRoomType,
  guestDisplayCheckIn,
  guestDisplayCheckOut,
  buildStaySegmentsFromGroup,
} from "./booking-room-change.js";

var failed = 0;

function assert(name, cond, detail) {
  if (!cond) {
    failed += 1;
    console.error("FAIL", name, detail || "");
    return;
  }
  console.log("ok", name);
}

var uv0 = {
  reservation_number: "20260806-UV0OJ8",
  room_type: "G1",
  check_in_date: "2026-08-17",
  check_out_date: "2026-08-21",
  original_room_type: "G1",
  contract_check_in: "2026-08-17",
  contract_check_out: "2026-08-23",
};

var children = [
  {
    room_type: "G2",
    check_in_date: "2026-08-22",
    check_out_date: "2026-08-23",
  },
  {
    room_type: "G4",
    check_in_date: "2026-08-21",
    check_out_date: "2026-08-22",
  },
];

var segs = buildStaySegmentsFromGroup(uv0, children);
assert("segments sorted and include primary first", segs.length === 3);
assert("first G1 17-21", segs[0].room === "G1" && segs[0].checkIn === "2026-08-17");
assert("second G4 21-22", segs[1].room === "G4" && segs[1].checkIn === "2026-08-21");
assert("third G2 22-23", segs[2].room === "G2" && segs[2].checkOut === "2026-08-23");

assert(
  "valid UV0OJ8 itinerary",
  validateStaySegments(segs, "2026-08-17", "2026-08-23").ok === true,
);
assert(
  "rejects gap",
  validateStaySegments(
    [
      { room: "G1", checkIn: "2026-08-17", checkOut: "2026-08-20" },
      { room: "G4", checkIn: "2026-08-21", checkOut: "2026-08-23" },
    ],
    "2026-08-17",
    "2026-08-23",
  ).ok === false,
);
assert(
  "rejects contract mismatch",
  validateStaySegments(
    [{ room: "G1", checkIn: "2026-08-17", checkOut: "2026-08-21" }],
    "2026-08-17",
    "2026-08-23",
  ).ok === false,
);
assert(
  "single same-room is not room change",
  isRoomChangeItinerary(
    [{ room: "G1", checkIn: "2026-08-17", checkOut: "2026-08-23" }],
    "G1",
  ) === false,
);
assert("multi segment is room change", isRoomChangeItinerary(segs, "G1") === true);
assert(
  "full-stay room move is room change",
  isRoomChangeItinerary(
    [{ room: "G4", checkIn: "2026-08-17", checkOut: "2026-08-23" }],
    "G1",
  ) === true,
);

assert("gallery room stays original", guestDisplayRoomType(uv0) === "G1");
assert("guest check-in uses contract", guestDisplayCheckIn(uv0) === "2026-08-17");
assert("guest check-out uses contract", guestDisplayCheckOut(uv0) === "2026-08-23");

var normalized = normalizeStaySegments([
  { roomType: "g4", check_in: "2026-08-21", check_out: "2026-08-22" },
]);
assert("normalize room/dates", normalized[0].room === "G4" && normalized[0].checkIn === "2026-08-21");

if (failed) {
  process.exit(1);
}
console.log("booking-room-change tests passed");
