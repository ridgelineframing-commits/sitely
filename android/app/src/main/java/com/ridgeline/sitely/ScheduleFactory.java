package com.ridgeline.sitely;

import android.content.Context;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Flattens every visible job's schedule into day-header + task rows.
 *
 * Two shapes off the same data:
 *   AGENDA — the next 30 calendar days, in order
 *   WEEKS  — 2–4 work weeks (Mon–Fri) starting from this week's Monday
 *
 * Jobs the web app switched off (Schedules hub / Field settings) are skipped, so the widget
 * shows exactly what the app shows. Empty days are omitted entirely — the list is only as
 * long as there is work to do.
 */
class ScheduleFactory implements RemoteViewsService.RemoteViewsFactory {
    static final int MODE_AGENDA = 0, MODE_WEEKS = 1;
    static final int TYPE_DAY = 0, TYPE_TASK = 1, TYPE_STATUS = 2;

    private final Context ctx;
    private final int mode;
    private List<Row> rows = new ArrayList<>();

    ScheduleFactory(Context ctx, int mode) { this.ctx = ctx; this.mode = mode; }

    static class Row {
        int type;
        String title, sub;
        boolean done, confirmed, today;
    }

    private static class Task {
        String name, job, group, start, finish, status;
        boolean confirmed;
    }

    @Override public void onCreate() {}
    @Override public void onDestroy() { rows.clear(); }
    @Override public int getViewTypeCount() { return 3; }
    @Override public boolean hasStableIds() { return true; }
    @Override public long getItemId(int position) { return position; }
    @Override public RemoteViews getLoadingView() { return null; }
    @Override public int getCount() { return rows.size(); }

    private static SimpleDateFormat iso() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f;
    }

    private static Calendar utcMidnightToday() {
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        Calendar out = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        out.clear();
        out.set(c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH));
        return out;
    }

    /** Pull every visible job's tasks. One request for the list, one per job for its schedule. */
    private List<Task> loadTasks() {
        List<Task> out = new ArrayList<>();
        try {
            JSONArray jobs = new JSONArray(WidgetData.getScheduleText(ctx, WidgetData.jobsUrl()));
            for (int i = 0; i < jobs.length(); i++) {
                JSONObject meta = jobs.optJSONObject(i);
                if (meta == null) continue;
                String id = meta.optString("id", "");
                String name = meta.optString("name", "");
                String status = meta.optString("status", "active");
                if (id.isEmpty()) continue;
                // archived/warranty/prospect jobs stay off unless the app turned them on
                boolean defaultOn = "active".equals(status) || "admin".equalsIgnoreCase(name.trim());
                if (!WidgetData.jobShown(ctx, id)) continue;
                if (!defaultOn && !hasExplicitOn(id)) continue;
                JSONObject job = new JSONObject(WidgetData.getScheduleText(ctx, WidgetData.jobUrl(id)));
                JSONArray sched = job.optJSONArray("schedule");
                if (sched == null) continue;
                for (int k = 0; k < sched.length(); k++) {
                    JSONObject t = sched.optJSONObject(k);
                    if (t == null) continue;
                    String start = t.optString("start", "");
                    if (start.isEmpty() || "null".equals(start)) continue;
                    Task task = new Task();
                    task.name = stripLeadingNumber(t.optString("task", ""));
                    task.job = name;
                    task.group = t.optString("group", "");
                    task.start = start;
                    String fin = t.optString("finish", "");
                    task.finish = (fin.isEmpty() || "null".equals(fin)) ? start : fin;
                    task.status = t.optString("status", "Not Started");
                    task.confirmed = t.optBoolean("confirmed", false);
                    out.add(task);
                }
            }
        } catch (Exception e) {
            // offline / signed out — the widget's empty view explains it
        }
        return out;
    }

    /** A non-active job only shows if the app explicitly switched it ON. */
    private boolean hasExplicitOn(String jobId) {
        String raw = ctx.getSharedPreferences(WidgetData.PREFS, Context.MODE_PRIVATE).getString(WidgetData.KEY_JOBVIS, "");
        if (raw == null || raw.isEmpty()) return false;
        try {
            JSONObject o = new JSONObject(raw);
            return o.has(jobId) && o.optBoolean(jobId, false);
        } catch (Exception e) { return false; }
    }

    @Override
    public void onDataSetChanged() {
        WidgetData.beginScheduleRefresh(ctx);
        List<Task> tasks = loadTasks();
        List<Row> out = new ArrayList<>();
        if (WidgetData.scheduleStale(ctx)) {
            Row stale = new Row();
            stale.type = TYPE_STATUS;
            stale.title = "OFFLINE  ·  SHOWING SAVED SCHEDULE";
            out.add(stale);
        }
        SimpleDateFormat isoFmt = iso();
        SimpleDateFormat dayFmt = new SimpleDateFormat("EEE, MMM d", Locale.US);
        dayFmt.setTimeZone(TimeZone.getTimeZone("UTC"));

        Calendar cur = utcMidnightToday();
        String todayIso = isoFmt.format(cur.getTime());
        int days;
        if (mode == MODE_WEEKS) {
            // back up to Monday, then walk whole work weeks
            while (cur.get(Calendar.DAY_OF_WEEK) != Calendar.MONDAY) cur.add(Calendar.DAY_OF_MONTH, -1);
            days = WidgetData.weeks(ctx) * 7;
        } else {
            days = 30;
        }

        for (int i = 0; i < days; i++) {
            int dow = cur.get(Calendar.DAY_OF_WEEK);
            boolean weekend = dow == Calendar.SATURDAY || dow == Calendar.SUNDAY;
            String dayIso = isoFmt.format(cur.getTime());
            if (!(mode == MODE_WEEKS && weekend)) {
                List<Task> onDay = new ArrayList<>();
                for (Task t : tasks) {
                    if (t.start.compareTo(dayIso) > 0 || dayIso.compareTo(t.finish) > 0) continue;
                    // a task only shows on a weekend if it actually starts or ends there
                    if (weekend && !t.start.equals(dayIso) && !t.finish.equals(dayIso)) continue;
                    onDay.add(t);
                }
                if (!onDay.isEmpty()) {
                    Row h = new Row();
                    h.type = TYPE_DAY;
                    h.today = dayIso.equals(todayIso);
                    h.title = dayFmt.format(cur.getTime()) + (h.today ? "  ·  TODAY" : "");
                    out.add(h);
                    for (Task t : onDay) {
                        Row r = new Row();
                        r.type = TYPE_TASK;
                        r.title = t.name;
                        StringBuilder sub = new StringBuilder(t.job == null ? "" : t.job);
                        if (t.group != null && !t.group.isEmpty() && !"null".equals(t.group)) {
                            if (sub.length() > 0) sub.append("  ·  ");
                            sub.append(t.group);
                        }
                        r.sub = sub.toString();
                        r.done = "Complete".equals(t.status);
                        r.confirmed = t.confirmed;
                        out.add(r);
                    }
                }
            }
            cur.add(Calendar.DAY_OF_MONTH, 1);
        }
        rows = out;
    }

    @Override
    public RemoteViews getViewAt(int position) {
        if (position < 0 || position >= rows.size()) return null;
        Row r = rows.get(position);
        String pkg = ctx.getPackageName();
        if (r.type == TYPE_DAY || r.type == TYPE_STATUS) {
            RemoteViews rv = new RemoteViews(pkg, R.layout.widget_row_day);
            rv.setTextViewText(R.id.day_label, r.title);
            rv.setInt(R.id.day_label, "setTextColor", r.type == TYPE_STATUS ? 0xFFD9B46A : (r.today ? 0xFF6FA8FF : 0xFF8A9098));
            rv.setOnClickFillInIntent(R.id.day_root, new android.content.Intent());
            return rv;
        }
        RemoteViews rv = new RemoteViews(pkg, R.layout.widget_row_task);
        rv.setTextViewText(R.id.task_firm, r.confirmed ? "✓" : "?");
        rv.setInt(R.id.task_firm, "setTextColor", r.confirmed ? 0xFF6FBF8F : 0xFF7A8088);
        rv.setTextViewText(R.id.task_name, r.title);
        rv.setInt(R.id.task_name, "setTextColor", r.done ? 0xFF7A8088 : 0xFFE6E3DC);
        rv.setInt(R.id.task_name, "setPaintFlags", r.done
                ? (android.graphics.Paint.STRIKE_THRU_TEXT_FLAG | android.graphics.Paint.ANTI_ALIAS_FLAG)
                : android.graphics.Paint.ANTI_ALIAS_FLAG);
        rv.setTextViewText(R.id.task_sub, r.sub == null ? "" : r.sub);
        rv.setOnClickFillInIntent(R.id.task_root, new android.content.Intent());
        return rv;
    }

    private static String stripLeadingNumber(String s) {
        if (s == null) return "";
        String t = s.trim().replaceFirst("^\\d+\\s*", "");
        return t.length() > 90 ? t.substring(0, 90) : t;
    }
}
