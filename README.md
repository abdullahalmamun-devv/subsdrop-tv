# SubsDrop TV — Live Stream Player

A premium, lightweight, and ultra-fast IPTV stream player built to play HLS (`.m3u8`) and MPEG-TS (`.ts`) live feeds directly in the web browser. Features an integrated intelligent CORS proxy fallback, real-time traffic counters, responsive minimalist dark themes, and a content disclaimer system.

## 🚀 Features

- **Multi-Format Playback:** Seamless support for HLS native playback (using Hls.js) and MPEG-TS playback (using mpegts.js) in the browser.
- **Smart CORS Proxy:** Handles browser CORS restrictions by selectively proxying `.m3u8` manifests or piping complete `.ts` video chunks using a Node.js backend proxy.
- **Live Traffic Tracker:** Real-time active web session counter and active concurrent streamer tracking for Server 1 using Server-Sent Events (SSE).
- **Minimalist UI:** Modern, distraction-free dashboard centered horizontally and vertically under the player wrapper.
- **Premium Themes:** Sleek dark-mode aesthetic featuring Outfit typography, a neon glow backdrop backing, and an active server bouncing equalizer wave animation.
- **Disclaimer Modal:** Legal take-down and content ownership notice overlay.
- **VPS Autodeploy:** Fully configured GitHub Actions workflow (`.github/workflows/deploy.yml`) to automatically pull updates and restart the Node server on VPS upon git push to `main`.

---

## 🛠️ Tech Stack

- **Frontend:** Vanilla HTML5, Vanilla CSS3 (Outfit Google font, Lucide icon system), Vanilla JavaScript (ES6)
- **Engine libraries:** Hls.js, mpegts.js, Lucide Icons
- **Backend:** Node.js, Express.js (HTTP stream proxy, Server-Sent Events controller)

---

## 💻 Local Setup & Installation

### Prerequisites
Make sure you have Node.js (v14 or higher) installed on your system.

### Steps
1. Clone the repository to your local machine:
   ```bash
   git clone https://github.com/abdullahalmamun-devv/subsdrop-tv.git
   ```
2. Navigate into the project folder:
   ```bash
   cd subsdrop-tv
   ```
3. Install backend dependencies:
   ```bash
   npm install
   ```
4. Start the Node.js server:
   ```bash
   npm start
   ```
5. Open your web browser and navigate to:
   ```http
   http://localhost:8000
   ```

---

## 🔧 Proxy Routing Modes
Each channel in `DEFAULT_CHANNELS` (defined in `app.js`) can specify a `proxyMode` to optimize server bandwidth:
- **`none` (Direct):** Play directly from the target stream CDN. Uses zero server bandwidth.
- **`smart` (Manifest-Only Proxy):** Routes the `.m3u8` playlist index through the backend server (to bypass CORS block and spoof User-Agent headers), while the browser downloads raw segment files directly from the stream CDN. Near-zero server bandwidth.
- **`all` (Full Proxy):** Routes both the playlist index and all segment chunks through the backend server. Used for strict MPEG-TS streams or secured CDNs. Uses VPS bandwidth.

---

## 📖 License & Disclaimer
SubsDrop TV is a media player interface. It does not host, stream, store, or redistribute any media content. All live streams are third-party links publicly available on the internet.
Inquiries and take-down requests can be forwarded to `support@subsdrop.com`.
