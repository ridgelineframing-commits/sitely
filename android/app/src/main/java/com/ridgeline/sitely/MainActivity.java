package com.ridgeline.sitely;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.OutputStream;

/**
 * Thin native shell around the live Sitely web app. The start URL is set per build flavor
 * (Field vs desktop) via BuildConfig.START_URL, so the app content always tracks the git
 * deploy — the wrapper never needs rebuilding for a content change.
 */
public class MainActivity extends Activity {
    private WebView web;
    private static final String HOST = "ridgeline-workspace.pages.dev";

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);        // localStorage — needed for the rl_token login session
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        // Bridge for saving blob: downloads (schedule JPEG/PDF share). A bare WebView drops
        // blob:/data: URLs, so the "Text (JPEG)"/"PDF" buttons appeared to do nothing — we read
        // the bytes in the page and write them to the device Downloads folder from native code.
        web.addJavascriptInterface(new BlobBridge(), "SitelyBlobBridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                String url = req.getUrl().toString();
                if (url.contains(HOST)) return false;                 // keep Sitely in the app
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception e) {}
                return true;                                          // companion apps / mailto / tel open outside
            }
            @Override
            public void onPageFinished(WebView v, String url) { captureToken(); }
        });
        web.setWebChromeClient(new WebChromeClient());

        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String ua, String cd, String mime, long len) {
                if (url == null) return;
                // DownloadManager can't fetch blob:/data: — read the bytes in the page and save natively.
                if (url.startsWith("blob:") || url.startsWith("data:")) { saveInPageUrl(url, mime); return; }
                try {
                    DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                    r.setMimeType(mime);
                    r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, URLUtil.guessFileName(url, cd, mime));
                    ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
                } catch (Exception e) {}
            }
        });

        if (saved == null) web.loadUrl(BuildConfig.START_URL); else web.restoreState(saved);
    }

    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    // Leaving the app is when the login session is most likely present — capture it for the widget.
    @Override protected void onPause() { super.onPause(); captureToken(); }

    /** Copy the web app's rl_token from localStorage into native storage so the home-screen
     *  whiteboard widget can read/write /api/board on its own. */
    private void captureToken() {
        if (web == null) return;
        try {
            web.evaluateJavascript(
                "(function(){try{return localStorage.getItem('rl_token')||''}catch(e){return ''}})()",
                new ValueCallback<String>() {
                    @Override public void onReceiveValue(String value) {
                        if (value == null) return;
                        String t = value;
                        if (t.length() >= 2 && t.startsWith("\"") && t.endsWith("\"")) t = t.substring(1, t.length() - 1);
                        t = t.replace("\\\"", "\"").replace("\\\\", "\\");
                        if (!t.isEmpty() && !"null".equals(t)) {
                            WidgetData.saveToken(MainActivity.this, t);
                            WhiteboardWidget.refreshAll(MainActivity.this);
                        }
                    }
                });
        } catch (Exception e) {}
    }

    /** Read a blob:/data: URL's bytes inside the page (XHR -> FileReader base64) and hand them
     *  to the native bridge, which writes them to the device Downloads folder. */
    private void saveInPageUrl(String url, String mime) {
        if (web == null || url == null) return;
        String u = url.replace("\\", "\\\\").replace("'", "\\'");
        String m = (mime == null ? "" : mime).replace("\\", "\\\\").replace("'", "\\'");
        String js =
            "(function(){try{" +
            "var x=new XMLHttpRequest();x.open('GET','" + u + "',true);x.responseType='blob';" +
            "x.onload=function(){var r=new FileReader();r.onloadend=function(){" +
            "var s=(''+r.result);var b=s.substring(s.indexOf(',')+1);" +
            "var t='" + m + "'||(x.response&&x.response.type)||'application/octet-stream';" +
            "SitelyBlobBridge.save(b,t);};r.readAsDataURL(x.response);};" +
            "x.onerror=function(){SitelyBlobBridge.fail();};x.send();" +
            "}catch(e){SitelyBlobBridge.fail();}})();";
        try { web.evaluateJavascript(js, null); } catch (Exception e) {}
    }

    /** JS-callable bridge that persists downloaded bytes to Downloads. */
    private class BlobBridge {
        @JavascriptInterface
        public void save(String base64, String mime) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                saveToDownloads(bytes, mime);
            } catch (Exception e) { toast("Couldn't save the file."); }
        }
        @JavascriptInterface
        public void fail() { toast("Couldn't read the file to save. Try from Chrome."); }
    }

    private static String extFor(String mime) {
        if (mime == null) return "bin";
        if (mime.contains("pdf")) return "pdf";
        if (mime.contains("jpeg") || mime.contains("jpg")) return "jpg";
        if (mime.contains("png")) return "png";
        return "bin";
    }

    /** Write bytes into the public Downloads collection (MediaStore, no storage permission on
     *  API 29+). Pre-29 falls back to the app-scoped external files dir. */
    private void saveToDownloads(byte[] bytes, String mime) {
        String type = (mime == null || mime.isEmpty()) ? "application/octet-stream" : mime;
        String name = "Sitely-schedule-" + System.currentTimeMillis() + "." + extFor(type);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                cv.put(MediaStore.Downloads.MIME_TYPE, type);
                cv.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri item = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (item == null) { toast("Couldn't save the file."); return; }
                OutputStream os = getContentResolver().openOutputStream(item);
                os.write(bytes); os.close();
                cv.clear(); cv.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(item, cv, null, null);
            } else {
                java.io.File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                java.io.File f = new java.io.File(dir, name);
                java.io.FileOutputStream fos = new java.io.FileOutputStream(f);
                fos.write(bytes); fos.close();
            }
            toast("Saved " + name + " to Downloads.");
        } catch (Exception e) { toast("Couldn't save the file."); }
    }

    private void toast(final String msg) {
        new Handler(Looper.getMainLooper()).post(new Runnable() {
            @Override public void run() { Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show(); }
        });
    }
}
