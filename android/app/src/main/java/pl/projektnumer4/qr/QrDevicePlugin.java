package pl.projektnumer4.qr;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.content.IntentCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Drobne funkcje urządzenia dla aplikacji QR:
 * - keepAwake: ekran nie gaśnie w czasie transmisji, a przy nadawaniu świeci najjaśniej,
 * - takeShared: treść przekazana przez „Udostępnij → QR” (tekst albo pliki) z innej aplikacji.
 */
@CapacitorPlugin(name = "QrDevice")
public class QrDevicePlugin extends Plugin {

    private static final long MAX_SHARED_BYTES = 16L * 1024 * 1024;

    @PluginMethod
    public void keepAwake(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        final boolean bright = Boolean.TRUE.equals(call.getBoolean("bright", false));
        final Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            WindowManager.LayoutParams lp = window.getAttributes();
            lp.screenBrightness = bright ? 1f : WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
            window.setAttributes(lp);
            call.resolve();
        });
    }

    @PluginMethod
    public void takeShared(PluginCall call) {
        final Activity activity = getActivity();
        final Intent intent = activity.getIntent();
        final JSObject ret = new JSObject();
        if (intent == null) { call.resolve(ret); return; }
        final String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) { call.resolve(ret); return; }
        // treść odbieramy tylko raz
        activity.setIntent(new Intent(Intent.ACTION_MAIN));

        new Thread(() -> {
            try {
                List<Uri> uris = new ArrayList<>();
                if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                    ArrayList<Uri> list = IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri.class);
                    if (list != null) uris.addAll(list);
                } else {
                    Uri uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
                    if (uri != null) uris.add(uri);
                }
                JSArray files = new JSArray();
                ContentResolver cr = activity.getContentResolver();
                long total = 0;
                for (Uri uri : uris) {
                    byte[] data = readAll(cr, uri, MAX_SHARED_BYTES - total);
                    if (data == null) continue;
                    total += data.length;
                    JSObject f = new JSObject();
                    f.put("name", displayName(cr, uri));
                    String type = cr.getType(uri);
                    f.put("type", type != null ? type : "application/octet-stream");
                    f.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
                    files.put(f);
                }
                ret.put("files", files);
                CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
                if (text != null) ret.put("text", text.toString());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Nie udało się odczytać udostępnionych danych: " + e.getMessage());
            }
        }).start();
    }

    private static byte[] readAll(ContentResolver cr, Uri uri, long limit) throws Exception {
        try (InputStream in = cr.openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            long sum = 0;
            while ((n = in.read(buf)) > 0) {
                sum += n;
                if (sum > limit) throw new Exception("pliki są większe niż 16 MB");
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }

    private static String displayName(ContentResolver cr, Uri uri) {
        try (Cursor c = cr.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String n = c.getString(0);
                if (n != null && !n.isEmpty()) return n;
            }
        } catch (Exception ignored) { }
        String last = uri.getLastPathSegment();
        return last != null ? last : "plik";
    }
}
