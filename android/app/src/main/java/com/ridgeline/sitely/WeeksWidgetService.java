package com.ridgeline.sitely;

import android.content.Intent;
import android.widget.RemoteViewsService;

/** Feeds the Weeks widget's list (2–4 work weeks). */
public class WeeksWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new ScheduleFactory(getApplicationContext(), ScheduleFactory.MODE_WEEKS);
    }
}
