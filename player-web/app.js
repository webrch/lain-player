/* ================= LAIN PLAYER ================= */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const audio = $('audio');
  const native = !!(window.AndroidBridge && window.AndroidBridge.getSetting);
  const electron = !!(window.ElectronBridge && window.ElectronBridge.pickAudio);
  const DEFAULTS = {
    token: '', clientId: '', wall: 'default', icon: 'cross',
    speed: '1', autoNext: 'true', dark: 'false', library: '', volume: '100', eq: '',
    localTracks: ''
  };
  const WALLS = {
    default: { label: 'Море', file: 'assets/wallpaper/default.jpg' },
    '1': { label: 'Сад', file: 'assets/wallpaper/1.jpg' },
    '2': { label: 'Зима', file: 'assets/wallpaper/2.jpg' }
  };
  const ICONS = {
    cross: { label: 'Крест', file: 'assets/icons/cross-512.png' },
    lain: { label: 'Лейн', file: 'assets/icons/lain-512.png' },
    brown: { label: 'Коричневый', file: 'assets/icons/brown-512.png' }
  };

  const state = {
    settings: Object.assign({}, DEFAULTS),
    results: [], queue: [], index: -1,
    current: null, playing: false, seeking: false,
    shuffle: false, repeat: false, searchTimer: null,
    libTab: 'liked', cbId: 0, callbacks: {}, streamCache: {},
    localTracks: [], hls: null, lastVolume: 100,
    eq: { enabled: false, preset: 'flat', bands: [0,0,0,0,0,0,0,0,0,0], bass: 0, amp: 100 },
    audioCtx: null, eqNodes: [], bassNode: null, ampNode: null,
    repeat: 'off', shuffleOrder: [], shufflePos: -1
  };
  window.__lainLocalFiles = function (json) {
    try {
      const data = JSON.parse(json);
      (data.tracks || []).forEach(t => {
        if (!state.localTracks.some(x => String(x.id) === String(t.id))) state.localTracks.unshift(t);
      });
      saveSetting('localTracks', JSON.stringify(state.localTracks));
      renderLibrary();
      toast('Добавлено файлов: ' + (data.tracks || []).length);
    } catch (e) { toast('Ошибка чтения файлов'); }
  };
  window.__lainCb = function (id, json) {
    const cb = state.callbacks[id];
    if (!cb) return;
    delete state.callbacks[id];
    try { cb(JSON.parse(json)); } catch (e) { cb(null); }
  };
  function callNative(method, args) {
    return new Promise((resolve) => {
      if (!native || !window.AndroidBridge[method]) return resolve(null);
      const id = 'cb' + (++state.cbId);
      state.callbacks[id] = resolve;
      try { window.AndroidBridge[method].apply(window.AndroidBridge, args.concat([id])); }
      catch (e) { delete state.callbacks[id]; resolve(null); }
    });
  }

  /* ---------- media session (shade / lock screen) ---------- */
  window.__lainMediaControl = function (action, value) {
    switch (action) {
      case 'play': if (!state.playing) togglePlay(); break;
      case 'pause': if (state.playing) togglePlay(); break;
      case 'toggle': togglePlay(); break;
      case 'next': next(false); break;
      case 'prev': prev(); break;
      case 'seek':
        if (audio.duration && value != null) audio.currentTime = (Number(value) || 0) / 1000;
        break;
    }
  };
  let lastMediaPush = 0;
  function pushMediaState(force) {
    if (!native || !window.AndroidBridge.updateMedia) return;
    const now = Date.now();
    if (!force && now - lastMediaPush < 1500) return;
    lastMediaPush = now;
    const t = state.current;
    if (!t) { window.AndroidBridge.stopMedia(); return; }
    const dur = Math.round((audio.duration || t.duration || 0) * 1000);
    const pos = Math.round((audio.currentTime || 0) * 1000);
    window.AndroidBridge.updateMedia(
      t.title || 'LAIN', t.artist || 'Лейн', t.art || '',
      dur, state.playing, pos, parseFloat(state.settings.speed) || 1
    );
  }

  /* ---------- storage ---------- */
  function loadSettings() {
    const local = {};
    Object.keys(DEFAULTS).forEach(k => {
      try { local[k] = localStorage.getItem('lain_' + k); } catch (e) {}
    });
    Object.keys(DEFAULTS).forEach(k => {
      let v = native ? window.AndroidBridge.getSetting(k) : local[k];
      state.settings[k] = (v === null || v === undefined || v === '') ? DEFAULTS[k] : v;
    });
  }
  function saveSetting(key, value) {
    state.settings[key] = String(value);
    try { localStorage.setItem('lain_' + key, value); } catch (e) {}
    if (native) window.AndroidBridge.setSetting(key, String(value));
  }
  function loadLibrary() {
    try {
      const raw = state.settings.library;
      if (raw) {
        const lib = JSON.parse(raw);
        state.liked = lib.liked || [];
        state.recent = lib.recent || [];
        state.playlists = lib.playlists || [];
        return;
      }
    } catch (e) {}
    state.liked = []; state.recent = []; state.playlists = [];
  }
  function saveLibrary() {
    saveSetting('library', JSON.stringify({ liked: state.liked, recent: state.recent, playlists: state.playlists }));
    saveSetting('localTracks', JSON.stringify(state.localTracks));
    renderLibrary();
  }

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }
  function art(track) {
    if (!track) return 'assets/icons/cross-512.png';
    return track.art || 'assets/icons/cross-512.png';
  }
  function normalize(t) {
    let a = t.artwork_url || (t.user && t.user.avatar_url) || '';
    if (a) a = a.replace('-large.', '-t500x500.');
    return {
      id: t.id,
      title: t.title || 'Без названия',
      artist: (t.user && t.user.username) || t.publisher_metadata?.artist || 'Неизвестный',
      duration: Math.round((t.duration || 0) / 1000),
      art: a,
      uri: t.uri || '',
      likes: t.likes_count || 0,
      genre: t.genre || ''
    };
  }

  /* ---------- SoundCloud API ---------- */
  async function apiSearch(query) {
    const token = state.settings.token.trim();
    const client = state.settings.clientId.trim();
    if (!token && !client) throw new Error('Укажи токен в настройках');
    if (native) {
      const r = await callNative('search', [query, token, client]);
      if (!r) throw new Error('Ошибка запроса к SoundCloud');
      if (r.error) throw new Error(r.error);
      return (r.items || []).map(normalize);
    }
    let url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&limit=30`;
    if (client) url += `&client_id=${encodeURIComponent(client)}`;
    const headers = token ? { 'Authorization': 'OAuth ' + token } : {};
    let res = await fetch(url, { headers });
    if (!res.ok) throw new Error('Ошибка API: ' + res.status + ' (CORS?)');
    const data = await res.json();
    return (data.collection || data || []).map(normalize);
  }

  async function resolveStream(track) {
    if (track.local) return track.uri;
    if (state.streamCache[track.id]) return state.streamCache[track.id];
    const token = state.settings.token.trim();
    const client = state.settings.clientId.trim();
    if (native) {
      const r = await callNative('resolveStream', [String(track.id), token, client]);
      if (r && r.url) { state.streamCache[track.id] = r.url; return r.url; }
      throw new Error((r && r.error) || 'Не удалось получить поток');
    }
    const headers = token ? { 'Authorization': 'OAuth ' + token } : {};
    let infoUrl = `https://api-v2.soundcloud.com/tracks/${track.id}`;
    if (client) infoUrl += `?client_id=${encodeURIComponent(client)}`;
    const infoRes = await fetch(infoUrl, { headers });
    if (!infoRes.ok) throw new Error('Трек недоступен: ' + infoRes.status);
    const info = await infoRes.json();
    const transcodings = info.media && info.media.transcodings;
    if (!transcodings || !transcodings.length) throw new Error('У трека нет доступного потока');
    const best = transcodings.slice().sort((a, b) => {
      const q = t => (t.preset === 'aac_160k' ? 2 : t.quality === 'sq' ? 1 : 0);
      return q(b) - q(a);
    })[0];
    let mediaUrl = best.url;
    if (client) mediaUrl += (mediaUrl.includes('?') ? '&' : '?') + 'client_id=' + encodeURIComponent(client);
    const mediaRes = await fetch(mediaUrl, { headers });
    if (!mediaRes.ok) throw new Error('Поток недоступен: ' + mediaRes.status);
    const final = (await mediaRes.json()).url;
    if (!final) throw new Error('Не удалось получить ссылку на поток');
    state.streamCache[track.id] = final;
    return final;
  }

  async function importFromSoundCloud(kind) {
    const token = state.settings.token.trim();
    if (!token) { toast('Сначала укажи токен в настройках'); navigate('settings'); return; }
    if (!native || !window.AndroidBridge.importFromSoundCloud) {
      toast('Импорт доступен в Android-приложении'); return;
    }
    toast(kind === 'likes' ? 'Импортируем лайки...' : 'Импортируем плейлисты...');
    const r = await callNative('importFromSoundCloud', [kind, token, state.settings.clientId.trim()]);
    if (!r) { toast('Не удалось импортировать'); return; }
    if (r.error) { toast(r.error); return; }
    const items = (r.items || []).map(normalize);
    if (kind === 'likes') {
      const ids = new Set(state.liked.map(x => String(x.id)));
      items.forEach(t => { if (!ids.has(String(t.id))) state.liked.push(t); });
      saveLibrary();
      toast('Импортировано лайков: ' + items.length);
    } else {
      const lists = (r.playlists || []).map(p => ({
        id: 'sc_' + p.id,
        name: p.title || 'Плейлист SoundCloud',
        tracks: (p.tracks || []).filter(t => t && t.id).map(normalize)
      })).filter(p => p.tracks.length);
      state.playlists = lists.concat(state.playlists.filter(p => !String(p.id).startsWith('sc_')));
      saveLibrary();
      toast('Импортировано плейлистов: ' + lists.length);
    }
    renderLibrary();
  }

  /* ---------- player ---------- */
  function setQueue(list, startIndex) {
    state.queue = list.slice();
    state.index = startIndex;
    if (state.shuffle) reshuffle();
    playCurrent();
  }
  async function playCurrent() {
    const t = state.queue[state.index];
    if (!t) return;
    state.current = t;
    updateTrackUI();
    renderAllLists();
    $('miniPlayer').classList.remove('hidden');
    toast('Загрузка: ' + t.title);
    try {
      const url = await resolveStream(t);
      if (state.current && state.current.id !== t.id) return;
      if (state.hls) { state.hls.destroy(); state.hls = null; }
      audio.removeAttribute('src');
      if (url.includes('.m3u8') && window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls({ enableWorker: true });
        state.hls = hls;
        hls.loadSource(url);
        hls.attachMedia(audio);
        await new Promise((resolve, reject) => {
          let done = false;
          const finish = (err) => { if (done) return; done = true; err ? reject(err) : resolve(); };
          hls.on(window.Hls.Events.MANIFEST_PARSED, () => finish());
          hls.on(window.Hls.Events.ERROR, (_e, data) => { if (data && data.fatal) finish(new Error('HLS: ' + data.type)); });
          setTimeout(() => finish(), 7000);
        });
      } else {
        audio.src = url;
      }
      audio.playbackRate = parseFloat(state.settings.speed) || 1;
      await audio.play();
      state.playing = true;
      updatePlayIcons();
      addRecent(t);
    } catch (e) {
      toast(e.message || 'Не удалось воспроизвести');
      state.playing = false; updatePlayIcons();
    }
  }
  function togglePlay() {
    if (!state.current) { toast('Сначала выбери трек'); return; }
    if (audio.paused) {
      audio.play().then(() => { state.playing = true; updatePlayIcons(); })
        .catch(() => toast('Нажми ещё раз для воспроизведения'));
    } else { audio.pause(); state.playing = false; updatePlayIcons(); }
  }
  function reshuffle() {
    const n = state.queue.length;
    state.shuffleOrder = Array.from({ length: n }, (_, i) => i).filter(i => i !== state.index);
    for (let i = state.shuffleOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.shuffleOrder[i], state.shuffleOrder[j]] = [state.shuffleOrder[j], state.shuffleOrder[i]];
    }
    state.shufflePos = -1;
  }
  function next(auto) {
    if (!state.queue.length) return;
    if (auto && state.repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
    let i;
    if (state.shuffle) {
      if (state.shufflePos >= state.shuffleOrder.length - 1) reshuffle();
      i = state.shuffleOrder[++state.shufflePos];
      if (i === undefined) i = state.index;
    } else {
      i = state.index + 1;
    }
    if (i >= state.queue.length) {
      if (state.repeat === 'all' || !auto) i = 0;
      else { audio.pause(); state.playing = false; updatePlayIcons(); return; }
    }
    state.index = i; playCurrent();
  }
  function prev() {
    if (!state.queue.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    if (state.shuffle && state.shufflePos > 0) {
      state.index = state.shuffleOrder[--state.shufflePos];
    } else {
      state.index = (state.index - 1 + state.queue.length) % state.queue.length;
      if (state.shuffle) reshuffle();
    }
    playCurrent();
  }
  function setSpeed(v) {
    saveSetting('speed', v);
    audio.playbackRate = parseFloat(v);
    $('speedSub').textContent = parseFloat(v).toFixed(2).replace(/0$/, '') + '×';
    document.querySelectorAll('#speedChips button').forEach(b => b.classList.toggle('active', b.dataset.speed == v));
    $('speedSetting').value = v;
    paintRange($('speedSetting'));
    pushMediaState(true);
  }

  function setVolume(v, persist) {
    const value = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    audio.volume = value / 100;
    if (value > 0) state.lastVolume = value;
    $('volumeBar').value = value;
    $('volValue').textContent = value + '%';
    $('muteBtn').classList.toggle('muted', value === 0);
    paintRange($('volumeBar'));
    if (persist !== false) saveSetting('volume', value);
  }

  const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const EQ_PRESETS = {
    flat:       [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bass:       [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
    vocal:      [-2, -1, 0, 2, 4, 5, 4, 2, 0, -1],
    electronic: [5, 4, 2, 0, -1, 2, 4, 5, 4, 3],
    night:      [4, 3, 2, 1, 0, -1, -2, -3, -4, -5],
    rock:       [4, 3, 1, -1, -2, 1, 3, 4, 4, 3]
  };

  function initAudioGraph() {
    if (state.audioCtx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) { toast('Web Audio недоступен'); return; }
      const ctx = new Ctx();
      state.audioCtx = ctx;
      const src = ctx.createMediaElementSource(audio);

      const bass = ctx.createBiquadFilter();
      bass.type = 'lowshelf'; bass.frequency.value = 120;
      state.bassNode = bass;

      state.eqNodes = EQ_FREQS.map(f => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'peaking'; filter.frequency.value = f; filter.Q.value = 1;
        return filter;
      });

      const amp = ctx.createGain();
      state.ampNode = amp;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.25;

      let node = src;
      node.connect(bass); node = bass;
      state.eqNodes.forEach(f => { node.connect(f); node = f; });
      node.connect(amp); amp.connect(comp); comp.connect(ctx.destination);
      applyEq();
    } catch (e) { toast('Не удалось включить эквалайзер'); }
  }
  function applyEq() {
    if (!state.audioCtx) return;
    const e = state.eq;
    state.eqNodes.forEach((n, i) => { n.gain.value = e.enabled ? e.bands[i] : 0; });
    state.bassNode.gain.value = e.enabled ? e.bass : 0;
    state.ampNode.gain.value = e.enabled ? e.amp / 100 : 1;
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume().catch(() => {});
  }
  function saveEq() { saveSetting('eq', JSON.stringify(state.eq)); applyEq(); }
  function renderEq() {
    $('eqToggle').classList.toggle('active', state.eq.enabled);
    $('bassBar').value = state.eq.bass;
    $('bassSub').textContent = state.eq.bass + ' дБ';
    $('ampBar').value = state.eq.amp;
    $('ampSub').textContent = (state.eq.amp / 100).toFixed(2).replace(/0$/, '') + '×';
    paintRange($('bassBar')); paintRange($('ampBar'));
    $('eqPresets').innerHTML = Object.keys(EQ_PRESETS).map(p =>
      `<button data-preset="${p}" class="${state.eq.preset === p ? 'active' : ''}">${p === 'flat' ? 'Плоский' : p === 'bass' ? 'Бас' : p === 'vocal' ? 'Вокал' : p === 'electronic' ? 'Электроника' : p === 'night' ? 'Ночь' : 'Рок'}</button>`).join('');
    $('eqBands').innerHTML = EQ_FREQS.map((f, i) =>
      `<div class="eq-band"><input type="range" min="-12" max="12" step="1" value="${state.eq.bands[i]}" data-band="${i}" aria-label="${f} Гц"><span>${f >= 1000 ? f / 1000 + 'k' : f}</span></div>`).join('');
    $('eqBands').querySelectorAll('[data-band]').forEach(el => paintRange(el));
  }

  function updatePlayIcons() {
    const path = state.playing ? 'M6 5h4v14H6V5Zm8 0h4v14h-4V5Z' : 'M8 5v14l11-7z';
    $('playIcon').innerHTML = `<path d="${path}"/>`;
    $('miniPlayIcon').innerHTML = `<path d="${path}"/>`;
    pushMediaState(true);
  }
  function updateTrackUI() {
    const t = state.current;
    $('playerTitle').textContent = t ? t.title : 'Ничего не играет';
    $('playerArtist').textContent = t ? t.artist : 'LAIN';
    $('miniTitle').textContent = t ? t.title : 'Ничего не играет';
    $('miniArtist').textContent = t ? t.artist : 'LAIN';
    $('playerArt').src = art(t);
    $('miniArt').src = art(t);
    $('sourceBadge').textContent = t && t.local ? 'ЛОКАЛЬНЫЙ ФАЙЛ' : 'SOUNDCLOUD';
    $('likeBtn').classList.toggle('liked', !!(t && isLiked(t)));
    $('curTime').textContent = '0:00'; $('durTime').textContent = t ? fmt(t.duration) : '0:00';
    pushMediaState(true);
  }
  function isLiked(t) { return state.liked.some(x => String(x.id) === String(t.id)); }
  function toggleLike(t) {
    if (!t) return;
    if (isLiked(t)) state.liked = state.liked.filter(x => String(x.id) !== String(t.id));
    else state.liked.unshift({ id: t.id, title: t.title, artist: t.artist, art: t.art, duration: t.duration });
    saveLibrary(); updateTrackUI(); toast(isLiked(t) ? 'Добавлено в любимое ♥' : 'Удалено из любимого');
  }
  function addRecent(t) {
    state.recent = state.recent.filter(x => String(x.id) !== String(t.id));
    state.recent.unshift({ id: t.id, title: t.title, artist: t.artist, art: t.art, duration: t.duration });
    state.recent = state.recent.slice(0, 50);
    saveLibrary();
  }

  audio.addEventListener('timeupdate', () => {
    if (state.seeking) return;
    const pct = audio.duration ? (audio.currentTime / audio.duration) : 0;
    $('seekBar').value = Math.round(pct * 1000);
    paintRange($('seekBar'));
    $('miniProgressBar').style.width = (pct * 100) + '%';
    $('curTime').textContent = fmt(audio.currentTime);
    if (audio.duration) $('durTime').textContent = fmt(audio.duration);
    pushMediaState(false);
  });
  audio.addEventListener('ended', () => next(true));
  audio.addEventListener('play', () => { state.playing = true; updatePlayIcons(); });
  audio.addEventListener('pause', () => { state.playing = false; updatePlayIcons(); });
  function paintRange(el) {
    const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
    el.style.setProperty('--pct', pct + '%');
    if (el.id === 'seekBar' && el.parentElement) el.parentElement.style.setProperty('--progress', pct);
  }

  /* ---------- rendering ---------- */
  function trackHTML(t, i, listName) {
    const playing = state.current && String(state.current.id) === String(t.id) && state.playing;
    return `<div class="track ${playing ? 'playing' : ''}" data-list="${listName}" data-i="${i}">
      <img class="track-art" src="${esc(art(t))}" alt="" loading="lazy">
      <div class="track-meta">
        <div class="track-title">${esc(t.title)}</div>
        <div class="track-artist">${esc(t.artist)}</div>
      </div>
      <div class="track-right">
        <button class="track-like ${isLiked(t) ? 'liked' : ''}" data-like="${i}" data-list="${listName}" aria-label="Нравится">
          <svg viewBox="0 0 24 24"><path d="M12 21 3.6 12.6a5 5 0 0 1 7.1-7.1l1.3 1.3 1.3-1.3a5 5 0 0 1 7.1 7.1L12 21Z"/></svg>
        </button>
        <span class="track-dur">${t.duration ? fmt(t.duration) : '--:--'}</span>
      </div>
    </div>`;
  }
  function bindList(container, list) {
    container.innerHTML = list.map((t, i) => trackHTML(t, i, container.id)).join('');
    container.querySelectorAll('.track').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-like]')) return;
        setQueue(list, parseInt(el.dataset.i, 10));
        openPlayer();
      });
    });
    container.querySelectorAll('[data-like]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLike(list[parseInt(btn.dataset.like, 10)]);
      });
    });
  }
  function renderSearch() {
    const c = $('searchResults');
    bindList(c, state.results);
    $('resultsCount').textContent = state.results.length ? state.results.length + ' результатов' : '';
    $('searchEmpty').style.display = state.results.length ? 'none' : 'block';
    $('skeleton').classList.remove('show');
  }
  function renderLibrary() {
    bindList($('likedList'), state.liked);
    bindList($('recentList'), state.recent);
    bindList($('localList'), state.localTracks);
    $('localCount').textContent = state.localTracks.length + ' ' + plural(state.localTracks.length) + ' на устройстве';
    $('localEmpty').style.display = state.localTracks.length ? 'none' : 'block';
    $('likedCount').textContent = state.liked.length + ' ' + plural(state.liked.length);
    $('likedEmpty').style.display = state.liked.length ? 'none' : 'block';
    $('recentEmpty').style.display = state.recent.length ? 'none' : 'block';
    const grid = $('playlistGrid');
    grid.innerHTML = state.playlists.map((p, i) => `<div class="pl-card" data-pl="${i}">
      <div class="pl-card-art">${esc(p.name.charAt(0).toUpperCase())}</div>
      <div class="pl-card-name">${esc(p.name)}</div>
      <div class="pl-card-count">${p.tracks.length} ${plural(p.tracks.length)}</div>
    </div>`).join('');
    grid.querySelectorAll('[data-pl]').forEach(el => el.addEventListener('click', () => {
      const p = state.playlists[parseInt(el.dataset.pl, 10)];
      if (p.tracks.length) { setQueue(p.tracks, 0); openPlayer(); }
      else toast('Плейлист пуст');
    }));
  }
  function plural(n) {
    const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return 'трек';
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'трека';
    return 'треков';
  }
  function renderAllLists() { renderSearch(); renderLibrary(); }

  function renderPresets() {
    const w = $('wallpaperPresets');
    w.innerHTML = Object.entries(WALLS).map(([k, v]) => `<button class="preset wall ${state.settings.wall === k ? 'active' : ''}" data-wall="${k}">
      <img class="preset-img" src="${v.file}" alt=""><span class="preset-name">${v.label}</span></button>`).join('');
    w.querySelectorAll('[data-wall]').forEach(b => b.addEventListener('click', async () => {
      const k = b.dataset.wall;
      saveSetting('wall', k); applyWallpaper(); renderPresets();
      if (native && window.AndroidBridge.setSystemWallpaper) {
        window.AndroidBridge.setSystemWallpaper(k);
        toast('Обои применены');
      } else toast('Обои применены в плеере');
    }));
    const ic = $('iconPresets');
    ic.innerHTML = Object.entries(ICONS).map(([k, v]) => `<button class="preset ${state.settings.icon === k ? 'active' : ''}" data-icon="${k}">
      <img class="preset-img" src="${v.file}" alt=""><span class="preset-name">${v.label}</span></button>`).join('');
    ic.querySelectorAll('[data-icon]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.icon;
      saveSetting('icon', k); renderPresets(); applyIcon();
      if (native && window.AndroidBridge.setIcon) window.AndroidBridge.setIcon(k);
      toast('Иконка: ' + ICONS[k].label);
    }));
  }
  function applyWallpaper() {
    const url = 'url("' + (WALLS[state.settings.wall] || WALLS.default).file + '")';
    document.documentElement.style.setProperty('--wall', url);
  }
  function applyIcon() { $('brandIcon').src = (ICONS[state.settings.icon] || ICONS.cross).file; }
  function applyTheme() {
    document.body.classList.toggle('dark', state.settings.dark === 'true');
    $('darkSwitch').classList.toggle('active', state.settings.dark === 'true');
  }

  /* ---------- navigation ---------- */
  function navigate(name) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
  }
  function openPlayer() { $('playerSheet').classList.add('open'); }
  function closePlayer() { $('playerSheet').classList.remove('open'); }

  /* ---------- events ---------- */
  document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('click', () => navigate(b.dataset.nav)));
  $('btnSettings').addEventListener('click', () => navigate('settings'));
  $('btnTheme').addEventListener('click', () => {
    const v = state.settings.dark === 'true' ? 'false' : 'true';
    saveSetting('dark', v); applyTheme();
  });
  $('darkSwitch').addEventListener('click', () => {
    const v = state.settings.dark === 'true' ? 'false' : 'true';
    saveSetting('dark', v); applyTheme();
  });
  $('miniPlayer').addEventListener('click', (e) => { if (!e.target.closest('button')) openPlayer(); });
  $('closePlayer').addEventListener('click', closePlayer);
  $('playerHandle').addEventListener('click', closePlayer);
  $('miniPlay').addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); });
  $('miniNext').addEventListener('click', (e) => { e.stopPropagation(); next(false); });
  $('playBtn').addEventListener('click', togglePlay);
  $('nextBtn').addEventListener('click', () => next(false));
  $('prevBtn').addEventListener('click', prev);
  $('likeBtn').addEventListener('click', () => toggleLike(state.current));
  $('shuffleBtn').addEventListener('click', () => {
    state.shuffle = !state.shuffle;
    $('shuffleBtn').classList.toggle('on', state.shuffle);
    if (state.shuffle) reshuffle();
    toast(state.shuffle ? 'Shuffle включён' : 'Shuffle выключен');
  });
  $('repeatBtn').addEventListener('click', () => {
    state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
    const btn = $('repeatBtn');
    btn.classList.toggle('on', state.repeat !== 'off');
    btn.classList.toggle('one', state.repeat === 'one');
    toast(state.repeat === 'off' ? 'Повтор выключен' : state.repeat === 'all' ? 'Повтор очереди' : 'Повтор трека');
  });
  $('eqBtn').addEventListener('click', () => {
    renderEq();
    $('eqSheet').classList.add('open');
    if (state.eq.enabled) initAudioGraph();
  });
  $('eqBackdrop').addEventListener('click', () => $('eqSheet').classList.remove('open'));
  $('eqClose').addEventListener('click', () => $('eqSheet').classList.remove('open'));
  $('eqToggle').addEventListener('click', () => {
    state.eq.enabled = !state.eq.enabled;
    if (state.eq.enabled) initAudioGraph();
    $('eqToggle').classList.toggle('active', state.eq.enabled);
    saveEq();
    toast(state.eq.enabled ? 'Эквалайзер включён' : 'Эквалайзер выключен');
  });
  $('eqPresets').addEventListener('click', e => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    state.eq.preset = b.dataset.preset;
    state.eq.bands = EQ_PRESETS[state.eq.preset].slice();
    saveEq(); renderEq();
    toast('Пресет: ' + b.textContent);
  });
  $('eqBands').addEventListener('input', e => {
    const el = e.target.closest('[data-band]');
    if (!el) return;
    state.eq.bands[Number(el.dataset.band)] = Number(el.value);
    state.eq.preset = 'custom';
    paintRange(el); saveEq();
  });
  $('bassBar').addEventListener('input', e => {
    state.eq.bass = Number(e.target.value);
    $('bassSub').textContent = state.eq.bass + ' дБ';
    paintRange(e.target); saveEq();
  });
  $('ampBar').addEventListener('input', e => {
    state.eq.amp = Number(e.target.value);
    $('ampSub').textContent = (state.eq.amp / 100).toFixed(2).replace(/0$/, '') + '×';
    paintRange(e.target); saveEq();
  });
  $('seekBar').addEventListener('input', (e) => {
    state.seeking = true; paintRange(e.target);
    const dur = audio.duration || (state.current ? state.current.duration : 0);
    $('curTime').textContent = fmt(dur * e.target.value / 1000);
  });
  $('seekBar').addEventListener('change', (e) => {
    const dur = audio.duration || 0;
    if (dur) audio.currentTime = dur * e.target.value / 1000;
    state.seeking = false;
    pushMediaState(true);
  });
  $('volumeBar').addEventListener('input', e => setVolume(e.target.value));
  $('muteBtn').addEventListener('click', () => {
    const current = Number($('volumeBar').value);
    setVolume(current > 0 ? 0 : (state.lastVolume || 100));
  });
  $('speedChips').addEventListener('click', e => { const b = e.target.closest('[data-speed]'); if (b) setSpeed(b.dataset.speed); });
  $('speedSetting').addEventListener('input', e => setSpeed(e.target.value));

  document.querySelectorAll('[data-lib]').forEach(b => b.addEventListener('click', () => {
    state.libTab = b.dataset.lib;
    document.querySelectorAll('.lib-tab').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('.lib-pane').forEach(p => p.classList.toggle('active', p.id === 'lib-' + state.libTab));
  }));
  document.querySelectorAll('[data-genre]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === b));
    $('searchInput').value = b.dataset.genre;
    doSearch();
  }));
  $('searchInput').addEventListener('input', e => {
    $('clearSearch').classList.toggle('show', !!e.target.value);
    clearTimeout(state.searchTimer);
    if (!e.target.value.trim()) { state.results = []; renderSearch(); $('resultsTitle').textContent = 'Для тебя'; return; }
    state.searchTimer = setTimeout(doSearch, 550);
  });
  $('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(state.searchTimer); doSearch(); } });
  $('clearSearch').addEventListener('click', () => { $('searchInput').value = ''; $('clearSearch').classList.remove('show'); state.results = []; renderSearch(); });
  $('playLiked').addEventListener('click', () => { if (state.liked.length) { setQueue(state.liked, 0); openPlayer(); } else toast('Сначала добавь треки в любимое'); });
  $('newPlaylist').addEventListener('click', () => {
    const name = prompt('Название плейлиста');
    if (!name) return;
    state.playlists.unshift({ id: Date.now(), name: name.trim(), tracks: [] });
    saveLibrary(); toast('Плейлист создан');
  });

  async function doSearch() {
    const q = $('searchInput').value.trim();
    if (!q) return;
    $('resultsTitle').textContent = 'Поиск: ' + q;
    $('searchEmpty').style.display = 'none';
    $('skeleton').classList.add('show');
    $('searchResults').innerHTML = '';
    try {
      state.results = await apiSearch(q);
      renderSearch();
      if (!state.results.length) $('searchEmptyText').textContent = 'Ничего не найдено. Попробуй другой запрос.';
    } catch (e) {
      $('skeleton').classList.remove('show');
      $('searchEmpty').style.display = 'block';
      $('searchEmptyText').textContent = e.message || 'Ошибка поиска';
      toast(e.message || 'Ошибка поиска');
    }
  }

  /* local files + updates */
  $('pickAudio').addEventListener('click', async () => {
    if (native && window.AndroidBridge.pickAudio) {
      window.AndroidBridge.pickAudio();
      return;
    }
    if (electron) {
      const tracks = await window.ElectronBridge.pickAudio();
      if (!tracks || !tracks.length) return;
      tracks.forEach(t => {
        if (!state.localTracks.some(x => String(x.id) === String(t.id))) state.localTracks.unshift(t);
      });
      saveSetting('localTracks', JSON.stringify(state.localTracks));
      renderLibrary();
      toast('Добавлено файлов: ' + tracks.length);
      return;
    }
    toast('Выбор файлов доступен в Android и desktop-приложении');
  });
  async function checkUpdates(silent) {
    const el = $('updateStatus');
    if (!native || !window.AndroidBridge.checkUpdate) {
      if (electron) {
        if (!silent) el.textContent = 'Проверяем GitHub...';
        try {
          const res = await fetch('https://api.github.com/repos/webrch/lain-player/releases/latest');
          if (res.status === 404) { el.textContent = 'Релизов пока нет'; return; }
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const d = await res.json();
          window.__lainUpdateUrl = d.html_url || '';
          const v = d.tag_name || '';
          el.innerHTML = v
            ? 'Релиз <b>' + esc(v) + '</b>' + (v !== 'v1.0' ? ' — доступно обновление' : ' — у тебя актуальная версия')
            : 'Релизов пока нет';
        } catch (e) { el.textContent = 'Не удалось проверить'; }
      } else {
        el.textContent = 'Доступно в Android и desktop-приложении';
      }
      return;
    }
    if (!silent) el.textContent = 'Проверяем GitHub...';
    const r = await callNative('checkUpdate', []);
    if (!r) { el.textContent = 'Не удалось проверить'; return; }
    if (r.error) { el.textContent = r.error; return; }
    window.__lainUpdateUrl = r.url || '';
    const newer = r.version && r.version.replace(/[^0-9.]/g, '') !== '1.0';
    el.innerHTML = r.version
      ? 'Релиз <b>' + esc(r.version) + '</b>' + (newer ? ' — доступно обновление' : ' — у тебя актуальная версия')
      : 'Релизов пока нет';
    if (newer && !silent) toast('Доступно обновление ' + r.version);
  }
  $('checkUpdate').addEventListener('click', () => checkUpdates(false));
  $('openRelease').addEventListener('click', () => {
    if (window.__lainUpdateUrl && native && window.AndroidBridge.openUrl) window.AndroidBridge.openUrl(window.__lainUpdateUrl);
    else if (window.__lainUpdateUrl && electron) window.ElectronBridge.openUrl(window.__lainUpdateUrl);
    else toast('Сначала проверь обновления');
  });

  /* settings */
  $('toggleToken').addEventListener('click', () => {
    const i = $('tokenInput');
    const show = i.type === 'password';
    i.type = show ? 'text' : 'password';
    $('toggleToken').textContent = show ? 'Скрыть' : 'Показать';
  });
  $('saveToken').addEventListener('click', async () => {
    saveSetting('token', $('tokenInput').value.trim());
    saveSetting('clientId', $('clientInput').value.trim());
    const st = $('tokenStatus');
    st.className = 'hint'; st.textContent = 'Проверяем подключение...';
    try {
      const r = await apiSearch('test');
      st.className = 'hint ok';
      st.textContent = 'Подключено ✓ найдено ' + r.length + ' треков';
      toast('Токен сохранён');
    } catch (e) {
      st.className = 'hint err';
      st.textContent = 'Ошибка: ' + e.message;
      toast('Проверь токен');
    }
  });

  $('importLikes').addEventListener('click', () => importFromSoundCloud('likes'));
  $('importPlaylists').addEventListener('click', () => importFromSoundCloud('playlists'));

  /* ---------- init ---------- */
  loadSettings();
  loadLibrary();
  try { state.localTracks = JSON.parse(state.settings.localTracks || '[]') || []; } catch (e) { state.localTracks = []; }
  try { Object.assign(state.eq, JSON.parse(state.settings.eq || '{}')); } catch (e) {}
  $('tokenInput').value = state.settings.token;
  $('clientInput').value = state.settings.clientId;
  $('speedSetting').value = state.settings.speed;
  setSpeed(state.settings.speed);
  setVolume(state.settings.volume, false);
  $('autoNextSwitch').classList.toggle('active', state.settings.autoNext === 'true');
  $('autoNextSwitch').addEventListener('click', () => {
    const v = state.settings.autoNext === 'true' ? 'false' : 'true';
    saveSetting('autoNext', v); $('autoNextSwitch').classList.toggle('active', v === 'true');
  });
  applyTheme(); applyWallpaper(); applyIcon(); renderPresets(); renderLibrary(); renderSearch();
  paintRange($('seekBar'));
  $('tokenStatus').textContent = state.settings.token ? 'Токен сохранён ✓' : 'Токен не задан';
  if ('serviceWorker' in navigator && !native) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (native || electron) setTimeout(() => checkUpdates(true), 300);
})();
