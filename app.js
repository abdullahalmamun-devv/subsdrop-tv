/**
 * SubsDrop TV - Application Logic
 * Implements lightweight, premium IPTV playback with automatic CORS proxy fallback.
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- Constants & Preloaded Channels ---
  // proxyMode per channel:
  // 'none'  = Direct play, zero server bandwidth (for CORS-friendly sources)
  // 'smart' = Only .m3u8 manifest proxied, .ts video chunks go direct from CDN (near-zero bandwidth)
  // 'all'   = Full proxy for CORS-restricted sources (server handles all traffic)
  const DEFAULT_CHANNELS = [
    {
      id: 'colors-bangla-hd',
      name: 'Colors Bangla HD',
      url: 'https://d1g8wgjurz8via.cloudfront.net/bpk-tv/ColorsHD/default/ColorsHD.m3u8',
      category: 'HLS',
      logo: '',
      isCustom: false,
      isFavorite: false,
      proxyMode: 'smart' // CloudFront HLS stream
    },
    {
      id: 'fifa-ts-2',
      name: 'FIFA World Cup 4K',
      url: 'http://starhub.pro/live/farhat-3379/67897-913379/742610.ts',
      category: 'TS',
      logo: 'https://i.ibb.co.com/nMBnLS9h/1000284536.png',
      isCustom: false,
      isFavorite: false,
      proxyMode: 'all'
    },
    {
      id: 'stream-toffee',
      name: 'Server 1',
      url: 'https://toffee-seg.smartdev.workers.dev/manifest?url=https%3A%2F%2Fprod-cdn01-live.toffeelive.com%2Flive%2FFIFA-2026%2F0%2Fmaster_2000.m3u8&cookie=%22Expires%3D1781636307~_GO%3DGenerated~URLPrefix%3DaHR0cHM6Ly9wcm9kLWNkbjAxLWxpdmUudG9mZmVlbGl2ZS5jb20~Signature%3DAduQTZ9t0mGjlXJ3dtEAGqYTyE5PW__m1jRmMyHRZM7Jv_TYwRT9Trid7Q05okywyNi9k2RuilUaXJdSY9TFLLUrD5EN%22',
      category: 'HLS',
      logo: '',
      isCustom: false,
      isFavorite: false,
      proxyMode: 'smart' // Akamai HLS stream
    },
    {
      id: 'stream-somoy-tv',
      name: 'Somoy TV',
      url: 'https://live.thebosstv.com:30443/dwlive/Somoy-TV/chunks.m3u8',
      category: 'HLS',
      logo: '',
      isCustom: false,
      isFavorite: false,
      proxyMode: 'smart' // Akamai HLS stream
    },
    {
      id: 'live-ts-stream',
      name: 'Server 2',
      url: 'http://198.195.239.50:8095/tsports/index.m3u8',
      category: 'HLS',
      logo: '',
      isCustom: false,
      isFavorite: false,
      proxyMode: 'smart' // TS redirect chain requires full proxy
    },
    {
      id: 'toffee-live-stream',
      name: 'Server 3',
      url: 'https://s3.us-east-2.amazonaws.com/cdnh111/hls/0/stream.m3u8',
      category: 'HLS',
      logo: '',
      isCustom: false,
      isFavorite: false,
      proxyMode: 'smart' // Toffee stream already proxied via Cloudflare worker
    },
    {
      id: 'stream-23',
      name: 'Server 4',
      url: 'https://1nyaler.streamhostingcdn.top/stream/23/index.m3u8',
      category: 'HLS',
      logo: '',
      isCustom: false,
      isFavorite: false,
      proxyMode: 'smart' // Only manifest proxied, video chunks direct
    }
  ];
  const CLOUDFLARE_PROXIES = [
    'https://subsdrop-proxy.alm40533.workers.dev/?url=',
    'https://subsdrop-proxy2.softpremium13.workers.dev/?url=',
    'https://subsdrop-proxy3.jihadabal122.workers.dev/?url=',
    'https://bitter-lake-b42b.softpremiumbd4.workers.dev/?url=',
    'https://subsdrop-proxy5.softpremium0.workers.dev/?url=',
    'https://subsdrop-proxy6.softpremiumbd1.workers.dev/?url=',
    'https://subsdrop-proxy7.flexsubsbd.workers.dev/?url=',
    'https://subsdrop-proxy8.znznxxnpwkwsk.workers.dev/?url=',
    'https://subsdrop-proxy9.easminjannat6.workers.dev/?url=',
    'https://subsdrop-proxy9.zihad70888.workers.dev/?url=',
    'https://subsdrop-proxy10.nottyboy510.workers.dev/?url=',
    'https://subsdrop-proxy11.humayraakterjoly.workers.dev/?url=',
    'https://subsdrop-proxy12.al-mamun-16479.workers.dev/?url=',
    'https://subsdrop-proxy13.askfordeenbd.workers.dev/?url=',
    'https://subsdrop-proxy14.khansforfb.workers.dev/?url=',
    'https://subsdrop-proxy15.mamunayan07.workers.dev/?url=',
    'https://subsdrop-proxy16.fahmidulayan.workers.dev/?url=',
    'https://subsdrop-proxy17.mahi696907.workers.dev/?url=',
    'https://subsdrop-proxy18.protrainerit.workers.dev/?url=',
    'https://subsdrop-proxy19.kumarikul680.workers.dev/?url=',
    'https://subsdrop-proxy20.subsdropbd.workers.dev/?url='
  ];
  const DEFAULT_CORS_PROXY = 'cloudflare_balancer';
  // --- App State ---
  let channels = [];
  let activeChannelId = '';
  let activeTab = 'all'; // 'all', 'favorites', 'custom'
  let searchQuery = '';
  let useCorsProxy = true;
  let corsProxyUrl = DEFAULT_CORS_PROXY;

  // Players
  let hlsInstance = null;
  let mpegtsPlayer = null;
  let idleTimer = null;

  // Auto-Fallback State variables
  let currentStreamUrl = '';
  let retryWithProxyActive = false;
  let fallbackTimeout = null;

  // --- DOM Elements ---
  const video = document.getElementById('video-element');
  const playerContainer = document.getElementById('player-container');
  const ambientGlow = document.getElementById('ambient-glow');
  const channelList = document.getElementById('channel-list');
  const emptyState = document.getElementById('empty-state');
  // Search elements removed per user request

  // Header details
  const headerChannelName = document.getElementById('header-channel-name');
  const headerChannelStatus = document.getElementById('header-channel-status');
  const headerChannelAvatar = document.getElementById('header-channel-avatar');

  // Custom Overlays
  const loadingOverlay = document.getElementById('loading-overlay');
  const stateOverlay = document.getElementById('state-overlay');
  const stateOverlayIcon = document.getElementById('state-overlay-icon');
  const errorOverlay = document.getElementById('error-overlay');
  const errorMessage = document.getElementById('error-message');

  // Custom Controls Elements
  const videoControls = document.getElementById('video-controls-overlay');
  const playPauseBtn = document.getElementById('ctrl-play-pause');
  const playIcon = document.getElementById('ctrl-play-icon');
  const prevBtn = document.getElementById('ctrl-prev');
  const nextBtn = document.getElementById('ctrl-next');
  const muteBtn = document.getElementById('ctrl-mute');
  const volumeIcon = document.getElementById('ctrl-volume-icon');
  const volumeSlider = document.getElementById('volume-slider');
  const timeDisplay = document.getElementById('time-display');
  const liveIndicator = document.getElementById('live-indicator');
  const resolutionIndicator = document.getElementById('resolution-indicator');
  const pipBtn = document.getElementById('ctrl-pip');
  const fullscreenBtn = document.getElementById('ctrl-fullscreen');
  const fullscreenIcon = document.getElementById('ctrl-fullscreen-icon');
  const qualityBtn = document.getElementById('ctrl-quality');
  const qualityPopover = document.getElementById('quality-popover');
  const qualityList = document.getElementById('quality-list');
  const progressBarContainer = document.getElementById('progress-bar-container');
  const progressBuffer = document.getElementById('progress-buffer');
  const progressFill = document.getElementById('progress-fill');
  const progressHandle = document.getElementById('progress-handle');

  // Modals & Buttons
  const modalSettings = document.getElementById('modal-settings');
  const btnOpenSettings = document.getElementById('btn-open-settings');
  const btnResetApp = document.getElementById('btn-reset-app');
  const btnRetryStream = document.getElementById('btn-retry-stream');
  const btnCorsTroubleshoot = document.getElementById('btn-cors-troubleshoot');
  const btnToggleProxyError = document.getElementById('btn-toggle-proxy-error');
  const modalDisclaimer = document.getElementById('modal-disclaimer');
  const btnOpenDisclaimer = document.getElementById('btn-open-disclaimer');

  // Settings Inputs
  const settingUseProxy = document.getElementById('setting-use-proxy');
  const settingProxySelect = document.getElementById('setting-proxy-select');
  const settingProxyUrl = document.getElementById('setting-proxy-url');
  const proxySelectGroup = document.getElementById('proxy-select-group');
  const proxyUrlGroup = document.getElementById('proxy-url-group');

  // --- Initializer & State Loader ---
  function initApp() {
    loadSettings();
    loadChannels();
    setupEventListeners();
    renderChannels();
    initLiveStatsSSE();

    // Auto-select first channel
    if (channels.length > 0) {
      selectChannel(channels[0].id);
    }

    // Render Lucide icons
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  function initLiveStatsSSE() {
    const liveViewersBadge = document.getElementById('live-viewers-badge');
    const liveViewersCount = document.getElementById('live-viewers-count');
    const statViewers = document.getElementById('stat-viewers');
    const statStreams = document.getElementById('stat-streams');

    let eventSource = null;
    let reconnectTimeout = null;

    function connect() {
      if (eventSource) {
        eventSource.close();
      }

      eventSource = new EventSource('/api/live-stats');

      eventSource.onopen = () => {
        console.log('SSE connection to live stats established.');
        clearTimeout(reconnectTimeout);
      };

      eventSource.onmessage = (e) => {
        try {
          const stats = JSON.parse(e.data);

          if (liveViewersCount) liveViewersCount.textContent = stats.viewers;
          if (statViewers) statViewers.textContent = stats.viewers;
          if (statStreams) statStreams.textContent = stats.activeTsStreams;

          if (liveViewersBadge && stats.viewers > 0) {
            liveViewersBadge.style.display = 'inline-flex';
          }
        } catch (err) {
          console.error('Error parsing live stats data:', err);
        }
      };

      eventSource.onerror = (err) => {
        console.warn('SSE connection lost. Reconnecting in 5 seconds...', err);
        eventSource.close();
        if (liveViewersBadge) {
          liveViewersBadge.style.display = 'none';
        }

        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connect, 5000);
      };
    }

    connect();
  }

  function loadSettings() {
    // Version marker to force-migrate old settings where proxy was off by default
    const settingsVersion = localStorage.getItem('iptv_settings_v');
    if (settingsVersion !== '3') {
      // Force proxy ON with Cloudflare worker
      localStorage.setItem('iptv_settings_v', '3');
      localStorage.setItem('iptv_use_proxy', 'true');
      localStorage.setItem('iptv_proxy_url', DEFAULT_CORS_PROXY);
    }

    const savedProxy = localStorage.getItem('iptv_use_proxy');
    useCorsProxy = savedProxy === null ? true : savedProxy === 'true';
    corsProxyUrl = localStorage.getItem('iptv_proxy_url') || DEFAULT_CORS_PROXY;

    settingUseProxy.checked = useCorsProxy;

    // Set proxy select dropdown
    const localPrefix = window.location.origin + '/proxy?url=';
    if (corsProxyUrl === DEFAULT_CORS_PROXY || corsProxyUrl === 'cloudflare_balancer' || CLOUDFLARE_PROXIES.includes(corsProxyUrl)) {
      settingProxySelect.value = 'cloudflare_balancer';
      proxyUrlGroup.style.display = 'none';
      corsProxyUrl = 'cloudflare_balancer'; // Normalize to balancer
      localStorage.setItem('iptv_proxy_url', corsProxyUrl); // Update local storage
    } else if (corsProxyUrl === localPrefix || corsProxyUrl.includes('/proxy?url=')) {
      settingProxySelect.value = 'local';
      proxyUrlGroup.style.display = 'none';
    } else if (corsProxyUrl === 'https://corsproxy.io/?url=' || corsProxyUrl === 'https://api.allorigins.win/raw?url=') {
      settingProxySelect.value = corsProxyUrl;
      proxyUrlGroup.style.display = 'none';
    } else {
      settingProxySelect.value = 'custom';
      settingProxyUrl.value = corsProxyUrl;
      proxyUrlGroup.style.display = useCorsProxy ? 'flex' : 'none';
    }

    proxySelectGroup.style.display = useCorsProxy ? 'flex' : 'none';
  }

  function saveSettings() {
    localStorage.setItem('iptv_use_proxy', useCorsProxy);

    const selectVal = settingProxySelect.value;
    if (selectVal === 'local') {
      corsProxyUrl = window.location.origin + '/proxy?url=';
    } else if (selectVal === 'custom') {
      corsProxyUrl = settingProxyUrl.value.trim() || DEFAULT_CORS_PROXY;
    } else {
      corsProxyUrl = selectVal;
    }
    localStorage.setItem('iptv_proxy_url', corsProxyUrl);
  }

  function loadChannels() {
    localStorage.removeItem('iptv_channels');
    channels = [...DEFAULT_CHANNELS];
  }

  // --- UI Renderers ---
  function renderChannels() {
    channelList.innerHTML = '';

    channels.forEach((ch, index) => {
      const li = document.createElement('li');
      li.className = `channel-item ${ch.id === activeChannelId ? 'active' : ''}`;
      li.setAttribute('data-id', ch.id);

      li.innerHTML = `
        <div class="channel-details">
          <span class="channel-name">${ch.name}</span>
        </div>
      `;

      // Click to select channel
      li.addEventListener('click', () => {
        selectChannel(ch.id);
      });

      channelList.appendChild(li);
    });

    if (window.lucide) {
      window.lucide.createIcons({ attrs: { class: 'small-icon' } });
    }
  }

  // --- Player Controllers ---
  function selectChannel(id) {
    activeChannelId = id;
    const channelIndex = channels.findIndex(c => c.id === id);
    const channel = channels[channelIndex];
    if (!channel) return;

    // Update Sidebar active state styling and add streaming indicator
    document.querySelectorAll('.channel-item').forEach(el => {
      const details = el.querySelector('.channel-details');
      if (details) {
        const existing = details.querySelector('.streaming-indicator');
        if (existing) existing.remove();
      }

      if (el.getAttribute('data-id') === id) {
        el.classList.add('active');
        if (details) {
          const indicator = document.createElement('div');
          indicator.className = 'streaming-indicator';
          indicator.innerHTML = `
            <span class="bar"></span>
            <span class="bar"></span>
            <span class="bar"></span>
          `;
          details.appendChild(indicator);
        }
      } else {
        el.classList.remove('active');
      }
    });

    // Update Header Details
    headerChannelName.textContent = channel.name;
    headerChannelStatus.innerHTML = `<i data-lucide="radio" class="inline-icon"></i> Connecting...`;

    if (window.lucide) {
      window.lucide.createIcons();
    }

    // Scroll player into view on mobile
    if (window.innerWidth <= 768) {
      playerContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Load Stream using per-channel proxy mode (resetting any fallback chains)
    loadStream(channel.url, null, channel.proxyMode || 'none');
  }

  function getGlowColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash % 360);
    return `linear-gradient(135deg, hsl(${h}, 70%, 50%) 0%, hsl(${(h + 60) % 360}, 75%, 40%) 100%)`;
  }

  function loadStream(rawUrl, forceProxy = null, channelProxyMode = 'none') {
    // Show spinner & clear error overlay
    showOverlay(loadingOverlay, true);
    showOverlay(errorOverlay, false);
    qualityBtn.style.display = 'none';
    resolutionIndicator.style.display = 'none';

    // Clean up previous players and timer fallbacks
    destroyPlayers();
    clearTimeout(fallbackTimeout);

    currentStreamUrl = rawUrl;

    // SMART PROXY LOGIC: Determine proxy routing based on per-channel proxyMode
    // 'none'  = direct play (zero server bandwidth)
    // 'smart' = only m3u8 proxied via &smart=true, .ts goes direct from CDN
    // 'all'   = full proxy (all traffic through server)
    let tryProxy = false;
    let smartProxy = false;

    if (forceProxy !== null) {
      tryProxy = forceProxy;
      retryWithProxyActive = true;
    } else {
      if (channelProxyMode === 'none') {
        tryProxy = false;
        retryWithProxyActive = false; // Do not fallback to proxy for none mode
      } else if (channelProxyMode === 'smart') {
        tryProxy = true;
        smartProxy = true;
        retryWithProxyActive = true;
      } else { // 'all'
        tryProxy = true;
        smartProxy = false;
        retryWithProxyActive = true;
      }
    }

    let isMpegTs = rawUrl.toLowerCase().includes('.ts') || (!rawUrl.toLowerCase().includes('.m3u8') && !rawUrl.toLowerCase().includes('.mp4'));

    let streamUrl = rawUrl;
    if (tryProxy) {
      // Load Balancing Logic: Randomly pick a proxy if balancer is selected
      let activeProxy = corsProxyUrl;
      if (activeProxy === 'cloudflare_balancer') {
        activeProxy = CLOUDFLARE_PROXIES[Math.floor(Math.random() * CLOUDFLARE_PROXIES.length)];
      }

      // If it's an MPEG-TS stream, we MUST use the local proxy for FFmpeg audio transcoding.
      // Cloudflare Worker cannot do audio conversion.
      if (isMpegTs && activeProxy.includes('workers.dev')) {
        streamUrl = window.location.origin + '/proxy?url=' + encodeURIComponent(rawUrl);
      } else {
        streamUrl = activeProxy + encodeURIComponent(rawUrl);
      }

      if (smartProxy) {
        streamUrl += '&smart=true';
        headerChannelStatus.innerHTML = `<i data-lucide="radio" class="inline-icon"></i> Connecting (Smart Proxy)...`;
      } else {
        headerChannelStatus.innerHTML = `<i data-lucide="radio" class="inline-icon"></i> Connecting (Proxy)...`;
      }
    } else {
      headerChannelStatus.innerHTML = `<i data-lucide="radio" class="inline-icon"></i> Connecting (Direct)...`;
    }
    if (window.lucide) window.lucide.createIcons();

    if (isMpegTs) {
      playMpegTsStream(streamUrl);
    } else {
      playHlsStream(streamUrl);
    }

    // Start fallback watchdog: TS streams need much more time due to multi-hop redirect chains
    // and mpegts.js buffering. HLS playlists also need time for segment download.
    const timeoutMs = isMpegTs ? 20000 : 10000;
    fallbackTimeout = setTimeout(() => {
      console.warn(`Stream loading timed out after ${timeoutMs}ms. Triggering fallback...`);
      handlePlaybackFailure('timeout');
    }, timeoutMs);

    // Set ambient glow gradient
    const color = getGlowColor(headerChannelName.textContent);
    ambientGlow.style.background = `radial-gradient(circle, ${color.split('(')[2].split(')')[0]} 0%, transparent 70%)`;
  }

  function handlePlaybackFailure(reason) {
    clearTimeout(fallbackTimeout);

    if (retryWithProxyActive) {
      // Automatic proxy fallback: try the opposite of current proxy state
      retryWithProxyActive = false; // Prevent infinite loop

      // Determine what was just tried and what to try next
      const wasTryingProxy = currentStreamUrl !== '' &&
        (document.querySelector('#header-channel-status')?.textContent?.includes('Proxy') || useCorsProxy);
      const nextTryProxy = !wasTryingProxy;

      const msg = nextTryProxy
        ? 'Direct connection failed. Retrying via CORS Proxy...'
        : 'Proxy failed. Retrying direct connection...';
      console.log(msg);
      headerChannelStatus.innerHTML = `<i data-lucide="refresh-cw" class="inline-icon"></i> ${msg}`;
      if (window.lucide) window.lucide.createIcons();

      // Load with the opposite proxy setting
      setTimeout(() => {
        loadStream(currentStreamUrl, nextTryProxy);
      }, 500);
    } else {
      // Both attempts failed, show error card
      let msg = 'The stream could not be loaded due to a network error or restricted access (CORS).';
      if (reason === 'timeout') {
        msg = 'Stream connection timed out. The server might be offline or blocked by CORS.';
      }
      handleStreamError(msg);
    }
  }

  function playHlsStream(url) {
    if (Hls.isSupported()) {
      hlsInstance = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferSize: 60 * 1024 * 1024, // 60MB max buffer size
        maxBufferLength: 45, // 45 seconds max buffer length
        liveBackBufferLength: 20,
        manifestLoadingTimeOut: 15000,
        manifestLoadingMaxRetry: 10,
        levelLoadingTimeOut: 15000,
        levelLoadingMaxRetry: 10,
        fragLoadingTimeOut: 20000,
        fragLoadingMaxRetry: 10
      });
      hlsInstance.loadSource(url);
      hlsInstance.attachMedia(video);

      hlsInstance.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        clearTimeout(fallbackTimeout);
        showOverlay(loadingOverlay, false);
        headerChannelStatus.innerHTML = `<i data-lucide="play" class="inline-icon"></i> Streaming Live (HLS)`;
        if (window.lucide) window.lucide.createIcons();
        video.play().catch(() => {
          updatePlayPauseIcons(true);
        });
        setupQualitySelector();
      });

      hlsInstance.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS error:', data);
        if (data.fatal) {
          clearTimeout(fallbackTimeout);
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              handlePlaybackFailure('network');
              break;
            default:
              handlePlaybackFailure('media');
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari iOS
      video.src = url;
      video.addEventListener('loadedmetadata', () => {
        clearTimeout(fallbackTimeout);
        showOverlay(loadingOverlay, false);
        headerChannelStatus.innerHTML = `<i data-lucide="play" class="inline-icon"></i> Streaming Live (HLS Native)`;
        if (window.lucide) window.lucide.createIcons();
        video.play().catch(() => { });
      });
      video.addEventListener('error', () => {
        clearTimeout(fallbackTimeout);
        handlePlaybackFailure('native');
      });
    } else {
      clearTimeout(fallbackTimeout);
      handleStreamError('Your browser does not support HLS streaming.');
    }
  }

  function playMpegTsStream(url) {
    // Strategy: Try multiple approaches for TS playback
    // 1. mpegts.js (best quality, with proper config)
    // 2. Native video.src fallback (simpler, works in some browsers)

    if (mpegts.getFeatureList().mseLivePlayback) {
      try {
        mpegtsPlayer = mpegts.createPlayer({
          type: 'mpegts',
          isLive: true,
          url: url,
          hasAudio: true,
          hasVideo: true
        }, {
          enableWorker: true,
          enableStashBuffer: true,
          stashInitialSize: 384 * 1024, // 384KB — large enough to capture PAT/PMT + first audio PES packets
          liveBufferLatencyChasing: false, // Disable chasing to prevent stuttering/buffer underruns
          lazyLoad: false,
          deferLoadAfterSourceOpen: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 60,
          autoCleanupMinBackwardDuration: 30,
          fixAudioTimestampGap: true // Fix audio gaps that cause silent playback
        });

        mpegtsPlayer.attachMediaElement(video);
        mpegtsPlayer.load();
        mpegtsPlayer.play().catch(() => {
          updatePlayPauseIcons(true);
        });

        // Multiple success detection events
        let tsStreamReady = false;
        function onTsStreamReady() {
          if (tsStreamReady) return;
          tsStreamReady = true;
          clearTimeout(fallbackTimeout);
          clearTimeout(mpegtsErrorTimeout);
          showOverlay(loadingOverlay, false);
          headerChannelStatus.innerHTML = `<i data-lucide="play" class="inline-icon"></i> Streaming Live (MPEG-TS)`;
          if (window.lucide) window.lucide.createIcons();
        }

        mpegtsPlayer.on(mpegts.Events.INFO, onTsStreamReady);
        mpegtsPlayer.on(mpegts.Events.STATISTICS_INFO, onTsStreamReady);
        mpegtsPlayer.on(mpegts.Events.MEDIA_INFO, onTsStreamReady);
        mpegtsPlayer.on(mpegts.Events.LOADING_COMPLETE, onTsStreamReady);

        video.addEventListener('loadeddata', onTsStreamReady, { once: true });
        video.addEventListener('canplay', onTsStreamReady, { once: true });
        video.addEventListener('playing', onTsStreamReady, { once: true });

        // If mpegts.js fails quickly (fetch error), fall back to native video.src
        let mpegtsErrorTimeout = null;
        mpegtsPlayer.on(mpegts.Events.ERROR, (type, detail, info) => {
          console.warn('mpegts.js error:', type, detail);
          if (!tsStreamReady) {
            // Give it 2 seconds before falling back to native
            if (!mpegtsErrorTimeout) {
              mpegtsErrorTimeout = setTimeout(() => {
                console.log('mpegts.js failed, falling back to native video.src...');
                tryNativeVideoPlayback(url);
              }, 2000);
            }
          }
        });
      } catch (e) {
        console.warn('mpegts.js init failed, trying native:', e);
        tryNativeVideoPlayback(url);
      }
    } else {
      // mpegts.js not supported, try native
      tryNativeVideoPlayback(url);
    }
  }

  function tryNativeVideoPlayback(url) {
    // Clean up mpegts player if it exists
    if (mpegtsPlayer) {
      try {
        mpegtsPlayer.unload();
        mpegtsPlayer.detachMediaElement();
        mpegtsPlayer.destroy();
      } catch (e) { }
      mpegtsPlayer = null;
    }

    // Try direct video.src — browsers may handle MPEG-TS natively
    video.src = url;
    video.load();

    let nativeReady = false;
    function onNativeReady() {
      if (nativeReady) return;
      nativeReady = true;
      clearTimeout(fallbackTimeout);
      showOverlay(loadingOverlay, false);
      headerChannelStatus.innerHTML = `<i data-lucide="play" class="inline-icon"></i> Streaming Live (Native TS)`;
      if (window.lucide) window.lucide.createIcons();
    }

    video.addEventListener('loadeddata', onNativeReady, { once: true });
    video.addEventListener('canplay', onNativeReady, { once: true });
    video.addEventListener('playing', onNativeReady, { once: true });

    video.play().catch(() => {
      updatePlayPauseIcons(true);
    });

    video.addEventListener('error', () => {
      if (!nativeReady) {
        console.warn('Native video.src playback also failed');
        // Don't trigger fallback here — let the main timeout handle it
      }
    }, { once: true });
  }

  function destroyPlayers() {
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
    if (mpegtsPlayer) {
      mpegtsPlayer.unload();
      mpegtsPlayer.detachMediaElement();
      mpegtsPlayer.destroy();
      mpegtsPlayer = null;
    }
    video.removeAttribute('src');
    video.load();
  }

  function handleStreamError(msg) {
    showOverlay(loadingOverlay, false);
    showOverlay(errorOverlay, true);
    headerChannelStatus.innerHTML = `<i data-lucide="alert-circle" class="inline-icon"></i> Error Playing`;
    errorMessage.textContent = msg;

    // Toggle error card button state
    if (useCorsProxy) {
      btnToggleProxyError.innerHTML = `<i data-lucide="shield-off" class="btn-icon-left"></i>Disable Proxy`;
    } else {
      btnToggleProxyError.innerHTML = `<i data-lucide="shield" class="btn-icon-left"></i>Enable Proxy`;
    }

    if (window.lucide) window.lucide.createIcons();
  }

  function showOverlay(element, show) {
    if (show) {
      element.style.display = 'flex';
      element.style.opacity = '1';
    } else {
      element.style.opacity = '0';
      setTimeout(() => {
        if (element.style.opacity === '0') {
          element.style.display = 'none';
        }
      }, 150);
    }
  }

  // --- HLS Quality Controller ---
  function setupQualitySelector() {
    if (!hlsInstance) return;
    const levels = hlsInstance.levels;

    if (levels && levels.length > 1) {
      qualityBtn.style.display = 'inline-flex';
      qualityList.innerHTML = `<li class="quality-item active" data-index="-1">Auto</li>`;

      levels.forEach((level, index) => {
        const height = level.height;
        const bitrate = Math.round(level.bitrate / 1000);
        const name = height ? `${height}p (${bitrate}kbps)` : `Level ${index} (${bitrate}kbps)`;

        const li = document.createElement('li');
        li.className = 'quality-item';
        li.setAttribute('data-index', index);
        li.textContent = name;
        qualityList.appendChild(li);
      });

      // Quality selector events
      qualityList.querySelectorAll('.quality-item').forEach(item => {
        item.addEventListener('click', () => {
          qualityList.querySelectorAll('.quality-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');

          const index = parseInt(item.getAttribute('data-index'));
          hlsInstance.currentLevel = index;

          qualityPopover.style.display = 'none';

          // Show active height badge
          if (index === -1) {
            resolutionIndicator.style.display = 'none';
          } else {
            resolutionIndicator.style.display = 'inline-flex';
            resolutionIndicator.textContent = `${levels[index].height}p`;
          }
        });
      });
    }
  }

  // --- Favorite Toggle ---
  function toggleFavorite(id) {
    const ch = channels.find(c => c.id === id);
    if (!ch) return;

    ch.isFavorite = !ch.isFavorite;
    saveChannels();
    renderChannels();
  }

  // --- Controls Interaction ---
  function togglePlayPause() {
    if (video.paused) {
      video.play().catch(() => { });
      triggerStateIndicator('play');
    } else {
      video.pause();
      triggerStateIndicator('pause');
    }
  }

  function triggerStateIndicator(action) {
    const overlay = document.getElementById('state-overlay');
    if (overlay) {
      overlay.innerHTML = `<i data-lucide="${action}" id="state-overlay-icon"></i>`;
      if (window.lucide) window.lucide.createIcons();
      showOverlay(overlay, true);
      setTimeout(() => {
        showOverlay(overlay, false);
      }, 500);
    }
  }

  function updatePlayPauseIcons(isPaused) {
    const playPauseBtn = document.getElementById('ctrl-play-pause');
    if (playPauseBtn) {
      playPauseBtn.innerHTML = isPaused
        ? `<i data-lucide="play" id="ctrl-play-icon"></i>`
        : `<i data-lucide="pause" id="ctrl-play-icon"></i>`;
      if (window.lucide) window.lucide.createIcons();
    }
  }

  function handleVolumeChange() {
    video.volume = volumeSlider.value;
    video.muted = video.volume === 0;

    let iconName = 'volume-2';
    if (video.muted || video.volume === 0) {
      iconName = 'volume-x';
    } else if (video.volume < 0.5) {
      iconName = 'volume-1';
    }

    const muteBtn = document.getElementById('ctrl-mute');
    if (muteBtn) {
      muteBtn.innerHTML = `<i data-lucide="${iconName}" id="ctrl-volume-icon"></i>`;
      if (window.lucide) window.lucide.createIcons();
    }
  }

  function toggleMute() {
    video.muted = !video.muted;
    let iconName = 'volume-2';
    if (video.muted) {
      volumeSlider.value = 0;
      iconName = 'volume-x';
    } else {
      volumeSlider.value = video.volume || 0.8;
      video.volume = volumeSlider.value;
      if (video.volume < 0.5) {
        iconName = 'volume-1';
      }
    }
    const muteBtn = document.getElementById('ctrl-mute');
    if (muteBtn) {
      muteBtn.innerHTML = `<i data-lucide="${iconName}" id="ctrl-volume-icon"></i>`;
      if (window.lucide) window.lucide.createIcons();
    }
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds === Infinity) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts = [
      m.toString().padStart(2, '0'),
      s.toString().padStart(2, '0')
    ];
    if (h > 0) parts.unshift(h.toString().padStart(2, '0'));
    return parts.join(':');
  }

  function updateProgressBar() {
    const current = video.currentTime;
    const duration = video.duration;

    const isLive = !duration || duration === Infinity || isNaN(duration);

    if (isLive) {
      timeDisplay.textContent = `${formatTime(current)} / LIVE`;
      progressFill.style.width = '100%';
      progressHandle.style.left = '100%';
      liveIndicator.style.display = 'inline-flex';
    } else {
      timeDisplay.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
      const percent = (current / duration) * 100;
      progressFill.style.width = `${percent}%`;
      progressHandle.style.left = `${percent}%`;
      liveIndicator.style.display = 'none';

      // Buffer
      if (video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const bufferPercent = (bufferedEnd / duration) * 100;
        progressBuffer.style.width = `${bufferPercent}%`;
      }
    }
  }

  function seek(e) {
    const duration = video.duration;
    if (!duration || duration === Infinity || isNaN(duration)) return;

    const rect = progressBarContainer.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    video.currentTime = pos * duration;
  }

  function toggleFullscreen() {
    const isFullscreen = document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement;

    if (!isFullscreen) {
      if (playerContainer.requestFullscreen) {
        playerContainer.requestFullscreen().catch(err => {
          console.error(`Error entering fullscreen: ${err.message}`);
        });
      } else if (playerContainer.webkitRequestFullscreen) {
        playerContainer.webkitRequestFullscreen();
      } else if (video.webkitEnterFullscreen) {
        // Fallback for iOS (iPhone) Safari
        video.webkitEnterFullscreen();
      } else if (video.requestFullscreen) {
        video.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (video.webkitExitFullscreen) {
        video.webkitExitFullscreen();
      }
    }
  }

  function updateFullscreenIcon() {
    const fullscreenBtn = document.getElementById('ctrl-fullscreen');
    if (fullscreenBtn) {
      if (document.fullscreenElement) {
        fullscreenBtn.innerHTML = `<i data-lucide="minimize" id="ctrl-fullscreen-icon"></i>`;
      } else {
        fullscreenBtn.innerHTML = `<i data-lucide="maximize" id="ctrl-fullscreen-icon"></i>`;
      }
      if (window.lucide) window.lucide.createIcons();
    }
  }

  function togglePip() {
    if (!document.pictureInPictureElement) {
      video.requestPictureInPicture().catch(err => {
        console.error('Failed to enter Pip:', err);
      });
    } else {
      document.exitPictureInPicture().catch(err => {
        console.error('Failed to exit Pip:', err);
      });
    }
  }

  function triggerNextChannel() {
    const currentIndex = channels.findIndex(ch => ch.id === activeChannelId);
    if (currentIndex === -1) return;
    const nextIndex = (currentIndex + 1) % channels.length;
    selectChannel(channels[nextIndex].id);
  }

  function triggerPrevChannel() {
    const currentIndex = channels.findIndex(ch => ch.id === activeChannelId);
    if (currentIndex === -1) return;
    const prevIndex = (currentIndex - 1 + channels.length) % channels.length;
    selectChannel(channels[prevIndex].id);
  }

  // --- Auto-Hide Controls ---
  function resetIdleTimer() {
    playerContainer.classList.remove('idle');
    clearTimeout(idleTimer);

    if (!video.paused) {
      idleTimer = setTimeout(() => {
        playerContainer.classList.add('idle');
        qualityPopover.style.display = 'none';
      }, 3000);
    }
  }

  // --- Keyboard Shortcuts ---
  function handleKeyboardShortcuts(e) {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') {
      return;
    }

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        togglePlayPause();
        break;
      case 'KeyM':
        e.preventDefault();
        toggleMute();
        break;
      case 'KeyF':
        e.preventDefault();
        toggleFullscreen();
        break;
      case 'KeyP':
        e.preventDefault();
        togglePip();
        break;
      case 'ArrowUp':
        e.preventDefault();
        volumeSlider.value = Math.min(1, parseFloat(volumeSlider.value) + 0.1);
        handleVolumeChange();
        break;
      case 'ArrowDown':
        e.preventDefault();
        volumeSlider.value = Math.max(0, parseFloat(volumeSlider.value) - 0.1);
        handleVolumeChange();
        break;
      case 'PageUp':
        e.preventDefault();
        triggerPrevChannel();
        break;
      case 'PageDown':
        e.preventDefault();
        triggerNextChannel();
        break;
    }
  }

  // --- Event Listeners Setup ---
  function setupEventListeners() {
    // Video Playback
    video.addEventListener('play', () => updatePlayPauseIcons(false));
    video.addEventListener('pause', () => updatePlayPauseIcons(true));
    video.addEventListener('timeupdate', updateProgressBar);
    video.addEventListener('progress', updateProgressBar);

    // Playback Click Overlay / Control bar
    video.addEventListener('click', togglePlayPause);

    // Toggle play/pause when clicking empty space on the screen control overlay
    videoControls.addEventListener('click', (e) => {
      if (!e.target.closest('button') && !e.target.closest('input') && !e.target.closest('.controls-bottom-panel') && !e.target.closest('.quality-popover')) {
        togglePlayPause();
      }
    });

    // Buffering & Loading indicators
    video.addEventListener('waiting', () => {
      showOverlay(loadingOverlay, true);
    });
    video.addEventListener('playing', () => {
      showOverlay(loadingOverlay, false);
    });
    video.addEventListener('seeking', () => {
      showOverlay(loadingOverlay, true);
    });
    video.addEventListener('seeked', () => {
      showOverlay(loadingOverlay, false);
    });
    video.addEventListener('canplay', () => {
      showOverlay(loadingOverlay, false);
    });

    playPauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlayPause();
    });

    // Volume Control
    volumeSlider.addEventListener('input', handleVolumeChange);
    muteBtn.addEventListener('click', toggleMute);

    // Video Hover Idle UI
    playerContainer.addEventListener('mousemove', resetIdleTimer);
    playerContainer.addEventListener('click', resetIdleTimer);

    // Progress Seeking
    progressBarContainer.addEventListener('click', seek);
    let isSeeking = false;
    progressBarContainer.addEventListener('mousedown', () => isSeeking = true);
    document.addEventListener('mouseup', () => isSeeking = false);
    document.addEventListener('mousemove', (e) => {
      if (isSeeking) seek(e);
    });

    // Fullscreen and Pip
    fullscreenBtn.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', updateFullscreenIcon);
    pipBtn.addEventListener('click', togglePip);

    // Channel Switching Buttons
    prevBtn.addEventListener('click', triggerPrevChannel);
    nextBtn.addEventListener('click', triggerNextChannel);

    // Quality Selector Dropdown
    qualityBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      qualityPopover.style.display = qualityPopover.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', () => {
      qualityPopover.style.display = 'none';
    });

    // Keyboard Shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // Settings Modal Trigger
    btnOpenSettings.addEventListener('click', () => {
      modalSettings.style.display = 'flex';
    });

    // Disclaimer Modal Trigger
    if (btnOpenDisclaimer && modalDisclaimer) {
      btnOpenDisclaimer.addEventListener('click', (e) => {
        e.preventDefault();
        modalDisclaimer.style.display = 'flex';
      });
    }

    document.querySelectorAll('.modal-close-btn, [data-close]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modalId = btn.getAttribute('data-close') || btn.closest('.modal-backdrop').id;
        document.getElementById(modalId).style.display = 'none';
      });
    });

    // CORS & Setting change listeners
    settingUseProxy.addEventListener('change', () => {
      useCorsProxy = settingUseProxy.checked;
      proxySelectGroup.style.display = useCorsProxy ? 'flex' : 'none';

      const selectVal = settingProxySelect.value;
      if (useCorsProxy && selectVal === 'custom') {
        proxyUrlGroup.style.display = 'flex';
      } else {
        proxyUrlGroup.style.display = 'none';
      }

      saveSettings();
    });
    settingProxySelect.addEventListener('change', () => {
      const selectVal = settingProxySelect.value;
      if (selectVal === 'custom') {
        proxyUrlGroup.style.display = 'flex';
      } else {
        proxyUrlGroup.style.display = 'none';
      }
      saveSettings();
    });
    settingProxyUrl.addEventListener('input', () => {
      saveSettings();
    });

    // Troubleshooting buttons
    btnRetryStream.addEventListener('click', () => {
      const active = channels.find(c => c.id === activeChannelId);
      // Force loading direct first on explicit retry click
      if (active) loadStream(active.url, false);
    });
    btnToggleProxyError.addEventListener('click', () => {
      useCorsProxy = !useCorsProxy;
      settingUseProxy.checked = useCorsProxy;
      proxySelectGroup.style.display = useCorsProxy ? 'flex' : 'none';
      saveSettings();

      // Explicitly load with the forced user setting
      loadStream(currentStreamUrl, useCorsProxy);
    });
    btnCorsTroubleshoot.addEventListener('click', () => {
      modalSettings.style.display = 'flex';
    });

    // Hard reset app settings
    btnResetApp.addEventListener('click', () => {
      if (confirm('Are you sure you want to reset all app settings? This cannot be undone.')) {
        localStorage.removeItem('iptv_channels');
        localStorage.removeItem('iptv_use_proxy');
        localStorage.removeItem('iptv_proxy_url');

        // Reload states
        loadSettings();
        loadChannels();
        renderChannels();

        modalSettings.style.display = 'none';
        if (channels.length > 0) selectChannel(channels[0].id);
      }
    });
  }

  // Start the application
  initApp();
});
