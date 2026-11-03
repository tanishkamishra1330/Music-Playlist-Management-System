(() => {
  'use strict';

  const TOKEN_KEY = 'sonora.spotify.token.v1';
  const PENDING_KEY = 'sonora.spotify.pkce.v1';
  const SCOPES = [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-read-playback-state',
    'user-modify-playback-state'
  ].join(' ');

  const ui = {
    login: document.getElementById('spotify-login'),
    loginLabel: document.getElementById('spotify-login-label'),
    configure: document.getElementById('spotify-configure'),
    configDialog: document.getElementById('spotify-config-dialog'),
    configForm: document.getElementById('spotify-config-form'),
    configInput: document.getElementById('spotify-client-id'),
    configError: document.getElementById('spotify-config-error'),
    logout: document.getElementById('spotify-logout'),
    profile: document.getElementById('profile-label'),
    status: document.getElementById('spotify-status'),
    form: document.getElementById('spotify-search-form'),
    query: document.getElementById('spotify-search-input'),
    submit: document.getElementById('spotify-search-submit'),
    results: document.getElementById('spotify-results'),
    tabs: Array.from(document.querySelectorAll('[data-spotify-type]'))
  };

  let config = null;
  let configReady = false;
  let configError = '';
  let tokens = readTokens();
  let player = null;
  let deviceId = null;
  let sdkReady = false;
  let sdkAuthRetryUsed = false;
  let connecting = null;
  let selectedType = 'track';
  let callbacks = {};
  let searchGeneration = 0;

  function readTokens() {
    try {
      const value = sessionStorage.getItem(TOKEN_KEY);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      sessionStorage.removeItem(TOKEN_KEY);
      return null;
    }
  }

  function saveTokens(value) {
    tokens = value;
    try {
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify(value));
    } catch (error) {
      throw new Error('Browser session storage is unavailable. Enable it and reconnect Spotify.');
    }
  }

  function clearTokens() {
    tokens = null;
    sessionStorage.removeItem(TOKEN_KEY);
  }

  function setStatus(message, kind = '') {
    ui.status.textContent = message;
    ui.status.dataset.kind = kind;
  }

  function renderAuth() {
    const connected = Boolean(tokens && tokens.accessToken);
    ui.login.disabled = connected;
    ui.loginLabel.textContent = connected
      ? 'Spotify connected'
      : config && config.configured ? 'Connect Spotify' : 'Set Spotify Client ID';
    ui.configure.hidden = !config || !config.configured;
    ui.logout.hidden = !connected;
    ui.submit.disabled = !connected;
    ui.query.disabled = !connected;
    ui.profile.textContent = connected ? (tokens.displayName || 'Spotify listener') : 'Listener';
    if (configError) {
      setStatus(configError, 'error');
      renderMessage(configError);
    } else if (!config || !config.configured) {
      const message = 'Choose Set Spotify Client ID to configure Spotify in Sonora.';
      setStatus(message, 'error');
      renderMessage(message);
    } else if (!connected) {
      setStatus('Connect your Spotify account to search and play.', '');
      renderMessage('Sign in to search Spotify’s catalog.');
    } else {
      setStatus(deviceId ? 'Spotify connected · Web Playback ready' : 'Spotify connected · Preparing Web Playback…', 'success');
    }
  }

  function renderMessage(message, className = 'spotify-empty-state') {
    ui.results.replaceChildren();
    const node = document.createElement('div');
    node.className = className;
    node.textContent = message;
    ui.results.append(node);
  }

  function openClientConfig() {
    ui.configError.hidden = true;
    ui.configError.textContent = '';
    ui.configInput.value = config && config.clientId ? config.clientId : '';
    ui.configDialog.hidden = false;
    ui.configInput.focus();
  }

  function closeClientConfig() {
    ui.configDialog.hidden = true;
  }

  async function saveClientConfig(event) {
    event.preventDefault();
    const clientId = ui.configInput.value.trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(clientId)) {
      ui.configError.textContent = 'Enter a valid Spotify Client ID (letters, digits, hyphens, or underscores).';
      ui.configError.hidden = false;
      return;
    }

    const saveButton = document.getElementById('save-spotify-config');
    saveButton.disabled = true;
    ui.configError.hidden = true;
    try {
      const response = await fetch('/api/spotify/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ clientId })
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || `Configuration save failed (${response.status}).`);
      }

      const changed = config && config.clientId !== clientId;
      if (changed) {
        if (player) player.disconnect();
        player = null;
        deviceId = null;
        connecting = null;
        clearTokens();
        sessionStorage.removeItem(PENDING_KEY);
      }
      config = result;
      configReady = true;
      configError = '';
      closeClientConfig();
      renderAuth();
      setStatus('Spotify Client ID saved locally. Connect your account to continue.', 'success');
      renderMessage('Client ID saved. Connect Spotify to search and play.');
    } catch (error) {
      ui.configError.textContent = error.message;
      ui.configError.hidden = false;
    } finally {
      saveButton.disabled = false;
    }
  }

  function base64Url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function randomUrlSafe(byteLength) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return base64Url(bytes);
  }

  async function createChallenge(verifier) {
    if (!crypto.subtle) {
      throw new Error('PKCE requires a secure browser context. Open Sonora at http://127.0.0.1:8080.');
    }
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(verifier)
    );
    return base64Url(new Uint8Array(digest));
  }

  function removeCallbackFromUrl() {
    window.history.replaceState(
      null,
      document.title,
      `${window.location.pathname}${window.location.hash}`
    );
  }

  function safeOAuthError(value) {
    if (typeof value !== 'string') return '';
    return value
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/("(?:access_token|refresh_token|token|client_secret|client_id|code_verifier|authorization_code|code)"\s*:\s*")[^"]*"/gi, '$1[redacted]"')
      .replace(/\b(access_token|refresh_token|token|client_secret|client_id|code_verifier|authorization_code|code)\s*[=:]\s*[^&\s,}]+/gi, '$1=[redacted]')
      .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
      .slice(0, 300)
      .trim();
  }

  function safeResponseExcerpt(value) {
    const text = safeOAuthError(value)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&(?:nbsp|amp|quot|lt|gt);/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text ? text.slice(0, 240) : '(empty response body)';
  }

  function parseTokenResponse(response, body) {
    if (!response.ok ||
        !body ||
        typeof body !== 'object' ||
        typeof body.access_token !== 'string' ||
        !body.access_token) {
      const error = body && safeOAuthError(body.error);
      const description = body && safeOAuthError(body.error_description);
      const detail = description || error || 'Spotify did not return an access token.';
      throw new Error(
        `Spotify token endpoint returned HTTP ${response.status}` +
        `${error ? ` (${error})` : ''}: ${detail}`
      );
    }
    return body;
  }

  async function tokenRequest(params) {
    let response;
    try {
      response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
        cache: 'no-store'
      });
    } catch (error) {
      throw new Error(
        'Could not reach Spotify’s token endpoint (network or browser CORS failure). ' +
        'Check the browser network panel and try connecting again.'
      );
    }
    let text;
    try {
      text = await response.text();
    } catch (error) {
      throw new Error(
        `Spotify token endpoint returned HTTP ${response.status}, but its response body could not be read.`
      );
    }
    let body = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch (error) {
        const detail = safeOAuthError(text);
        throw new Error(
          `Spotify token endpoint returned HTTP ${response.status} with an unreadable response` +
          `${detail ? `: ${detail}` : '.'}`
        );
      }
    }
    return parseTokenResponse(response, body);
  }

  function acceptTokenResponse(body, previous) {
    const value = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token || (previous && previous.refreshToken) || '',
      expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000,
      displayName: previous && previous.displayName ? previous.displayName : ''
    };
    saveTokens(value);
    renderAuth();
    return value.accessToken;
  }

  async function refreshTokens() {
    if (!tokens || !tokens.refreshToken || !config || !config.clientId) {
      clearTokens();
      renderAuth();
      throw new Error('Your Spotify session expired. Connect Spotify again.');
    }
    try {
      const body = await tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: config.clientId
      });
      return acceptTokenResponse(body, tokens);
    } catch (error) {
      if (/invalid_grant|invalid refresh token/i.test(error.message)) clearTokens();
      renderAuth();
      throw error;
    }
  }

  async function getAccessToken(forceRefresh = false) {
    if (!tokens || !tokens.accessToken) {
      throw new Error('Connect your Spotify account first.');
    }
    if (forceRefresh || tokens.expiresAt <= Date.now() + 60000) {
      return refreshTokens();
    }
    return tokens.accessToken;
  }

  async function spotifyApi(path, options = {}, retry = true) {
    const accessToken = await getAccessToken();
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${accessToken}`);
    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const method = (options.method || 'GET').toUpperCase();
    let response;
    try {
      response = await fetch(`https://api.spotify.com/v1${path}`, {
        ...options,
        headers
      });
    } catch (error) {
      throw new Error(
        `Spotify API ${method} ${path.split('?')[0]} could not be reached ` +
        '(network or browser CORS failure). Check the browser network panel.'
      );
    }
    if (response.status === 401 && retry) {
      await getAccessToken(true);
      return spotifyApi(path, options, false);
    }
    const contentType = response.headers.get('content-type') || '(missing)';
    let text;
    try {
      text = await response.text();
    } catch (error) {
      throw new Error(
        `Spotify API ${method} ${path.split('?')[0]} returned HTTP ${response.status} ` +
        `(Content-Type: ${contentType}), but its response body could not be read.`
      );
    }
    let body = null;
    let parseError = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch (error) {
        parseError = error;
      }
    }
    if (!response.ok) {
      const errorValue = body && body.error;
      const errorCode = typeof errorValue === 'string'
        ? errorValue
        : errorValue && (errorValue.code || errorValue.status);
      let message =
        `Spotify API ${method} ${path.split('?')[0]} failed: HTTP ${response.status}` +
        `; Content-Type: ${contentType}` +
        `${errorCode ? `; error: ${safeResponseExcerpt(String(errorCode))}` : ''}` +
        `; response: ${safeResponseExcerpt(text)}`;
      if (response.status === 403) {
        message += ' Check app access and account restrictions.';
      } else if (response.status === 429) {
        message += ' Spotify rate limit reached; wait and retry.';
      }
      console.warn(message);
      if (response.status === 401) {
        clearTokens();
        renderAuth();
      }
      throw new Error(message);
    }
    if (parseError) {
      const message =
        `Spotify API ${method} ${path.split('?')[0]} returned HTTP ${response.status} ` +
        `(Content-Type: ${contentType}) with an invalid JSON response: ${safeResponseExcerpt(text)}`;
      console.warn(message);
      throw new Error(message);
    }
    return body;
  }

  async function handleAuthorizationCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');
    if (!code && !error) return;

    removeCallbackFromUrl();
    let pending = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
    } catch (parseError) {
      pending = null;
    }
    // Consume the verifier before the request so a callback reload cannot reuse the code.
    sessionStorage.removeItem(PENDING_KEY);
    if (!pending ||
        typeof pending.state !== 'string' ||
        !/^[A-Za-z0-9_-]{43,128}$/.test(pending.state) ||
        typeof pending.verifier !== 'string' ||
        !/^[A-Za-z0-9_-]{43,128}$/.test(pending.verifier) ||
        !Number.isFinite(pending.createdAt) ||
        pending.createdAt > Date.now() ||
        !params.get('state') ||
        params.get('state') !== pending.state ||
        Date.now() - pending.createdAt > 10 * 60 * 1000) {
      clearTokens();
      renderAuth();
      setStatus('Spotify sign-in could not be verified. Please connect again.', 'error');
      return;
    }
    if (error) {
      clearTokens();
      renderAuth();
      setStatus(error === 'access_denied'
        ? 'Spotify access was declined.'
        : `Spotify authorization failed: ${safeOAuthError(error) || 'unknown error'}`, 'error');
      return;
    }

    try {
      if (!config || !config.configured || !config.clientId || !config.redirectUri) {
        throw new Error('Spotify OAuth configuration is unavailable; the authorization code was not exchanged.');
      }
      setStatus('Finishing Spotify sign-in…');
      const body = await tokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        code_verifier: pending.verifier
      });
      acceptTokenResponse(body, null);
    } catch (callbackError) {
      clearTokens();
      renderAuth();
      setStatus(callbackError.message, 'error');
      renderMessage(callbackError.message);
    }
  }

  async function beginLogin() {
    if (!config || !config.configured) {
      openClientConfig();
      return;
    }
    ui.login.disabled = true;
    clearTokens();
    sessionStorage.removeItem(PENDING_KEY);
    if (player) {
      player.disconnect();
      player = null;
    }
    deviceId = null;
    sdkAuthRetryUsed = false;
    connecting = null;
    renderAuth();
    ui.login.disabled = true;
    try {
      const verifier = randomUrlSafe(64);
      const state = randomUrlSafe(32);
      const challenge = await createChallenge(verifier);
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({
        verifier,
        state,
        createdAt: Date.now()
      }));
      const authorize = new URL('https://accounts.spotify.com/authorize');
      authorize.search = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        scope: SCOPES,
        redirect_uri: config.redirectUri,
        state,
        code_challenge_method: 'S256',
        code_challenge: challenge
      }).toString();
      window.location.assign(authorize.toString());
    } catch (error) {
      setStatus(error.message, 'error');
      ui.login.disabled = false;
    }
  }

  async function loadProfile() {
    const profile = await spotifyApi('/me');
    if (tokens) {
      tokens.displayName = profile.display_name || profile.id || 'Spotify listener';
      saveTokens(tokens);
    }
    renderAuth();
  }

  function sdkError(message, detail) {
    setStatus(`${message}${detail ? ` ${detail}` : ''}`, 'error');
    if (callbacks.onPlaybackError) callbacks.onPlaybackError(message, detail || '');
  }

  function connectPlayer() {
    if (connecting) return connecting;
    if (player && deviceId) return Promise.resolve(true);
    if (!sdkReady || !window.Spotify) {
      return Promise.reject(new Error('Spotify Web Playback is still loading. Try again in a moment.'));
    }

    connecting = new Promise((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          connecting = null;
          reject(new Error('Spotify player is taking too long to connect.'));
        }
      }, 15000);

      const finish = (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        connecting = null;
        if (error) reject(error);
        else resolve(true);
      };

      player = new window.Spotify.Player({
        name: 'Sonora Web Player',
        volume: 0.75,
        getOAuthToken: (callback) => {
          getAccessToken().then(callback).catch((error) => {
            sdkError('Could not provide an access token to Spotify Web Playback.', error.message);
            finish(error);
          });
        }
      });

      player.addListener('ready', ({ device_id: id }) => {
        deviceId = id;
        sdkAuthRetryUsed = false;
        setStatus('Spotify connected · Web Playback ready', 'success');
        finish();
      });
      player.addListener('not_ready', () => {
        deviceId = null;
        setStatus('Spotify playback device disconnected. Reconnect or try again.', 'error');
      });
      player.addListener('player_state_changed', (playbackState) => {
        if (callbacks.onPlaybackState) callbacks.onPlaybackState(playbackState);
      });
      player.addListener('initialization_error', ({ message }) => {
        sdkError('Spotify player could not initialize.', message);
        finish(new Error(message));
      });
      player.addListener('authentication_error', ({ message }) => {
        const detail = safeOAuthError(message) || 'Spotify rejected the SDK authentication.';
        if (!sdkAuthRetryUsed && tokens && tokens.refreshToken) {
          sdkAuthRetryUsed = true;
          const rejectedPlayer = player;
          player = null;
          deviceId = null;
          finish(new Error(`Spotify rejected its current access token (${detail}); refreshing once.`));
          if (rejectedPlayer) rejectedPlayer.disconnect();
          refreshTokens()
            .then(() => connectPlayer())
            .catch((error) => {
              clearTokens();
              renderAuth();
              sdkError(
                'Spotify Web Playback authentication failed after one token refresh.',
                error.message
              );
            });
          return;
        }

        clearTokens();
        renderAuth();
        sdkError(
          'Spotify Web Playback authentication failed. Connect again to retry.',
          detail
        );
        finish(new Error(detail));
      });
      player.addListener('account_error', ({ message }) => {
        sdkError('Spotify Web Playback requires a Premium account.', message);
        finish(new Error(message));
      });
      player.addListener('playback_error', ({ message }) => {
        sdkError('Spotify could not play this track.', message);
      });
      player.addListener('autoplay_failed', () => {
        setStatus('Tap Play to allow Spotify playback in this browser.', 'error');
      });

      player.connect().then((connected) => {
        if (!connected && !settled) {
          finish(new Error('Spotify player could not connect.'));
        }
      }).catch((error) => finish(error));
    });
    return connecting;
  }

  async function finishConnection() {
    renderAuth();
    try {
      await loadProfile();
    } catch (error) {
      if (/403/.test(error.message)) {
        setStatus('Spotify account is not authorized for this development app. Check the app allowlist.', 'error');
      } else {
        setStatus(error.message, 'error');
      }
      return;
    }
    if (sdkReady) {
      connectPlayer().catch((error) => setStatus(error.message, 'error'));
    }
  }

  async function ensurePlayer() {
    if (!tokens) throw new Error('Connect your Spotify account first.');
    await getAccessToken();
    if (!sdkReady) throw new Error('Spotify Web Playback SDK has not loaded. Check your network or content blockers.');
    await connectPlayer();
    if (!deviceId) throw new Error('Spotify playback device is not ready yet.');
    return deviceId;
  }

  async function transferToBrowser() {
    const id = await ensurePlayer();
    if (player && typeof player.activateElement === 'function') {
      await player.activateElement();
    }
    await spotifyApi('/me/player', {
      method: 'PUT',
      body: JSON.stringify({ device_ids: [id], play: false })
    });
    return id;
  }

  async function playTrack(uri) {
    const id = await transferToBrowser();
    const query = new URLSearchParams({ device_id: id });
    await spotifyApi(`/me/player/play?${query}`, {
      method: 'PUT',
      body: JSON.stringify({ uris: [uri] })
    });
  }

  async function togglePlayback() {
    await ensurePlayer();
    await player.togglePlay();
  }

  async function pausePlayback() {
    if (player && deviceId) await player.pause();
  }

  async function previousTrack() {
    await ensurePlayer();
    await player.previousTrack();
  }

  async function nextTrack() {
    await ensurePlayer();
    await player.nextTrack();
  }

  async function seek(positionMs) {
    await ensurePlayer();
    await player.seek(positionMs);
  }

  async function setVolume(volume) {
    if (!player || !deviceId || !sdkReady) return;
    await player.setVolume(Math.max(0, Math.min(1, volume)));
  }

  async function setRepeat(mode) {
    const state = mode === 'one' ? 'track' : 'off';
    await spotifyApi(`/me/player/repeat?state=${encodeURIComponent(state)}`, {
      method: 'PUT'
    });
  }

  function spotifyLink(item, type) {
    const url = item && item.external_urls && item.external_urls.spotify;
    if (typeof url === 'string' && url.indexOf('https://open.spotify.com/') === 0) {
      return url;
    }
    return `https://open.spotify.com/${type}/${encodeURIComponent(item.id)}`;
  }

  function safeArtwork(images) {
    if (!Array.isArray(images)) return '';
    const image = images.find((entry) =>
      entry && typeof entry.url === 'string' &&
      entry.url.indexOf('https://i.scdn.co/') === 0
    );
    return image ? image.url : '';
  }

  function appendArtwork(target, url, symbol) {
    if (!url) {
      target.textContent = symbol;
      return;
    }
    const image = document.createElement('img');
    image.src = url;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      image.remove();
      target.textContent = symbol;
    });
    target.append(image);
  }

  function trackMetadata(track) {
    return {
      spotifyId: track.id,
      spotifyUri: track.uri,
      title: track.name,
      artist: (track.artists || []).map((artist) => artist.name).join(', '),
      duration: Math.max(1, Math.ceil(Number(track.duration_ms || 0) / 1000)),
      album: track.album ? track.album.name : '',
      artworkUrl: safeArtwork(track.album && track.album.images)
    };
  }

  function makeOpenLink(item, type) {
    const link = document.createElement('a');
    link.className = 'spotify-open-link';
    link.href = spotifyLink(item, type);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open ↗';
    return link;
  }

  function renderTrackResult(track) {
    const metadata = trackMetadata(track);
    const card = document.createElement('article');
    card.className = 'spotify-result-card spotify-track-result';
    const art = document.createElement('div');
    art.className = 'spotify-result-art';
    appendArtwork(art, metadata.artworkUrl, '♫');
    const copy = document.createElement('div');
    copy.className = 'spotify-result-copy';
    const title = document.createElement('strong');
    title.textContent = metadata.title;
    const line = document.createElement('span');
    line.textContent = `${metadata.artist} · ${metadata.album}`;
    const duration = document.createElement('small');
    duration.textContent = formatDuration(metadata.duration);
    copy.append(title, line, duration);
    const actions = document.createElement('div');
    actions.className = 'spotify-result-actions';
    const play = document.createElement('button');
    play.className = 'spotify-result-play';
    play.type = 'button';
    play.textContent = 'Play';
    play.addEventListener('click', () => {
      if (callbacks.onAddTrack) callbacks.onAddTrack(metadata, true);
    });
    const add = document.createElement('button');
    add.className = 'spotify-result-add';
    add.type = 'button';
    add.textContent = '＋ Add';
    add.addEventListener('click', () => {
      if (callbacks.onAddTrack) callbacks.onAddTrack(metadata, false);
    });
    actions.append(play, add, makeOpenLink(track, 'track'));
    card.append(art, copy, actions);
    return card;
  }

  function renderArtistResult(artist) {
    const card = document.createElement('article');
    card.className = 'spotify-result-card';
    const art = document.createElement('div');
    art.className = 'spotify-result-art spotify-artist-art';
    appendArtwork(art, safeArtwork(artist.images), '♬');
    const copy = document.createElement('div');
    copy.className = 'spotify-result-copy';
    const name = document.createElement('strong');
    name.textContent = artist.name;
    const genre = document.createElement('span');
    genre.textContent = Array.isArray(artist.genres) && artist.genres.length
      ? artist.genres.slice(0, 3).join(' · ')
      : 'Spotify artist';
    copy.append(name, genre);
    card.append(art, copy, makeOpenLink(artist, 'artist'));
    return card;
  }

  function renderAlbumResult(album) {
    const card = document.createElement('article');
    card.className = 'spotify-result-card';
    const art = document.createElement('div');
    art.className = 'spotify-result-art';
    appendArtwork(art, safeArtwork(album.images), '♫');
    const copy = document.createElement('div');
    copy.className = 'spotify-result-copy';
    const name = document.createElement('strong');
    name.textContent = album.name;
    const artists = document.createElement('span');
    artists.textContent = (album.artists || []).map((artist) => artist.name).join(', ');
    const albumType = document.createElement('small');
    albumType.textContent = `${album.album_type || 'Album'}${album.release_date ? ` · ${album.release_date.slice(0, 4)}` : ''}`;
    copy.append(name, artists, albumType);
    card.append(art, copy, makeOpenLink(album, 'album'));
    return card;
  }

  function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function renderResults(items, renderer) {
    ui.results.replaceChildren();
    if (!items.length) {
      renderMessage('No Spotify results found. Try a different search.');
      return;
    }
    items.forEach((item) => ui.results.append(renderer(item)));
  }

  async function search(query = ui.query.value) {
    const value = query.trim();
    if (!value) {
      renderMessage('Enter a search term to find Spotify tracks, artists, or albums.');
      return;
    }
    if (!tokens) {
      renderMessage('Connect your Spotify account before searching.');
      return;
    }
    const generation = ++searchGeneration;
    renderMessage('Searching Spotify…', 'spotify-loading');
    ui.submit.disabled = true;
    try {
      const params = new URLSearchParams({
        q: value,
        type: selectedType,
        limit: '8'
      });
      const data = await spotifyApi(`/search?${params}`);
      if (generation !== searchGeneration) return;
      const key = `${selectedType}s`;
      const items = data && data[key] && Array.isArray(data[key].items)
        ? data[key].items
        : [];
      const render = selectedType === 'track'
        ? renderTrackResult
        : selectedType === 'artist' ? renderArtistResult : renderAlbumResult;
      renderResults(items, render);
    } catch (error) {
      if (generation !== searchGeneration) return;
      renderMessage(error.message);
      setStatus(error.message, 'error');
    } finally {
      if (generation === searchGeneration) ui.submit.disabled = !tokens;
    }
  }

  async function loadConfig() {
    const response = await fetch('/api/spotify/config', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Spotify config request failed (${response.status}).`);
    config = await response.json();
    if (!config || typeof config.configured !== 'boolean') {
      throw new Error('The server returned an invalid Spotify configuration response.');
    }
    if (typeof config.clientIdDetected !== 'boolean') {
      throw new Error('The server is an outdated build and does not report Spotify configuration diagnostics.');
    }
    configReady = true;
    configError = '';
    const redirect = config.redirectUri ? new URL(config.redirectUri) : null;
    const appUrl = `${window.location.origin}${window.location.pathname}`;
    const redirectUrl = redirect ? `${redirect.origin}${redirect.pathname}` : '';
    if (config.configured &&
        (!config.clientId || !redirect ||
         window.location.protocol !== 'http:' ||
         !/^http:\/\/127\.0\.0\.1(?::\d+)?\/$/.test(config.redirectUri) ||
         appUrl !== redirectUrl)) {
      config.configured = false;
      configError = 'Open Sonora at the exact 127.0.0.1 redirect URI configured in Spotify and the server.';
    }
    return config;
  }

  async function initialize(options) {
    callbacks = options || {};
    try {
      await loadConfig();
      renderAuth();
      if (configError) setStatus(configError, 'error');
      await handleAuthorizationCallback();
      if (tokens) await finishConnection();
    } catch (error) {
      config = { configured: false };
      configError = `Could not load Spotify settings from this server: ${error.message} Rebuild and restart Sonora.`;
      renderAuth();
      ui.login.disabled = false;
    }
  }

  function logout() {
    if (player) {
      player.disconnect();
      player = null;
    }
    deviceId = null;
    sdkAuthRetryUsed = false;
    connecting = null;
    clearTokens();
    sessionStorage.removeItem(PENDING_KEY);
    renderAuth();
    setStatus('Spotify disconnected.', '');
    renderMessage('Connect Spotify to search and play catalog tracks.');
  }

  ui.login.addEventListener('click', beginLogin);
  ui.configure.addEventListener('click', openClientConfig);
  ui.configForm.addEventListener('submit', saveClientConfig);
  document.getElementById('close-spotify-config').addEventListener('click', closeClientConfig);
  ui.configDialog.addEventListener('click', (event) => {
    if (event.target === ui.configDialog) closeClientConfig();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !ui.configDialog.hidden) closeClientConfig();
  });
  ui.logout.addEventListener('click', logout);
  ui.form.addEventListener('submit', (event) => {
    event.preventDefault();
    search();
  });
  ui.query.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      search();
    }
  });
  ui.tabs.forEach((tab) => tab.addEventListener('click', () => {
    selectedType = tab.dataset.spotifyType;
    ui.tabs.forEach((item) => {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    if (ui.query.value.trim() && tokens) search();
  }));
  window.onSpotifyWebPlaybackSDKReady = () => {
    sdkReady = true;
    if (configReady && tokens) {
      connectPlayer().catch((error) => setStatus(error.message, 'error'));
    }
  };
  if (window.Spotify) window.onSpotifyWebPlaybackSDKReady();

  window.SonoraSpotify = {
    init: initialize,
    isConnected: () => Boolean(tokens && tokens.accessToken),
    getAccessToken,
    playTrack,
    togglePlayback,
    pausePlayback,
    previousTrack,
    nextTrack,
    seek,
    setVolume,
    setRepeat,
    ensurePlayer
  };
})();
