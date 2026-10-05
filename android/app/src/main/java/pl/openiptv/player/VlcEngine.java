package pl.openiptv.player;

import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebView;
import android.widget.FrameLayout;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;
import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.interfaces.IMedia;
import org.videolan.libvlc.util.VLCVideoLayout;

import java.util.ArrayList;

/* ======================  ODTWARZACZ VLC (libVLC)  ======================

   Trzecia droga obrazu, obok odtwarzacza systemowego (ExoPlayer — patrz
   MainActivity) i dróg strony (natywna → MSE → HLS). Powód istnienia jest ten
   sam, co poprzednich dróg, ale silnik inny: kanał 4K HEVC z playlisty bywa dla
   dekodera odbiornika za ciężki, a libVLC ma własny demukser TS/HLS i łagodniej
   podchodzi do kontenerów, na których hls.js i MSE odmawiają (HEVC w M2TS).

   Włączany jest wyłącznie ręcznie (Ustawienia → „Odtwarzacz VLC (beta)”) i tylko
   dla kanału NA ŻYWO — tak samo jak odtwarzacz systemowy, żeby droga testowa nie
   mogła zaszkodzić temu, co działa (patrz buildSourceQueue w app.js). Gdy VLC
   nie da obrazu, kanał wraca do kolejki prób jak dotąd.

   Obraz rysuje droga, która na tym odbiorniku rozstrzyga o wszystkim:
   attachViews(..., useTextureView) każe VLC składać klatki przez TextureView,
   czyli kompozytorem GPU — nie wprost na sprzętowej płaszczyźnie obrazu, na
   której ten telewizor zostawiał czarny ekran (ta sama przypadłość, którą
   odtwarzacz systemowy leczy od 2.1.8). Przełącznik w ustawieniach pozwala obie
   drogi porównać, bo to ma być pomiar, a nie przekonanie.

   Liczby do panelu diagnostyki bierzemy z samego VLC (patrz IMedia.Stats):
   zgubione klatki, odtworzone klatki, uszkodzone dane strumienia i bitrate.
   Dzięki nim „obraz zrywa” przestaje być opisem z kanapy, a staje się pomiarem —
   czego drodze ExoPlayera brakuje (tam jest tylko licznik zgubionych klatek
   i nazwa dekodera). */
class VlcEngine {

    /* Zdarzenie dla strony (patrz emitVlc w MainActivity): app.js czyta z niego
       stan obrazu tak samo, jak ze zdarzeń <video> i drogi systemowej. */
    interface Listener {
        void onEvent(String json);
    }

    /* Co ile odświeżamy liczby z VLC (zgubione klatki, bitrate) — panel
       diagnostyki ma pokazywać bieżący stan, a nie stan sprzed minuty. */
    private static final long STATS_TICK = 1000;

    private final BridgeActivity activity;
    private final Listener listener;
    private final Handler handler = new Handler(Looper.getMainLooper());

    /* Instancja VLC jest jedna na aplikację: jej utworzenie ładuje biblioteki
       i wtyczki (setki milisekund), więc nie robimy tego przy każdym kanale.
       Opcje są jednak częścią instancji, a przełącznik drogi obrazu je zmienia
       (patrz ensureLib), dlatego pamiętamy, z jakimi powstała. */
    private LibVLC lib;
    private boolean libTexture = true;
    private String libUserAgent = "";

    private MediaPlayer player;
    private VLCVideoLayout layout;
    private Runnable statsTick;

    /* Stan ostatniej próby: most czyta go bez czekania, a panel diagnostyki
       pokazuje liczby (patrz infoJson i diagCodecLines w app.js). */
    private volatile boolean firstFrame = false;
    private volatile int width = 0;
    private volatile int height = 0;
    private volatile String decoder = "";
    private volatile int lost = 0;
    private volatile int displayed = 0;
    private volatile int decoded = 0;
    private volatile int corrupted = 0;
    private volatile int bitrate = 0;
    private volatile String lastError = "";
    private volatile boolean textureView = true;

    VlcEngine(BridgeActivity activity, Listener listener) {
        this.activity = activity;
        this.listener = listener;
    }

    /* Czy silnik w ogóle ruszy na tym odbiorniku: biblioteki VLC pakujemy tylko
       dla architektur telewizorów (arm64-v8a, armeabi-v7a — patrz
       libvlcAbiFilters w variables.gradle), więc na urządzeniu x86 most nie ma
       czego wołać i kanał zostaje przy dotychczasowych drogach. */
    static boolean available() {
        try {
            LibVLC.loadLibraries();
            return true;
        } catch (Throwable error) {
            return false;
        }
    }

    private void emit(String type, String message, int eventWidth, int eventHeight) {
        String json;
        try {
            JSONObject event = new JSONObject();
            event.put("type", type);
            if (message != null) event.put("message", message);
            if (eventWidth > 0) event.put("width", eventWidth);
            if (eventHeight > 0) event.put("height", eventHeight);
            json = event.toString();
        } catch (Exception error) {
            json = "{\"type\":\"error\"}";
        }
        if (listener != null) listener.onEvent(json);
    }

    private static String shortMessage(Throwable error) {
        String message = error.getMessage();
        if (message == null || message.isEmpty()) message = error.getClass().getSimpleName();
        return message.length() > 120 ? message.substring(0, 120) : message;
    }

    /* ============================  START KANAŁU  ============================

       Zwraca "ok" albo "error: powód" — tak samo, jak playNative w odtwarzaczu
       systemowym, żeby app.js obsłużył obie drogi jednym kodem. */
    String start(String url, String userAgent, boolean useTexture) {
        if (url == null || url.isEmpty()) return "error: brak adresu";
        try {
            textureView = useTexture;
            ensureLib(userAgent, useTexture);
            stopPlayer();
            ensureLayout();
            if (layout == null) return "error: brak warstwy obrazu";

            /* Liczby liczymy od nowa: panel diagnostyki ma opisywać ten kanał,
               a nie poprzedni. */
            firstFrame = false;
            width = 0;
            height = 0;
            lost = 0;
            displayed = 0;
            decoded = 0;
            corrupted = 0;
            bitrate = 0;
            decoder = "";
            lastError = "";

            player = new MediaPlayer(lib);
            player.setEventListener(new MediaPlayer.EventListener() {
                @Override
                public void onEvent(MediaPlayer.Event event) {
                    handleEvent(event);
                }
            });
            /* Ostatni parametr to droga obrazu: true składa klatki przez
               TextureView (kompozytor GPU), false rysuje wprost na płaszczyźnie
               obrazu. Pusty DisplayManager = obraz na głównym ekranie odbiornika. */
            player.attachViews(layout, null, false, useTexture);
            layout.setVisibility(View.VISIBLE);

            Media media = new Media(lib, Uri.parse(url));
            /* Dekoder sprzętowy włączony i wymagany: 4K HEVC dekodowane
               programowo to droga donikąd (procesor odbiornika tego nie udźwignie). */
            media.setHWDecoderEnabled(true, true);
            /* Zapas sieci dla kanału na żywo (milisekundy): bez niego strumień
               zrywa się przy pierwszej gorszej chwili łącza. */
            media.addOption(":network-caching=1500");
            media.addOption(":live-caching=1500");
            player.setMedia(media);
            media.release();

            player.setVolume(100);
            activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            player.play();
            startStats();
            return "ok";
        } catch (Throwable error) {
            lastError = shortMessage(error);
            emit("error", lastError, 0, 0);
            stopPlayer();
            return "error: " + lastError;
        }
    }

    /* Instancja VLC powstaje raz i żyje z aplikacją; przełącznik drogi obrazu
       zmienia opcje, a te należą do instancji — dlatego przy zmianie trybu
       tworzymy ją od nowa (raz, ręcznie, w ustawieniach). */
    private void ensureLib(String userAgent, boolean useTexture) {
        String agent = userAgent == null ? "" : userAgent;
        if (lib != null && libTexture == useTexture && libUserAgent.equals(agent)) return;
        if (lib != null) {
            stopPlayer();
            try {
                lib.release();
            } catch (Throwable ignored) {
            }
            lib = null;
        }
        ArrayList<String> options = new ArrayList<String>();
        /* Sprzętowy dekoder, nie programowy: 4K HEVC na procesorze odbiornika to
           ślepa ulica (ta sama uwaga, która odrzuciła dekodowanie programowe przy
           odtwarzaczu systemowym). */
        options.add("--avcodec-hw=mediacodec");
        options.add("--network-caching=1500");
        options.add("--live-caching=1500");
        if (useTexture) {
            /* Klatki przez kopiowanie: dekoder nie pisze wprost na płaszczyznę
               obrazu, tylko oddaje klatkę kompozytorowi GPU — ta sama droga,
               którą od 2.1.8 idzie obraz odtwarzacza systemowego. */
            options.add("--no-mediacodec-dr");
        }
        lib = new LibVLC(activity, options);
        if (!agent.isEmpty()) {
            try {
                lib.setUserAgent(agent, "OpenIPTV");
            } catch (Throwable ignored) {
            }
        }
        libTexture = useTexture;
        libUserAgent = agent;
    }

    /* Warstwa obrazu pod stroną: tworzona raz, chowana, gdy nic nie gra. Tło
       czarne, żeby pasy przy innych proporcjach klatki wyglądały jak
       w odtwarzaczu systemowym, a nie jak dziura w interfejsie. */
    private void ensureLayout() {
        if (layout != null) return;
        Bridge bridge = activity.getBridge();
        WebView webView = bridge != null ? bridge.getWebView() : null;
        ViewGroup root = (ViewGroup) activity.findViewById(android.R.id.content);
        if (webView == null || root == null) return;
        layout = new VLCVideoLayout(activity);
        layout.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
            Gravity.CENTER));
        layout.setBackgroundColor(Color.BLACK);
        layout.setVisibility(View.GONE);
        /* Pod stroną, tak samo jak warstwa odtwarzacza systemowego: obraz widać
           tylko dlatego, że strona jest w tym miejscu przezroczysta (app.js
           zakłada na czas odtwarzania klasę „exo-player”). */
        root.addView(layout, 0);
        webView.setBackgroundColor(Color.TRANSPARENT);
    }

    /* Zdarzenia VLC. Trzymają ten sam stan, co zdarzenia <video> na innych
       drogach: bez tego budziki obrazu i pasek odtwarzacza nie wiedziałyby, że
       obraz naprawdę leci (patrz vlcEvent w app.js). */
    private void handleEvent(MediaPlayer.Event event) {
        if (event == null) return;
        switch (event.type) {
            case MediaPlayer.Event.Playing:
                readTrack();
                emit("playing", null, width, height);
                break;
            case MediaPlayer.Event.Paused:
                emit("paused", null, 0, 0);
                break;
            case MediaPlayer.Event.Buffering:
                emit("buffering", null, 0, 0);
                break;
            /* Vout to pierwsza klatka, która doszła na powierzchnię obrazu —
               dokładnie to, czego brakuje, gdy kanał gra sam dźwięk. */
            case MediaPlayer.Event.Vout:
                firstFrame = true;
                readTrack();
                emit("size", null, width, height);
                break;
            case MediaPlayer.Event.EncounteredError:
                lastError = "VLC nie odtworzył tego strumienia";
                emit("error", lastError, 0, 0);
                break;
            case MediaPlayer.Event.Stopped:
                emit("paused", null, 0, 0);
                break;
            default:
                break;
        }
    }

    /* Rozmiar klatki i kodek z toru wideo: rozmiar to jedyny pewny znak, że obraz
       leci (a nie sam dźwięk), a kodek mówi, czym VLC naprawdę rozbiera strumień. */
    private void readTrack() {
        try {
            IMedia media = player != null ? player.getMedia() : null;
            if (media == null) return;
            int count = media.getTrackCount();
            for (int i = 0; i < count; i++) {
                IMedia.Track track = media.getTrack(i);
                if (track instanceof IMedia.VideoTrack) {
                    IMedia.VideoTrack video = (IMedia.VideoTrack) track;
                    if (video.width > 0 && video.height > 0) {
                        width = video.width;
                        height = video.height;
                    }
                    if (track.codec != null) decoder = track.codec;
                }
            }
        } catch (Throwable ignored) {
            /* brak metadanych toru nie może zgasić obrazu */
        }
    }

    /* Liczby prosto z VLC, co sekundę. To one odróżniają „strumień nie nadchodzi”
       (uszkodzone dane, mały bitrate) od „dekoder nie wyrabia” (zgubione klatki),
       a to dwie różne naprawy. */
    private void startStats() {
        stopStats();
        statsTick = new Runnable() {
            @Override
            public void run() {
                readStats();
                handler.postDelayed(this, STATS_TICK);
            }
        };
        handler.postDelayed(statsTick, STATS_TICK);
    }

    private void stopStats() {
        if (statsTick != null) {
            handler.removeCallbacks(statsTick);
            statsTick = null;
        }
    }

    private void readStats() {
        try {
            IMedia media = player != null ? player.getMedia() : null;
            IMedia.Stats stats = media != null ? media.getStats() : null;
            if (stats == null) return;
            lost = stats.lostPictures;
            displayed = stats.displayedPictures;
            decoded = stats.decodedVideo;
            corrupted = stats.demuxCorrupted;
            bitrate = Math.round(stats.demuxBitrate);
        } catch (Throwable ignored) {
            /* statystyki są dodatkiem — bez nich obraz ma grać dalej */
        }
    }

    /* Pauza i wznowienie z paska odtwarzacza (albo klawiszem pilota). VLC zna
       tylko przełączenie, więc stan trzymamy tutaj razem z app.js. */
    void setPlaying(boolean playing) {
        try {
            if (player == null) return;
            if (playing && !player.isPlaying()) player.play();
            if (!playing && player.isPlaying()) player.pause();
        } catch (Throwable ignored) {
        }
    }

    void setMuted(boolean muted) {
        try {
            if (player != null) player.setVolume(muted ? 0 : 100);
        } catch (Throwable ignored) {
        }
    }

    /* Zamknięcie obrazu: kanał zmieniony, droga porzucona albo wyjście z ekranu.
       Instancja VLC zostaje — kolejny kanał nie może czekać na jej załadowanie. */
    void stop() {
        stopPlayer();
        activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    void release() {
        stopPlayer();
        if (lib != null) {
            try {
                lib.release();
            } catch (Throwable ignored) {
            }
            lib = null;
        }
    }

    private void stopPlayer() {
        stopStats();
        if (player != null) {
            try {
                player.setEventListener(null);
            } catch (Throwable ignored) {
            }
            try {
                player.stop();
            } catch (Throwable ignored) {
            }
            try {
                player.detachViews();
            } catch (Throwable ignored) {
            }
            try {
                player.release();
            } catch (Throwable ignored) {
            }
            player = null;
        }
        if (layout != null) layout.setVisibility(View.GONE);
    }

    /* Co silnik widzi w strumieniu — panel diagnostyki pokazuje to obok drogi
       systemowej (patrz diagCodecLines i diag_vlc_* w app.js). */
    String infoJson() {
        try {
            JSONObject info = new JSONObject();
            info.put("libvlc", lib != null ? LibVLC.version() : "");
            info.put("api", Build.VERSION.SDK_INT);
            info.put("texture", textureView);
            info.put("decoder", decoder);
            info.put("firstFrame", firstFrame);
            info.put("width", width);
            info.put("height", height);
            info.put("lost", lost);
            info.put("displayed", displayed);
            info.put("decoded", decoded);
            info.put("corrupted", corrupted);
            info.put("bitrate", bitrate);
            info.put("error", lastError);
            return info.toString();
        } catch (Exception error) {
            return "";
        }
    }
}
