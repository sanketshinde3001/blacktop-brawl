# Online scoreboards (optional)

The game keeps a top 10 on each player's device without any server. To share boards between
players, deploy this tiny Cloudflare Worker (free tier is plenty) and build the game with its URL.

1. `npx wrangler login`
2. `npx wrangler kv namespace create SCORES` and copy the id it prints
3. `cp wrangler.toml.example wrangler.toml`, paste the id, set `ALLOWED_ORIGIN` to your game's site
4. `npx wrangler deploy` (prints the worker URL)
5. Build the game with that URL:

```bash
VITE_LEADERBOARD_URL=https://blacktop-brawl-boards.<you>.workers.dev npm run package
```

Players' names and scores are then posted to your worker when an endless run ends or a daily
challenge is finished. Nothing else is sent. The game is client-side, so a determined player could
fake a score; the worker rejects junk (bad names, impossible scores, spam) but treat it as a
casual board. To wipe a board, delete its `board:<id>` key in the KV namespace.
