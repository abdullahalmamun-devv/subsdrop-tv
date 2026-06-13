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
      id: 'stream-23',
      name: 'Stream 23',
      url: 'https://1nyaler.streamhostingcdn.top/stream/23/index.m3u8',
      category: 'Sports',
      logo: '⚽',
      isCustom: false,
      isFavorite: false,
      proxyMode: 'smart' // Only manifest proxied, video chunks direct
    },
    {
      id: 'stream-32',
      name: 'Stream 32',
      url: 'https://1nyaler.streamhostingcdn.top/stream/32/index.m3u8',
      category: 'Sports',
      logo: '🏏',
      isCustom: false,
      isFavorite: false,
      proxyMode: 'smart' // Only manifest proxied, video chunks direct
    },
    {
      id: 'live-ts-stream',
      name: 'Live TS Stream (MPEG-TS)',
      url: 'http://rgkkw.live:80/live/1Aoen7elp5/IgMJ60tmAa/130714.ts',
      category: 'News',
      logo: 'TS',
      isCustom: false,
      isFavorite: false,
      proxyMode: 'all' // TS redirect chain requires full proxy
    }
  ];

  const DEFAULT_CORS_PROXY = window.location.origin + '/proxy?url=';

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
  const searchInput = document.getElementById('search-input');
  const clearSearchBtn = document.getElementById('clear-search-btn');
  const connectionStatus = document.getElementById('connection-status');
  
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
  const modalAddChannel = document.getElementById('modal-add-channel');
  const modalSettings = document.getElementById('modal-settings');
  const btnOpenAddChannel = document.getElementById('btn-open-add-channel');
  const btnOpenSettings = document.getElementById('btn-open-settings');
  const btnExportPlaylist = document.getElementById('btn-export-playlist');
  const btnImportPlaylistTrigger = document.getElementById('btn-import-playlist-trigger');
  const fileImportPlaylist = document.getElementById('file-import-playlist');
  const addChannelForm = document.getElementById('add-channel-form');
  const btnResetApp = document.getElementById('btn-reset-app');
  const btnRetryStream = document.getElementById('btn-retry-stream');
  const btnCorsTroubleshoot = document.getElementById('btn-cors-troubleshoot');
  const btnToggleProxyError = document.getElementById('btn-toggle-proxy-error');
  
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
    
    // Auto-select first channel
    if (channels.length > 0) {
      selectChannel(channels[0].id);
    }
    
    // Detect internet connection status
    window.addEventListener('online', updateConnectionStatus);
    window.addEventListener('offline', updateConnectionStatus);
    updateConnectionStatus();

    // Render Lucide icons
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  function loadSettings() {
    // Version marker to force-migrate old settings where proxy was off by default
    const settingsVersion = localStorage.getItem('iptv_settings_v');
    if (settingsVersion !== '2') {
      // First run or upgrade from v1: force proxy ON with local proxy
      localStorage.setItem('iptv_settings_v', '2');
      localStorage.setItem('iptv_use_proxy', 'true');
      localStorage.setItem('iptv_proxy_url', DEFAULT_CORS_PROXY);
    }

    const savedProxy = localStorage.getItem('iptv_use_proxy');
    useCorsProxy = savedProxy === null ? true : savedProxy === 'true';
    corsProxyUrl = localStorage.getItem('iptv_proxy_url') || DEFAULT_CORS_PROXY;
    
    settingUseProxy.checked = useCorsProxy;
    
    // Set proxy select dropdown
    const localPrefix = window.location.origin + '/proxy?url=';
    if (corsProxyUrl === localPrefix || corsProxyUrl.includes('/proxy?url=')) {
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
    const CHANNEL_VERSION = '9'; // Bump this to force-reload default channels with working URLs
    const savedVersion = localStorage.getItem('iptv_channels_v');
    const saved = localStorage.getItem('iptv_channels');

    if (savedVersion !== CHANNEL_VERSION) {
      // Clean migration: clear ALL old data and reload fresh defaults
      // This removes any malformed entries from old React/Vite migration
      localStorage.removeItem('iptv_channels');
      localStorage.removeItem('subsdrop_channels_v3'); // Old React version key
      channels = [...DEFAULT_CHANNELS];
      localStorage.setItem('iptv_channels_v', CHANNEL_VERSION);
      saveChannels();
    } else if (saved) {
      try {
        channels = JSON.parse(saved);
      } catch (e) {
        channels = [...DEFAULT_CHANNELS];
      }
    } else {
      channels = [...DEFAULT_CHANNELS];
      saveChannels();
    }
  }

  function saveChannels() {
    localStorage.setItem('iptv_channels', JSON.stringify(channels));
  }

  function updateConnectionStatus() {
    if (navigator.onLine) {
      connectionStatus.className = 'connection-status online';
      connectionStatus.querySelector('.status-text').textContent = 'Online';
    } else {
      connectionStatus.className = 'connection-status offline';
      connectionStatus.querySelector('.status-text').textContent = 'Offline';
    }
  }

  // --- UI Renderers ---
  function renderChannels() {
    channelList.innerHTML = '';
    
    // Filter
    let filtered = channels.filter(ch => {
      // Tab filter
      if (activeTab === 'favorites' && !ch.isFavorite) return false;
      if (activeTab === 'custom' && !ch.isCustom) return false;
      
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return ch.name.toLowerCase().includes(query) || 
               ch.category.toLowerCase().includes(query) ||
               ch.url.toLowerCase().includes(query);
      }
      return true;
    });

    if (filtered.length === 0) {
      emptyState.style.display = 'flex';
    } else {
      emptyState.style.display = 'none';
    }

    filtered.forEach(ch => {
      const li = document.createElement('li');
      li.className = `channel-item ${ch.id === activeChannelId ? 'active' : ''}`;
      li.setAttribute('data-id', ch.id);
      
      const isMpegTs = ch.url.toLowerCase().includes('.ts') || !ch.url.toLowerCase().includes('.m3u8');
      const extBadge = isMpegTs ? '<span class="channel-badge mpegts">TS</span>' : '<span class="channel-badge hls">HLS</span>';
      const customBadge = ch.isCustom ? '<span class="channel-badge custom-badge">Custom</span>' : '';
      
      const avatarChar = ch.name.trim().charAt(0);
      const isLogoUrl = ch.logo && (ch.logo.startsWith('http://') || ch.logo.startsWith('https://'));
      const avatarContent = isLogoUrl 
        ? `<img src="${ch.logo}" alt="${ch.name}" onerror="this.style.display='none'; this.parentElement.innerText='${avatarChar}'">`
        : (ch.logo || avatarChar);
      
      li.innerHTML = `
        <div class="channel-avatar">
          ${avatarContent}
        </div>
        <div class="channel-details">
          <div class="channel-name" title="${ch.name}">${ch.name}</div>
          <div class="channel-meta-tags">
            ${extBadge}
            ${customBadge}
            <span class="channel-badge">${ch.category}</span>
          </div>
        </div>
        <button class="channel-fav-btn ${ch.isFavorite ? 'active' : ''}" title="Favorite">
          <i data-lucide="star"></i>
        </button>
      `;

      // Click to select channel
      li.addEventListener('click', (e) => {
        // Prevent trigger if clicking favorite button
        if (e.target.closest('.channel-fav-btn')) {
          e.stopPropagation();
          toggleFavorite(ch.id);
          return;
        }
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
    const channel = channels.find(c => c.id === id);
    if (!channel) return;

    // Update Sidebar active state styling
    document.querySelectorAll('.channel-item').forEach(el => {
      if (el.getAttribute('data-id') === id) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    // Update Header Details
    headerChannelName.textContent = channel.name;
    headerChannelStatus.innerHTML = `<i data-lucide="radio" class="inline-icon"></i> Connecting...`;
    
    // Set Header Avatar
    const avatarChar = channel.name.trim().charAt(0);
    const isHeaderLogoUrl = channel.logo && (channel.logo.startsWith('http://') || channel.logo.startsWith('https://'));
    headerChannelAvatar.innerHTML = isHeaderLogoUrl ? `<img src="${channel.logo}" alt="${channel.name}">` : (channel.logo || avatarChar);
    headerChannelAvatar.style.background = getGlowColor(channel.name);

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

    let streamUrl = rawUrl;
    if (tryProxy) {
      streamUrl = corsProxyUrl + encodeURIComponent(rawUrl);
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

    const isMpegTs = rawUrl.toLowerCase().includes('.ts') || (!rawUrl.toLowerCase().includes('.m3u8') && !rawUrl.toLowerCase().includes('.mp4'));

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
        video.play().catch(() => {});
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
          stashInitialSize: 128 * 1024, // 128KB initial stash size for instant startup
          liveBufferLatencyChasing: false, // Disable chasing to prevent stuttering/buffer underruns
          lazyLoad: false,
          deferLoadAfterSourceOpen: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 60,
          autoCleanupMinBackwardDuration: 30
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
      } catch (e) {}
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
      video.play().catch(() => {});
      triggerStateIndicator('play');
    } else {
      video.pause();
      triggerStateIndicator('pause');
    }
  }

  function triggerStateIndicator(action) {
    stateOverlayIcon.setAttribute('data-lucide', action);
    if (window.lucide) window.lucide.createIcons();
    showOverlay(stateOverlay, true);
    setTimeout(() => {
      showOverlay(stateOverlay, false);
    }, 500);
  }

  function updatePlayPauseIcons(isPaused) {
    if (isPaused) {
      playIcon.setAttribute('data-lucide', 'play');
    } else {
      playIcon.setAttribute('data-lucide', 'pause');
    }
    if (window.lucide) window.lucide.createIcons();
  }

  function handleVolumeChange() {
    video.volume = volumeSlider.value;
    video.muted = video.volume === 0;
    
    // Update Icons
    if (video.muted || video.volume === 0) {
      volumeIcon.setAttribute('data-lucide', 'volume-x');
    } else if (video.volume < 0.5) {
      volumeIcon.setAttribute('data-lucide', 'volume-1');
    } else {
      volumeIcon.setAttribute('data-lucide', 'volume-2');
    }
    if (window.lucide) window.lucide.createIcons();
  }

  function toggleMute() {
    video.muted = !video.muted;
    if (video.muted) {
      volumeIcon.setAttribute('data-lucide', 'volume-x');
      volumeSlider.value = 0;
    } else {
      volumeSlider.value = video.volume || 0.8;
      video.volume = volumeSlider.value;
      if (video.volume < 0.5) {
        volumeIcon.setAttribute('data-lucide', 'volume-1');
      } else {
        volumeIcon.setAttribute('data-lucide', 'volume-2');
      }
    }
    if (window.lucide) window.lucide.createIcons();
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
    if (!document.fullscreenElement) {
      playerContainer.requestFullscreen().catch(err => {
        console.error(`Error entering fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  }

  function updateFullscreenIcon() {
    if (document.fullscreenElement) {
      fullscreenIcon.setAttribute('data-lucide', 'minimize');
    } else {
      fullscreenIcon.setAttribute('data-lucide', 'maximize');
    }
    if (window.lucide) window.lucide.createIcons();
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

  // --- Playlist Parsers ---
  function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target.result;
      if (file.name.endsWith('.json')) {
        parseJsonPlaylist(content);
      } else {
        parseM3uPlaylist(content);
      }
      fileImportPlaylist.value = '';
    };
    reader.readAsText(file);
  }

  function parseJsonPlaylist(text) {
    try {
      const imported = JSON.parse(text);
      if (Array.isArray(imported)) {
        imported.forEach(ch => {
          if (ch.name && ch.url) {
            addNewChannel(ch.name, ch.url, ch.category || 'Custom', ch.logo || '');
          }
        });
        saveChannels();
        renderChannels();
        alert('Playlist imported successfully.');
      } else {
        alert('Invalid JSON playlist structure.');
      }
    } catch (e) {
      alert('Error reading JSON playlist file.');
    }
  }

  function parseM3uPlaylist(text) {
    const lines = text.split('\n');
    let channelCount = 0;
    
    let currentName = '';
    let currentLogo = '';
    let currentCategory = 'Custom';

    lines.forEach(line => {
      line = line.trim();
      
      if (line.startsWith('#EXTINF:')) {
        const logoMatch = line.match(/tvg-logo="([^"]+)"/);
        const groupMatch = line.match(/group-title="([^"]+)"/);
        
        currentLogo = logoMatch ? logoMatch[1] : '';
        currentCategory = groupMatch ? groupMatch[1] : 'Custom';
        
        const commaIndex = line.lastIndexOf(',');
        if (commaIndex !== -1) {
          currentName = line.substring(commaIndex + 1).trim();
        } else {
          currentName = 'M3U Channel';
        }
      } else if (line && !line.startsWith('#')) {
        if (currentName) {
          addNewChannel(currentName, line, currentCategory, currentLogo);
          channelCount++;
          // Reset
          currentName = '';
          currentLogo = '';
          currentCategory = 'Custom';
        }
      }
    });

    if (channelCount > 0) {
      saveChannels();
      renderChannels();
      alert(`Successfully imported ${channelCount} channels.`);
    } else {
      alert('Could not find any channels in this M3U file.');
    }
  }

  function addNewChannel(name, url, category, logo) {
    const duplicate = channels.find(c => c.url.toLowerCase() === url.toLowerCase().trim());
    if (duplicate) return;

    const id = 'custom-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    channels.push({
      id: id,
      name: name,
      url: url,
      category: category || 'Custom',
      logo: logo || '',
      isCustom: true,
      isFavorite: false
    });
  }

  function exportPlaylist() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(channels, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `subsdrop_tv_playlist_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
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

    // Search Box Listener
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value;
      clearSearchBtn.style.display = searchQuery ? 'inline-flex' : 'none';
      renderChannels();
    });
    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      clearSearchBtn.style.display = 'none';
      renderChannels();
    });

    // Dashboard Category Filter Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeTab = btn.getAttribute('data-tab');
        renderChannels();
      });
    });

    // Modals Open/Close Events
    btnOpenAddChannel.addEventListener('click', () => {
      modalAddChannel.style.display = 'flex';
    });
    btnOpenSettings.addEventListener('click', () => {
      modalSettings.style.display = 'flex';
    });
    
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

    // Add Custom Channel form submit
    addChannelForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('ch-name').value.trim();
      const url = document.getElementById('ch-url').value.trim();
      const category = document.getElementById('ch-category').value;
      const logo = document.getElementById('ch-logo').value.trim();

      addNewChannel(name, url, category, logo);
      saveChannels();
      renderChannels();

      // Reset & Close
      addChannelForm.reset();
      modalAddChannel.style.display = 'none';
      
      // Auto-play the newly added channel
      const lastChan = channels[channels.length - 1];
      if (lastChan) selectChannel(lastChan.id);
    });

    // Export & Import triggers
    btnExportPlaylist.addEventListener('click', exportPlaylist);
    btnImportPlaylistTrigger.addEventListener('click', () => {
      fileImportPlaylist.click();
    });
    fileImportPlaylist.addEventListener('change', handleImportFile);

    // Hard reset app settings
    btnResetApp.addEventListener('click', () => {
      if (confirm('Are you sure you want to reset all custom channels and restore defaults? This cannot be undone.')) {
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
