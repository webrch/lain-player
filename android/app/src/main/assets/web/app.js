/* ================= LAIN PLAYER ================= */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const audio = $('audio');
  const native = !!(window.AndroidBridge && window.AndroidBridge.getSetting);
  const DEFAULTS = {
    token: '', clientId: '', wall: 'default', icon: 'cross',
    speed: '1', autoNext: 'true', dark: 'false', library: '',
    localTracks: '', ghRepo: ''
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
    localTracks: [], hls: null
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

  /* ---------- player ---------- */
  function setQueue(list, startIndex) {
    state.queue = list.slice();
    state.index = startIndex;
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
  function next(auto) {
    if (!state.queue.length) return;
    if (auto && state.repeat) { audio.currentTime = 0; audio.play(); return; }
    let i = state.index + 1;
    if (state.shuffle) i = Math.floor(Math.random() * state.queue.length);
    if (i >= state.queue.length) {
      if (auto) { audio.pause(); state.playing = false; updatePlayIcons(); return; }
      i = 0;
    }
    state.index = i; playCurrent();
  }
  function prev() {
    if (!state.queue.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    state.index = (state.index - 1 + state.queue.length) % state.queue.length;
    playCurrent();
  }
  function setSpeed(v) {
    saveSetting('speed', v);
    audio.playbackRate = parseFloat(v);
    $('speedSub').textContent = parseFloat(v).toFixed(2).replace(/0$/, '') + '×';
    document.querySelectorAll('#speedChips button').forEach(b => b.classList.toggle('active', b.dataset.speed == v));
    $('speedSetting').value = v;
    paintRange($('speedSetting'));
  }

  function updatePlayIcons() {
    const path = state.playing ? 'M6 5h4v14H6V5Zm8 0h4v14h-4V5Z' : 'M8 5v14l11-7z';
    $('playIcon').innerHTML = `<path d="${path}"/>`;
    $('miniPlayIcon').innerHTML = `<path d="${path}"/>`;
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
  $('shuffleBtn').addEventListener('click', () => { state.shuffle = !state.shuffle; $('shuffleBtn').classList.toggle('on', state.shuffle); toast(state.shuffle ? 'Перемешивание включено' : 'Перемешивание выключено'); });
  $('repeatBtn').addEventListener('click', () => { state.repeat = !state.repeat; $('repeatBtn').classList.toggle('on', state.repeat); toast(state.repeat ? 'Повтор включён' : 'Повтор выключен'); });
  $('playerMore').addEventListener('click', () => toast('LAIN · 「接続」'));
  $('seekBar').addEventListener('input', (e) => {
    state.seeking = true; paintRange(e.target);
    const dur = audio.duration || (state.current ? state.current.duration : 0);
    $('curTime').textContent = fmt(dur * e.target.value / 1000);
  });
  $('seekBar').addEventListener('change', (e) => {
    const dur = audio.duration || 0;
    if (dur) audio.currentTime = dur * e.target.value / 1000;
    state.seeking = false;
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
  $('pickAudio').addEventListener('click', () => {
    if (!native || !window.AndroidBridge.pickAudio) {
      toast('Выбор файлов доступен в Android-приложении');
      return;
    }
    window.AndroidBridge.pickAudio();
  });
  async function checkUpdates(silent) {
    const el = $('updateStatus');
    if (!native || !window.AndroidBridge.checkUpdate) {
      el.textContent = 'Доступно в Android-приложении';
      return;
    }
    if (!silent) el.textContent = 'Проверяем GitHub...';
    const r = await callNative('checkUpdate', [state.settings.ghRepo.trim()]);
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

  /* ---------- init ---------- */
  loadSettings();
  loadLibrary();
  try { state.localTracks = JSON.parse(state.settings.localTracks || '[]') || []; } catch (e) { state.localTracks = []; }
  $('tokenInput').value = state.settings.token;
  $('clientInput').value = state.settings.clientId;
  $('repoInput').value = state.settings.ghRepo;
  $('repoInput').addEventListener('change', e => {
    saveSetting('ghRepo', e.target.value.trim());
    checkUpdates(false);
  });
  $('speedSetting').value = state.settings.speed;
  setSpeed(state.settings.speed);
  $('autoNextSwitch').classList.toggle('active', state.settings.autoNext === 'true');
  $('autoNextSwitch').addEventListener('click', () => {
    const v = state.settings.autoNext === 'true' ? 'false' : 'true';
    saveSetting('autoNext', v); $('autoNextSwitch').classList.toggle('active', v === 'true');
  });
  applyTheme(); applyWallpaper(); applyIcon(); renderPresets(); renderLibrary(); renderSearch();
  paintRange($('seekBar'));
  $('tokenStatus').textContent = state.settings.token ? 'Токен сохранён ✓' : 'Токен не задан';
  if ('serviceWorker' in navigator && !native) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (native) setTimeout(() => checkUpdates(true), 1200);
})();
