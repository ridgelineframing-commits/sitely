// GET /api/feed/<token>/all.ics        -> combined calendar for every job
// GET /api/feed/<token>/<jobId>.ics    -> calendar for one job
// Unauthenticated by design (calendar apps can't send headers); the long random
// token in the URL is the credential. Serves iCalendar; Google/Apple/Outlook
// subscribe to this URL and refresh automatically.

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function dateStamp(iso) { return iso.replace(/-/g, ''); }

// Accept only YYYY-MM-DD that parses to a real calendar date.
function isValidDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return false;
  const d = new Date(iso + 'T00:00:00Z');
  return !isNaN(d.getTime());
}

function addDay(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function jobEvents(job, lines) {
  const rows = Array.isArray(job.schedule) ? job.schedule : [];
  for (const t of rows) {
    if (!t || !t.start || !t.finish || !t.task) continue;
    // A bad date on one row must not 500 the whole calendar (esp. the combined all.ics feed).
    if (!isValidDate(t.start) || !isValidDate(t.finish)) continue;
    const uid = job.id + '-' + (t.id || t.task).toString().replace(/[^\w-]/g, '').slice(0, 60) + '@ridgeline-keystone';
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + uid);
    lines.push('DTSTAMP:' + dateStamp(t.start) + 'T000000Z');
    lines.push('DTSTART;VALUE=DATE:' + dateStamp(t.start));
    lines.push('DTEND;VALUE=DATE:' + dateStamp(addDay(t.finish)));
    lines.push('SUMMARY:' + esc('[' + job.name + '] ' + t.task));
    if (t.status) lines.push('DESCRIPTION:' + esc('Status: ' + t.status + (t.pct != null ? ' (' + Math.round(t.pct * 100) + '%)' : '')));
    lines.push('END:VEVENT');
  }
}

export async function onRequestGet({ env, params }) {
  const token = await env.RIDGELINE_KV.get('feedtoken');
  if (!token || params.token !== token) return new Response('not found', { status: 404 });

  const file = String(params.file || '');
  if (!file.endsWith('.ics')) return new Response('not found', { status: 404 });
  const target = file.slice(0, -4);

  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//Ridgeline Construction//Sitely//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + (target === 'all' ? 'Sitely — All Jobs' : 'Sitely Job Schedule')
  ];

  if (target === 'all') {
    const idxRaw = await env.RIDGELINE_KV.get('jobs:index');
    const index = idxRaw ? JSON.parse(idxRaw) : [];
    for (const meta of index) {
      const raw = await env.RIDGELINE_KV.get('job:' + meta.id);
      if (!raw) continue;
      const job = JSON.parse(raw);
      if ((job.status || 'active') !== 'active') continue; // only live projects feed the combined calendar
      jobEvents(job, lines);
    }
  } else {
    const raw = await env.RIDGELINE_KV.get('job:' + target);
    if (!raw) return new Response('not found', { status: 404 });
    const job = JSON.parse(raw);
    lines[lines.length - 1] = 'X-WR-CALNAME:Sitely — ' + job.name;
    jobEvents(job, lines);
  }

  lines.push('END:VCALENDAR');
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'no-cache, max-age=300'
    }
  });
}
