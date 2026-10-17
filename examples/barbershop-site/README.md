# Sam's Barbershop (demo site)

A tiny stand-alone website that takes bookings through the Kitpier Booking API, built from Kitpier's
"Use in your app" prompt. No dependencies; Node 20.6+.

1. In Kitpier, open your project → **Use in your app** → **Create key**, and copy the `.env` snippet.
2. Save it as `.env` in this folder (see `.env.example`). Never commit it.
3. `node --env-file=.env server.mjs` → http://localhost:3006

The key stays in `server.mjs`; the browser only calls this site's `/api/chat`, `/api/code` and `/api/confirm`,
which forward to `/v1/booking/converse`, `/code` and `/confirm` with the visitor's IP. Bookings land in the
business's Supabase, confirmations go through its Resend, and usage is paid from its Kitpier credits.
