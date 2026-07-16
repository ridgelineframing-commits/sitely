/* ScheduleShare — turn a job's schedule into a clean, one-page image (JPEG to text) or PDF
 * (to email). Field-update style, not a calendar/gantt. Shared by desktop (keystone) and the
 * field app. No external libraries: the image is drawn on a <canvas>; the PDF is a minimal
 * hand-rolled document that embeds that JPEG (DCTDecode) on a single page. */
(function () {
  'use strict';

  const isDone = s => s === 'Complete';
  const isProg = s => s === 'In Progress';

  function fmtMD(iso) {
    const p = String(iso || '').split('-');
    return p.length === 3 ? (+p[1]) + '/' + (+p[2]) : '';
  }
  function pctOf(tasks) {
    if (!tasks.length) return 0;
    const d = tasks.filter(t => isDone(t.status)).length;
    const ip = tasks.filter(t => isProg(t.status)).length;
    return Math.round(100 * (d + 0.5 * ip) / tasks.length);
  }
  function groupsOf(schedule) {
    const order = [], map = {};
    for (const t of (schedule || [])) {
      const g = t.group || 'Tasks';
      if (!map[g]) { map[g] = { name: g, tasks: [] }; order.push(map[g]); }
      map[g].tasks.push(t);
    }
    return order;
  }
  function range(tasks) {
    const s = tasks.map(t => t.start).filter(Boolean).sort();
    const f = tasks.map(t => t.finish || t.start).filter(Boolean).sort();
    return { start: s[0] || '', finish: f[f.length - 1] || '' };
  }

  // Pure: the list of lines to render, honoring the collapse/hide options.
  function buildModel(job, opts) {
    opts = opts || {};
    const lines = [];
    for (const g of groupsOf(job && job.schedule)) {
      const r = range(g.tasks);
      const phase = { type: 'phase', name: g.name, start: r.start, finish: r.finish,
        pct: pctOf(g.tasks), done: g.tasks.filter(t => isDone(t.status)).length, total: g.tasks.length };
      if (opts.collapseToPhases) { lines.push(phase); continue; }
      const tasks = opts.hideCompleted ? g.tasks.filter(t => !isDone(t.status)) : g.tasks;
      if (opts.hideCompleted && !tasks.length) continue; // whole phase done + hidden
      lines.push(phase);
      for (const t of tasks) lines.push({ type: 'task', name: String(t.task || '').replace(/^\d+\s*/, ''),
        start: t.start, finish: t.finish, status: t.status || 'Not Started' });
    }
    return { title: (job && job.name) || 'Schedule', lines, tasks: (job && job.schedule) || [] };
  }

  // Draw the model onto a fresh <canvas> and return it (browser only).
  function drawCanvas(job, opts) {
    const model = buildModel(job, opts);
    const W = 1000, M = 44, HEADER = 128, phaseH = 52, taskH = 40, FOOT = 52;
    let bodyH = 0;
    for (const ln of model.lines) bodyH += (ln.type === 'phase' ? phaseH : taskH);
    const H = HEADER + Math.max(bodyH, 40) + FOOT;
    const scale = 2;
    const cv = document.createElement('canvas');
    cv.width = W * scale; cv.height = H * scale;
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);

    // header
    ctx.fillStyle = '#1c1a17'; ctx.font = '700 40px Georgia, serif';
    ctx.fillText(String(model.title).slice(0, 42), M, 60);
    const now = new Date();
    const d = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
    ctx.textAlign = 'right'; ctx.font = '700 15px Arial, sans-serif'; ctx.fillStyle = '#8a8578';
    ctx.fillText('SCHEDULE · ' + d, W - M, 38); ctx.textAlign = 'left';
    ctx.font = '15px Arial, sans-serif'; ctx.fillStyle = '#8a8578';
    ctx.fillText(pctOf(model.tasks) + '% complete · ' + model.tasks.length + ' tasks', M, 88);
    ctx.strokeStyle = '#26211a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(M, 106); ctx.lineTo(W - M, 106); ctx.stroke();

    let y = HEADER;
    if (!model.lines.length) {
      ctx.fillStyle = '#8a8578'; ctx.font = '17px Arial, sans-serif';
      ctx.fillText('No schedule yet.', M, y + 20);
    }
    for (const ln of model.lines) {
      if (ln.type === 'phase') {
        ctx.fillStyle = '#f1ede4'; ctx.fillRect(M - 10, y - 2, W - 2 * M + 20, phaseH - 8);
        ctx.fillStyle = '#26211a'; ctx.font = '700 21px Georgia, serif';
        ctx.fillText(String(ln.name).slice(0, 44), M + 4, y + 28);
        ctx.textAlign = 'right'; ctx.font = '700 15px Arial, sans-serif'; ctx.fillStyle = '#a64b24';
        const rng = (ln.start || ln.finish) ? fmtMD(ln.start) + ' – ' + fmtMD(ln.finish) : '';
        ctx.fillText(ln.done + '/' + ln.total + ' done' + (rng ? '   ·   ' + rng : ''), W - M - 4, y + 27);
        ctx.textAlign = 'left';
        y += phaseH;
      } else {
        const done = isDone(ln.status), prog = isProg(ln.status);
        const gx = M + 14, gy = y + taskH / 2 - 3, r = 8;
        ctx.beginPath(); ctx.arc(gx, gy, r, 0, 2 * Math.PI);
        if (done) { ctx.fillStyle = '#9c968b'; ctx.fill(); }
        else if (prog) { ctx.lineWidth = 3; ctx.strokeStyle = '#a64b24'; ctx.stroke(); ctx.beginPath(); ctx.arc(gx, gy, r - 4, 0, 2 * Math.PI); ctx.fillStyle = '#a64b24'; ctx.fill(); }
        else { ctx.lineWidth = 2; ctx.strokeStyle = '#c4bdb0'; ctx.stroke(); }
        ctx.fillStyle = done ? '#9c968b' : '#26211a';
        ctx.font = (prog ? '700 ' : '') + '19px Arial, sans-serif';
        const name = String(ln.name).slice(0, 62);
        ctx.fillText(name, M + 36, y + taskH / 2 + 4);
        if (done) { const w = ctx.measureText(name).width; ctx.strokeStyle = '#9c968b'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(M + 36, y + taskH / 2 + 1); ctx.lineTo(M + 36 + w, y + taskH / 2 + 1); ctx.stroke(); }
        ctx.textAlign = 'right'; ctx.font = '15px Arial, sans-serif'; ctx.fillStyle = '#8a8578';
        const dr = ln.start ? fmtMD(ln.start) + (ln.finish && ln.finish !== ln.start ? '–' + fmtMD(ln.finish) : '') : '';
        ctx.fillText(dr, W - M - 4, y + taskH / 2 + 4); ctx.textAlign = 'left';
        ctx.strokeStyle = '#eee9df'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(M, y + taskH - 2); ctx.lineTo(W - M, y + taskH - 2); ctx.stroke();
        y += taskH;
      }
    }
    ctx.fillStyle = '#a89f90'; ctx.font = '13px Arial, sans-serif';
    ctx.fillText('Ridgeline Construction · Sitely', M, H - 20);
    ctx.textAlign = 'right'; ctx.fillText('○ to do   ◑ in progress   ● done', W - M, H - 20); ctx.textAlign = 'left';
    return cv;
  }

  // Pure: wrap JPEG bytes in a minimal single-page PDF, image fit to one page.
  function buildImagePdf(jpeg, imgW, imgH) {
    const enc = s => new TextEncoder().encode(s);
    const landscape = imgW >= imgH;
    const pageW = landscape ? 792 : 612, pageH = landscape ? 612 : 792, m = 18;
    const s = Math.min((pageW - 2 * m) / imgW, (pageH - 2 * m) / imgH);
    const dW = imgW * s, dH = imgH * s, x = (pageW - dW) / 2, yy = (pageH - dH) / 2;
    const content = enc('q ' + dW.toFixed(2) + ' 0 0 ' + dH.toFixed(2) + ' ' + x.toFixed(2) + ' ' + yy.toFixed(2) + ' cm /Im0 Do Q');

    const parts = []; let offset = 0; const off = {};
    const push = u8 => { parts.push(u8); offset += u8.length; };
    push(enc('%PDF-1.3\n'));
    function obj(n, dict, stream) {
      off[n] = offset;
      push(enc(n + ' 0 obj\n' + dict));
      if (stream) { push(enc('\nstream\n')); push(stream); push(enc('\nendstream')); }
      push(enc('\nendobj\n'));
    }
    obj(1, '<</Type/Catalog/Pages 2 0 R>>');
    obj(2, '<</Type/Pages/Kids[3 0 R]/Count 1>>');
    obj(3, '<</Type/Page/Parent 2 0 R/MediaBox[0 0 ' + pageW + ' ' + pageH + ']/Resources<</XObject<</Im0 4 0 R>>/ProcSet[/PDF/ImageC]>>/Contents 5 0 R>>');
    obj(4, '<</Type/XObject/Subtype/Image/Width ' + imgW + '/Height ' + imgH + '/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ' + jpeg.length + '>>', jpeg);
    obj(5, '<</Length ' + content.length + '>>', content);
    const xrefAt = offset;
    let xref = 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i <= 5; i++) xref += String(off[i]).padStart(10, '0') + ' 00000 n \n';
    push(enc(xref));
    push(enc('trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n' + xrefAt + '\n%%EOF'));

    const total = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(total); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  function safeName(job) {
    return (String((job && job.name) || 'schedule').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').slice(0, 50)) || 'schedule';
  }
  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
  }
  const toJpeg = cv => new Promise(res => cv.toBlob(res, 'image/jpeg', 0.92));

  async function downloadJpeg(job, opts) {
    const blob = await toJpeg(drawCanvas(job, opts));
    download(blob, safeName(job) + '-schedule.jpg');
  }
  async function downloadPdf(job, opts) {
    const cv = drawCanvas(job, opts);
    const jpeg = new Uint8Array(await (await toJpeg(cv)).arrayBuffer());
    download(new Blob([buildImagePdf(jpeg, cv.width, cv.height)], { type: 'application/pdf' }), safeName(job) + '-schedule.pdf');
  }
  function previewURL(job, opts) { return drawCanvas(job, opts).toDataURL('image/jpeg', 0.85); }

  window.ScheduleShare = { buildModel, drawCanvas, buildImagePdf, downloadJpeg, downloadPdf, previewURL };
})();
