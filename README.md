Garmin Connect Dashboard

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Set the Garmin Connect credentials in `.env` before starting the server:

```dotenv
GARMIN_USERNAME="your.email@example.com"
GARMIN_PASSWORD="your-password"
GARMIN_DOMAIN="garmin.com"
```

Use `GARMIN_DOMAIN="garmin.cn"` for Garmin China accounts.

The dashboard reads activity data at `/`. The same server-side fetch is also
available as JSON at `/api/activities?start=0&limit=20`.

Embed the recent running overview in a blog with:

```html
<iframe
  src="https://your-domain.example/embed/running?limit=5"
  title="Recent running activity"
  width="100%"
  height="420"
  loading="lazy"
  style="border:0;max-width:760px;width:100%;"
></iframe>
```

The `limit` query parameter accepts `1` through `10`.

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
