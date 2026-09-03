# PVP Hub

## Run locally

Requires Node.js 18 or newer.

```sh
npm start
```

Open `http://localhost:3000`. On the first run the server creates a master account:

- Username: `admin`
- Password: `change-me-please`

Set `MASTER_PASSWORD` before the first run in production. The master can create and remove editor accounts from **Manage**. Editors can update `data/leaderboards.json` through the same workspace. Accounts and rankings are persisted in `data/users.json` and `data/leaderboards.json`.

The public leaderboard data is also available at `/data/leaderboards.json`. Account storage remains private in the root `data/users.json` file; do not place it under `public`.

Player titles support three modes in the editor: `auto` derives a title from points, `custom` uses `customTitle`, and `retired` displays `Retired`. Existing players with only a legacy `title` field continue to display that title as a custom title.

Netlify account management uses Netlify Blobs through `netlify/functions/api.mjs`. Add these environment variables in Netlify before deploying: `NETLIFY_SITE_ID`, `NETLIFY_AUTH_TOKEN`, and `MASTER_PASSWORD`. The function creates the initial `admin` account in the `pvp-hub` store on its first request. Use a Netlify personal access token for `NETLIFY_AUTH_TOKEN`; never commit it to the repository.