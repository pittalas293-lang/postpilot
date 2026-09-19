# PostPilot Architecture

Browser UI
  -> Node.js HTTP API
     -> JSON persistence
     -> Ollama local model
     -> Local scheduler

Core API:
- GET /api/health
- GET /api/ollama/status
- POST /api/auth/signup
- POST /api/auth/login
- POST /api/auth/logout
- GET /api/me
- GET/POST /api/posts
- GET/PUT/POST/DELETE /api/posts/:id
- POST /api/posts/:id/duplicate
- POST /api/generate
- GET /api/analytics
- GET /api/connections
- POST/DELETE /api/connections/:platform
- PUT /api/settings

Security notes:
- Passwords are hashed with `scrypt`.
- Sessions are random bearer tokens stored server-side.
- Secrets are not shipped to browser JavaScript.
- Third-party social publishing is not faked.
