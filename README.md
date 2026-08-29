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