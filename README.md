Garmin Connect Dashboard

## Getting Started

First, run the development server:

```bash
bun install -g pm2

pm2 start bun --name garmin -- start
pm2 save
pm2 startup
```

Set the Garmin Connect credentials in `.env` before starting the server:

```dotenv
GARMIN_USERNAME="your.email@example.com"
GARMIN_PASSWORD="your-password"
GARMIN_DOMAIN="garmin.com"
GARMIN_DB_PATH=".data/garmin.sqlite"
GARMIN_SYNC_TIME="04:00"
```

Use `GARMIN_DOMAIN="garmin.cn"` for Garmin China accounts. `GARMIN_DB_PATH`
and `GARMIN_SYNC_TIME` are optional; the defaults above store the SQLite cache
inside `.data/` and sync once daily at 04:00 server-local time.

The app stores Garmin activities in SQLite. On server startup, it initializes
the cache and starts a background full-history sync when the database is empty.
After that, it refreshes activities once per day at `GARMIN_SYNC_TIME`.

The dashboard reads cached activity data at `/`. The same cached data is also
available as JSON at `/api/activities?start=0&limit=20`.

Training load data is fetched live from Garmin Connect on the dashboard. The
raw Garmin response is available as JSON at `/api/training-load`, or for a
specific day with `/api/training-load?date=2026-04-28`.

Embed the recent running overview in a blog with:

```html
<iframe
  src="https://run.lycois.org/embed/running"
  title="Current month running activity"
  width="100%"
  height="420"
  loading="lazy"
  style="border:0;max-width:760px;width:100%;"
></iframe>
```

By default, the embed shows running activities from the current calendar month.

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.
