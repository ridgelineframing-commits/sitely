package com.ridgeline.sitely;

import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Flattens the board into rows: a header row per note, plus a checkbox row per checklist item. */
class BoardFactory implements RemoteViewsService.RemoteViewsFactory {
    static final int TYPE_NOTE = 0, TYPE_ITEM = 1;

    private final Context ctx;
    private List<Row> rows = new ArrayList<>();
    private boolean authed = true;

    BoardFactory(Context ctx) { this.ctx = ctx; }

    static class Row {
        int type;
        String noteId, itemId, title, sub, icon, count;
        boolean done;
    }

    @Override public void onCreate() {}
    @Override public void onDestroy() { rows.clear(); }
    @Override public int getViewTypeCount() { return 2; }
    @Override public boolean hasStableIds() { return true; }
    @Override public long getItemId(int position) { return position; }
    @Override public RemoteViews getLoadingView() { return null; }
    @Override public int getCount() { return rows.size(); }

    @Override
    public void onDataSetChanged() {
        List<Row> out = new ArrayList<>();
        authed = !WidgetData.token(ctx).isEmpty();
        try {
            JSONObject board = WidgetData.getBoard(ctx);
            JSONArray notes = board.optJSONArray("notes");
            if (notes != null) {
                // newest first
                for (int i = notes.length() - 1; i >= 0; i--) {
                    JSONObject n = notes.optJSONObject(i);
                    if (n == null) continue;
                    JSONArray items = n.optJSONArray("items");
                    boolean isCheck = items != null && items.length() > 0;
                    String text = n.optString("text", "").trim();
                    Row h = new Row();
                    h.type = TYPE_NOTE;
                    h.noteId = n.optString("id", "");
                    h.icon = isCheck ? "☑" : "📝";
                    h.title = !text.isEmpty() ? firstLine(text)
                            : (isCheck ? firstLine(items.optJSONObject(0).optString("text", "Checklist")) : "Note");
                    String job = n.optString("jobId", "");
                    String due = n.optString("dueDate", "");
                    StringBuilder sub = new StringBuilder();
                    if (!job.isEmpty() && !"null".equals(job)) sub.append("⌂ assigned");
                    if (!due.isEmpty() && !"null".equals(due)) { if (sub.length() > 0) sub.append("  ·  "); sub.append("◷ ").append(due); }
                    String by = n.optString("by", "");
                    if (!by.isEmpty()) { if (sub.length() > 0) sub.append("  ·  "); sub.append(by); }
                    h.sub = sub.toString();
                    if (isCheck) {
                        int done = 0;
                        for (int k = 0; k < items.length(); k++) if (items.optJSONObject(k).optBoolean("done", false)) done++;
                        h.count = done + "/" + items.length();
                    } else {
                        h.count = "";
                    }
                    out.add(h);
                    if (isCheck) {
                        for (int k = 0; k < items.length(); k++) {
                            JSONObject it = items.optJSONObject(k);
                            if (it == null) continue;
                            Row r = new Row();
                            r.type = TYPE_ITEM;
                            r.noteId = h.noteId;
                            r.itemId = it.optString("id", "");
                            r.title = it.optString("text", "");
                            r.done = it.optBoolean("done", false);
                            out.add(r);
                        }
                    }
                }
            }
        } catch (Exception e) {
            // leave list empty; the widget's empty view explains sign-in
        }
        rows = out;
    }

    @Override
    public RemoteViews getViewAt(int position) {
        if (position < 0 || position >= rows.size()) return null;
        Row r = rows.get(position);
        String pkg = ctx.getPackageName();
        if (r.type == TYPE_NOTE) {
            RemoteViews rv = new RemoteViews(pkg, R.layout.widget_row_note);
            rv.setTextViewText(R.id.row_icon, r.icon);
            rv.setTextViewText(R.id.row_title, r.title);
            rv.setTextViewText(R.id.row_sub, r.sub);
            rv.setTextViewText(R.id.row_count, r.count == null ? "" : r.count);
            Intent fill = new Intent();
            fill.putExtra(WhiteboardWidget.EXTRA_KIND, "note");
            rv.setOnClickFillInIntent(R.id.row_root, fill);
            return rv;
        } else {
            RemoteViews rv = new RemoteViews(pkg, R.layout.widget_row_item);
            rv.setTextViewText(R.id.item_box, r.done ? "☑" : "☐");
            rv.setInt(R.id.item_box, "setTextColor", r.done ? 0xFF6FA8FF : 0xFF9AA0A8);
            rv.setTextViewText(R.id.item_text, r.title);
            rv.setInt(R.id.item_text, "setPaintFlags", r.done
                    ? (android.graphics.Paint.STRIKE_THRU_TEXT_FLAG | android.graphics.Paint.ANTI_ALIAS_FLAG)
                    : android.graphics.Paint.ANTI_ALIAS_FLAG);
            rv.setInt(R.id.item_text, "setTextColor", r.done ? 0xFF7A8088 : 0xFFC7CCD1);
            Intent fill = new Intent();
            fill.putExtra(WhiteboardWidget.EXTRA_KIND, "item");
            fill.putExtra(WhiteboardWidget.EXTRA_NOTE, r.noteId);
            fill.putExtra(WhiteboardWidget.EXTRA_ITEM, r.itemId);
            rv.setOnClickFillInIntent(R.id.item_root, fill);
            return rv;
        }
    }

    private static String firstLine(String s) {
        if (s == null) return "";
        int nl = s.indexOf('\n');
        String t = nl >= 0 ? s.substring(0, nl) : s;
        return t.length() > 80 ? t.substring(0, 80) : t;
    }
}
