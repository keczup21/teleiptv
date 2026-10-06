package pl.openiptv.player;

import android.graphics.Color;
import android.graphics.SurfaceTexture;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.TextureView;
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

   Do tego wyboru nie mieszamy renderowania wprost (mediacodec-dr): tego VLC nie
   rusza i ma je włączone domyślnie, bo droga przez kopiowanie klatek zostawiła
   temu odbiornikowi obraz zatrzymany na jednej klatce przy grającym dźwięku — na
   każdym kanale (patrz ensureLib).

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

    /* Ile klatek naprawdę doszło na obraz — i czy jeszcze dochodzą. Liczymy
       przyrost trzech liczników naraz (patrz countFrames), bo VLC nie zawsze
       oddaje wszystkie: displayedPictures i decodedVideo z silnika oraz licznik
       powierzchni obrazu (texFrames). Gdy żaden nie ruszy, fps zostaje -1 i panel
       pisze „nie liczone” — brak liczby nie jest dowodem, że obraz stoi. Po
       pierwszym przyroście brak przyrostu to już zatrzymany obraz: po STALL_TICKS
       sekundach kanał wraca do kolejki zdarzeniem „stalled”. */
    private static final int STALL_TICKS = 10;
    private volatile int fps = -1;
    private volatile int texFrames = 0;
    private volatile boolean sawFrames = false;
    private volatile boolean stalled = false;
    private int lastDisplayed = 0;
    private int lastDecoded = 0;
    private int lastTexFrames = 0;
    private int flatTicks = 0;
    private boolean stallReported = false;

    /* Zegar obrazu: pozycja i długość okna (w milisekundach). Obraz VLC nie ma
       elementu <video>, więc pasek odtwarzania i skok o krok w nagraniu (catch-up)
       czytają te liczby przez most — patrz emitClock, setTime oraz seekBy
       i seekArchiveHardware w app.js. */
    private volatile long clockTime = -1;
    private volatile long clockLength = -1;

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

    /* Pozycja i długość okna dla paska odtwarzania strony. Wysyłamy tylko wtedy,
       gdy liczba naprawdę się zmieniła: zdarzenie „TimeChanged” przychodzi kilka
       razy na sekundę, a pasek potrzebuje ćwierci sekundy dokładności — bez tego
       most wołałby stronę bez potrzeby. Skok w tył (⏪) liczy się jako zmiana,
       dlatego wolno wysłać liczbę mniejszą od poprzedniej. */
    private void emitClock() {
        if (player == null) return;
        long time;
        long length;
        try {
            time = player.getTime();
            length = player.getLength();
        } catch (Throwable error) {
            return;
        }
        if (time < 0) time = 0;
        if (length < 0) length = 0;
        if (time >= clockTime && time - clockTime < 250 && length == clockLength) return;
        clockTime = time;
        clockLength = length;
        String json;
        try {
            JSONObject event = new JSONObject();
            event.put("type", "time");
            event.put("time", time);
            /* Długość okna tylko wtedy, gdy silnik ją zna: kanał na żywo nie ma
               końca, a zero znaczy dla strony „nie ma po czym skakać”
               (patrz seekArchiveHardware). */
            if (length > 0) event.put("length", length);
            json = event.toString();
        } catch (Exception error) {
            return;
        }
        if (listener != null) listener.onEvent(json);
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
            fps = -1;
            texFrames = 0;
            sawFrames = false;
            stalled = false;
            flatTicks = 0;
            stallReported = false;
            lastDisplayed = 0;
            lastDecoded = 0;
            lastTexFrames = 0;
            /* zegar obrazu też liczy się od nowa: pozycja z poprzedniego kanału
               opisywałaby nowy (patrz emitClock) */
            clockTime = -1;
            clockLength = -1;

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
            /* Warstwa musi być widoczna, zanim powstanie jej powierzchnia —
               kolejność jak w odtwarzaczu systemowym (patrz startNative):
               inaczej powierzchnia powstaje dopiero przy następnym wejściu na
               kanał, a to wygląda dokładnie jak obraz zatrzymany na jednej
               klatce. */
            layout.setVisibility(View.VISIBLE);
            player.attachViews(layout, null, false, useTexture);
            /* Licznik klatek powierzchni zakładamy po attachViews, bo dopiero ono
               podłącza listener powierzchni silnika (patrz watchSurfaceFrames). */
            watchSurfaceFrames();

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
        /* Renderowania wprost (mediacodec-dr) świadomie NIE wyłączamy: VLC ma je
           włączone domyślnie, a droga przez kopiowanie klatek
           (--no-mediacodec-dr) oddawała jedną klatkę i zatrzymywała obraz przy
           grającym dźwięku na każdym kanale. Wybór powierzchni — TextureView albo
           płaszczyzna obrazu — załatwia sam attachViews (patrz start), więc to
           jedyna dźwignia drogi obrazu, jaką tu mamy. */
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
            /* Zegar obrazu: pozycja i długość okna nagrania. Bez tych zdarzeń pasek
               odtwarzania i skok o krok na drodze VLC nie miałyby z czym pracować
               (patrz emitClock, setTime). */
            case MediaPlayer.Event.TimeChanged:
            case MediaPlayer.Event.LengthChanged:
                emitClock();
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
            if (stats != null) {
                lost = stats.lostPictures;
                displayed = stats.displayedPictures;
                decoded = stats.decodedVideo;
                corrupted = stats.demuxCorrupted;
                bitrate = Math.round(stats.demuxBitrate);
            }
            countFrames();
        } catch (Throwable ignored) {
            /* statystyki są dodatkiem — bez nich obraz ma grać dalej */
        }
    }

    /* Czy klatki jeszcze dochodzą na obraz. Liczymy przyrost wszystkich trzech
       liczników naraz (silnikowe displayed i decoded oraz powierzchnię texFrames),
       bo w różnych drogach obrazu różne z nich żyją. Pierwszy przyrost mówi „ten
       odbiornik umie to policzyć” (sawFrames), a brak przyrostu po nim przestaje
       być brakiem danych — to już zatrzymany obraz. Wtedy kanał wraca do kolejki
       zdarzeniem „stalled”, zamiast trzymać jedną klatkę i udawać, że leci
       (patrz vlcEvent w app.js). fps to największy z przyrostów, więc mówi raczej
       rząd wielkości: czy klatki idą i ile ich jest w przybliżeniu. */
    private void countFrames() {
        if (player == null || !player.isPlaying()) {
            /* pauza i buforowanie nie są zatrzymanym obrazem */
            flatTicks = 0;
            return;
        }
        int tex = texFrames;
        int stepDisplayed = displayed - lastDisplayed;
        int stepDecoded = decoded - lastDecoded;
        int stepTex = tex - lastTexFrames;
        lastDisplayed = displayed;
        lastDecoded = decoded;
        lastTexFrames = tex;
        int step = Math.max(Math.max(stepDisplayed, stepDecoded), stepTex);
        if (step > 0) {
            sawFrames = true;
            fps = step;
            flatTicks = 0;
            stalled = false;
            stallReported = false;
            return;
        }
        fps = sawFrames ? 0 : -1;
        /* przed pierwszą klatką nie ma czego pilnować: to nie zatrzymanie obrazu,
           a wolny start strumienia (pilnuje go armVlcWatchdog po stronie strony) */
        if (!sawFrames || !firstFrame) return;
        flatTicks++;
        if (flatTicks < STALL_TICKS || stallReported) return;
        stalled = true;
        stallReported = true;
        emit("stalled", null, width, height);
    }

    /* Licznik klatek powierzchni obrazu: TextureView woła onSurfaceTextureUpdated
       raz na klatkę, która doszła na ekran, więc to jedyny licznik, którego VLC
       nie może nam zamilczeć. Listener silnika opakowujemy, a nie podmieniamy —
       bez jego wywołań powierzchnia nie dostanie obrazu (patrz AWindow). */
    private void watchSurfaceFrames() {
        try {
            TextureView view = findTextureView(layout);
            if (view == null) return;
            TextureView.SurfaceTextureListener previous = view.getSurfaceTextureListener();
            if (previous instanceof FrameCounter) return;
            view.setSurfaceTextureListener(new FrameCounter(previous));
        } catch (Throwable ignored) {
            /* licznik jest dodatkiem — bez niego obraz ma grać dalej */
        }
    }

    private static TextureView findTextureView(View view) {
        if (view instanceof TextureView) return (TextureView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                TextureView found = findTextureView(group.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }

    /* Opakowanie listenera silnika: liczymy klatki i przepuszczamy wszystko dalej. */
    private final class FrameCounter implements TextureView.SurfaceTextureListener {

        private final TextureView.SurfaceTextureListener next;

        FrameCounter(TextureView.SurfaceTextureListener next) {
            this.next = next;
        }

        @Override
        public void onSurfaceTextureAvailable(SurfaceTexture surface, int surfaceWidth, int surfaceHeight) {
            if (next != null) next.onSurfaceTextureAvailable(surface, surfaceWidth, surfaceHeight);
        }

        @Override
        public void onSurfaceTextureSizeChanged(SurfaceTexture surface, int surfaceWidth, int surfaceHeight) {
            if (next != null) next.onSurfaceTextureSizeChanged(surface, surfaceWidth, surfaceHeight);
        }

        @Override
        public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) {
            return next == null || next.onSurfaceTextureDestroyed(surface);
        }

        @Override
        public void onSurfaceTextureUpdated(SurfaceTexture surface) {
            texFrames++;
            if (next != null) next.onSurfaceTextureUpdated(surface);
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

    /* Skok w nagraniu (catch-up) — pozycja w milisekundach, tak samo jak w app.js
       (patrz seekArchiveHardware). Krok liczy strona z ustawień („Krok przewijania
       archiwum”), a VLC zna tylko „skocz do czasu”: przewija po odebranych danych,
       więc krok jest natychmiastowy, a nie nowym wczytaniem strumienia. */
    void setTime(long ms) {
        try {
            if (player == null) return;
            player.setTime(Math.max(0, ms));
        } catch (Throwable ignored) {
            /* silnik, który nie potrafi przewinąć (np. kanał na żywo), zostawia
               obraz tam, gdzie był */
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
            /* Klatki na sekundę i licznik powierzchni: to one odróżniają obraz
               żywy od zatrzymanego na jednej klatce (patrz countFrames). */
            info.put("fps", fps);
            info.put("texFrames", texFrames);
            info.put("sawFrames", sawFrames);
            info.put("stalled", stalled);
            info.put("error", lastError);
            return info.toString();
        } catch (Exception error) {
            return "";
        }
    }
}
