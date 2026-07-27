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

/** Home-screen agenda: the next 30 days of work across every job you have switched on. */
public class AgendaWidget extends AppWidgetProvider {
    static final String ACTION_REFRESH = "com.ridgeline.sitely.AGENDA_REFRESH";

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
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_schedule);
        rv.setTextViewText(R.id.sched_title, "Next 30 days");
        rv.setViewVisibility(R.id.sched_mode, android.view.View.GONE);

        Intent svc = new Intent(ctx, AgendaWidgetService.class);
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
        rv.setPendingIntentTemplate(R.id.sched_list, PendingIntent.getActivity(ctx, 12, rowTap, rowFlags));

        Intent refresh = new Intent(ctx, AgendaWidget.class).setAction(ACTION_REFRESH);
        rv.setOnClickPendingIntent(R.id.sched_refresh, PendingIntent.getBroadcast(ctx, 11, refresh, piFlags()));

        mgr.updateAppWidget(id, rv);
        mgr.notifyAppWidgetViewDataChanged(id, R.id.sched_list);
    }

    private static PendingIntent openAppIntent(Context ctx) {
        Intent launch = new Intent(ctx, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int f = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getActivity(ctx, 10, launch, f);
    }

    static void refreshAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, AgendaWidget.class));
        if (ids != null && ids.length > 0) mgr.notifyAppWidgetViewDataChanged(ids, R.id.sched_list);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) refreshAll(ctx);
    }
}
