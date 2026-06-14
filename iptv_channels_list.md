# IPTV Channels List (To Be Implemented)

This file contains the streaming sources extracted from the `.m3u` playlist [aponn.vercel.app/iptv.m3u](https://aponn.vercel.app/iptv.m3u).

---

## 📺 Channel Overview

| Channel Name | Logo URL | Stream URL | Playback Type | Recommended `proxyMode` |
| :--- | :--- | :--- | :--- | :--- |
| **TSports Live** | [Logo](https://i.ibb.co.com/h1Wvy09C/1000283988.png) | `http://198.195.239.50:8095/tsports/index.m3u8` | HLS (`.m3u8`) | `smart` |
| **FIFA World Cup 2026 (Server 1)** | [Logo](https://i.ibb.co.com/h1Wvy09C/1000283988.png) | `http://starhub.pro/live/farhat-3379/67897-913379/130714.ts` | MPEG-TS (`.ts`) | `all` |
| **FIFA World Cup 2026 (Server 2)** | [Logo](https://i.ibb.co.com/nMBnLS9h/1000284536.png) | `http://starhub.pro/live/farhat-3379/67897-913379/742610.ts` | MPEG-TS (`.ts`) | `all` |
| **FIFA World Cup 2026 (Server 3)** | [Logo](https://i.ibb.co.com/TD6fkDPj/1000284537.png) | `http://starhub.pro/live/farhat-3379/67897-913379/742611.ts` | MPEG-TS (`.ts`) | `all` |
| **FIFA World Cup 2026 4K (Server A)** | [Logo](https://i.ibb.co.com/nMBnLS9h/1000284536.png) | `http://starhub.pro/live/farhat-3379/67897-913379/745269.ts` | MPEG-TS (`.ts`) | `all` |
| **FIFA World Cup 2026 4K (Server B)** | [Logo](https://i.ibb.co/C32Rhtff/1000284518.png) | `http://starhub.pro/live/farhat-3379/67897-913379/745270.ts` | MPEG-TS (`.ts`) | `all` |

---

## 🛠️ Copy-Pasteable JavaScript Objects (for `app.js`)

You can copy these directly into the `DEFAULT_CHANNELS` array in `app.js` tomorrow:

```javascript
    // TSports Live
    {
      id: 'tsports-live',
      name: 'TSports Live',
      url: 'http://198.195.239.50:8095/tsports/index.m3u8',
      category: 'HLS',
      logo: 'https://i.ibb.co.com/h1Wvy09C/1000283988.png',
      isCustom: false,
      isFavorite: false,
      proxyMode: 'smart'
    },
    // FIFA World Cup (Starhub TS 130714)
    {
      id: 'fifa-ts-1',
      name: 'FIFA World Cup 1',
      url: 'http://starhub.pro/live/farhat-3379/67897-913379/130714.ts',
      category: 'TS',
      logo: 'https://i.ibb.co.com/h1Wvy09C/1000283988.png',
      isCustom: false,
      isFavorite: false,
      proxyMode: 'all'
    },
    // FIFA World Cup (Starhub TS 742610)
    {
      id: 'fifa-ts-2',
      name: 'FIFA World Cup 2',
      url: 'http://starhub.pro/live/farhat-3379/67897-913379/742610.ts',
      category: 'TS',
      logo: 'https://i.ibb.co.com/nMBnLS9h/1000284536.png',
      isCustom: false,
      isFavorite: false,
      proxyMode: 'all'
    },
    // FIFA World Cup (Starhub TS 742611)
    {
      id: 'fifa-ts-3',
      name: 'FIFA World Cup 3',
      url: 'http://starhub.pro/live/farhat-3379/67897-913379/742611.ts',
      category: 'TS',
      logo: 'https://i.ibb.co.com/TD6fkDPj/1000284537.png',
      isCustom: false,
      isFavorite: false,
      proxyMode: 'all'
    },
    // FIFA World Cup 4K (Starhub TS 745269)
    {
      id: 'fifa-ts-4k-1',
      name: 'FIFA World Cup 4K 1',
      url: 'http://starhub.pro/live/farhat-3379/67897-913379/745269.ts',
      category: 'TS',
      logo: 'https://i.ibb.co.com/nMBnLS9h/1000284536.png',
      isCustom: false,
      isFavorite: false,
      proxyMode: 'all'
    },
    // FIFA World Cup 4K (Starhub TS 745270)
    {
      id: 'fifa-ts-4k-2',
      name: 'FIFA World Cup 4K 2',
      url: 'http://starhub.pro/live/farhat-3379/67897-913379/745270.ts',
      category: 'TS',
      logo: 'https://i.ibb.co/C32Rhtff/1000284518.png',
      isCustom: false,
      isFavorite: false,
      proxyMode: 'all'
    }
```

---

## 🔒 Proxy Notice
Since `starhub.pro` uses the same path structure as the original TS live stream (`live-ts-stream`), they require routing through the server-side multicast pipeline (`proxyMode: 'all'`) to properly handle network buffering. If you scale these channels tomorrow, ensure they are routed via the server proxy settings.
