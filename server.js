const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { PassThrough } = require('stream');

const keepAliveAgentHttp = new http.Agent({ keepAlive: true, maxSockets: 150, keepAliveMsecs: 15000 });
const keepAliveAgentHttps = new https.Agent({ keepAlive: true, maxSockets: 150, keepAliveMsecs: 15000 });

// In-memory manifest cache to avoid duplicate upstream requests and rewriting overhead
const manifestCache = new Map();
const CACHE_TTL_MS = 1500; // 1.5 seconds TTL (suitable for live HLS streams)

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

// Proxy route
app.get('/proxy', (req, res) => {
  const targetUrl = req.query.url;
  const smartMode = req.query.smart === 'true'; // SMART PROXY FLAG

  if (!targetUrl) {
    return res.status(400).send('Missing "url" parameter');
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
          }
          res.writeHead(200, responseHeaders);
          // Pipe using PassThrough chute with 512KB buffer to prevent backpressure stuttering
          const bufferChute = new PassThrough({ highWaterMark: 512 * 1024 });
          proxyRes.pipe(bufferChute).pipe(res);
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
