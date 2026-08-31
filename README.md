# Random Video Chat

Omegle-style 1-to-1 random video chat using WebRTC + Socket.IO. This version is intentionally standalone: it only matches users on this service.

## Deploy on Render

The repository includes `render.yaml`. Connect the GitHub repository to Render and deploy the `random-video-chat` web service. Render supports inbound WebSocket connections for web services, which Socket.IO needs for matchmaking/signaling.

If deploying manually, use:
- Root Directory: `server`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check: `/health`

For public camera/microphone access, use HTTPS. For reliable WebRTC connectivity across restrictive NAT/firewalls, add a TURN service to `client/app.js`.
