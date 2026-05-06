# iCal Integration Setup

## 1) What this project now supports

- `GET /api/reservations?availability=1&room=G1`
  - Existing DB reservation nights are returned as before.
  - If iCal import URLs are configured, external iCal nights are merged into `occupiedNights`.
- `GET /api/reservations?ical=1`
  - Exports current reservation status as an `.ics` feed.
  - You can limit by room with `room=G1`.
  - If `ICAL_EXPORT_TOKEN` is set, `token` query is required.

## 2) Environment variables

Set in Vercel project settings (or local `.env.local`):

- `ICAL_EXPORT_TOKEN`
  - Optional but recommended.
  - Protects iCal export endpoint.
  - Example:
    - `/api/reservations?ical=1&token=YOUR_TOKEN`
    - `/api/reservations?ical=1&room=G1&token=YOUR_TOKEN`

- `ICAL_IMPORT_URLS`
  - Optional.
  - Comma-separated external iCal URLs to import.
  - Supports room-scoped entries with `ROOM@URL` format.
  - Example:
    - `G1@https://example.com/g1.ics,G2@https://example.com/g2.ics,https://example.com/all-rooms.ics`

- `ICAL_IMPORT_URLS_G1`, `ICAL_IMPORT_URLS_G2`, `ICAL_IMPORT_URLS_G3`, `ICAL_IMPORT_URLS_G4`
  - Optional room-specific import URLs.
  - Comma-separated.
  - Example:
    - `ICAL_IMPORT_URLS_G1=https://example.com/g1-1.ics,https://example.com/g1-2.ics`

## 3) Important iCal basics

- iCal sync is usually pull-based, not push-based.
  - Other platforms regularly fetch your `.ics` URL.
  - They may apply delay (often minutes to hours).
- This project exports all-day events with:
  - `DTSTART` = check-in date
  - `DTEND` = check-out date (exclusive end date)
- Calendar blocks nights in `[check-in, check-out)` range.
- External iCal fetch failure does not break booking API.
  - It falls back to internal DB availability.

## 4) Validation checklist

1. Create a test reservation in your current project.
2. Open:
   - `/api/reservations?ical=1&token=YOUR_TOKEN`
3. Confirm `.ics` contains a `VEVENT` for that booking.
4. Configure one external iCal URL in import env.
5. Open reservation page calendar and confirm blocked dates reflect merged status.

