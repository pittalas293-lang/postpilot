# PostPilot AI — Complete Local-First SaaS

PostPilot is a complete local-first social-media management web application powered by Ollama. It is designed to let you build and operate the core product locally without a cloud AI subscription or per-token AI billing.

## One-click start (Windows)

1. Install Node.js 18+.
2. Install Ollama for Windows: https://ollama.com/download/windows
3. Double-click `launch.bat`.

`launch.bat` checks Node/Ollama, downloads `qwen2.5:7b` once if needed, starts the PostPilot server, and opens the app at:

`http://localhost:3000`

You can also run:

```text
setup-ollama.bat
start.bat
```

## Included application

### Accounts
- Sign up
- Sign in / logout
- Password hashing with Node scrypt
- Session authentication
- Profile settings

### AI content
- Local Ollama generation
- LinkedIn, Instagram, Facebook and X
- Tone selection
- Short / Medium / Long
- Editable AI output
- Local fallback when Ollama is unavailable

### Content management
- Create posts
- Save drafts
- Edit
- Delete
- Duplicate
- Search
- Status filters
- Post history

### Media
- Upload MP4 / MOV / WebM video
- Up to 100 MB
- Video validation
- Video preview
- Attach video to posts
- Authenticated video playback

### Scheduling
- Schedule posts
- Calendar view
- Local scheduler automatically moves due scheduled posts to Published
- Manual publish action
- Publishing status/history

### Analytics
- Total posts
- Draft / Scheduled / Published counts
- Last-30-day count
- Platform distribution

### Social connections
- LinkedIn
- Instagram
- Facebook
- X
- Secure connection-record architecture

## Production boundary

The local application is functional end-to-end for local content creation, media, scheduling, and analytics. Real third-party publishing requires the relevant developer apps, OAuth permissions, access tokens, API policies, and production secret storage for each social network. PostPilot intentionally does not fake third-party success.

Before public multi-user production deployment, replace the local JSON data store and local session storage with a production database and production-grade authentication/session infrastructure.

## Configuration

Copy `.env.example` to `.env` when using a process manager or terminal configuration. The server supports:

- `PORT`
- `OLLAMA_URL`
- `OLLAMA_MODEL`
- `SESSION_DAYS`
- `REQUEST_TIMEOUT_MS`

Default Ollama endpoint:

`http://127.0.0.1:11434`

Default model:

`qwen2.5:7b`
