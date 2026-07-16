/* RidgelineSync — cloud persistence layer.
 *
 * Every edit is (1) written to localStorage immediately (offline cache) and
 * (2) pushed to the Cloudflare KV backend, debounced ~1.2s. If the network is
 * down, edits queue locally (dirty flag) and flush automatically when the
 * browser comes back online. Last write wins.
 *
 * localStorage keys:
 *   rl_token            auth token
 *   rl_active_job       last active job id
 *   rl_cache_<jobId>    { edits, updatedAt, dirty }
 */
(function () {
  const TOKEN_KEY = 'rl_token';
  const ACTIVE_KEY = 'rl_active_job';
  const DEBOUNCE_MS = 1200;

  const S = {
    onStatus: null,   // fn(status) — 'saving' | 'saved' | 'offline' | 'error' | ''
    onAuthFail: null, // fn() — token rejected

    _timers: {},
    _lastStatus: '',

    token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } },
    setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} },

    role() { try { return localStorage.getItem('rl_role') || 'admin'; } catch (e) { return 'admin'; } },
    userName() { try { return localStorage.getItem('rl_name') || ''; } catch (e) { return ''; } },
    setRole(role, name) {
      try {
        role ? localStorage.setItem('rl_role', role) : localStorage.removeItem('rl_role');
        name ? localStorage.setItem('rl_name', name) : localStorage.removeItem('rl_name');
      } catch (e) {}
    },

    activeJob() { try { return localStorage.getItem(ACTIVE_KEY) || ''; } catch (e) { return ''; } },
    setActiveJob(id) { try { localStorage.setItem(ACTIVE_KEY, id); } catch (e) {} },

    _status(s) {
      this._lastStatus = s;
      if (this.onStatus) this.onStatus(s);
    },

    cacheGet(jobId) {
      try { return JSON.parse(localStorage.getItem('rl_cache_' + jobId) || 'null'); } catch (e) { return null; }
    },
    cachePut(jobId, edits, dirty) {
      try {
        localStorage.setItem('rl_cache_' + jobId, JSON.stringify({ edits, updatedAt: Date.now(), dirty: !!dirty }));
      } catch (e) {}
    },
    cacheDrop(jobId) { try { localStorage.removeItem('rl_cache_' + jobId); } catch (e) {} },

    async api(path, opts) {
      opts = opts || {};
      opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      const t = this.token();
      if (t) opts.headers['Authorization'] = 'Bearer ' + t;
      const resp = await fetch('/api' + path, opts);
      if (resp.status === 401 && path !== '/login') {
        this.setToken('');
        if (this.onAuthFail) this.onAuthFail();
        throw new Error('unauthorized');
      }
      if (!resp.ok) {
        let msg = 'request failed (' + resp.status + ')';
        try { msg = (await resp.json()).error || msg; } catch (e) {}
        throw new Error(msg);
      }
      return resp.json();
    },

    async login(password, email) {
      const r = await this.api('/login', { method: 'POST', body: JSON.stringify({ password, email: email || undefined }) });
      this.setToken(r.token);
      this.setRole(r.role || 'admin', r.name || '');
      return true;
    },

    logout() { this.setToken(''); this.setRole('', ''); },

    listJobs() { return this.api('/jobs'); },

    createJob(name, edits) {
      return this.api('/jobs', { method: 'POST', body: JSON.stringify({ name, edits: edits || {} }) });
    },

    async getJob(id) {
      const job = await this.api('/jobs/' + id);
      // If we have dirty local edits newer than the server copy, prefer ours and push.
      const cache = this.cacheGet(id);
      if (cache && cache.dirty) {
        const p = this._payloadOf(cache);
        if (p.edits) job.edits = p.edits;
        if (p.estimate) job.estimate = p.estimate;
        if (p.schedule) job.schedule = p.schedule;
        this.saveJob(id, p); // flush
      } else {
        this.cachePut(id, { edits: job.edits, estimate: job.estimate, schedule: job.schedule }, false);
      }
      return job;
    },

    renameJob(id, name) {
      return this.api('/jobs/' + id, { method: 'PUT', body: JSON.stringify({ name }) });
    },

    deleteJob(id) {
      this.cacheDrop(id);
      return this.api('/jobs/' + id, { method: 'DELETE' });
    },

    /* Debounced save. `data` may be plain edits (legacy) or {edits, estimate, schedule}. */
    saveJob(id, data) {
      if (!id) return;
      const payload = (data && (data.edits || data.estimate || data.schedule)) ? data : { edits: data };
      this.cachePut(id, payload, true);
      this._status('saving');
      clearTimeout(this._timers[id]);
      this._timers[id] = setTimeout(() => this._push(id), DEBOUNCE_MS);
    },

    _payloadOf(cache) {
      // Accept both old cache format ({edits:...}) and new ({edits, estimate, schedule}).
      const e = cache.edits || {};
      return (e.edits || e.estimate || e.schedule) ? e : { edits: e };
    },

    async _push(id) {
      const cache = this.cacheGet(id);
      if (!cache || !cache.dirty) return;
      try {
        await this.api('/jobs/' + id, { method: 'PUT', body: JSON.stringify(this._payloadOf(cache)) });
        this.cachePut(id, cache.edits, false);
        this._status('saved');
      } catch (e) {
        if (e.message === 'unauthorized') return;
        this._status(navigator.onLine === false ? 'offline' : 'error');
      }
    },

    /* Push any dirty caches (called on reconnect / page load). */
    async flushAll() {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('rl_cache_') === 0) {
          const id = k.slice('rl_cache_'.length);
          const c = this.cacheGet(id);
          if (c && c.dirty) await this._push(id);
        }
      }
    },

    /* Best-effort immediate flush when the tab is closing. */
    flushSync(id) {
      const cache = this.cacheGet(id);
      if (!cache || !cache.dirty) return;
      try {
        fetch('/api/jobs/' + id, {
          method: 'PUT',
          keepalive: true,
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token() },
          body: JSON.stringify(this._payloadOf(cache))
        });
      } catch (e) {}
    }
  };

  window.addEventListener('online', () => { S.flushAll(); });
  window.addEventListener('offline', () => { S._status('offline'); });

  window.RidgelineSync = S;
})();
