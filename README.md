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
| `VITE_API_URL` | Client build | Deployed Express API origin | `http://localhost:5000` in development; required for Vercel builds |
| `ADMIN_USERNAME` | Server | Temporary staging admin login name | unset |
| `ADMIN_PASSWORD_HASH` | Server | scrypt-encoded admin password | unset |
| `TRUST_PROXY_HOPS` | Server | Exact number of trusted reverse proxy hops | `0` locally; set explicitly for Render |
| `GEOIP_DB_PATH` | Server | Path to DB-IP City Lite MMDB | `./data/dbip-city-lite-2026-11.mmdb` locally; `./data/dbip-city-lite.mmdb` on Render |

Never commit a real `.env` file, database credentials, admin credentials, or a GeoIP database. The server loads `server/.env` when started by its workspace script.

## API

- `POST /api/links` accepts `{ "originalUrl": "https://example.com/path", "customAlias": "optional-name", "title": "optional", "tags": ["optional"], "utm": { "utm_source": "newsletter" } }`. It returns the final destination and any UTM field conflicts. Existing UTM values are kept and never overwritten. Alias conflicts return `409` with database-checked suggestions.
- `GET /api/links?q=...&status=active&tag=...&sort=createdAt&page=1&limit=50` returns `{ "links": [...], "pagination": { "page": 1, "limit": 50, "total": 1, "totalPages": 1 } }`. Search checks title, alias, and destination. Sort can be `createdAt` or `clicks`; limit is capped at 100.
- `GET /api/links/:id` returns `{ "link": {...} }`; malformed IDs return `400` and unknown links return `404`.
- `DELETE /api/links/:id` deletes only the matching MongoDB record; malformed IDs return `400` and unknown links return `404`.
- `PATCH /api/links/:id` edits the destination, title, tags, or status (`active` / `archived`). Archived short links return `410 Gone` and can be restored by setting status to `active`.
- `GET /api/links/:id/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD` returns `{ "analytics": { "totalClicks": 12, "clicksToday": 1, "clicksLast7Days": 4, "clicksLast30Days": 9, "dailyClicks": [], "deviceBreakdown": {}, "browserBreakdown": {}, "operatingSystemBreakdown": {}, "topReferrers": [], "botBreakdown": {} } }`. Dates use inclusive UTC days; by default the selected window is the last 30 UTC calendar days, and it cannot exceed 366 days.
- `GET /api/analytics/overview?from=YYYY-MM-DD&to=YYYY-MM-DD` returns selected-range activity, country rankings, optional region counts, top links, and recently created links.
- `GET /api/aliases/:alias/availability` returns `{ alias, available, suggestions }`.
- `GET /:code` redirects to the stored destination with HTTP `302`, or returns `404` for an unknown code.
- `GET /api/health` reports API/database readiness.

Custom aliases are case-insensitive and stored in lowercase. They must be 3–40 characters and contain lowercase letters, digits, and single hyphens. Reserved aliases include `api`, `admin`, `dashboard`, `login`, `health`, `favicon`, and `robots.txt`. Destination URLs must use HTTP or HTTPS.

The dashboard lists links behind the temporary single-admin staging login and supports search, copy, opening destinations, confirmed deletion, analytics, and QR code PNG downloads. QR codes encode each actual short URL and are rendered at high resolution for PNG export. This staging login is not multi-tenant authentication.

Click records store only an approximate country name, ISO code, and optional region from a local DB-IP City Lite database. Raw IP addresses and raw User-Agent strings are never persisted. GeoIP lookup can be wrong or unavailable and never blocks a redirect. Device/browser classification and bot detection are heuristic estimates. Referrers are reduced to hostnames. Click events expire after 365 days through a MongoDB TTL index; TTL cleanup is asynchronous, so this is an approximate retention window.

The `links` MongoDB collection has a unique index on `shortCode`; duplicate-key races are handled in the API. Link creation and alias availability checks are each limited to 60 requests per 15 minutes per client IP. Link management, alias lookup, dashboard, and analytics APIs require the temporary single-admin staging login. Public short-link redirects and `/api/health` remain open. This is a staging boundary, not final multi-tenant authentication. API tests use in-memory models and do not require a running MongoDB instance.

## GeoIP and private staging setup

The server uses the maintained `maxmind` Node package with a local MMDB reader. DB-IP City Lite uses the MaxMind DB v2 format, and its `country.iso_code`, `country.names.en`, and `subdivisions[0].names.en` fields map directly to the reader paths used here. The application never sends visitor IPs to an external lookup service. Locally, set `GEOIP_DB_PATH=./data/dbip-city-lite-2026-11.mmdb` in `server/.env` for the checked-out database. Render builds download the pinned November 2026 release into `server/data/dbip-city-lite.mmdb`; set production `GEOIP_DB_PATH=./data/dbip-city-lite.mmdb`. Production startup fails if this path is absent or the database cannot be opened and queried. During redirects, individual lookup errors still return `Unknown` and never block the redirect. The compressed archive and extracted database are excluded from Git.

DB-IP Lite is licensed under CC BY 4.0 and requires attribution when data is used. The geographic dashboard displays the required [IP Geolocation by DB-IP](https://db-ip.com) link. Keep this attribution on any deployed dashboard that displays geographic analytics.

Set `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH` on the backend. Generate the hash in a terminal with `npm run hash-admin-password --workspace server`; the password is entered without echo. Store only the printed encoded result in the backend secret manager. Its format is `scrypt$<base64url salt>$<base64url digest>` using a 64-byte scrypt digest. Changing the configured username or hash immediately makes existing sessions fail authentication; users must sign in again. The server stores random opaque sessions in MongoDB by token hash, expires them after eight hours, and sets HttpOnly cookies with `SameSite=Lax; Secure` in production. Use an app and API custom domain under the same site (for example `app.example.com` and `api.example.com`): they remain cross-origin for CORS, but are same-site for cookies. Mutating auth calls require the exact configured frontend Origin. Login is limited to 10 attempts per 15 minutes per client IP. No multi-user registration or billing behavior is included.

## Deployment configuration (Vercel frontend + Render API)

Use custom domains on the same registrable domain to avoid third-party-cookie blocking while keeping the API cross-origin. Example values below assume `example.com`; replace the domains with your own. Set Vercel's frontend domain to `app.example.com` and Render's backend custom domain to `api.example.com`. Both must serve HTTPS. The production cookie is `SameSite=Lax; Secure`; sibling subdomains are same-site, while exact-origin CORS and Origin checks still apply. The default `*.vercel.app` and `*.onrender.com` domains are different sites, so the production session cookie may be blocked by browser third-party-cookie policies when used together.

### Render Web Service

- Root Directory: repository root (`.` or leave blank).
- Runtime: Node.
- Node.js version: `24.x` (also declared in the root `package.json`).
- Build Command: `npm ci && npm run prepare-geoip --workspace @linkify/server`.
- Start Command: `npm start`.
- Health Check Path: `/api/health`.
- Add the `api.example.com` custom domain in Render and wait until its TLS certificate is active.
- Set these service environment variables (secrets are entered directly into Render; do not place their values in Git):

| Name | Value / guidance |
| --- | --- |
| `NODE_ENV` | `production` |
| `CLIENT_ORIGIN` | `https://app.example.com` (one exact origin, no trailing slash) |
| `SHORT_BASE_URL` | `https://api.example.com` |
| `MONGODB_URI` | Secret Atlas connection string for the intended production database; restrict Atlas network access to the deployment as appropriate. |
| `ADMIN_USERNAME` | Admin login name. |
| `ADMIN_PASSWORD_HASH` | Output of `npm run hash-admin-password --workspace server`, generated locally; never store the plaintext password. |
| `TRUST_PROXY_HOPS` | `1` for the standard Render web-service proxy setup; do not use `true`. |
| `GEOIP_DB_PATH` | `./data/dbip-city-lite.mmdb` (path is relative to the server workspace at start). |
| `PORT` | Leave unset; Render supplies this automatically and the server listens on it. |

Generate a password hash locally with `npm run hash-admin-password --workspace server`, then paste only the resulting encoded hash into Render's `ADMIN_PASSWORD_HASH` field. Do not run this command in build logs or put its output in source control.

### Vercel Project

- Root Directory: repository root (`.`); keep “Include files outside the root directory” unnecessary because the frontend build is contained in the monorepo root and `client` workspace.
- Framework Preset: Vite.
- Node.js Version: `24.x`.
- Install Command: `npm ci`.
- Build Command: `npm run build --workspace @linkify/client`.
- Output Directory: `client/dist`.
- Add `app.example.com` as the Vercel production domain.
- Set `VITE_API_URL=https://api.example.com` for Production and any Preview environment you intend to use. This is public browser configuration, never a secret. For previews, use a separately configured backend with the exact preview `CLIENT_ORIGIN`; do not point an untrusted preview at the production admin API.

### DB-IP build artifact and updates

The Render build runs `server/scripts/downloadDbIpLite.js`, downloads the pinned official release `2026-11`, and checks the downloaded archive's pinned SHA-1 (`21ed2ad1b50b98918c2432b61421dce9e61ed121`) before decompression. It then verifies DB-IP's published SHA-1 for the uncompressed MMDB (`a6f14e8da5565c713cdda9f1959a904b2eb88337`) and opens/queries it with the installed `maxmind` reader before moving it to `server/data/dbip-city-lite.mmdb`. DB-IP publishes its checksum for the uncompressed database, not the `.gz` archive; therefore the published checksum cannot be checked until decompression, while the pinned archive checksum is checked first. A network, decompression, checksum, or MMDB validation failure exits the build unsuccessfully. The direct download is public and needs no credential. To update monthly, change `RELEASE`, both checksums, and URL template together in `server/scripts/downloadDbIpLite.js`, then confirm the dashboard attribution remains present. Do not fetch in a Render pre-deploy command: that command's filesystem is separate from the build artifact. The build output is ignored by Git (`*.mmdb` and `*.mmdb.gz`).

The exact local preparation command is `npm run prepare-geoip --workspace @linkify/server`. A deployment's normal Render build command above runs it automatically before the service starts. Do not configure a Render Secret File or commit the MMDB. A persistent disk is unnecessary for this build-artifact approach.

Production startup checks that `CLIENT_ORIGIN`, `SHORT_BASE_URL`, `MONGODB_URI`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, and `GEOIP_DB_PATH` exist, validates the password-hash format and explicit proxy-hop setting, rejects localhost/non-HTTPS public origins, and opens/queries the MMDB before connecting to MongoDB. No secret belongs in Vercel variables except the public `VITE_API_URL`; Atlas/admin credentials belong only in Render's backend environment.

`PORT` is provided by Render. The remaining backend variable names are exactly `NODE_ENV`, `CLIENT_ORIGIN`, `SHORT_BASE_URL`, `MONGODB_URI`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `TRUST_PROXY_HOPS`, and `GEOIP_DB_PATH`. The only required Vercel variable is `VITE_API_URL`.

## Atlas and deployment verification checklist

The standard `npm test` suite uses in-memory models. For actual Atlas verification, `npm run verify-atlas --workspace server` reads live collection indexes and executes the overview/link analytics pipelines without inserting data. The explicit `-- --exercise` option creates uniquely named temporary test links, events, and a session; checks authenticated APIs, redirect insertion, date-filtered geography, pagination/sorting and archive/restore; then verifies those fixture records are removed.

Before staging release, verify against the intended Atlas database with the safe exercise and confirm:

1. Backend connection succeeds without printing the URI.
2. `links.shortCode` has a unique index.
3. `clickEvents` has `{ linkId: 1, clickedAt: -1 }` and `{ clickedAt: 1 }` with `expireAfterSeconds: 31536000` indexes.
4. Geographic aggregation facets (including legacy events without country fields) return country and optional region counts for a selected inclusive UTC date range.
5. Pagination and date filtering work against actual records; inspect explain plans and server execution for the overview and single-link analytics pipelines.
6. Health is public, management calls without a session return 401, login works, and logout/expiry invalidate sessions.
7. Create a short link, visit it, then verify click and approximate geographic analytics. Confirm its QR code resolves to the Render domain.
8. Verify Vercel browser requests use the production API origin and Render CORS rejects other origins.

Atlas connectivity, the expected link/click/session indexes, and a cleaned-up integration exercise have been verified in the configured development environment. Production Render/Vercel settings, account access, and deployed domains have not been provided or verified; no deployment is claimed.
