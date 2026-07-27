package com.ridgeline.sitely;

import android.content.Intent;
import android.widget.RemoteViewsService;

/** Feeds the Agenda widget's list (next 30 days). */
public class AgendaWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new ScheduleFactory(getApplicationContext(), ScheduleFactory.MODE_AGENDA);
    }
}
