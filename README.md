# Linkify

Linkify is a URL shortening and link management app built with MongoDB, Express, React, Node.js and Tailwind CSS. The approved project context is `Linkify_Project_Context_and_Documentation.pdf`.

## Project structure

```text
client/                 React + Vite + Tailwind application
  src/pages/            Page-level UI
  src/components/       Link creation, dashboard, and QR components
  src/styles.css        Tailwind entry and global styles
server/                 Express API
  src/config/            Database connection
  src/routes/            API route modules
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

- `POST /api/links` accepts `{ "originalUrl": "https://example.com/path", "customAlias": "optional-name" }`. Returns `201` with the stored code and short URL. Alias conflicts return `409` with database-checked suggestions.
- `GET /api/links` returns `{ "links": [...] }`, newest first.
- `GET /api/links/:id` returns `{ "link": {...} }`; malformed IDs return `400` and unknown links return `404`.
- `DELETE /api/links/:id` deletes only the matching MongoDB record; malformed IDs return `400` and unknown links return `404`.
- `GET /api/aliases/:alias/availability` returns `{ alias, available, suggestions }`.
- `GET /:code` redirects to the stored destination with HTTP `302`, or returns `404` for an unknown code.
- `GET /api/health` reports API/database readiness.

Custom aliases are case-insensitive and stored in lowercase. They must be 3–40 characters and contain lowercase letters, digits, and single hyphens. Reserved aliases include `api`, `admin`, `dashboard`, `login`, `health`, `favicon`, and `robots.txt`. Destination URLs must use HTTP or HTTPS.

The dashboard lists links for this shared, unauthenticated app and supports search, copy, opening destinations, confirmed deletion, and QR code PNG downloads. QR codes encode each actual short URL and are rendered at high resolution for PNG export. The dashboard does not provide user-level privacy or access control.

The `links` MongoDB collection has a unique index on `shortCode`; duplicate-key races are handled in the API. Link creation and alias availability checks are each limited to 60 requests per 15 minutes per client IP. API tests use an in-memory model and do not require a running MongoDB instance.
