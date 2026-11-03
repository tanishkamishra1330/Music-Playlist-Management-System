(() => {
  'use strict';

  const elements = {
    trackList: document.getElementById('track-list'),
    emptyState: document.getElementById('empty-state'),
    noResults: document.getElementById('no-results'),
    search: document.getElementById('search-input'),
    count: document.getElementById('track-count'),
    headingCount: document.getElementById('heading-count'),
    meta: document.getElementById('playlist-meta'),
    currentTitle: document.getElementById('player-title'),
    currentArtist: document.getElementById('player-artist'),
    playerArt: document.getElementById('player-art'),
    playButton: document.getElementById('toggle-play'),
    audio: document.getElementById('audio-engine'),
    progress: document.getElementById('progress-slider'),
    elapsed: document.getElementById('elapsed-time'),
    total: document.getElementById('total-time'),
    volume: document.getElementById('volume-slider'),
    repeat: document.getElementById('repeat-button'),
    shuffle: document.getElementById('shuffle-button'),
    dialog: document.getElementById('upload-dialog'),
    uploadForm: document.getElementById('upload-form'),
    uploadError: document.getElementById('upload-error'),
    uploadSubmit: document.getElementById('submit-upload'),
    fileName: document.getElementById('file-name'),
    toast: document.getElementById('toast'),
    playerDelete: document.getElementById('player-delete')
  };

  let state = {
    songs: [],
    currentId: null,
    repeat: 'off',
    playing: false,
    shuffle: false,
    filter: ''
  };
  let toastTimer = 0;
  let sourceSongId = null;
  let activeSource = null;
  let lastSpotifyPlayback = null;
  let handlingSpotifyEnd = false;
  elements.audio.volume = 0.75;

  async function api(url, options = {}) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      throw new Error('Cannot reach the local player. Is the C++ server running?');
    }

    const body = await response.text();
    let result;
    try {
      result = body ? JSON.parse(body) : {};
    } catch (error) {
      throw new Error('The server returned an invalid response.');
    }
    if (!response.ok) {
      throw new Error(result.error || `Request failed (${response.status}).`);
    }
    return result;
  }

  function showToast(message, isError = false) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle('error', isError);
    elements.toast.classList.add('visible');
    toastTimer = window.setTimeout(() => elements.toast.classList.remove('visible'), 3200);
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const wholeSeconds = Math.floor(seconds);
    const minutes = Math.floor(wholeSeconds / 60);
    return `${minutes}:${String(wholeSeconds % 60).padStart(2, '0')}`;
  }

  function makeButton(className, label, title, action) {
    const button = document.createElement('button');
    button.className = className;
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', event => {
      event.stopPropagation();
      action();
    });
    return button;
  }

  function colorForSong(id) {
    const palettes = [
      ['#b2d878', '#435d54', '#263540'],
      ['#d99d74', '#795b72', '#313044'],
      ['#8bbcc0', '#43677c', '#283747'],
      ['#d3bd71', '#8a7952', '#413c38'],
      ['#bc91ca', '#625a8b', '#302e48'],
      ['#dc8f8c', '#8c5668', '#393244']
    ];
    const palette = palettes[Math.abs(id) % palettes.length];
    return `linear-gradient(145deg, ${palette[0]}, ${palette[1]} 58%, ${palette[2]})`;
  }

  function renderSongs() {
    const query = state.filter.trim().toLocaleLowerCase();
    const visibleSongs = state.songs.filter(song =>
      `${song.title} ${song.artist}`.toLocaleLowerCase().includes(query)
    );
    elements.trackList.replaceChildren();

    visibleSongs.forEach(song => {
      const position = state.songs.findIndex(item => item.id === song.id) + 1;
      const row = document.createElement('tr');
      row.className = `track-row${song.id === state.currentId ? ' current' : ''}`;
      row.tabIndex = 0;
      row.setAttribute('aria-label', `Play ${song.title} by ${song.artist}`);
      row.addEventListener('click', () => selectSong(song.id, true));
      row.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectSong(song.id, true);
        }
      });

      const index = document.createElement('td');
      index.className = 'track-index';
      const number = document.createElement('span');
      number.className = 'track-index-number';
      number.textContent = String(position);
      const indicator = document.createElement('span');
      indicator.className = 'row-play-indicator';
      indicator.textContent = song.id === state.currentId && state.playing ? '♫' : '▶';
      index.append(number, indicator);

      const infoCell = document.createElement('td');
      const info = document.createElement('div');
      info.className = 'track-info';
      const art = document.createElement('div');
      art.className = 'track-art';
      art.style.background = colorForSong(song.id);
      if (song.source === 'spotify' && song.artworkUrl) {
        const artwork = document.createElement('img');
        artwork.src = song.artworkUrl;
        artwork.alt = '';
        artwork.loading = 'lazy';
        artwork.referrerPolicy = 'no-referrer';
        artwork.addEventListener('error', () => {
          artwork.remove();
          art.textContent = '♫';
        });
        art.append(artwork);
      } else {
        art.textContent = song.source === 'spotify' ? '♫' : '♪';
      }
      const copy = document.createElement('div');
      copy.className = 'track-copy';
      const title = document.createElement('strong');
      title.textContent = song.title;
      const artist = document.createElement('span');
      artist.textContent = song.artist;
      const source = document.createElement('small');
      source.className = `track-source ${song.source === 'spotify' ? 'spotify-source' : ''}`;
      source.textContent = song.source === 'spotify' ? 'Spotify' : 'Local file';
      copy.append(title, artist, source);
      info.append(art, copy);
      infoCell.append(info);

      const albumCell = document.createElement('td');
      albumCell.className = 'track-album';
      albumCell.textContent = song.source === 'spotify'
        ? song.album || 'Spotify'
        : 'Local collection';

      const duration = document.createElement('td');
      duration.className = 'track-duration';
      duration.textContent = formatTime(song.duration);

      const deleteCell = document.createElement('td');
      deleteCell.className = 'delete-cell';
      deleteCell.append(makeButton('icon-button delete-track', '×', `Remove ${song.title}`, () => removeSong(song.id)));
      row.append(index, infoCell, albumCell, duration, deleteCell);
      elements.trackList.append(row);
    });

    const hasSongs = state.songs.length > 0;
    elements.emptyState.hidden = hasSongs;
    elements.noResults.hidden = !hasSongs || visibleSongs.length > 0;
    elements.count.textContent = String(state.songs.length).padStart(2, '0');
    elements.headingCount.textContent = String(state.songs.length);
    elements.meta.textContent = hasSongs
      ? `${state.songs.length} ${state.songs.length === 1 ? 'track' : 'tracks'} · Your personal collection`
      : '0 tracks · Add your first song to get started';
    document.getElementById('sidebar-playlist-name').textContent = 'Your Library';
    document.getElementById('playlist-title').textContent = 'Your Library';
  }

  function renderCurrent() {
    const song = state.songs.find(item => item.id === state.currentId) || null;
    if (!song) {
      if (activeSource === 'local') elements.audio.pause();
      activeSource = null;
      elements.currentTitle.textContent = 'Nothing playing';
      elements.currentArtist.textContent = 'Choose a track to begin';
      elements.playerArt.classList.remove('has-song');
      elements.playerArt.style.backgroundImage = '';
      elements.playerArt.replaceChildren();
      const emptyArtwork = document.createElement('span');
      emptyArtwork.textContent = '♫';
      elements.playerArt.append(emptyArtwork);
      elements.playerDelete.disabled = true;
      sourceSongId = null;
      elements.audio.removeAttribute('src');
      elements.audio.load();
      elements.elapsed.textContent = '0:00';
      elements.total.textContent = '0:00';
      elements.progress.value = '0';
      elements.progress.style.background = 'linear-gradient(to right, var(--accent) 0%, var(--accent) 0%, #454449 0%, #454449 100%)';
      state.playing = false;
      renderPlayButton();
      return;
    }
    const sourceChanged = activeSource !== song.source;
    if (sourceChanged) state.playing = false;
    if (sourceChanged && activeSource === 'local') elements.audio.pause();
    if (sourceChanged && activeSource === 'spotify' && window.SonoraSpotify) {
      window.SonoraSpotify.pausePlayback().catch(error => showToast(error.message, true));
    }
    activeSource = song.source;
    elements.currentTitle.textContent = song.title;
    elements.currentArtist.textContent = song.source === 'spotify' && song.album
      ? `${song.artist} · ${song.album}`
      : song.artist;
    elements.playerArt.classList.add('has-song');
    elements.playerArt.style.background = colorForSong(song.id);
    elements.playerArt.style.backgroundImage = '';
    elements.playerArt.replaceChildren();
    if (song.source === 'spotify' && song.artworkUrl) {
      const artwork = document.createElement('img');
      artwork.src = song.artworkUrl;
      artwork.alt = '';
      artwork.referrerPolicy = 'no-referrer';
      artwork.addEventListener('error', () => {
        artwork.remove();
        const symbol = document.createElement('span');
        symbol.textContent = '♫';
        elements.playerArt.append(symbol);
      });
      elements.playerArt.append(artwork);
    } else {
      const symbol = document.createElement('span');
      symbol.textContent = song.source === 'spotify' ? '♫' : '♪';
      elements.playerArt.append(symbol);
    }
    elements.playerDelete.disabled = false;
    if (song.source === 'spotify') {
      if (sourceChanged) {
        elements.audio.pause();
        elements.audio.removeAttribute('src');
        elements.audio.load();
        elements.elapsed.textContent = '0:00';
        elements.progress.value = '0';
      }
      sourceSongId = song.id;
      elements.total.textContent = formatTime(song.duration);
    } else if (sourceSongId !== song.id) {
      sourceSongId = song.id;
      elements.audio.src = song.audioUrl;
      elements.audio.load();
      elements.total.textContent = formatTime(song.duration);
    }
    renderPlayButton();
  }

  function renderPlayButton() {
    elements.playButton.textContent = state.playing ? 'Ⅱ' : '▶';
    elements.playButton.classList.toggle('playing', state.playing);
    elements.playButton.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    elements.playButton.title = state.playing ? 'Pause' : 'Play';
  }

  function renderRepeat() {
    const labels = { off: 'Repeat off', all: 'Repeat playlist', one: 'Repeat current song' };
    elements.repeat.classList.toggle('active', state.repeat !== 'off');
    elements.repeat.dataset.mode = state.repeat;
    elements.repeat.setAttribute('aria-label', labels[state.repeat] || labels.off);
    elements.repeat.title = labels[state.repeat] || labels.off;
    elements.repeat.textContent = state.repeat === 'one' ? '↻¹' : '↻';
  }

  function renderShuffle() {
    elements.shuffle.classList.toggle('active', state.shuffle);
    elements.shuffle.setAttribute('aria-pressed', String(state.shuffle));
  }

  function applyPlaylist(data) {
    state.songs = Array.isArray(data.songs) ? data.songs : [];
    state.currentId = data.currentId == null ? null : data.currentId;
    if (data.repeat) state.repeat = data.repeat;
    elements.audio.loop = state.repeat === 'one';
    renderSongs();
    renderCurrent();
    renderRepeat();
    renderShuffle();
  }

  async function refreshPlaylist() {
    const data = await api('/api/playlist');
    applyPlaylist(data);
  }

  async function selectSong(id, autoplay) {
    try {
      const result = await api('/api/play/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      state.currentId = result.song.id;
      renderSongs();
      renderCurrent();
      if (autoplay) await startPlayback();
    } catch (error) {
      showToast(error.message, true);
    }
  }

  async function startPlayback() {
    const song = state.songs.find(item => item.id === state.currentId);
    if (!song) {
      showToast('Add a song before starting playback.');
      return;
    }
    if (sourceSongId !== song.id || activeSource !== song.source) renderCurrent();
    if (song.source === 'spotify') {
      if (!window.SonoraSpotify || !window.SonoraSpotify.isConnected()) {
        showToast('Connect your Spotify account to play this track.', true);
        return;
      }
      try {
        await window.SonoraSpotify.playTrack(song.spotifyUri);
        await window.SonoraSpotify.setVolume(Number(elements.volume.value) / 100);
      } catch (error) {
        showToast(error.message, true);
      }
      return;
    }
    if (!elements.audio.src) {
      showToast('This song has no audio file.');
      return;
    }
    try {
      await elements.audio.play();
      state.playing = true;
      renderPlayButton();
      renderSongs();
    } catch (error) {
      state.playing = false;
      renderPlayButton();
      showToast('This audio file could not be played by your browser.', true);
    }
  }

  async function togglePlayback() {
    if (activeSource === 'spotify') {
      if (!window.SonoraSpotify || !window.SonoraSpotify.isConnected()) {
        showToast('Connect Spotify to control this track.', true);
        return;
      }
      try {
        await window.SonoraSpotify.togglePlayback();
      } catch (error) {
        showToast(error.message, true);
      }
      return;
    }
    if (state.playing && !elements.audio.paused) {
      elements.audio.pause();
      return;
    }
    if (!state.currentId && state.songs.length) {
      await selectSong(state.songs[0].id, true);
      return;
    }
    await startPlayback();
  }

  async function moveTrack(direction, fromEnded = false) {
    const endpoint = direction === 'next' ? '/api/next' : '/api/previous';
    const shouldPlay = fromEnded || state.playing;
    try {
      const result = await api(endpoint, { method: 'POST' });
      state.currentId = result.song.id;
      renderSongs();
      renderCurrent();
      if (shouldPlay || result.song.source === 'spotify') await startPlayback();
    } catch (error) {
      if (!(fromEnded && state.repeat === 'off')) showToast(error.message);
    }
  }

  async function removeSong(id) {
    const removedCurrentSpotify = id === state.currentId && activeSource === 'spotify';
    const wasPlaying = state.playing;
    try {
      const result = await api('/api/songs/', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (result.playlist) applyPlaylist(result.playlist);
      if (removedCurrentSpotify) {
        await window.SonoraSpotify.pausePlayback();
        if (wasPlaying && state.currentId != null) await startPlayback();
      }
      showToast('Song removed from your library.');
    } catch (error) {
      showToast(error.message, true);
    }
  }

  async function setRepeat(mode) {
    try {
      const result = await api('/api/repeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
      });
      state.repeat = result.repeat;
      elements.audio.loop = state.repeat === 'one';
      renderRepeat();
      if (activeSource === 'spotify' && window.SonoraSpotify) {
        try {
          await window.SonoraSpotify.setRepeat(state.repeat);
        } catch (error) {
          showToast(`Sonora repeat updated, but Spotify could not change repeat: ${error.message}`, true);
          return;
        }
      }
      showToast(state.repeat === 'off' ? 'Repeat is off.' : state.repeat === 'one' ? 'Repeating this track.' : 'Repeating the playlist.');
    } catch (error) {
      showToast(error.message, true);
    }
  }

  function openDialog() {
    elements.uploadError.hidden = true;
    elements.dialog.hidden = false;
    const firstField = elements.uploadForm.querySelector('input[name="title"]');
    if (firstField) firstField.focus();
  }

  function closeDialog() {
    elements.dialog.hidden = true;
    elements.uploadForm.reset();
    elements.fileName.textContent = 'Choose audio';
    elements.uploadError.hidden = true;
  }

  async function uploadSong(event) {
    event.preventDefault();
    elements.uploadError.hidden = true;
    const formData = new FormData(elements.uploadForm);
    const file = formData.get('audio');
    if (!(file instanceof File) || file.size === 0) {
      elements.uploadError.textContent = 'Choose a non-empty audio file.';
      elements.uploadError.hidden = false;
      return;
    }
    elements.uploadSubmit.disabled = true;
    elements.uploadSubmit.querySelector('span').textContent = 'Uploading…';
    try {
      await api('/api/songs', { method: 'POST', body: formData });
      await refreshPlaylist();
      closeDialog();
      showToast('Added to your library.');
    } catch (error) {
      elements.uploadError.textContent = error.message;
      elements.uploadError.hidden = false;
    } finally {
      elements.uploadSubmit.disabled = false;
      elements.uploadSubmit.querySelector('span').textContent = 'Add to library';
    }
  }

  async function addSpotifyTrack(track, playAfterAdding) {
    const existing = state.songs.find(song =>
      song.source === 'spotify' && song.spotifyId === track.spotifyId
    );
    if (existing) {
      if (playAfterAdding) await selectSong(existing.id, true);
      else showToast('This Spotify track is already in your playlist.');
      return;
    }

    const fields = new FormData();
    fields.set('title', track.title);
    fields.set('artist', track.artist);
    fields.set('duration', String(track.duration));
    fields.set('spotifyId', track.spotifyId);
    fields.set('spotifyUri', track.spotifyUri);
    fields.set('album', track.album || '');
    fields.set('artworkUrl', track.artworkUrl || '');
    try {
      const result = await api('/api/songs/spotify', {
        method: 'POST',
        body: fields
      });
      await refreshPlaylist();
      if (playAfterAdding && result.song) {
        await selectSong(result.song.id, true);
      } else {
        showToast('Added Spotify track to your Sonora playlist.');
      }
    } catch (error) {
      showToast(error.message, true);
    }
  }

  function handleSpotifyPlayback(playbackState) {
    if (activeSource !== 'spotify') {
      lastSpotifyPlayback = null;
      return;
    }
    if (!playbackState) {
      state.playing = false;
      lastSpotifyPlayback = null;
      renderPlayButton();
      return;
    }
    const track = playbackState.track_window &&
      playbackState.track_window.current_track;
    const trackUri = track && track.uri ? track.uri : null;
    const previousPlayback = lastSpotifyPlayback;
    const ended = activeSource === 'spotify' &&
      previousPlayback &&
      previousPlayback.trackUri === trackUri &&
      !previousPlayback.paused &&
      playbackState.paused &&
      playbackState.duration > 0 &&
      playbackState.position >= playbackState.duration - 750;
    lastSpotifyPlayback = {
      trackUri,
      paused: playbackState.paused,
      position: playbackState.position,
      duration: playbackState.duration
    };
    if (track && track.uri) {
      const linkedSong = state.songs.find(song =>
        song.source === 'spotify' && song.spotifyUri === track.uri
      );
      if (linkedSong && linkedSong.id !== state.currentId) {
        api('/api/play/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: linkedSong.id })
        }).then(() => {
          state.currentId = linkedSong.id;
          renderSongs();
          renderCurrent();
        }).catch(error => showToast(error.message, true));
      }
      if (activeSource === 'spotify') {
        elements.currentTitle.textContent = track.name || elements.currentTitle.textContent;
        elements.currentArtist.textContent = (track.artists || [])
          .map(artist => artist.name).join(', ') || elements.currentArtist.textContent;
      }
    }
    state.playing = !playbackState.paused;
    elements.elapsed.textContent = formatTime(playbackState.position / 1000);
    elements.total.textContent = formatTime(playbackState.duration / 1000);
    const progress = playbackState.duration
      ? Math.min(1, playbackState.position / playbackState.duration)
      : 0;
    elements.progress.value = String(Math.round(progress * 1000));
    const percentage = `${progress * 100}%`;
    elements.progress.style.background =
      `linear-gradient(to right, var(--accent) ${percentage}, #454449 ${percentage})`;
    renderPlayButton();
    renderSongs();
    if (ended && !handlingSpotifyEnd && state.repeat !== 'one') {
      handlingSpotifyEnd = true;
      moveTrack('next', true).finally(() => {
        handlingSpotifyEnd = false;
      });
    }
  }

  document.getElementById('add-song').addEventListener('click', openDialog);
  document.getElementById('sidebar-add').addEventListener('click', openDialog);
  document.getElementById('sidebar-upload').addEventListener('click', openDialog);
  document.querySelectorAll('[data-open-upload]').forEach(button => button.addEventListener('click', openDialog));
  document.getElementById('close-dialog').addEventListener('click', closeDialog);
  elements.dialog.addEventListener('click', event => {
    if (event.target === elements.dialog) closeDialog();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !elements.dialog.hidden) closeDialog();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      elements.search.focus();
    }
  });
  elements.uploadForm.addEventListener('submit', uploadSong);
  elements.uploadForm.elements.audio.addEventListener('change', event => {
    elements.fileName.textContent = event.target.files[0]?.name || 'Choose audio';
  });
  elements.search.addEventListener('input', () => {
    state.filter = elements.search.value;
    renderSongs();
  });
  document.getElementById('play-all').addEventListener('click', async () => {
    if (!state.songs.length) {
      openDialog();
      return;
    }
    if (state.currentId == null) await selectSong(state.songs[0].id, true);
    else await togglePlayback();
  });
  elements.playButton.addEventListener('click', togglePlayback);
  document.getElementById('next-button').addEventListener('click', () => moveTrack('next'));
  document.getElementById('previous-button').addEventListener('click', () => moveTrack('previous'));
  document.getElementById('player-delete').addEventListener('click', () => {
    if (state.currentId != null) removeSong(state.currentId);
  });
  elements.shuffle.addEventListener('click', async () => {
    if (state.shuffle) {
      state.shuffle = false;
      renderShuffle();
      showToast('Shuffle mode is off. The current playlist order stays as it is.');
      return;
    }
    try {
      const data = await api('/api/shuffle', { method: 'POST' });
      state.shuffle = true;
      applyPlaylist(data);
      showToast('Playlist shuffled.');
    } catch (error) {
      showToast(error.message, true);
    }
  });
  elements.repeat.addEventListener('click', () => {
    const next = { off: 'all', all: 'one', one: 'off' }[state.repeat] || 'all';
    setRepeat(next);
  });
  document.getElementById('sort-button').addEventListener('click', async () => {
    try {
      applyPlaylist(await api('/api/sort', { method: 'POST' }));
      showToast('Sorted alphabetically by title.');
    } catch (error) {
      showToast(error.message, true);
    }
  });
  document.getElementById('reverse-button').addEventListener('click', async () => {
    try {
      applyPlaylist(await api('/api/reverse', { method: 'POST' }));
      showToast('Playlist order reversed.');
    } catch (error) {
      showToast(error.message, true);
    }
  });
  document.getElementById('clear-button').addEventListener('click', async () => {
    if (!state.songs.length || !window.confirm('Remove every song from your library?')) return;
    const wasSpotify = activeSource === 'spotify';
    try {
      applyPlaylist(await api('/api/playlist', { method: 'DELETE' }));
      elements.audio.pause();
      elements.audio.removeAttribute('src');
      elements.audio.load();
      if (wasSpotify && window.SonoraSpotify) {
        await window.SonoraSpotify.pausePlayback();
      }
      sourceSongId = null;
      showToast('Your library has been cleared.');
    } catch (error) {
      showToast(error.message, true);
    }
  });
  document.getElementById('more-actions').addEventListener('click', () => {
    showToast('Use A–Z, Reverse, or Clear to manage this playlist.');
  });

  if (window.SonoraSpotify) {
    window.SonoraSpotify.init({
      onAddTrack: addSpotifyTrack,
      onPlaybackState: handleSpotifyPlayback,
      onPlaybackError: (message, detail) => showToast(`${message} ${detail}`.trim(), true)
    });
  }

  elements.audio.addEventListener('play', () => {
    if (activeSource !== 'local') return;
    state.playing = true;
    renderPlayButton();
    renderSongs();
  });
  elements.audio.addEventListener('pause', () => {
    if (activeSource !== 'local') return;
    state.playing = false;
    renderPlayButton();
    renderSongs();
  });
  elements.audio.addEventListener('timeupdate', () => {
    if (activeSource !== 'local') return;
    const duration = elements.audio.duration || 0;
    const progress = duration ? elements.audio.currentTime / duration : 0;
    elements.progress.value = String(Math.round(progress * 1000));
    elements.elapsed.textContent = formatTime(elements.audio.currentTime);
    elements.total.textContent = formatTime(duration);
    const percentage = `${progress * 100}%`;
    elements.progress.style.background = `linear-gradient(to right, var(--accent) ${percentage}, #454449 ${percentage})`;
  });
  elements.audio.addEventListener('loadedmetadata', () => {
    if (activeSource !== 'local') return;
    elements.total.textContent = formatTime(elements.audio.duration);
  });
  elements.audio.addEventListener('ended', () => {
    if (activeSource !== 'local') return;
    if (state.repeat === 'one') return;
    moveTrack('next', true);
  });
  elements.audio.addEventListener('error', () => {
    if (activeSource === 'local' && state.currentId != null) {
      showToast('Could not decode this audio file. Try another supported format.', true);
    }
  });
  elements.progress.addEventListener('input', () => {
    if (activeSource === 'spotify') return;
    const duration = elements.audio.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    elements.audio.currentTime = (Number(elements.progress.value) / 1000) * duration;
  });
  elements.progress.addEventListener('change', () => {
    if (activeSource === 'spotify') {
      const duration = Number(lastSpotifyPlayback && lastSpotifyPlayback.duration);
      if (Number.isFinite(duration) && duration > 0 && window.SonoraSpotify) {
        window.SonoraSpotify.seek(
          Math.round((Number(elements.progress.value) / 1000) * duration)
        ).catch(error => showToast(error.message, true));
      }
    }
  });
  elements.volume.addEventListener('input', () => {
    const volume = Number(elements.volume.value) / 100;
    elements.audio.volume = volume;
    if (activeSource === 'spotify' && window.SonoraSpotify) {
      window.SonoraSpotify.setVolume(volume).catch(error => showToast(error.message, true));
    }
    const percent = elements.volume.value;
    elements.volume.style.background = `linear-gradient(to right, var(--accent) ${percent}%, #454449 ${percent}%)`;
  });

  elements.volume.dispatchEvent(new Event('input'));
  renderRepeat();
  refreshPlaylist().catch(error => showToast(error.message, true));
})();
