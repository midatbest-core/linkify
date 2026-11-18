# Linkify

Linkify is a URL shortening and link analytics platform built with MongoDB, Express, React, Node.js and Tailwind CSS. This repository implements the core URL shortening milestone against `Linkify_Project_Context_and_Documentation.pdf`.

## Project structure

```text
client/                 React + Vite + Tailwind application
  src/pages/            Page-level UI
  src/styles.css        Tailwind entry and global styles
server/                 Express API
  src/config/            Database connection
  src/routes/            API route modules
Linkify_Project_Context_and_Documentation.pdf
```

## Requirements

- Node.js 20 or newer and npm
- MongoDB locally, or a MongoDB Atlas connection string

## Setup

1. Install dependencies from the repository root:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `server/.env` and set `MONGODB_URI` to your local MongoDB URL or Atlas connection string. The remaining defaults work for local development.

3. Start the client and API together:

   ```sh
   npm run dev
   ```

   The client runs at `http://localhost:5173`; the API runs at `http://localhost:5000`.

4. Check API and database readiness at `http://localhost:5000/api/health`.

## Environment variables

| Variable | Used by | Purpose | Local default |
| --- | --- | --- | --- |
| `PORT` | Server | Express listening port | `5000` |
| `MONGODB_URI` | Server | MongoDB connection string | `mongodb://127.0.0.1:27017/linkify` |
| `CLIENT_ORIGIN` | Server | Allowed browser origin for CORS | `http://localhost:5173` |
| `SHORT_BASE_URL` | Server | Public base URL used to build short links | `http://localhost:5000` |
| `VITE_API_URL` | Client | API base URL for browser requests | `http://localhost:5000` |

Never commit a real `.env` file or database credentials. The server loads `server/.env` when started by its workspace script.

## API

- `POST /api/links` — accepts `{ "originalUrl": "https://example.com/path", "customAlias": "optional-name" }`. Returns `201` with the stored code and short URL. `customAlias` may be omitted for a random seven-character code. A taken alias returns `409` with `alias` and 3–5 database-checked `suggestions`.
- `GET /api/aliases/:alias/availability` — returns `{ alias, available, suggestions }`. Suggestions are empty when the alias is available.
- `GET /:code` — redirects to the stored destination with HTTP `302`, or returns `404` for an unknown code.
- `GET /api/health` — reports API/database readiness.

Custom aliases are case-insensitive and stored in lowercase. They must be 3–40 characters and contain lowercase letters, digits, and single hyphens. The aliases `api`, `admin`, `dashboard`, `login`, `health`, `favicon`, and `robots.txt` are reserved. Destination URLs must use HTTP or HTTPS.

The `links` MongoDB collection has a unique index on `shortCode`; duplicate-key races are handled in the API. Core shortening and redirect flows are covered with an in-memory model in the test suite, so tests do not require a running MongoDB instance. QR generation, dashboard management, analytics, and accounts remain outside this milestone.

Link creation and alias availability checks are each limited to 60 requests per 15 minutes per client IP.
