const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { PassThrough } = require('stream');
const { spawn } = require('child_process');

const keepAliveAgentHttp = new http.Agent({ keepAlive: true, maxSockets: 150, keepAliveMsecs: 15000 });
const keepAliveAgentHttps = new https.Agent({ keepAlive: true, maxSockets: 150, keepAliveMsecs: 15000 });

// In-memory manifest cache to avoid duplicate upstream requests and rewriting overhead
const manifestCache = new Map();
const CACHE_TTL_MS = 1500; // 1.5 seconds TTL (suitable for live HLS streams)

// Periodic cleanup of expired manifest cache entries to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of manifestCache) {
    if (now - val.timestamp > CACHE_TTL_MS * 4) {
      manifestCache.delete(key);
    }
  }
}, 10000);

const app = express();
const PORT = process.env.PORT || 8000;

// Serve static frontend files directly from the root directory (no-cache for dev)
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/index.html', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/style.css', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'style.css'));
});
app.get('/app.js', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'app.js'));
});

// Enable CORS for API routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Range');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Live Stats SSE endpoint
app.get('/api/live-stats', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  
  // Send initial ping to establish connection
  res.write(':\n\n');

  sseClients.push(res);
  broadcastStats();

  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
    broadcastStats();
  });
});

// Proxy route
app.get('/proxy', (req, res) => {
  const targetUrl = req.query.url;
  const smartMode = req.query.smart === 'true'; // SMART PROXY FLAG

  if (!targetUrl) {
    return res.status(400).send('Missing "url" parameter');
  }

  // All .ts streams use the dynamic Multicast/Restreaming proxy
  const isTsStream = targetUrl.toLowerCase().includes('.ts');
  if (isTsStream) {
    return handleMulticastTsStream(req, res, targetUrl);
  }

  // Serve manifest from cache if available and fresh
  const cacheKey = `${targetUrl}_${smartMode}`;
  const cached = manifestCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    res.writeHead(200, cached.headers);
    return res.end(cached.body);
  }

  let originalOrigin = '';
  try {
    const u = new URL(targetUrl);
    originalOrigin = u.origin;
  } catch (e) {
    return res.status(400).send('Invalid URL parameter');
  }

  const sendError = (statusCode, msg) => {
    if (!res.headersSent) {
      res.status(statusCode).send(msg);
    }
  };

  function makeRequest(currentUrl, redirectCount = 0, cookies = '') {
    if (redirectCount > 10) {
      return sendError(508, 'Too many redirects');
    }

    try {
      const currentParsed = new URL(currentUrl);
      const isHttps = currentParsed.protocol === 'https:';
      const clientModule = isHttps ? https : http;

      const forwardHeaders = {
        'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
        'Accept': '*/*',
        'Connection': 'keep-alive'
      };

      if (req.headers['range']) forwardHeaders['Range'] = req.headers['range'];
      if (originalOrigin) forwardHeaders['Referer'] = originalOrigin + '/';
      if (cookies) forwardHeaders['Cookie'] = cookies;

      const proxyOptions = {
        hostname: currentParsed.hostname,
        port: currentParsed.port || (isHttps ? 443 : 80),
        path: currentParsed.pathname + currentParsed.search,
        method: 'GET',
        headers: forwardHeaders,
        timeout: 15000,
        agent: isHttps ? keepAliveAgentHttps : keepAliveAgentHttp
      };

      const proxyReq = clientModule.request(proxyOptions, (proxyRes) => {
        proxyReq.setTimeout(0);
        const statusCode = proxyRes.statusCode;

        let nextCookies = cookies;
        if (proxyRes.headers['set-cookie']) {
          const newCookies = proxyRes.headers['set-cookie']
            .map(c => c.split(';')[0])
            .join('; ');
          nextCookies = cookies ? `${cookies}; ${newCookies}` : newCookies;
        }

        if ([301, 302, 303, 307, 308].includes(statusCode) && proxyRes.headers.location) {
          let redirectUrl = proxyRes.headers.location;
          if (!redirectUrl.startsWith('http')) {
            redirectUrl = new URL(redirectUrl, currentUrl).href;
          }
          return makeRequest(redirectUrl, redirectCount + 1, nextCookies);
        }

        const responseHeaders = {
          'Access-Control-Allow-Origin': '*'
        };
        const headersToForward = ['content-type', 'content-length', 'accept-ranges', 'content-range', 'cache-control'];
        headersToForward.forEach(header => {
          if (proxyRes.headers[header]) responseHeaders[header] = proxyRes.headers[header];
        });

        const contentType = proxyRes.headers['content-type'] || '';
        const isM3u8 = currentUrl.toLowerCase().includes('.m3u8') ||
                       contentType.includes('mpegurl') ||
                       contentType.includes('application/x-mpegurl') ||
                       contentType.includes('vnd.apple.mpegurl');

        if (isM3u8) {
          let body = [];
          proxyRes.on('data', chunk => body.push(chunk));
          proxyRes.on('end', () => {
            try {
              const text = Buffer.concat(body).toString('utf8');
              const lines = text.split('\n');
              const rewrittenLines = lines.map(line => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                  let absoluteUrl;
                  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                    absoluteUrl = trimmed;
                  } else {
                    try {
                      absoluteUrl = new URL(trimmed, currentUrl).href;
                    } catch (err) {
                      absoluteUrl = trimmed;
                    }
                  }
                  
                  // SMART PROXY CORE LOGIC:
                  const isManifest = absoluteUrl.toLowerCase().includes('.m3u8');
                  if (smartMode && !isManifest) {
                    return absoluteUrl; // Browser fetches TS chunk directly from CDN!
                  } else {
                    return `/proxy?url=${encodeURIComponent(absoluteUrl)}${smartMode ? '&smart=true' : ''}`;
                  }
                }
                if (trimmed.startsWith('#') && trimmed.includes('URI="')) {
                  return line.replace(/URI="([^"]+)"/g, (match, uri) => {
                    let absUri;
                    if (uri.startsWith('http://') || uri.startsWith('https://')) absUri = uri;
                    else {
                      try { absUri = new URL(uri, currentUrl).href; } catch (e) { absUri = uri; }
                    }
                    const isManifest = absUri.toLowerCase().includes('.m3u8');
                    if (smartMode && !isManifest) {
                      return `URI="${absUri}"`;
                    }
                    return `URI="/proxy?url=${encodeURIComponent(absUri)}${smartMode ? '&smart=true' : ''}"`;
                  });
                }
                return line;
              });

              const rewrittenBuffer = Buffer.from(rewrittenLines.join('\n'), 'utf8');
              responseHeaders['content-type'] = 'application/vnd.apple.mpegurl; charset=utf-8';
              responseHeaders['content-length'] = rewrittenBuffer.length;
              
              // Cache the rewritten manifest
              manifestCache.set(cacheKey, {
                timestamp: Date.now(),
                headers: responseHeaders,
                body: rewrittenBuffer
              });
              
              res.writeHead(200, responseHeaders);
              res.end(rewrittenBuffer);
            } catch (err) {
              sendError(500, 'Error parsing M3U8');
            }
          });
        } else {
          // TS stream or binary data
          const isTsStream = targetUrl.toLowerCase().includes('.ts') || 
                             currentUrl.toLowerCase().includes('.ts') ||
                             (proxyRes.headers['content-type'] && proxyRes.headers['content-type'].includes('video/mp2t'));
          
          if (isTsStream) {
            responseHeaders['content-type'] = 'video/mp2t';
            delete responseHeaders['content-length'];
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.writeHead(200, responseHeaders);

            // Use FFmpeg to transcode audio (MP2/AC3 → AAC) so browsers can play it
            // Video is passed through unchanged (copy) for zero quality loss and low CPU
            const ffmpeg = spawn('ffmpeg', [
              '-i', 'pipe:0',           // Read from stdin (piped upstream)
              '-c:v', 'copy',           // Pass video through unchanged
              '-c:a', 'aac',            // Re-encode audio to AAC (browser-compatible)
              '-b:a', '128k',           // 128kbps audio bitrate
              '-ac', '2',               // Stereo output
              '-f', 'mpegts',           // Output format: MPEG-TS
              '-fflags', '+genpts+discardcorrupt',
              '-err_detect', 'ignore_err',
              '-loglevel', 'error',
              'pipe:1'                  // Write to stdout
            ], { stdio: ['pipe', 'pipe', 'pipe'] });

            // Pipe upstream TS → FFmpeg stdin → FFmpeg stdout → client response
            proxyRes.pipe(ffmpeg.stdin);
            ffmpeg.stdout.pipe(res);

            ffmpeg.stderr.on('data', (data) => {
              const msg = data.toString().trim();
              if (msg) console.warn('[FFmpeg proxy]', msg);
            });

            // Clean up on client disconnect
            res.on('close', () => {
              try { ffmpeg.stdin.destroy(); } catch (e) {}
              try { ffmpeg.kill('SIGTERM'); } catch (e) {}
            });

            ffmpeg.on('error', (err) => {
              console.error('[FFmpeg proxy] Process error:', err.message);
              if (!res.destroyed) res.destroy();
            });

            // Clean up upstream connection when FFmpeg exits
            ffmpeg.on('close', () => {
              if (!proxyRes.destroyed) proxyRes.destroy();
            });

            ffmpeg.stdin.on('error', () => {}); // Suppress EPIPE on early disconnect
            ffmpeg.stdout.on('error', () => {}); // Suppress EPIPE on early disconnect
          } else {
            res.writeHead(200, responseHeaders);
            // Pipe using PassThrough chute with 4MB buffer
            const bufferChute = new PassThrough({ highWaterMark: 4 * 1024 * 1024 });
            proxyRes.pipe(bufferChute).pipe(res);
          }
        }
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        sendError(504, 'Proxy request timeout');
      });

      proxyReq.on('error', (err) => {
        sendError(502, `Proxy request error: ${err.message}`);
      });

      proxyReq.end();

    } catch (e) {
      sendError(500, 'Internal server error');
    }
  }

  makeRequest(targetUrl);
});

// Dynamic state for multicast TS stream sharing
// Map key: targetUrl, Value: { stream: PassThrough, clients: Array, upstreamReq: ClientRequest, ffmpegProcess: ChildProcess, cleanupTimeout: NodeJS.Timeout }
const activeMultiplexers = new Map();

// Global state for SSE traffic tracking
let sseClients = [];

function broadcastStats() {
  let totalTsClients = 0;
  for (const mux of activeMultiplexers.values()) {
    totalTsClients += mux.clients.length;
  }
  const stats = {
    viewers: sseClients.length,
    activeTsStreams: totalTsClients
  };
  const data = `data: ${JSON.stringify(stats)}\n\n`;
  sseClients.forEach(client => {
    if (client.writable && !client.destroyed) {
      client.write(data);
    }
  });
}

// Heartbeat ping to keep SSE connections open and clean up stale ones
setInterval(() => {
  sseClients.forEach(client => {
    if (client.writable && !client.destroyed) {
      client.write(':\n\n'); // SSE comment ping
    }
  });
}, 25000);

function handleMulticastTsStream(req, res, targetUrl) {
  // Set headers for MPEG-TS streaming with keep-alive
  res.writeHead(200, {
    'Content-Type': 'video/mp2t',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Connection': 'keep-alive',
    'X-Content-Type-Options': 'nosniff'
  });

  let mux = activeMultiplexers.get(targetUrl);

  if (!mux) {
    console.log(`[Multiplexer] Initializing new stream for ${targetUrl}`);
    mux = {
      stream: new PassThrough({ highWaterMark: 15 * 1024 * 1024 }),
      clients: [],
      upstreamReq: null,
      ffmpegProcess: null,
      cleanupTimeout: null
    };
    activeMultiplexers.set(targetUrl, mux);
    
    // Listen to data events and write directly to each client to avoid backpressure block
    mux.stream.on('data', (chunk) => {
      if (mux.stream.destroyed) return; // Guard against write-after-destroy
      mux.clients.forEach(client => {
        if (client.writable && !client.destroyed) {
          // If a client lags behind by more than 15MB (approx 1 minute of lag), disconnect them to protect RAM
          if (client.writableLength > 15 * 1024 * 1024) {
            console.warn(`[Multiplexer] Client too slow, dropping from ${targetUrl}`);
            client.destroy();
          } else {
            client.write(chunk);
          }
        }
      });
    });

    startUpstreamTsStream(targetUrl, mux, req);
  } else {
    // If a cleanup was scheduled because clients hit 0, cancel it since someone reconnected!
    if (mux.cleanupTimeout) {
      clearTimeout(mux.cleanupTimeout);
      mux.cleanupTimeout = null;
      console.log(`[Multiplexer] Client reconnected to ${targetUrl}. Cancelled shutdown.`);
    }
  }

  mux.clients.push(res);
  broadcastStats();

  // Clean up when a client leaves
  req.on('close', () => {
    mux.clients = mux.clients.filter(c => c !== res);
    broadcastStats();
    if (mux.clients.length === 0) {
      // Delay cleanup by 10 seconds in case a user is just refreshing the page
      console.log(`[Multiplexer] 0 clients for ${targetUrl}. Scheduling shutdown in 10s.`);
      mux.cleanupTimeout = setTimeout(() => {
        cleanupUpstreamTsStream(targetUrl, mux);
      }, 10000);
    }
  });
}

function startUpstreamTsStream(url, mux, originalReq) {
  try {
    const currentParsed = new URL(url);
    const isHttps = currentParsed.protocol === 'https:';
    const clientModule = isHttps ? https : http;

    let originalOrigin = '';
    try { originalOrigin = new URL(url).origin; } catch(e){}

    const forwardHeaders = {
      'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
      'Accept': '*/*',
      'Connection': 'keep-alive'
    };
    if (originalReq && originalReq.headers['range']) forwardHeaders['Range'] = originalReq.headers['range'];
    if (originalOrigin) forwardHeaders['Referer'] = originalOrigin + '/';

    const proxyOptions = {
      hostname: currentParsed.hostname,
      port: currentParsed.port || (isHttps ? 443 : 80),
      path: currentParsed.pathname + currentParsed.search,
      method: 'GET',
      headers: forwardHeaders,
      timeout: 15000,
      agent: isHttps ? keepAliveAgentHttps : keepAliveAgentHttp
    };

    mux.upstreamReq = clientModule.request(proxyOptions, (proxyRes) => {
      mux.upstreamReq.setTimeout(0);
      const statusCode = proxyRes.statusCode;

      if ([301, 302, 303, 307, 308].includes(statusCode) && proxyRes.headers.location) {
        let redirectUrl = proxyRes.headers.location;
        if (!redirectUrl.startsWith('http')) {
          redirectUrl = new URL(redirectUrl, url).href;
        }
        if (mux.upstreamReq) {
          try { mux.upstreamReq.destroy(); } catch (e) {}
        }
        startUpstreamTsStream(redirectUrl, mux, originalReq);
        return;
      }

      if (statusCode !== 200) {
        broadcastError(mux, "Failed to fetch stream from source.");
        cleanupUpstreamTsStream(url, mux);
        return;
      }

      // Use FFmpeg to transcode audio (MP2/AC3 → AAC) for browser compatibility
      const ffmpeg = spawn('ffmpeg', [
        '-i', 'pipe:0',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ac', '2',
        '-f', 'mpegts',
        '-fflags', '+genpts+discardcorrupt',
        '-err_detect', 'ignore_err',
        '-loglevel', 'error',
        'pipe:1'
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      mux.ffmpegProcess = ffmpeg;

      // Pipe: upstream → FFmpeg stdin, FFmpeg stdout → multicast PassThrough
      proxyRes.pipe(ffmpeg.stdin);
      ffmpeg.stdout.pipe(mux.stream, { end: false });

      ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) console.warn(`[FFmpeg Mux: ${url.substring(0,30)}...]`, msg);
      });

      ffmpeg.on('error', (err) => {
        console.error(`[FFmpeg Mux Error: ${url}]`, err.message);
      });

      // Clean up upstream connection when FFmpeg exits
      ffmpeg.on('close', () => {
        if (proxyRes && !proxyRes.destroyed) proxyRes.destroy();
      });

      ffmpeg.stdin.on('error', () => {}); // Suppress EPIPE
      ffmpeg.stdout.on('error', () => {}); // Suppress EPIPE
    });

    mux.upstreamReq.on('timeout', () => {
      broadcastError(mux, "Source stream connection timed out.");
      cleanupUpstreamTsStream(url, mux);
    });

    mux.upstreamReq.on('error', (err) => {
      broadcastError(mux, `Source stream error: ${err.message}`);
      cleanupUpstreamTsStream(url, mux);
    });

    mux.upstreamReq.end();
  } catch (e) {
    broadcastError(mux, "Failed to initiate source stream connection.");
    cleanupUpstreamTsStream(url, mux);
  }
}

function broadcastError(mux, msg) {
  mux.clients.forEach(client => {
    if (client.writable && !client.destroyed) {
      try {
        client.write(Buffer.from(msg, 'utf8'));
      } catch (e) {}
    }
  });
}

function cleanupUpstreamTsStream(url, mux) {
  console.log(`[Multiplexer] Shutting down ${url}`);
  if (mux.cleanupTimeout) clearTimeout(mux.cleanupTimeout);
  
  if (mux.ffmpegProcess) {
    try { mux.ffmpegProcess.stdin.destroy(); } catch (e) {}
    try { mux.ffmpegProcess.kill('SIGTERM'); } catch (e) {}
    mux.ffmpegProcess = null;
  }
  if (mux.upstreamReq) {
    try { mux.upstreamReq.destroy(); } catch (e) {}
    mux.upstreamReq = null;
  }
  if (mux.stream) {
    try { mux.stream.destroy(); } catch (e) {}
    mux.stream = null;
  }
  
  mux.clients = [];
  activeMultiplexers.delete(url);
  broadcastStats();
}

// Fallback for non-existent client-side paths
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/proxy')) {
    res.status(404).send('Page not found');
  } else {
    next();
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Serving static files from root directory: ${__dirname}`);
});
