package com.ridgeline.sitely;

import android.content.Intent;
import android.widget.RemoteViewsService;

public class BoardWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new BoardFactory(getApplicationContext());
    }
}
