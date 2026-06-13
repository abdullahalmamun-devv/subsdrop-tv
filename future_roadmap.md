# SubsDrop TV — Future Scaling & Optimization Roadmap

This document outlines the architecture plans and methods for scaling the SubsDrop TV platform to support high concurrent viewer loads, secure stream URLs, and automate external broadcasts (e.g., to Telegram).

---

## 1. ⚙️ High-Traffic Architecture (Next.js Migration)
As traffic scales, transitioning from Vanilla HTML/Express to a modern framework stack like **Next.js** provides key benefits:
- **Server-Side Rendering (SSR) & Edge API Routes:** Delivers pre-rendered pages instantly to users and handles proxy API endpoints under the same serverless or edge runtime environment.
- **Component-Driven UI:** Organizes codebases for complex features (user dashboard, favorite channels list, dark/light modes) into clean, modular React components.
- **Optimized Asset Delivery:** Automatic compression of scripts and styles.

---

## 2. 🧠 Cache Management & Session Sharing (Redis)
Using **Redis** (an in-memory key-value database) allows the backend to handle caching and live state scaling efficiently:
- **Shared Manifest Cache:** Instead of storing rewritten `.m3u8` playlists in a local JS `Map` (which is isolated per Node process), storing them in Redis allows multiple VPS server instances behind a load balancer to share a single, fast cache.
- **Global Traffic Counter:** Tracks active viewer sessions across all load-balanced nodes, providing a unified live viewers count.
- **DDoS/Rate Limiting:** Prevents scraper bots from exhausting proxy bandwidth by enforcing IP request rate limits in micro-seconds.

---

## 3. 🌐 Bandwidth Optimization (CDN Caching)
To prevent the backend VPS from crashing under high segment download traffic (when streaming in `all` proxy mode), we can route traffic through a CDN caching layer:
- **Cloudflare Cache Rules (Free):** Create a cache rule to cache `.ts` segment chunks for a short duration (e.g., 5 to 10 seconds). If 1,000 users are watching the same channel, Cloudflare fetches the segment from our proxy once, and serves it to the other 999 users from its global Edge servers—reducing VPS bandwidth load to near zero.
- **BunnyCDN Integration (Paid Backup):** If Cloudflare flags heavy video traffic on the Free tier, we can integrate BunnyCDN. It charges a very low flat rate (approx. $5 - $10 per 1 TB bandwidth), which can be easily funded by placing simple banner ads on the website.

---

## 4. 🔗 Stream URL Security (Hiding/Protecting URLs)
To prevent hotlinking (other websites stealing your streams) and scraping:
- **Internal URL Routing:** Hide absolute upstream stream URLs from the browser Network tab by using internal IDs (e.g., `/proxy/server-1/segment_001.ts`) and translating them in memory on the VPS.
- **Signed Tokens:** Generate temporary, IP-locked cryptographic tokens when a user loads the page, validating them at the server proxy before releasing stream data.
- **Cloudflare Referer Blocks:** Block requests to the `/proxy` path if the HTTP `Referer` header is missing or does not match your official domain (`tv.subsdrop.com`).

---

## 5. 📢 Telegram Channel Live Broadcasting (RTMP Push)
To broadcast live feeds from SubsDrop TV directly to a Telegram Channel or Group:
- **Manual OBS Broadcast (Zero VPS Bandwidth):**
  1. Open OBS Studio on a personal computer.
  2. Add a **Media Source** with `Local file` unchecked, and paste the stream URL in the `Input` box.
  3. Go to OBS **Settings** -> **Stream** -> Select **Service:** `Custom...`.
  4. Paste the Telegram Live Stream **Server URL** and **Stream Key** into the boxes and click OK.
  5. Click **Start Streaming** in OBS, and then click **Start Broadcast** in Telegram.
- **Automated Server Broadcasting (FFmpeg on VPS):**
  Run an FFmpeg pipe command on the VPS. Using `-c:v copy` bypasses transcoding to use almost zero CPU:
  ```bash
  ffmpeg -re -i "https://stream-url.m3u8" -c:v copy -c:a aac -f flv "rtmp://telegram-rtmp-server/telegram-stream-key"
  ```
- **Telegram Controller Bot:**
  Build a simple Node-based Telegram Bot running on the VPS. Allows admins to control broadcasts by typing telegram commands like `/start_stream server1` or `/stop_stream` directly from their mobile phone.
