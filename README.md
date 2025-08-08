
# Cyberpunk Treasure Hunt (Prototype)

A deployable Vite + React + TypeScript project for a massive-grid treasure hunt.
- 10M sq ft logical world (3163 × 3162)
- 1 free dig per user per day (local demo)
- Extra digs via mocked purchase
- Other players' digs + initials (local demo state)
- Swap mocked API with your backend for production

## Local Dev
```bash
npm i
npm run dev
```

## Build
```bash
npm run build
npm run preview
```

## One-Click Deploys
### Vercel
1. Create a new Vercel project and import this repo/folder.
2. Build command: `npm run build`
3. Output directory: `dist`
4. Framework preset: `Vite`

### Netlify
1. New Site from Git
2. Build command: `npm run build`
3. Publish directory: `dist`

## Backend (replace the mock API)
- POST /dig { x, y, userId } → { found: boolean } (also end game server-side if found)
- GET  /window?ox&oy&w&h → digs with { x, y, initials }
- GET  /state → { ended, winnerId?, x?, y? }
- POST /buy-digs { userId, count } → credits extra digs post-payment

**Important:** Keep the treasure location *server-side only* in production.

## Notes
- This prototype stores state in localStorage for demo purposes.
- For real-time initials, add a WebSocket to push new digs to clients.
