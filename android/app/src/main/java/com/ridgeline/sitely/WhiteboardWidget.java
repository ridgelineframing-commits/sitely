package com.ridgeline.sitely;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

public class WhiteboardWidget extends AppWidgetProvider {
    static final String ACTION_REFRESH = "com.ridgeline.sitely.WIDGET_REFRESH";
    static final String ACTION_CLICK   = "com.ridgeline.sitely.WIDGET_CLICK";
    static final String EXTRA_KIND = "kind";
    static final String EXTRA_NOTE = "note";
    static final String EXTRA_ITEM = "item";

    private static int piFlags() {
        int f = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 31) f |= PendingIntent.FLAG_MUTABLE;
        return f;
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) render(ctx, mgr, id);
    }

    private void render(Context ctx, AppWidgetManager mgr, int id) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_board);

        Intent svc = new Intent(ctx, BoardWidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        rv.setRemoteAdapter(R.id.widget_list, svc);
        rv.setEmptyView(R.id.widget_list, R.id.widget_empty);

        // header: title + ＋ open the app; refresh reloads the list
        PendingIntent open = openAppIntent(ctx);
        rv.setOnClickPendingIntent(R.id.widget_title, open);
        rv.setOnClickPendingIntent(R.id.widget_add, open);

        Intent refresh = new Intent(ctx, WhiteboardWidget.class).setAction(ACTION_REFRESH);
        rv.setOnClickPendingIntent(R.id.widget_refresh,
                PendingIntent.getBroadcast(ctx, 1, refresh, piFlags()));

        // list item template: fill-in extras decide open-app vs toggle-item
        Intent tmpl = new Intent(ctx, WhiteboardWidget.class).setAction(ACTION_CLICK);
        rv.setPendingIntentTemplate(R.id.widget_list,
                PendingIntent.getBroadcast(ctx, 2, tmpl, piFlags()));

        mgr.updateAppWidget(id, rv);
        mgr.notifyAppWidgetViewDataChanged(id, R.id.widget_list);
    }

    private static PendingIntent openAppIntent(Context ctx) {
        Intent launch = new Intent(ctx, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int f = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getActivity(ctx, 0, launch, f);
    }

    static void refreshAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, WhiteboardWidget.class));
        if (ids != null && ids.length > 0) mgr.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        String action = intent.getAction();
        if (ACTION_REFRESH.equals(action)) {
            refreshAll(ctx);
            return;
        }
        if (ACTION_CLICK.equals(action)) {
            String kind = intent.getStringExtra(EXTRA_KIND);
            if ("item".equals(kind)) {
                toggleItem(ctx, intent.getStringExtra(EXTRA_NOTE), intent.getStringExtra(EXTRA_ITEM));
            } else {
                Intent launch = new Intent(ctx, MainActivity.class);
                launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                ctx.startActivity(launch);
            }
        }
    }

    /** Flip one checklist item's done flag on the server, then reload the widget list. */
    private void toggleItem(final Context ctx, final String noteId, final String itemId) {
        if (noteId == null || itemId == null) return;
        final PendingResult pending = goAsync();
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    JSONObject board = WidgetData.getBoard(ctx);
                    JSONArray notes = board.optJSONArray("notes");
                    if (notes != null) {
                        for (int i = 0; i < notes.length(); i++) {
                            JSONObject n = notes.optJSONObject(i);
                            if (n == null || !noteId.equals(n.optString("id"))) continue;
                            JSONArray items = n.optJSONArray("items");
                            if (items == null) break;
                            for (int k = 0; k < items.length(); k++) {
                                JSONObject it = items.optJSONObject(k);
                                if (it != null && itemId.equals(it.optString("id"))) {
                                    it.put("done", !it.optBoolean("done", false));
                                }
                            }
                            break;
                        }
                        WidgetData.putBoard(ctx, board);
                    }
                } catch (Exception e) {
                    // offline / no token — nothing to do; the list stays as-is
                } finally {
                    try { refreshAll(ctx); } catch (Exception ignored) {}
                    pending.finish();
                }
            }
        }).start();
    }
}
