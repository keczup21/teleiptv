package pl.openiptv.player;

import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.graphics.SurfaceTexture;
import android.media.MediaCodec;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaLibraryInfo;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.VideoSize;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.analytics.AnalyticsListener;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private static final String PREFS = "openiptv_cache";
    private static final String KEY = "lastVersion";

    /* Czy w interfejsie jest odtwarzacz (ustawia app.js przez most
       setPlayerMode). Tylko wtedy oddajemy stronie klawisze multimedialne
       pilota — poza odtwarzaczem zostają systemowi. */
    private boolean playerMode = false;

    /* ---- odtwarzacz systemowy (patrz ODTWARZACZ NATYWNY niżej) ---- */
    private ExoPlayer player;
    private TextureView videoView;
    /* Liczby z ostatniej próby obrazu systemowego (patrz nativeInfo): nazwa
       użytego dekodera, klatki zgubione i fakt dotarcia klatki na obraz. Dopiero
       one odróżniają „dekoder nie nadąża” od „klatki nie dochodzą na ekran” —
       a to dwie różne naprawy (patrz diagCodecLines w app.js). */
    private volatile String nativeDecoder = "";
    private volatile int nativeDroppedSeen = 0;
    private volatile int nativeDroppedBase = 0;
    private volatile boolean nativeFirstFrame = false;
    private DefaultHttpDataSource.Factory httpFactory;
    private boolean nativeMuted = false;
    /* Stan dla app.js czytany przez most nativeState() — most chodzi na własnym
       wątku, więc nie wolno w nim dotykać odtwarzacza. */
    private volatile String nativeState = "{\"type\":\"idle\"}";

    /* ---- odtwarzacz VLC (patrz VlcEngine) ---- */
    private VlcEngine vlcEngine;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        /* Lokalne pluginy (aktualizacja APK z GitHuba, wybor pliku M3U / EPG bez
           systemowego okna wyboru na Fire TV) musza byc zarejestrowane przed
           super.onCreate. */
        registerPlugin(UpdatePlugin.class);
        registerPlugin(FilePlugin.class);
        clearWebViewCacheOnUpdate();
        super.onCreate(savedInstanceState);
        applyTvViewport();
        bindExitBridge();
        initNativePlayer();
        initVlcEngine();
    }

    /* Fire TV i Android TV zgłaszają ekran o gęstości 2.0, czyli okno 960x540 px
       CSS zamiast 1920x1080, i domyślnie ignorują „meta viewport”. Interfejs —
       projektowany tak samo jak na webOS przy 1920x1080 — wyglądał więc na tych
       telewizorach dwa razy za duży. Włączamy obsługę „meta viewport” oraz tryb
       przeglądowy: strona układa się w stałej szerokości 1920 px (patrz skrypt
       w index.html) i jest skalowana do szerokości ekranu, więc na każdej
       telewizji wygląda tak samo. Ustawienia trafiają tuż po utworzeniu mostu,
       a wczytanie strony jest asynchroniczne, więc obowiązują jeszcze przed
       pierwszym rysowaniem interfejsu. */
    private void applyTvViewport() {
        try {
            Bridge bridge = getBridge();
            WebView webView = bridge != null ? bridge.getWebView() : null;
            if (webView == null) return;

            WebSettings settings = webView.getSettings();
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            webView.requestLayout();
        } catch (Exception ignored) {
            /* brak możliwości zmiany ustawień nie może blokować startu aplikacji */
        }
    }

    /* Most dla przycisku „Wyjdź z aplikacji” z interfejsu. W WebView samo
       window.close() jest ignorowane, więc „Wstecz” na liście kanałów pokazuje
       pytanie o wyjście (app.js -> showExitConfirm), a potwierdzenie woła
       OpenIptvNative.quit(), które dopiero kończy aktywność. */
    private void bindExitBridge() {
        try {
            Bridge bridge = getBridge();
            WebView webView = bridge != null ? bridge.getWebView() : null;
            if (webView == null) return;

            webView.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void quit() {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            finish();
                        }
                    });
                }

                /* interfejs mówi, że na ekranie jest odtwarzacz — od tego
                   momentu klawisze ⏵‖ / ⏹ pilota trafiają do strony */
                @JavascriptInterface
                public void setPlayerMode(final boolean on) {
                    playerMode = on;
                }

                /* ---- odtwarzacz systemowy: app.js woła to samo, co robi każda
                   aplikacja IPTV na Androidzie — oddaje adres kanału sprzętowemu
                   dekoderowi (patrz ODTWARZACZ NATYWNY niżej). Metody mostu
                   chodzą na własnym wątku, więc każda tylko przekazuje robotę na
                   wątek główny i wraca. ---- */

                @JavascriptInterface
                public String playNative(final String url, final String userAgent) {
                    if (url == null || url.isEmpty()) return "error: brak adresu";
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            MainActivity.this.startNative(url, userAgent);
                        }
                    });
                    return "ok";
                }

                @JavascriptInterface
                public void stopNative() {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            MainActivity.this.stopNative();
                        }
                    });
                }

                @JavascriptInterface
                public void setNativePlaying(final boolean playing) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (player != null) player.setPlayWhenReady(playing);
                        }
                    });
                }

                @JavascriptInterface
                public void setNativeMuted(final boolean muted) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            nativeMuted = muted;
                            if (player != null) player.setVolume(muted ? 0f : 1f);
                        }
                    });
                }

                /* Stan odtwarzacza czytany bez czekania (app.js sprawdza nim, czy
                   obraz naprawdę ruszył — patrz armExoWatchdog). */
                @JavascriptInterface
                public String nativeState() {
                    return nativeState;
                }

                /* Co ten odbiornik potrafi natywnie — panel diagnostyki pokazuje
                   to obok testu MSE (patrz diagCodecLines w app.js). */
                @JavascriptInterface
                public String nativeInfo() {
                    try {
                        JSONObject info = new JSONObject();
                        info.put("media3", MediaLibraryInfo.VERSION);
                        info.put("api", Build.VERSION.SDK_INT);
                        info.put("hevc", hasHevcDecoder());
                        /* Liczby z ostatniej próby obrazu systemowego: który dekoder
                           ją prowadził, czy jakakolwiek klatka doszła na obraz i ile
                           klatek wypadło. Bez nich nie da się odróżnić „dekoder nie
                           nadąża” od „klatek nie widać” (patrz diagCodecLines). */
                        info.put("decoder", nativeDecoder);
                        info.put("firstFrame", nativeFirstFrame);
                        int dropped = nativeDroppedSeen - nativeDroppedBase;
                        info.put("dropped", dropped > 0 ? dropped : 0);
                        return info.toString();
                    } catch (Exception error) {
                        return "";
                    }
                }

                /* ---- odtwarzacz VLC (przełącznik „Odtwarzacz VLC (beta)”) ----
                   Te same zadania co droga systemowa, tylko innym silnikiem
                   (patrz VlcEngine): app.js obsługuje obie drogi jednym kodem. */

                @JavascriptInterface
                public String playVlc(final String url, final String userAgent, final boolean textureView) {
                    if (url == null || url.isEmpty()) return "error: brak adresu";
                    /* Biblioteki VLC pakujemy tylko dla architektur telewizorów
                       (patrz libvlcAbiFilters) — na innym odbiorniku most nie ma
                       czego wołać i kanał idzie dotychczasowymi drogami. */
                    if (vlcEngine == null || !VlcEngine.available()) return "error: brak silnika";
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (vlcEngine != null) vlcEngine.start(url, userAgent, textureView);
                        }
                    });
                    return "ok";
                }

                @JavascriptInterface
                public void stopVlc() {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (vlcEngine != null) vlcEngine.stop();
                        }
                    });
                }

                @JavascriptInterface
                public void setVlcPlaying(final boolean playing) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (vlcEngine != null) vlcEngine.setPlaying(playing);
                        }
                    });
                }

                @JavascriptInterface
                public void setVlcMuted(final boolean muted) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (vlcEngine != null) vlcEngine.setMuted(muted);
                        }
                    });
                }

                /* Co VLC widzi w strumieniu — panel diagnostyki pokazuje to obok
                   drogi systemowej (patrz diagCodecLines w app.js). */
                @JavascriptInterface
                public String vlcInfo() {
                    try {
                        return vlcEngine != null ? vlcEngine.infoJson() : "";
                    } catch (Exception error) {
                        return "";
                    }
                }
            }, "OpenIptvNative");
        } catch (Exception ignored) {
            /* bez mostu wyjście zostaje przy systemowym przycisku Wstecz */
        }
    }

    /* Klawisze multimedialne pilota (⏵‖, ⏸, ⏹, ⏪, ⏩). Część dekoderów
       i WebView zjada je dla własnej sesji multimediów, więc do strony nie
       docierało żadne zdarzenie klawiatury i przycisk play/pauza „nie działał”.
       Gdy leci obraz, przekazujemy taki klawisz do app.js
       (window.__openiptvKey) i zatrzymujemy go tutaj — jedno naciśnięcie to
       jedna akcja. Poza odtwarzaczem klawisz idzie dalej, systemowi. */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (playerMode && isMediaKey(keyCode)) {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                if (event.getRepeatCount() == 0) {
                    webView.evaluateJavascript(
                        "(function(){try{return window.__openiptvKey?window.__openiptvKey(" +
                        keyCode + "):''}catch(e){return ''}})()",
                        null);
                }
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }

    private static boolean isMediaKey(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_STOP:
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                return true;
            default:
                return false;
        }
    }

    /* Sprzętowy klawisz „Wstecz” na Android TV / Fire TV: najpierw pytamy
       interfejs (zamykanie nakładek, powrót z odtwarzacza do listy), a dopiero
       gdy ten nie ma nic do zrobienia, oddajemy zdarzenie systemowi. Dzięki
       temu „Wstecz” nigdy nie zamyka aplikacji w trakcie oglądania. */
    @Override
    public void onBackPressed() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        try {
            webView.evaluateJavascript(
                "(function(){try{return window.__openiptvBack?window.__openiptvBack():''}catch(e){return ''}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (!"\"handled\"".equals(value)) MainActivity.super.onBackPressed();
                    }
                });
        } catch (Exception ignored) {
            super.onBackPressed();
        }
    }

    /* Po aktualizacji aplikacji czyścimy cache HTTP WebView raz na nową wersję,
       żeby na pewno wczytały się nowe pliki (index.html + app.js), a nie ich
       mieszanka ze starej i nowej wersji. */
    private void clearWebViewCacheOnUpdate() {
        try {
            String current = currentVersion();
            if (current == null || current.isEmpty()) return;

            SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            if (current.equals(prefs.getString(KEY, ""))) return;

            WebView probe = new WebView(this);
            probe.clearCache(true);
            probe.destroy();
            deleteDatabase("webview.db");
            deleteDatabase("webviewCache.db");

            prefs.edit().putString(KEY, current).apply();
        } catch (Exception ignored) {
            /* brak możliwości wyczyszczenia cache nie może blokować startu aplikacji */
        }
    }

    private String currentVersion() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return String.valueOf(info.getLongVersionCode());
            }
            return String.valueOf(info.versionCode);
        } catch (Exception error) {
            return "";
        }
    }

    /* =====================  ODTWARZACZ NATYWNY (ExoPlayer)  =====================

       Dlaczego to jest w ogóle potrzebne: kanał 4K HEVC z playlisty idzie w WebView
       przez MSE, czyli mpegts.js rozbiera TS i składa fMP4 w JavaScripcie, a dopiero
       potem dekoder systemowy go dekoduje. Na telewizorze to dwa razy więcej pracy
       (CPU + pamięć) niż potrzeba — obraz zrywa się, a po dłuższym oglądaniu system
       zamyka aplikację. Każda „inna aplikacja” IPTV na Androidzie robi to inaczej:
       oddaje adres kanału wprost odtwarzaczowi systemowemu (ExoPlayer/MediaCodec),
       który rozbiera TS/HLS w kodzie natywnym i rysuje klatki bezpośrednio na
       warstwie sprzętowej.

       Dlatego obraz z tego odtwarzacza leci POD stroną: warstwa obrazu jest pierwszym
       dzieckiem okna (czyli pod WebView), a WebView i strona są przezroczyste tam,
       gdzie jest obraz (app.js dodaje klasę „exo-player” — patrz styles.css). Cały
       interfejs — pasek, EPG, panel diagnostyki — rysuje się nad obrazem jak dotąd.

       Warstwę obrazu rysujemy przez TextureView, a nie SurfaceView (2.1.8). Powód
       jest zmierzony, nie teoretyczny: na telewizorze, na którym 2.1.6 pokazał sam
       dźwięk, także element <video> w WebView zostawał czarny, dopóki nie wymusiliśmy
       przejścia klatek przez kompozytor GPU (patrz „video-layer-fix” w styles.css).
       Klatki ExoPlayera na SurfaceView idą płaszczyzną sprzętową obrazu — czyli
       dokładnie tą drogą, która na tym odbiorniku nie działa — więc TextureView
       przenosi je na tę samą drogę, którą idą już klatki <video>. Kosztuje to jedno
       kopiowanie klatki przez GPU, więc gdyby 4K miało przez to gubić klatki, panel
       diagnostyki pokaże to liczbami (nativeInfo → „dropped”) i wtedy wracamy do
       SurfaceView, ale z przezroczystym oknem. Rozstrzygać ma pomiar, nie wiara w
       jedną z dróg.

       Most (OpenIptvNative) jest ten sam co dla przycisku „Wyjdź”: playNative(),
       stopNative(), setNativePlaying(), setNativeMuted(), nativeState(),
       nativeInfo(). Zdarzenia z odtwarzacza wracają do strony przez
       window.__openiptvNativeEvent (patrz app.js). */

    @OptIn(markerClass = UnstableApi.class)
    private void initNativePlayer() {
        try {
            Bridge bridge = getBridge();
            WebView webView = bridge != null ? bridge.getWebView() : null;
            ViewGroup root = findViewById(android.R.id.content);
            if (webView == null || root == null) return;

            /* Warstwa pod stroną: obraz systemowy, domyślnie schowany. */
            videoView = new TextureView(this);
            videoView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.CENTER));
            videoView.setBackgroundColor(Color.BLACK);
            videoView.setVisibility(View.GONE);
            /* Powierzchnia obrazu powstaje dopiero wtedy, gdy warstwa jest widoczna
               i ułożona — dlatego oddajemy ją odtwarzaczowi tutaj, a nie raz przy
               starcie aplikacji (patrz też startNative). */
            videoView.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
                @Override
                public void onSurfaceTextureAvailable(SurfaceTexture surface, int width, int height) {
                    if (player != null) player.setVideoTextureView(videoView);
                }

                @Override
                public void onSurfaceTextureSizeChanged(SurfaceTexture surface, int width, int height) {
                    /* rozmiar powierzchni nie zmienia obrazu — klatkę skaluje
                       odtwarzacz, tak samo jak przy SurfaceView */
                }

                @Override
                public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) {
                    if (player != null) player.clearVideoSurface();
                    return true;
                }

                @Override
                public void onSurfaceTextureUpdated(SurfaceTexture surface) {
                }
            });
            root.addView(videoView, 0);

            /* Strona musi być przezroczysta, inaczej zasłoniłaby obraz. */
            webView.setBackgroundColor(Color.TRANSPARENT);

            /* Bufor na żywo: domyślne 50 s w pamięci odtwarzacza to przy 4K
               kilkadziesiąt megabajtów i obraz daleko za transmisją. 8–24 s
               wystarcza na zrywkę łącza, a start nie czeka pół minuty. */
            DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(8000, 24000, 1500, 4000)
                .setPrioritizeTimeOverSizeThresholds(false)
                .build();

            /* Adresy kanałów to często przekierowania http → https i dostawcy
               sprawdzają identyfikator przeglądarki, więc wysyłamy ten sam, którym
               posługuje się strona (app.js podaje go w playNative). */
            httpFactory = new DefaultHttpDataSource.Factory()
                .setConnectTimeoutMs(8000)
                .setReadTimeoutMs(8000)
                .setAllowCrossProtocolRedirects(true);

            player = new ExoPlayer.Builder(this)
                .setLoadControl(loadControl)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(httpFactory))
                .build();
            player.setAudioAttributes(AudioAttributes.DEFAULT, true);
            /* Powierzchnia obrazu może już istnieć (warstwa była widoczna, zanim
               powstał odtwarzacz) — wtedy przypinamy ją od razu. */
            if (videoView.isAvailable()) player.setVideoTextureView(videoView);
            player.addListener(new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int state) {
                    if (state == Player.STATE_READY) emitNative("playing", null, 0, 0);
                    else if (state == Player.STATE_BUFFERING) emitNative("buffering", null, 0, 0);
                    else if (state == Player.STATE_ENDED) emitNative("ended", null, 0, 0);
                }

                @Override
                public void onIsPlayingChanged(boolean playing) {
                    emitNative(playing ? "playing" : "paused", null, 0, 0);
                }

                @Override
                public void onRenderedFirstFrame() {
                    /* Klatka doszła na powierzchnię obrazu. Razem z licznikiem
                       zgubionych klatek rozstrzyga to, czy brak obrazu to wina
                       dekodera (klatek nie ma), czy warstwy (klatki są, ale ich nie
                       widać) — patrz nativeInfo i diagCodecLines w app.js. */
                    nativeFirstFrame = true;
                }

                @Override
                public void onVideoSizeChanged(VideoSize size) {
                    /* Wymiary klatki to jedyny pewny znak, że jest obraz (a nie sam
                       dźwięk) — app.js czeka na nie swoim budzikiem. */
                    emitNative("size", null, size.width, size.height);
                }

                @Override
                public void onPlayerError(PlaybackException error) {
                    emitNative("error", error != null ? error.getMessage() : "?", 0, 0);
                    MainActivity.this.stopNative();
                }
            });
            /* Liczby prosto z dekodera: nazwa użytego dekodera sprzętowego i klatki,
               które po drodze wypadły. Bez nich „brak obrazu” da się tylko zgadywać
               (patrz nativeInfo → decoder/dropped/firstFrame). */
            player.addAnalyticsListener(new AnalyticsListener() {
                @Override
                public void onVideoDecoderInitialized(AnalyticsListener.EventTime eventTime,
                                                      String decoderName,
                                                      long initializationDurationMs) {
                    nativeDecoder = decoderName != null ? decoderName : "";
                }

                @Override
                public void onDroppedVideoFrames(AnalyticsListener.EventTime eventTime,
                                                 int droppedFrames,
                                                 long elapsedMs) {
                    nativeDroppedSeen = droppedFrames;
                }
            });
        } catch (Exception ignored) {
            /* Brak warstwy natywnej nie może blokować aplikacji — strona ma swoje
               drogi odtwarzania (patrz buildSourceQueue w app.js). */
            player = null;
            videoView = null;
        }
    }

    private void startNative(String url, String userAgent) {
        if (player == null || videoView == null || url == null || url.isEmpty()) return;
        try {
            if (httpFactory != null && userAgent != null && !userAgent.isEmpty()) {
                httpFactory.setUserAgent(userAgent);
            }
            /* Liczniki liczymy od nowa dla każdej próby — panel diagnostyki ma
               pokazywać ten kanał, a nie całą sesję odtwarzacza. */
            nativeDecoder = "";
            nativeFirstFrame = false;
            nativeDroppedBase = nativeDroppedSeen;
            /* Warstwa musi być widoczna, zanim powstanie jej powierzchnia — inaczej
               odtwarzacz dostaje obraz dopiero przy kolejnym wejściu na kanał. */
            videoView.setVisibility(View.VISIBLE);
            if (videoView.isAvailable()) player.setVideoTextureView(videoView);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            player.setMediaItem(MediaItem.fromUri(Uri.parse(url)));
            player.setVolume(nativeMuted ? 0f : 1f);
            player.prepare();
            player.setPlayWhenReady(true);
        } catch (Exception error) {
            emitNative("error", error.getMessage(), 0, 0);
            stopNative();
        }
    }

    private void stopNative() {
        nativeState = "{\"type\":\"idle\"}";
        try {
            if (player != null) {
                player.stop();
                player.clearMediaItems();
            }
        } catch (Exception ignored) {
        }
        try {
            if (videoView != null) videoView.setVisibility(View.GONE);
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } catch (Exception ignored) {
        }
    }

    /* Zdarzenie dla strony: app.js czyta z niego stan obrazu (patrz
       __openiptvNativeEvent). Budowane przez JSONObject, bo komunikatu błędu nie
       wolno przepuścić przez cudzysłów. */
    private void emitNative(final String type, final String message, final int width, final int height) {
        String json;
        try {
            JSONObject event = new JSONObject();
            event.put("type", type);
            if (message != null) event.put("message", message);
            if (width > 0) event.put("width", width);
            if (height > 0) event.put("height", height);
            json = event.toString();
        } catch (Exception error) {
            json = "{\"type\":\"error\"}";
        }
        nativeState = json;
        final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;
        final String payload = json;
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    webView.evaluateJavascript(
                        "window.__openiptvNativeEvent&&window.__openiptvNativeEvent(" + payload + ")",
                        null);
                } catch (Exception ignored) {
                }
            }
        });
    }

    /* ======================  ODTWARZACZ VLC (libVLC)  ======================

       Trzecia droga obrazu (patrz VlcEngine): kanał na żywo może iść silnikiem
       VLC, gdy dekoder odbiornika nie wyrabia z tym strumieniem. Włączana jest
       ręcznie w ustawieniach i tylko dla kanału na żywo — tak samo jak droga
       systemowa, bo obie są testowe (patrz buildSourceQueue w app.js). Most jest
       ten sam (OpenIptvNative): playVlc(), stopVlc(), setVlcPlaying(),
       setVlcMuted(), vlcInfo(), a zdarzenia wracają do strony przez
       window.__openiptvVlcEvent. */

    private void initVlcEngine() {
        try {
            vlcEngine = new VlcEngine(this, new VlcEngine.Listener() {
                @Override
                public void onEvent(String json) {
                    emitVlc(json);
                }
            });
        } catch (Throwable error) {
            /* brak silnika VLC (np. paczka bez bibliotek dla tej architektury)
               nie może blokować aplikacji — kanał pójdzie dotychczasowymi drogami */
            vlcEngine = null;
        }
    }

    /* Zdarzenie obrazu VLC dla strony — ta sama postać, co emitNative wyżej. */
    private void emitVlc(final String json) {
        final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;
        final String payload = json == null ? "{\"type\":\"error\"}" : json;
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    webView.evaluateJavascript(
                        "window.__openiptvVlcEvent&&window.__openiptvVlcEvent(" + payload + ")",
                        null);
                } catch (Exception ignored) {
                }
            }
        });
    }

    /* Czy ten odbiornik ma sprzętowy dekoder HEVC — bez niego kanał 4K nie ruszy
       żadną drogą, a panel diagnostyki mówi to wprost (patrz diagCodecLines). */
    private boolean hasHevcDecoder() {
        MediaCodec codec = null;
        try {
            codec = MediaCodec.createDecoderByType("video/hevc");
            return codec != null;
        } catch (Exception error) {
            return false;
        } finally {
            if (codec != null) {
                try {
                    codec.release();
                } catch (Exception ignored) {
                }
            }
        }
    }

    /* Aplikacja w tle: obraz systemowy nie może lecieć dalej pod spodem (strona
       dostaje o tym zdarzenie i zgadza się z nim co do stanu obrazu). */
    @Override
    public void onStop() {
        super.onStop();
        try {
            if (player != null) player.setPlayWhenReady(false);
        } catch (Exception ignored) {
        }
        try {
            if (vlcEngine != null) vlcEngine.setPlaying(false);
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onDestroy() {
        try {
            if (player != null) {
                player.release();
                player = null;
            }
        } catch (Exception ignored) {
        }
        try {
            if (vlcEngine != null) {
                vlcEngine.release();
                vlcEngine = null;
            }
        } catch (Exception ignored) {
        }
        super.onDestroy();
    }
}

