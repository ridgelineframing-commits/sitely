package com.ridgeline.sitely;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Small helper: where the board lives, the bridged auth token, and GET/PUT of /api/board. */
final class WidgetData {
    static final String PREFS = "sitely_widget";
    static final String KEY_TOKEN = "token";
    static final String KEY_JOBVIS = "jobvis";   // JSON map {jobId: bool} bridged from the web app
    static final String KEY_WEEKS = "weeks";     // 2–4, how many work weeks the Weeks widget shows

    private WidgetData() {}

    static String token(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return p.getString(KEY_TOKEN, "");
    }

    static void saveToken(Context ctx, String token) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_TOKEN, token == null ? "" : token).apply();
    }

    /** The web app's per-job calendar toggles, mirrored so the widgets show the same jobs. */
    static void saveJobVisibility(Context ctx, String json) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_JOBVIS, json == null ? "" : json).apply();
    }

    /** True unless the web app explicitly turned this job off. */
    static boolean jobShown(Context ctx, String jobId) {
        String raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_JOBVIS, "");
        if (raw == null || raw.isEmpty() || jobId == null) return true;
        try {
            JSONObject o = new JSONObject(raw);
            if (!o.has(jobId)) return true;
            return o.optBoolean(jobId, true);
        } catch (Exception e) { return true; }
    }

    static int weeks(Context ctx) {
        int w = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_WEEKS, 2);
        return (w < 2 || w > 4) ? 2 : w;
    }

    static void saveWeeks(Context ctx, int w) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt(KEY_WEEKS, (w < 2 || w > 4) ? 2 : w).apply();
    }

    /** Origin of the flavor's start URL, e.g. https://ridgeline-workspace.pages.dev */
    static String origin() {
        try {
            URL u = new URL(BuildConfig.START_URL);
            return u.getProtocol() + "://" + u.getHost();
        } catch (Exception e) {
            return "https://ridgeline-workspace.pages.dev";
        }
    }

    static String boardUrl() { return origin() + "/api/board"; }
    static String jobsUrl() { return origin() + "/api/jobs"; }
    static String jobUrl(String id) { return origin() + "/api/jobs/" + id; }

    /** Authenticated GET returning the raw body — used for /api/jobs and /api/jobs/:id. */
    static String getText(Context ctx, String url) throws Exception {
        String tok = token(ctx);
        if (tok.isEmpty()) throw new Exception("no token");
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestProperty("Authorization", "Bearer " + tok);
        c.setConnectTimeout(9000);
        c.setReadTimeout(9000);
        int code = c.getResponseCode();
        if (code != 200) { c.disconnect(); throw new Exception("http " + code); }
        StringBuilder sb = new StringBuilder();
        BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"));
        String line;
        while ((line = r.readLine()) != null) sb.append(line);
        r.close();
        c.disconnect();
        return sb.toString();
    }

    static JSONObject getBoard(Context ctx) throws Exception {
        String tok = token(ctx);
        if (tok.isEmpty()) throw new Exception("no token");
        HttpURLConnection c = (HttpURLConnection) new URL(boardUrl()).openConnection();
        c.setRequestProperty("Authorization", "Bearer " + tok);
        c.setConnectTimeout(9000);
        c.setReadTimeout(9000);
        int code = c.getResponseCode();
        if (code != 200) { c.disconnect(); throw new Exception("http " + code); }
        StringBuilder sb = new StringBuilder();
        BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"));
        String line;
        while ((line = r.readLine()) != null) sb.append(line);
        r.close();
        c.disconnect();
        return new JSONObject(sb.toString());
    }

    static void putBoard(Context ctx, JSONObject board) throws Exception {
        String tok = token(ctx);
        if (tok.isEmpty()) throw new Exception("no token");
        HttpURLConnection c = (HttpURLConnection) new URL(boardUrl()).openConnection();
        c.setRequestMethod("PUT");
        c.setDoOutput(true);
        c.setRequestProperty("Authorization", "Bearer " + tok);
        c.setRequestProperty("Content-Type", "application/json");
        c.setConnectTimeout(9000);
        c.setReadTimeout(9000);
        OutputStream os = c.getOutputStream();
        os.write(board.toString().getBytes("UTF-8"));
        os.close();
        int code = c.getResponseCode();
        c.disconnect();
        if (code < 200 || code >= 300) throw new Exception("http " + code);
    }
}
