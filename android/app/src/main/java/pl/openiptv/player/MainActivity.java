package pl.openiptv.player;

import android.content.ComponentCallbacks2;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.graphics.SurfaceTexture;
import android.media.MediaCodec;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
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
import com.getcapacitor.WebViewListener;

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
    /* Ostatni komunikat błędu drogi systemowej: biały ekran znaczy „strona
       przezroczysta, a pod nią żadnej warstwy”, więc panel diagnostyki musi
       powiedzieć, co tę próbę zakończyło (patrz nativeInfo). */
    private volatile String nativeLastError = "";
    private DefaultHttpDataSource.Factory httpFactory;
    private boolean nativeMuted = false;
    /* Stan dla app.js czytany przez most nativeState() — most chodzi na własnym
       wątku, więc nie wolno w nim dotykać odtwarzacza. */
    private volatile String nativeState = "{\"type\":\"idle\"}";

    /* ---- kondycja obrazu systemowego (patrz checkNativeStall) ----

       Droga MSE ma swój strażnik (guardTick w app.js), a VLC liczy klatki na
       powierzchni obrazu (countFrames w VlcEngine). Odtwarzacz systemowy nie miał
       dotąd żadnego: gdy w połowie meczu dekoder albo łącze stanęło, na ekranie
       zostawała jedna klatka, a aplikacja dalej twierdziła, że obraz leci —
       jedynym wyjściem było wyjście z aplikacji. Liczymy więc klatki dochodzące
       na powierzchnię (onSurfaceTextureUpdated) i po NATIVE_STALL_TICKS sekundach
       bez ani jednej oddajemy obraz na świeży odtwarzacz (restartNativePlayer). */
    private static final int NATIVE_STALL_TICKS = 10;   /* sekundy bez klatki = obraz stanął */
    private static final int NATIVE_MAX_RESTARTS = 2;   /* ile razy odtwarzamy odtwarzacz */
    private volatile int nativeSurfaceFrames = 0;
    private int nativeFramesSeen = 0;
    private int nativeFlatTicks = 0;
    private volatile boolean nativeStallReported = false;
    private volatile int nativeRestarts = 0;
    private volatile int nativeStalls = 0;
    private volatile long nativePosition = 0;
    private volatile int nativeTrimLevel = 0;
    private String nativeUrl = "";
    private String nativeUserAgent = "";
    private Runnable nativeWatch;

    /* ---- odzyskiwanie po zniknięciu procesu strony (patrz bindWebViewRecovery) ----

       WebView rysuje stronę w osobnym procesie. Gdy system go zamknie (brak
       pamięci po długim oglądaniu), Capacitor domyślnie zwraca „nie obsłużono”
       i Android zamyka CAŁĄ aplikację — dokładnie to, co wyglądało jak „apka
       sama się wyrzuciła”. Zamiast tego odtwarzamy aktywność: nowy WebView,
       nowy proces strony. Drugi przypadek to proces, który żyje, ale jego wątek
       stanął: wtedy nic nie odpowiada (pilot, Wstecz), więc budzik pyta stronę
       o życie i po HEARTBEAT_LOST milisekund ciszy robi to samo. */
    private static final String KEY_RECOVERIES = "webViewRecoveries";
    private static final String KEY_RECOVERY_AT = "webViewRecoveryAt";
    private static final String KEY_RECOVERY_WHY = "webViewRecoveryWhy";
    private static final long HEARTBEAT_TICK = 4000;
    private static final long HEARTBEAT_LOST = 12000;
    private final Handler watchHandler = new Handler(Looper.getMainLooper());
    private boolean pageLoaded = false;
    private boolean heartbeatPending = false;
    private long heartbeatSince = 0;
    private Runnable heartbeatTick;

    /* ---- odtwarzacz VLC (patrz VlcEngine) ---- */
    private VlcEngine vlcEngine;

    /* Czy warstwa obrazu (TextureView) i odtwarzacz systemowy zostaly juz
       utworzone — patrz ensureNativePlayer. Na starcie nie tworzymy ich wcale:
       budowa ExoPlayera to kilkaset milisekund na dekoderze, a obraz potrzebny
       jest dopiero po wybraniu kanalu. */
    private boolean nativeLayerReady = false;

    /* Czy strona poprosila o zwezenie warstwy obrazu (tryb obraz + EPG).
       Pamietamy to, bo strona moze poprosic o zwezenie, zanim warstwa w ogole
       powstanie — a wtedy uklad trzeba nalozyc na swiezo utworzona warstwe
       (patrz ensureNativePlayer). */
    private boolean videoSplit = false;

    /* Czy obraz zgasił system, gdy aplikacja schodziła w tło (patrz onStop).
       Po powrocie wznawiamy właśnie taki obraz — pauza użytkownika zostaje
       pauzą, a kanał zatrzymany przez system nie może zostać na jednej klatce
       i wyglądać jak zapauzowany. */
    private boolean pausedByStop = false;

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
        /* Tło okna na czarno. Strona w trybie obrazu jest przezroczysta, więc gdy
           żadna warstwa obrazu nie jest widoczna (droga padła, kanał się dopiero
           łączy), przez dziurę widać było białe tło motywu — na odbiorniku
           wyglądało to jak „biały ekran”, choć znaczyło „brak warstwy obrazu”
           (patrz diagCodecLines w app.js: wiersz o warstwie obrazu). */
        getWindow().getDecorView().setBackgroundColor(Color.BLACK);
        bindExitBridge();
        /* Proces strony (renderer) i budzik jej życia — patrz bindWebViewRecovery.
           Musi być gotowe przed pierwszym kanałem: to właśnie po długim oglądaniu
           system zamyka proces strony, a wtedy domyślna obsługa Capacitora kończy
           całą aplikację. */
        bindWebViewRecovery();
        prepareVideoLayer();
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

    /* Tlo strony jest przezroczyste, zeby przez nia bylo widac warstwe obrazu
       pod spodem. Ustawiamy to od razu (jeden wpis), a samo tworzenie warstwy
       i odtwarzacza systemowego odkładamy do pierwszego kanalu — patrz
       ensureNativePlayer. Wczesniej powstawaly one w onCreate, czyli na
       krytycznej drodze startu aplikacji, choc obraz jest potrzebny dopiero po
       wybraniu kanalu. */
    private void prepareVideoLayer() {
        try {
            Bridge bridge = getBridge();
            WebView webView = bridge != null ? bridge.getWebView() : null;
            if (webView != null) webView.setBackgroundColor(Color.TRANSPARENT);
        } catch (Exception ignored) {
            /* brak mostu nie moze blokowac startu aplikacji */
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

                /* Tryb dzielony obraz + EPG: warstwa obrazu zwęża się do lewej
                   kolumny, żeby po prawej zmieściła się lista programów (patrz
                   showPlayerEpg w app.js). Obraz rysuje warstwa pod stroną, więc
                   sam CSS jej nie ruszy — stąd ten most. Obsługuje obie drogi
                   sprzętowe: odtwarzacz systemowy (videoView) i VLC (VlcEngine). */
                @JavascriptInterface
                public void setVideoSplit(final boolean on) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            applyVideoSplit(on);
                        }
                    });
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
                            MainActivity.this.startNative(url, userAgent, false);
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

                /* Świeży odtwarzacz dla tego samego kanału (patrz
                   restartNativePlayer): most woła to, gdy obraz systemowy stanął,
                   zamiast oddawać kanał kolejce przy pierwszym zrywie. */
                @JavascriptInterface
                public String restartNative() {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            MainActivity.this.restartNativePlayer();
                        }
                    });
                    return "ok";
                }

                @JavascriptInterface
                public void setNativePlaying(final boolean playing) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (player != null) {
                                player.setPlayWhenReady(playing);
                                return;
                            }
                            /* Odtwarzacz mógł zostać zwolniony przy krytycznym
                               braku pamięci (patrz onTrimMemory); „graj” buduje go
                               od nowa dla tego samego kanału. */
                            if (playing && !nativeUrl.isEmpty()) restartNativePlayer();
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
                        /* Czy warstwa obrazu systemowego jest w tej chwili widoczna
                           i czy jej powierzchnia jest gotowa: bez tego brak obrazu
                           wygląda jak wina dekodera, choć znaczy „brak warstwy”
                           (patrz diagCodecLines w app.js). */
                        info.put("layerVisible", isNativeLayerVisible());
                        info.put("surfaceReady", videoView != null && videoView.isAvailable());
                        info.put("error", nativeLastError);
                        /* Ile razy obraz systemowy stanął i ile razy interfejs był
                           odtwarzany (patrz checkNativeStall, recoverWebView). Bez
                           tych liczb „po dłuższym oglądaniu coś się zepsuło” znowu
                           byłoby tylko wrażeniem — a nie wiadomo, czy ratował obraz
                           odtwarzacz, czy cały interfejs. */
                        info.put("stalls", nativeStalls);
                        info.put("restarts", nativeRestarts);
                        info.put("position", nativePosition);
                        info.put("trim", nativeTrimLevel);
                        info.put("recoveries", recoveryCount());
                        info.put("recoveryReason", recoveryReason());
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

                /* Skok w nagraniu (catch-up): pozycja w milisekundach, tak samo jak
                   w app.js (patrz seekArchiveHardware). Dzięki temu archiwum idzie
                   silnikiem VLC razem z przewijaniem, a nie tylko z obrazem. */
                @JavascriptInterface
                public void setVlcTime(final long ms) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (vlcEngine != null) vlcEngine.setTime(ms);
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

    /* =================  PROCES STRONY: PRZYWRACANIE INTERFEJSU  =================

       Dwa przypadki, które na dłuższym oglądaniu wyglądały jak „zawieszona apka”:

         • proces renderowania strony zniknął (system go zamknął albo padł) —
           ekran zostaje na ostatniej klatce, a Capacitor bez własnego listenera
           zwraca „nie obsłużono”, więc Android zamyka całe aplikacje,
         • proces żyje, ale wątek strony stanął — nic nie odpowiada (pilot,
           Wstecz, nasze evaluateJavascript), a jedynym wyjściem było zabicie
           aplikacji.

       W obu przypadkach odtwarzamy aktywność: nowy WebView, nowy proces strony,
       świeży app.js. To widoczny koszt (wraca lista kanałów), ale mniejszy niż
       wyjście z aplikacji — i tylko tak da się wyjść z zamrożonego procesu.
       Licznik odtworzeń zapisujemy, żeby panel diagnostyki po powrocie pokazał,
       że interfejs był odtwarzany, a nie że „nic się nie stało”. */

    private void bindWebViewRecovery() {
        try {
            Bridge bridge = getBridge();
            if (bridge == null) return;
            bridge.addWebViewListener(new WebViewListener() {
                @Override
                public void onPageLoaded(WebView webView) {
                    pageLoaded = true;
                }

                @Override
                public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                    pageLoaded = false;
                    boolean crashed = detail != null && detail.didCrash();
                    rememberRecovery(crashed ? "renderer-crash" : "renderer-memory");
                    recoverWebView(crashed ? "renderer-crash" : "renderer-memory");
                    /* true = obsłużone. Domyślne false każe systemowi zamknąć
                       całą aplikację razem z martwym procesem strony. */
                    return true;
                }
            });
        } catch (Exception ignored) {
            /* bez listenera zostaje dotychczasowe zachowanie Capacitora */
        }
    }

    /* Odtworzenie interfejsu poza kolejką zdarzeń WebView: aktywność buduje się
       od nowa (onDestroy zwalnia stary most, onCreate tworzy nowy WebView).
       Po trzech odtworzeniach w dziesięć minut nie ma już czego ratować —
       kończymy aplikację, zamiast odtwarzać ją w kółko. */
    private void recoverWebView(final String reason) {
        nativeLastError = reason;
        watchHandler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    stopHeartbeat();
                    if (isFinishing() || isDestroyed()) return;
                    if (recoveryCount() > 3) {
                        finish();
                        return;
                    }
                    recreate();
                } catch (Exception error) {
                    finish();
                }
            }
        });
    }

    /* Licznik odtworzeń interfejsu — okno dziesięciu minut, bo tyle wystarcza,
       żeby odróżnić „system raz zamknął proces” od „proces pada w kółko”. */
    private int rememberRecovery(String reason) {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            long now = System.currentTimeMillis();
            long last = prefs.getLong(KEY_RECOVERY_AT, 0L);
            int count = prefs.getInt(KEY_RECOVERIES, 0);
            count = (now - last < 10 * 60 * 1000L) ? count + 1 : 1;
            prefs.edit()
                .putInt(KEY_RECOVERIES, count)
                .putLong(KEY_RECOVERY_AT, now)
                .putString(KEY_RECOVERY_WHY, reason == null ? "" : reason)
                .apply();
            return count;
        } catch (Exception error) {
            return 0;
        }
    }

    private int recoveryCount() {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            long now = System.currentTimeMillis();
            if (now - prefs.getLong(KEY_RECOVERY_AT, 0L) >= 10 * 60 * 1000L) return 0;
            return prefs.getInt(KEY_RECOVERIES, 0);
        } catch (Exception error) {
            return 0;
        }
    }

    private String recoveryReason() {
        try {
            return getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_RECOVERY_WHY, "");
        } catch (Exception error) {
            return "";
        }
    }

    /* Budzik życia strony. evaluateJavascript wykonuje się w wątku strony, więc
       brak odpowiedzi w HEARTBEAT_LOST milisekund znaczy, że ten wątek stanął
       (albo proces jest w połowie zamknięcia) — wtedy odtwarzamy interfejs.
       Pytamy tylko po wczytaniu strony i tylko gdy aplikacja jest na ekranie:
       w tle WebView może legalnie wstrzymać wykonywanie skryptów. */
    private void startHeartbeat() {
        stopHeartbeat();
        heartbeatTick = new Runnable() {
            @Override
            public void run() {
                if (heartbeatTick != this) return;
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView == null || !pageLoaded) {
                    watchHandler.postDelayed(this, HEARTBEAT_TICK);
                    return;
                }
                long now = SystemClock.uptimeMillis();
                if (heartbeatPending) {
                    if (now - heartbeatSince < HEARTBEAT_LOST) {
                        watchHandler.postDelayed(this, HEARTBEAT_TICK);
                        return;
                    }
                    heartbeatPending = false;
                    rememberRecovery("heartbeat");
                    recoverWebView("heartbeat");
                    return;
                }
                heartbeatPending = true;
                heartbeatSince = now;
                try {
                    webView.evaluateJavascript(
                        "window.__openiptvHeartbeat?window.__openiptvHeartbeat():''",
                        new ValueCallback<String>() {
                            @Override
                            public void onReceiveValue(String value) {
                                heartbeatPending = false;
                            }
                        });
                } catch (Exception error) {
                    heartbeatPending = false;
                }
                watchHandler.postDelayed(this, HEARTBEAT_TICK);
            }
        };
        watchHandler.postDelayed(heartbeatTick, HEARTBEAT_TICK);
    }

    private void stopHeartbeat() {
        if (heartbeatTick != null) {
            watchHandler.removeCallbacks(heartbeatTick);
            heartbeatTick = null;
        }
        heartbeatPending = false;
    }

    @Override
    public void onResume() {
        super.onResume();
        startHeartbeat();
    }

    @Override
    public void onPause() {
        stopHeartbeat();
        super.onPause();
    }

    /* System kończy pamięć: odtwarzacz, który stoi (pauza, aplikacja w tle), nie
       może dalej trzymać dekodera i bufora. Wracamy do niego w onStart, więc
       pauza użytkownika zostaje pauzą, a obraz wraca po powrocie do aplikacji. */
    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        nativeTrimLevel = level;
        if (level < ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL) return;
        try {
            if (player != null && !player.getPlayWhenReady()) {
                /* nowa próba po powrocie: limit restartów liczy zrywy obrazu w
                   jednym odtwarzaniu, a nie zwolnienia pamięci */
                nativeRestarts = 0;
                releaseNativePlayer();
            }
        } catch (Exception ignored) {
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
       stopNative(), restartNative(), setNativePlaying(), setNativeMuted(),
       nativeState(), nativeInfo(). Zdarzenia z odtwarzacza wracają do strony przez
       window.__openiptvNativeEvent (patrz app.js). */

    /* Warstwa obrazu i odtwarzacz systemowy powstaja przy PIERWSZYM kanale,
       nie w onCreate: budowa ExoPlayera (LoadControl, MediaSourceFactory, dwaj
       sluchacze) to na dekoderze kilkaset milisekund, a na starcie aplikacji
       nie jest potrzebna ani jedna klatka — patrz prepareVideoLayer. Strona
       wola playNative(), a to wola te metode (patrz startNative). */
    @OptIn(markerClass = UnstableApi.class)
    private void ensureNativePlayer() {
        /* Warstwa obrazu powstaje raz. Sam odtwarzacz może powstać jeszcze raz:
           po zerwaniu obrazu (patrz restartNativePlayer) i po zwolnieniu przy
           krytycznym braku pamięci (patrz onTrimMemory) — wtedy budujemy tylko
           jego, bez drugiej warstwy pod stroną. */
        if (nativeLayerReady && player != null) return;
        if (nativeLayerReady) {
            createNativePlayer();
            return;
        }
        nativeLayerReady = true;
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
                    /* Jedna klatka doszła na ekran. To jedyny licznik, którego
                       odtwarzacz nie może nam zamilczeć (patrz checkNativeStall) —
                       na nim stoi wykrywanie zatrzymanego obrazu, tak samo jak
                       w VlcEngine (patrz watchSurfaceFrames). */
                    nativeSurfaceFrames++;
                }
            });
            root.addView(videoView, 0);
            /* Strona mogla juz poprosic o tryb obraz + EPG, zanim warstwa
               powstawala — uklad nakladamy od razu na swieza warstwe. */
            applyVideoSplit(videoSplit);

            /* Strona musi być przezroczysta, inaczej zasłoniłaby obraz. */
            webView.setBackgroundColor(Color.TRANSPARENT);

            createNativePlayer();
        } catch (Exception ignored) {
            /* Brak warstwy natywnej nie może blokować aplikacji — strona ma swoje
               drogi odtwarzania (patrz buildSourceQueue w app.js). */
            player = null;
            /* ponowna proba przy nastepnym kanale: nieudane utworzenie warstwy
               nie moze zablokowac drogi systemowej na stale */
            nativeLayerReady = false;
            videoView = null;
        }
    }

    /* Sam odtwarzacz, bez warstwy obrazu. Powstaje przy pierwszym kanale, a potem
       jeszcze po każdym zwolnieniu: restart po zatrzymanym obrazie
       (restartNativePlayer) i krytyczny brak pamięci (onTrimMemory). Warstwa
       (TextureView) zostaje ta sama, więc nie ma drugiej powierzchni pod stroną. */
    @OptIn(markerClass = UnstableApi.class)
    private void createNativePlayer() {
        try {
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
            if (videoView != null && videoView.isAvailable()) player.setVideoTextureView(videoView);
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
            startNativeWatch();
        } catch (Exception ignored) {
            /* Bez odtwarzacza kanał idzie drogami strony (patrz buildSourceQueue
               w app.js) — most nadal odpowiada, więc kolejka prób działa dalej. */
            player = null;
        }
    }

    private void startNative(String url, String userAgent, boolean restart) {
        if (url == null || url.isEmpty()) return;
        /* warstwa obrazu i odtwarzacz powstaja tutaj — przy pierwszym kanale
           (patrz ensureNativePlayer), a nie na starcie aplikacji */
        ensureNativePlayer();
        if (player == null || videoView == null) return;
        try {
            if (httpFactory != null && userAgent != null && !userAgent.isEmpty()) {
                httpFactory.setUserAgent(userAgent);
            }
            nativeUrl = url;
            nativeUserAgent = userAgent == null ? "" : userAgent;
            /* Liczniki liczymy od nowa dla każdej próby — panel diagnostyki ma
               pokazywać ten kanał, a nie całą sesję odtwarzacza. Wyjątkiem jest
               restart tego samego kanału: on musi pamiętać, ile razy już próbował
               (patrz checkNativeStall), inaczej limit nigdy by się nie wyczerpał. */
            nativeDecoder = "";
            nativeFirstFrame = false;
            nativeLastError = "";
            nativeDroppedBase = nativeDroppedSeen;
            nativeFlatTicks = 0;
            nativeFramesSeen = nativeSurfaceFrames;
            nativeStallReported = false;
            if (!restart) nativeRestarts = 0;
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
        /* kanał zamknięty: nie ma czego wznawiać po powrocie do aplikacji
           (patrz onStart) ani restartować po zrywie (patrz restartNativePlayer) */
        nativeUrl = "";
        nativeUserAgent = "";
        nativeFlatTicks = 0;
        nativeStallReported = false;
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

    /* Świeży odtwarzacz dla tego samego kanału. To odpowiedź na obraz, który
       stanął (checkNativeStall): zatrzymany egzemplarz ExoPlayera potrafi już nie
       wrócić do gry, a nowy dostaje nowy dekoder i nowy bufor. Po NATIVE_MAX_RESTARTS
       próbach oddajemy kanał kolejce (app.js przejdzie do następnego sposobu). */
    @OptIn(markerClass = UnstableApi.class)
    private void restartNativePlayer() {
        if (nativeUrl.isEmpty()) return;
        String url = nativeUrl;
        String userAgent = nativeUserAgent;
        if (nativeRestarts >= NATIVE_MAX_RESTARTS) {
            emitNative("stalled-out", null, 0, 0);
            stopNative();
            return;
        }
        nativeRestarts++;
        nativeStallReported = false;
        nativeFlatTicks = 0;
        releaseNativePlayer();
        ensureNativePlayer();
        if (player == null) {
            emitNative("error", "brak odtwarzacza", 0, 0);
            stopNative();
            return;
        }
        emitNative("restart", null, 0, 0);
        startNative(url, userAgent, true);
    }

    /* Zwolnienie samego odtwarzacza, bez ruszania warstwy obrazu: po restarcie
       warstwa zostaje ta sama, a przy krytycznym braku pamięci zwalniamy dekoder
       i bufor, żeby system nie zamknął aplikacji. */
    @OptIn(markerClass = UnstableApi.class)
    private void releaseNativePlayer() {
        stopNativeWatch();
        nativePosition = 0;
        try {
            if (player != null) {
                player.clearVideoSurface();
                player.release();
                player = null;
            }
        } catch (Exception ignored) {
        }
        nativeState = "{\"type\":\"idle\"}";
    }

    /* Budzik kondycji obrazu systemowego: co sekundę patrzy, czy klatki jeszcze
       dochodzą na powierzchnię. Kanał na żywo zawsze je oddaje, więc brak przyrostu
       przez NATIVE_STALL_TICKS sekund to zatrzymany obraz, a nie „wolny strumień”
       (wolny start pilnuje armExoWatchdog po stronie app.js). */
    private void startNativeWatch() {
        if (nativeWatch != null) return;
        nativeWatch = new Runnable() {
            @Override
            public void run() {
                checkNativeStall();
                /* tylko bieżący łańcuch: restart odtwarzacza zakłada nowy budzik
                   (startNativeWatch), a stary nie może wtedy wrócić jako drugi */
                if (nativeWatch == this) watchHandler.postDelayed(this, 1000);
            }
        };
        watchHandler.postDelayed(nativeWatch, 1000);
    }

    private void stopNativeWatch() {
        if (nativeWatch != null) {
            watchHandler.removeCallbacks(nativeWatch);
            nativeWatch = null;
        }
        nativeFlatTicks = 0;
    }

    private void checkNativeStall() {
        if (player == null) {
            nativeFlatTicks = 0;
            return;
        }
        try {
            nativePosition = Math.max(0, player.getCurrentPosition());
            /* Pauza i aplikacja w tle nie są zatrzymanym obrazem; buforowanie też
               nie — kończy się błędem odtwarzacza (timeout 8 s), nie ciszą. */
            if (!player.getPlayWhenReady() || player.getPlaybackState() != Player.STATE_READY) {
                nativeFlatTicks = 0;
                nativeFramesSeen = nativeSurfaceFrames;
                return;
            }
            int frames = nativeSurfaceFrames;
            if (frames != nativeFramesSeen) {
                nativeFramesSeen = frames;
                nativeFlatTicks = 0;
                nativeStallReported = false;
                return;
            }
            /* Przed pierwszą klatką nie ma czego pilnować — to jeszcze start
               kanału (patrz armExoWatchdog w app.js). */
            if (!nativeFirstFrame) return;
            nativeFlatTicks++;
            if (nativeFlatTicks < NATIVE_STALL_TICKS || nativeStallReported) return;
            nativeStallReported = true;
            nativeStalls++;
            emitNative("stalled", null, 0, 0);
            restartNativePlayer();
        } catch (Exception ignored) {
            /* odtwarzacz w trakcie zwalniania — następna próbka go nie zastanie */
        }
    }

    /* Zwężenie warstwy obrazu do lewej kolumny (62%) na czas trybu dzielonego
       obraz + EPG; po wyjściu wraca na cały ekran. Dotyczy obu dróg sprzętowych:
       odtwarzacza systemowego (videoView) i VLC (vlcEngine.setSplit). Drogi
       strony (<video>) zwęża CSS w app.js. */
    private void applyVideoSplit(boolean on) {
        videoSplit = on;
        try {
            if (vlcEngine != null) vlcEngine.setSplit(on);
        } catch (Exception ignored) {
        }
        try {
            if (videoView == null) return;
            ViewGroup.LayoutParams current = videoView.getLayoutParams();
            if (!(current instanceof FrameLayout.LayoutParams)) return;
            FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) current;
            int screenWidth = getResources().getDisplayMetrics().widthPixels;
            params.width = on ? Math.round(screenWidth * 0.62f) : ViewGroup.LayoutParams.MATCH_PARENT;
            params.gravity = on ? (Gravity.START | Gravity.CENTER_VERTICAL) : Gravity.CENTER;
            videoView.setLayoutParams(params);
        } catch (Exception ignored) {
        }
    }

    /* Czy warstwa obrazu systemowego jest w tej chwili widoczna. Strona na czas
       obrazu jest przezroczysta, więc warstwa ukryta znaczy „pod spodem nie ma
       czego oglądać” — a to jest właśnie ten biały (od 2.1.10 czarny) ekran,
       który trzeba umieć odróżnić od winy dekodera (patrz nativeInfo). */
    private boolean isNativeLayerVisible() {
        try {
            return videoView != null && videoView.getVisibility() == View.VISIBLE;
        } catch (Exception error) {
            return false;
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
        /* Ostatni błąd drogi systemowej trzymamy dla panelu diagnostyki: bez niego
           brak obrazu nie mówi, co się właściwie stało (patrz nativeInfo). */
        if ("error".equals(type) && message != null) nativeLastError = message;
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
       ręcznie w ustawieniach na kanale na żywo i w archiwum (catch-up) — tak samo
       jak droga systemowa, bo obie są testowe (patrz buildSourceQueue w app.js).
       Most jest ten sam (OpenIptvNative): playVlc(), stopVlc(), setVlcPlaying(),
       setVlcMuted(), setVlcTime(), vlcInfo(), a zdarzenia wracają do strony przez
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

    /* Powrót do aplikacji: obraz, który zgasił system w onStop, wraca sam.
       Wznawiamy tylko to, co naprawdę leciało — pauza użytkownika zostaje pauzą
       (patrz pausedByStop). App.js dowiaduje się o tym zdarzeniem z silnika, więc
       pasek i pilot znowu pokazują lecący obraz (patrz emitVlc, emitNative). */
    @Override
    public void onStart() {
        super.onStart();
        if (!pausedByStop) return;
        pausedByStop = false;
        /* Odtwarzacz mógł zostać zwolniony w tle przez krytyczny brak pamięci
           (patrz onTrimMemory) — wtedy wracamy do kanału na świeżym odtwarzaczu,
           zamiast pokazywać czarny ekran pod przezroczystą stroną. */
        if (player == null && !nativeUrl.isEmpty()) {
            restartNativePlayer();
            return;
        }
        try {
            if (player != null) player.setPlayWhenReady(true);
        } catch (Exception ignored) {
        }
        try {
            if (vlcEngine != null) vlcEngine.setPlaying(true);
        } catch (Exception ignored) {
        }
    }

    /* Aplikacja w tle: obraz systemowy nie może lecieć dalej pod spodem (strona
       dostaje o tym zdarzenie i zgadza się z nim co do stanu obrazu). */
    @Override
    public void onStop() {
        super.onStop();
        try {
            if (player != null && player.getPlayWhenReady()) {
                player.setPlayWhenReady(false);
                pausedByStop = true;
            }
        } catch (Exception ignored) {
        }
        try {
            if (vlcEngine != null && vlcEngine.playing()) {
                vlcEngine.setPlaying(false);
                pausedByStop = true;
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onDestroy() {
        stopHeartbeat();
        stopNativeWatch();
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

