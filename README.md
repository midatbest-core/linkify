# Linkify

Linkify is a URL shortening and link management app built with MongoDB, Express, React, Node.js and Tailwind CSS. The approved project context is `Linkify_Project_Context_and_Documentation.pdf`.

## Project structure

```text
client/                 React + Vite + Tailwind application
  src/pages/            Page-level UI
  src/components/       Link creation, dashboard, analytics, and QR components
  src/styles.css        Tailwind entry and global styles
server/                 Express API
  src/models/            Link and click event models
  src/services/          Link and aggregation logic
  src/config/            Database connection
  src/routes/            Link, analytics, alias, and redirect routes
```

## Requirements and setup

- Node.js 20 or newer and npm
- MongoDB locally, or a MongoDB Atlas connection string

Install dependencies with `npm install`, copy `.env.example` to `server/.env`, and set `MONGODB_URI`. Run `npm run dev` to start the API at `http://localhost:5000` and client at `http://localhost:5174`. Vite is pinned to port 5174 and exits with an error if that port is unavailable. Check readiness at `http://localhost:5000/api/health`.

## Environment variables

| Variable | Used by | Purpose | Local default |
| --- | --- | --- | --- |
| `PORT` | Server | Listening port | `5000` |
| `MONGODB_URI` | Server | MongoDB connection string | `mongodb://127.0.0.1:27017/linkify` |
| `CLIENT_ORIGIN` | Server | Exact allowed browser origin for CORS | `http://localhost:5174` |
| `SHORT_BASE_URL` | Server | Public base URL for generated links | `http://localhost:5000` |
| `VITE_API_URL` | Client | API base URL | `http://localhost:5000` |

Never commit a real `.env` file or database credentials. The server loads `server/.env` when started by its workspace script.

## API

- `POST /api/links` accepts `{ "originalUrl": "https://example.com/path", "customAlias": "optional-name", "title": "optional", "tags": ["optional"], "utm": { "utm_source": "newsletter" } }`. It returns the final destination and any UTM field conflicts. Existing UTM values are kept and never overwritten. Alias conflicts return `409` with database-checked suggestions.
- `GET /api/links?q=...&status=active&tag=...&sort=createdAt&page=1&limit=50` returns `{ "links": [...], "pagination": { "page": 1, "limit": 50, "total": 1, "totalPages": 1 } }`. Search checks title, alias, and destination. Sort can be `createdAt` or `clicks`; limit is capped at 100.
- `GET /api/links/:id` returns `{ "link": {...} }`; malformed IDs return `400` and unknown links return `404`.
- `DELETE /api/links/:id` deletes only the matching MongoDB record; malformed IDs return `400` and unknown links return `404`.
- `PATCH /api/links/:id` edits the destination, title, tags, or status (`active` / `archived`). Archived short links return `410 Gone` and can be restored by setting status to `active`.
- `GET /api/links/:id/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD` returns `{ "analytics": { "totalClicks": 12, "clicksToday": 1, "clicksLast7Days": 4, "clicksLast30Days": 9, "dailyClicks": [], "deviceBreakdown": {}, "browserBreakdown": {}, "operatingSystemBreakdown": {}, "topReferrers": [], "botBreakdown": {} } }`. Dates use inclusive UTC days; by default the selected window is the last 30 UTC calendar days, and it cannot exceed 366 days.
- `GET /api/analytics/overview?from=YYYY-MM-DD&to=YYYY-MM-DD` returns selected-range activity, top links, and recently created links.
- `GET /api/aliases/:alias/availability` returns `{ alias, available, suggestions }`.
- `GET /:code` redirects to the stored destination with HTTP `302`, or returns `404` for an unknown code.
- `GET /api/health` reports API/database readiness.

Custom aliases are case-insensitive and stored in lowercase. They must be 3–40 characters and contain lowercase letters, digits, and single hyphens. Reserved aliases include `api`, `admin`, `dashboard`, `login`, `health`, `favicon`, and `robots.txt`. Destination URLs must use HTTP or HTTPS.

The dashboard lists links for this shared, unauthenticated app and supports search, copy, opening destinations, confirmed deletion, and QR code PNG downloads. QR codes encode each actual short URL and are rendered at high resolution for PNG export. The dashboard does not provide user-level privacy or access control.

Redirect analytics record a click event without storing raw IP addresses or identifying individual visitors. Device/browser classification and bot detection are heuristic estimates. Referrers are reduced to hostnames. Click events expire after 365 days through a MongoDB TTL index; TTL cleanup is asynchronous, so this is an approximate retention window. The shared, unauthenticated dashboard and APIs do not provide per-user privacy or access control.

The `links` MongoDB collection has a unique index on `shortCode`; duplicate-key races are handled in the API. Link creation and alias availability checks are each limited to 60 requests per 15 minutes per client IP. API tests use an in-memory model and do not require a running MongoDB instance.
