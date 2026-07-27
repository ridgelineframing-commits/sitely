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

/**
 * Home-screen work-week view: 2, 3 or 4 weeks of work across every job you have switched on.
 * Tapping the "2w / 3w / 4w" chip in the header cycles the span in place.
 */
public class WeeksWidget extends AppWidgetProvider {
    static final String ACTION_REFRESH = "com.ridgeline.sitely.WEEKS_REFRESH";
    static final String ACTION_CYCLE = "com.ridgeline.sitely.WEEKS_CYCLE";

    private static int piFlags() {
        int f = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 31) f |= PendingIntent.FLAG_IMMUTABLE;
        return f;
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) render(ctx, mgr, id);
    }

    private void render(Context ctx, AppWidgetManager mgr, int id) {
        int weeks = WidgetData.weeks(ctx);
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_schedule);
        rv.setTextViewText(R.id.sched_title, weeks + "-week look ahead");
        rv.setViewVisibility(R.id.sched_mode, android.view.View.VISIBLE);
        rv.setTextViewText(R.id.sched_mode, weeks + "w");

        Intent svc = new Intent(ctx, WeeksWidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        rv.setRemoteAdapter(R.id.sched_list, svc);
        rv.setEmptyView(R.id.sched_list, R.id.sched_empty);

        PendingIntent open = openAppIntent(ctx);
        rv.setOnClickPendingIntent(R.id.sched_title, open);
        // list rows: tapping any day or task opens the app (template + empty fill-in intents)
        Intent rowTap = new Intent(ctx, MainActivity.class);
        rowTap.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int rowFlags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        rv.setPendingIntentTemplate(R.id.sched_list, PendingIntent.getActivity(ctx, 23, rowTap, rowFlags));

        Intent refresh = new Intent(ctx, WeeksWidget.class).setAction(ACTION_REFRESH);
        rv.setOnClickPendingIntent(R.id.sched_refresh, PendingIntent.getBroadcast(ctx, 21, refresh, piFlags()));

        Intent cycle = new Intent(ctx, WeeksWidget.class).setAction(ACTION_CYCLE);
        rv.setOnClickPendingIntent(R.id.sched_mode, PendingIntent.getBroadcast(ctx, 22, cycle, piFlags()));

        mgr.updateAppWidget(id, rv);
        mgr.notifyAppWidgetViewDataChanged(id, R.id.sched_list);
    }

    private static PendingIntent openAppIntent(Context ctx) {
        Intent launch = new Intent(ctx, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int f = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getActivity(ctx, 20, launch, f);
    }

    static void refreshAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, WeeksWidget.class));
        if (ids == null || ids.length == 0) return;
        WeeksWidget w = new WeeksWidget();
        for (int id : ids) w.render(ctx, mgr, id);
        mgr.notifyAppWidgetViewDataChanged(ids, R.id.sched_list);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        String action = intent.getAction();
        if (ACTION_CYCLE.equals(action)) {
            int next = WidgetData.weeks(ctx) + 1;
            if (next > 4) next = 2;
            WidgetData.saveWeeks(ctx, next);
            refreshAll(ctx);
            return;
        }
        if (ACTION_REFRESH.equals(action)) refreshAll(ctx);
    }
}
