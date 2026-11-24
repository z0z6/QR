package pl.projektnumer4.qr;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // własna wtyczka (ekran włączony w czasie transmisji, „Udostępnij → QR”)
        registerPlugin(QrDevicePlugin.class);
        super.onCreate(savedInstanceState);

        // „Wstecz” zamyka otwarte okna (arkusze, skaner, transmisję); na ekranie głównym chowa aplikację w tle
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                } else {
                    moveTaskToBack(true);
                }
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // nowe „Udostępnij → QR”, gdy aplikacja już działa – odczyta je takeShared()
        setIntent(intent);
    }
}
