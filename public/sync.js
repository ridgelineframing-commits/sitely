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
    onConflict: null,

    _timers: {},
    _lastStatus: '',
    _versions: {},

    token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } },
    setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} },

    role() { try { return localStorage.getItem('rl_role') || null; } catch (e) { return null; } },
    userName() { try { return localStorage.getItem('rl_name') || ''; } catch (e) { return ''; } },
    // the account owner (super administrator) — signed in with the account password itself
    isOwner() { try { return localStorage.getItem('rl_owner') === '1'; } catch (e) { return false; } },
    setRole(role, name, owner) {
      try {
        role ? localStorage.setItem('rl_role', role) : localStorage.removeItem('rl_role');
        name ? localStorage.setItem('rl_name', name) : localStorage.removeItem('rl_name');
        owner ? localStorage.setItem('rl_owner', '1') : localStorage.removeItem('rl_owner');
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
    cachePut(jobId, edits, dirty, version) {
      try {
        const prior = this.cacheGet(jobId);
        localStorage.setItem('rl_cache_' + jobId, JSON.stringify({
          edits,
          version: Number(version) || Number(prior && prior.version) || Number(this._versions[jobId]) || 1,
          updatedAt: Date.now(),
          dirty: !!dirty
        }));
      } catch (e) {}
    },
    cacheDrop(jobId) { try { localStorage.removeItem('rl_cache_' + jobId); } catch (e) {} },

    async api(path, opts) {
      opts = opts || {};
      const jobPut = String(opts.method || 'GET').toUpperCase() === 'PUT' && /^\/jobs\/[^/]+$/.test(path);
      const jobId = jobPut ? decodeURIComponent(path.slice('/jobs/'.length)) : null;
      if (jobPut && typeof opts.body === 'string') {
        try {
          const body = JSON.parse(opts.body);
          if (!Number.isFinite(Number(body.baseVersion))) {
            body.baseVersion = Number(this._versions[jobId]) || 1;
            opts.body = JSON.stringify(body);
          }
        } catch (e) {}
      }
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
        let data = null;
        try { data = await resp.json(); msg = data.error || msg; } catch (e) {}
        const err = new Error(msg);
        err.status = resp.status;
        err.data = data;
        throw err;
      }
      const data = await resp.json();
      if (jobPut && data && Number(data.version)) this._versions[jobId] = Number(data.version);
      return data;
    },

    async login(password, identity) {
      const r = await this.api('/login', { method: 'POST', body: JSON.stringify({ password, identity: identity || undefined }) });
      this.setToken(r.token);
      this.setRole(r.role || 'admin', r.name || '', !!r.owner);
      return true;
    },

    logout() { this.setToken(''); this.setRole('', '', false); },

    async listJobs() {
      const jobs = await this.api('/jobs');
      for (const job of (jobs || [])) if (job && job.id) this._versions[job.id] = Number(job.version) || 1;
      return jobs;
    },

    async createJob(name, edits) {
      const job = await this.api('/jobs', { method: 'POST', body: JSON.stringify({ name, edits: edits || {} }) });
      if (job && job.id) this._versions[job.id] = Number(job.version) || 1;
      return job;
    },

    async getJob(id) {
      const job = await this.api('/jobs/' + id);
      this._versions[id] = Number(job.version) || 1;
      // If we have dirty local edits newer than the server copy, prefer ours and push.
      const cache = this.cacheGet(id);
      if (cache && cache.dirty) {
        const p = this._payloadOf(cache);
        if (p.edits) job.edits = p.edits;
        if (p.estimate) job.estimate = p.estimate;
        if (p.schedule) job.schedule = p.schedule;
        if (p.taskContractors) job.taskContractors = p.taskContractors;
        if (p.bidRequests) job.bidRequests = p.bidRequests;
        this._versions[id] = Number(cache.version) || this._versions[id];
        this.saveJob(id, p); // flush
      } else {
        this.cachePut(id, { edits: job.edits, estimate: job.estimate, schedule: job.schedule, taskContractors: job.taskContractors, bidRequests: job.bidRequests }, false, this._versions[id]);
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

    discardConflict(id, currentVersion) {
      this.cacheDrop(id);
      this._versions[id] = Number(currentVersion) || this._versions[id] || 1;
    },

    /* A structured payload names one of the job's server fields; anything else is a bare
       edits map (legacy workbook cells like "Sheet!A1", never these key names). */
    _isPayload(d) {
      return !!(d && typeof d === 'object' && (
        d.edits || d.estimate || d.schedule || d.pendingNotes || d.todos ||
        d.permitReady || d.draws || d.customer || d.status || d.portal || d.warrantyStart ||
        d.taskContractors || d.bidRequests
      ));
    },

    /* Debounced save. `data` may be a bare edits map (legacy) or a structured payload
       ({edits, estimate, schedule, pendingNotes, todos, …}). */
    saveJob(id, data) {
      if (!id) return;
      const payload = this._isPayload(data) ? data : { edits: data };
      payload.baseVersion = Number(this._versions[id]) || Number(payload.baseVersion) || 1;
      this.cachePut(id, payload, true, payload.baseVersion);
      this._status('saving');
      clearTimeout(this._timers[id]);
      this._timers[id] = setTimeout(() => this._push(id), DEBOUNCE_MS);
    },

    _payloadOf(cache) {
      const e = cache.edits || {};
      return this._isPayload(e) ? e : { edits: e };
    },

    async _push(id) {
      const cache = this.cacheGet(id);
      if (!cache || !cache.dirty) return;
      try {
        const payload = this._payloadOf(cache);
        payload.baseVersion = Number(cache.version) || Number(this._versions[id]) || 1;
        const result = await this.api('/jobs/' + id, { method: 'PUT', body: JSON.stringify(payload) });
        this._versions[id] = Number(result.version) || payload.baseVersion + 1;
        this.cachePut(id, cache.edits, false, this._versions[id]);
        this._status('saved');
      } catch (e) {
        if (e.message === 'unauthorized') return;
        if (e.status === 409 || e.status === 428) {
          this._status('conflict');
          if (this.onConflict) this.onConflict(id, e.data || {});
          return;
        }
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
          body: JSON.stringify(Object.assign(this._payloadOf(cache), {
            baseVersion: Number(cache.version) || Number(this._versions[id]) || 1
          }))
        });
      } catch (e) {}
    }
  };

  window.addEventListener('online', () => { S.flushAll(); });
  window.addEventListener('offline', () => { S._status('offline'); });

  window.RidgelineSync = S;
})();
