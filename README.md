# Bruno Bock Sign-In Kiosk

Touchscreen kiosk app for warehouse on-site tracking.

- **Tap-and-hold (1 s)** toggles employee/visitor on-site status with a fill/drain
  animation and audio feedback.
- **Visitor self sign-in** with webcam portrait and on-screen signature.
- **Multi-kiosk LAN sync** via leader-election; followers are hot-spare replicas
  that auto-promote if the leader is unreachable.
- **Hidden admin panel** (long-press top-right corner for 3 s, then enter PIN).
- **Append-only audit log** exportable as CSV; printable muster view.

## Stack

- Next.js 15 (App Router, custom `server.ts`) + React 19 + TypeScript
- SQLite via `better-sqlite3` + Drizzle ORM
- WebSockets (`ws`) for leader↔follower replication; SSE for browser updates
- Tailwind CSS, `signature_pad`, native `getUserMedia`
- PIN hashed with `node:crypto` scrypt

## Quick start (dev)

```bash
npm install
cp .env.example .env.local      # edit values
npm run db:generate             # only if you changed schema.ts
npm run db:migrate
npm run dev
```

Open http://localhost:3000.

## Production install on a Windows kiosk

Run as **Administrator** in PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\scripts\install.ps1
```

The script:

1. Installs Node LTS, Git, NSSM via `winget`
2. Stages the app to `C:\BrunoBock`, runs `npm ci` + `npm run build`
3. Prompts for kiosk ID, peers, admin PIN, paths
4. Hashes the PIN, writes `.env.local`, runs migrations
5. Installs the Windows service `BrunoBockApp` via NSSM
6. Applies Edge kiosk policies (camera auto-allow, autoplay, fullscreen)
7. Creates a Scheduled Task to launch Edge `--kiosk` at logon
8. Disables sleep / screensaver
9. Optionally configures Windows auto-login (`-EnableAutoLogin`)

Other scripts:

- `scripts/update.ps1` — `git pull` (or unpack release zip), rebuild, migrate, restart service
- `scripts/uninstall.ps1` — remove service, task, Edge policies, install dir
- `scripts/start-kiosk.ps1` — manually launch Edge in `--kiosk` mode
- `scripts/backup.ps1` — daily SQLite online backup, prunes after N days

### Environment variables

See [.env.example](.env.example).

| Var                | Purpose                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| `KIOSK_ID`         | Short unique id for this kiosk (e.g. `K1`, `lobby`)                    |
| `KIOSK_NAME`       | Friendly display name                                                  |
| `LEADER_DISCOVERY` | Comma-separated peer base URLs (e.g. `http://kiosk2:3000,http://kiosk3:3000`) |
| `ADMIN_PIN_HASH`   | scrypt hash from `scripts/hash-pin.ts`                                 |
| `DB_PATH`          | SQLite file path                                                       |
| `MEDIA_PATH`       | Visitor photo/signature storage root                                   |
| `PORT`             | HTTP port (default 3000)                                               |

## Architecture overview

Every kiosk runs the full stack. One kiosk is the **leader** (single writer);
others are **followers**. All write API routes call `applyMutation()`:

- on the leader: `appendEvent()` writes to the local `events` table and the
  `presence` table inside one transaction, then notifies subscribers.
- on a follower: the request is forwarded over HTTP to the leader; the
  resulting event arrives back over the WS replication stream and is applied
  via `applyRemoteEvent()` (idempotent by ULID).

The `events` table doubles as the replication log. Followers subscribe with
their `lastSeq`; the leader streams everything after that, then live events.

If the leader's heartbeat (every 2 s) is missed for >5 s, the coordinator runs
an election: it probes `/api/replication/identity` on each peer; the kiosk
with the highest `lastSeq` wins (smallest `kioskId` breaks ties).

## Admin panel

- Long-press the top-right corner for ~3 s on any kiosk.
- Enter the admin PIN (default `0000` if you skipped configuration — change it
  immediately at `/admin/pin`).
- Manage employees, visitors, view kiosk health, change PIN, export audit CSV,
  print muster.
