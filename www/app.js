/* TeleIPTV dla Android TV / Google TV / Fire TV (.apk) — to repozytorium buduje
 * wyłącznie paczkę .apk (WebView + Capacitor). Kod jest bliźniaczo podobny do
 * wersji na LG webOS (.ipk), ale od wersji 2.1.14 oba wydania rozwijają się
 * osobno: zmiana tutaj nie trafia do repozytorium teleiptv-webos automatycznie
 * i odwrotnie. Wersja na webOS:
 * https://github.com/keczup21/teleiptv-webos
 *
 * ŹRÓDŁA (na profil):
 *   - Playlista M3U : adres URL lub plik lokalny
 *   - Xtream Codes  : serwer + użytkownik + hasło (player_api.php)
 * EPG:
 *   - XMLTV (.xml / .gz) z URL lub pliku lokalnego
 *   - dla Xtream: automatycznie z <serwer>/xmltv.php
 * ARCHIWUM / CATCH-UP:
 *   - własny szablon (np. ...start={utc}&end={utcend})
 *   - doklejanie ?utc=&lutc= (catchup="append")
 *   - Xtream <serwer>/timeshift/... (catchup="default" / 1)
 */
(function () {
  "use strict";

  var SCREENS = ["settingsScreen", "browserScreen", "archiveScreen", "guideScreen", "playerScreen"];
  var SETTINGS_KEY = "openiptvSettings";
  /* Wielkie teksty (playlista i EPG wczytane z pliku) trzymamy w osobnym kluczu
     localStorage, żeby zapis ulubionych, kolejności grup i „ostatnio oglądane”
     był natychmiastowy i nie przepisywał za każdym razem megabajtów danych. */
  var BLOBS_KEY = "openiptvBlobs";
  var BLOB_FIELDS = ["playlistFileText", "epgFileText", "playlistFileName", "epgFileName"];
  var APP_VERSION = "2.1.19";
  var SCHEMA_VERSION = 5;

  /* „Ostatnio oglądane”: kanał trafia na listę po 10 s oglądania,
     a lista trzyma tylko 15 najnowszych (starsze wypadają) */
  var RECENT_DELAY = 10000;
  var RECENT_LIMIT = 15;

  /* Lista kanałów budowana jest porcjami („okienkowo”): DOM trzyma wtedy
     kilkadziesiąt kart zamiast kilkunastu tysięcy, więc przewijanie i
     sterowanie pilotem działa płynnie nawet na bardzo dużych playlistach. */
  var LIST_CHUNK = 60;
  /* Ile pikseli przed ekranem wczytujemy logotyp kanału (resztę leniwie) */
  var LOGO_MARGIN = 800;
  /* Po ilu ms samoczynnie znika pasek informacyjny odtwarzacza */
  var OSD_AUTOHIDE = 6000;
  /* Po jakim czasie trzymania OK otwiera się menu opcji kanału (TV) */
  var OK_HOLD_MS = 700;
  /* Ile czekamy na obraz, zanim uznamy, że dany sposób odtwarzania zawiódł */
  var START_TIMEOUT = 9000;
  /* Ile pozycji archiwum rysujemy naraz — 7 dni po kilkadziesiąt programów to
     setki przycisków; resztę i tak „chowa” filtr dni w ustawieniach. */
  var ARCHIVE_MAX = 240;
  /* Ile godzin w przód pokazuje lista programów otwarta z odtwarzacza (przycisk
     „EPG” na pasku) — tyle wystarczy, żeby zobaczyć, co będzie dalej, bez
     rysowania całego EPG dnia. */
  var ARCHIVE_AHEAD = 12 * 3600000;
  /* Program TV (EPG) pokazuje wszystkie kanały kategorii — i 60, i 5000 —
     bo wiersze rysujemy „okienkowo”: w DOM jest tylko widok z zapasem
     (GUIDE_CHUNK wierszy dokładanych przy przewijaniu), a wiersze daleko nad
     widokiem są usuwane (GUIDE_OVERSCAN). Rysowanie jednej porcji jest zawsze
     tak samo tanie, więc siatka nie zacina telewizora. */
  var GUIDE_CHUNK = 16;       // ile wierszy dokładamy jednym ruchem
  var GUIDE_OVERSCAN = 24;    // ile wierszy zostaje nad i pod widokiem
  var GUIDE_AHEAD = 8;        // ile wierszy pod fokusem musi być gotowych
  /* Program TV ma wypełnić ekran, więc liczba godzin wychodzi z szerokości
     siatki (nigdy mniej niż 3 i nigdy więcej niż 6), a szerokość godziny —
     z tego podziału. Węższa godzina niż GUIDE_HOUR_MIN_W jest nieczytelna. */
  var GUIDE_MIN_HOURS = 3;
  var GUIDE_MAX_HOURS = 6;
  var GUIDE_HOUR_MIN_W = 300;
  /* Ekran, który nie mieści nawet trzech godzin po GUIDE_HOUR_MIN_W (telefon
     w poziomie, mały dekoder), nie może dostać osi szerszej niż widok: siatka
     przewija się tylko w pionie, więc wystający kawałek osi był po prostu
     ucięty — razem z podświetlonym programem, który na nim leżał. Godzina jest
     wtedy węższa (tyle, ile zostaje miejsca), ale nigdy węższa niż
     GUIDE_HOUR_FIT_W — patrz guideHourWidth. */
  var GUIDE_HOUR_FIT_W = 120;
  /* Poniżej tej szerokości kafelek jest za wąski na nazwę programu i plakietkę
     „LIVE”/„ODTWARZANE” naraz: pill brał całe miejsce, a tytuł zostawał samym
     wielokropkiem (krótki program, np. 15-minutowy, był nieczytelny). Wtedy
     plakietkę pomijamy — patrz buildGuideProgram. */
  var GUIDE_PILL_MIN_W = 120;
  /* Szerokość kolumny z nazwami kanałów w programie TV — tyle samo co
     w styles.css (.guide-channel i .guide-corner). Potrzebna, żeby linia
     bieżącej godziny wypadła dokładnie na początku osi czasu, także wtedy, gdy
     siatka jest jeszcze niewidoczna i nie da się jej zmierzyć. */
  var GUIDE_CHANNEL_WIDTH = 260;
  /* Co ile przesuwamy linię bieżącej godziny: przy ~300 px na godzinę minuta to
     ~5 px, więc częstsze odświeżanie niczego nie zmienia. */
  var GUIDE_NOWLINE_MS = 20000;
  /* Jak długo kanał na żywo może stać w pauzie, żeby wznowienie poszło jeszcze
     z tego samego strumienia. Po tym czasie obraz ucieka do przodu, więc
     wznawiamy z archiwum dokładnie od chwili zatrzymania — inaczej „wznów”
     pokazałoby skok do bieżącej chwili (patrz resumePlayback). */
  var RESUME_AFTER_PAUSE = 1500;

  var state = {
    channels: [],
    programs: {},
    /* Surowy wynik parsowania XMLTV (bez przesunięcia godzin) — przesunięcie
       nakładamy na niego, więc jego zmiana nie wymaga pobierania EPG po raz
       drugi (patrz shiftPrograms, applyEpgShift). */
    epgRaw: null,
    /* „Odcisk” źródła, z którego pochodzą programy w pamięci: dopóki się nie
       zmieni, loadCatalog() nie pobiera EPG od nowa — dzięki temu zapis
       ustawień nie kasuje tego, co już mamy (patrz epgKey). */
    epgKey: "",
    epgUrl: "",
    epgTimer: null,
    selectedChannel: null,
    selectedGroup: "@all",
    playerReturn: "browserScreen",
    isArchive: false,
    /* chwila, w której użytkownik zatrzymał kanał na żywo (0 = nie zatrzymał);
       wznowienie wraca dokładnie w to miejsce — patrz resumePlayback() */
    livePauseAt: 0,
    /* kiedy ostatnio obsłużyliśmy klawisz multimedialny pilota (⏵‖ / ⏹).
       Jedno naciśnięcie ma dać jedną akcję, a część dekoderów wysyła klawisz
       dopiero na zwolnieniu — patrz mediaKeyAction() i keyup niżej. */
    mediaKeyAt: 0,
    currentSource: "",
    retryCount: 0,
    retryTimer: null,
    stableTimer: null,
    orderEdit: false,
    orderFocus: null,
    /* licznik oglądania dla „Ostatnio oglądane” */
    recentChannel: null,
    recentTimer: null,
    watchedMs: 0,
    watchStart: 0,
    recentRecorded: false,
    recentDirty: false,
    /* lista kanałów budowana porcjami (wydajność na dużych playlistach) */
    listItems: [],
    listRendered: 0,
    listToken: 0,
    /* odtwarzacz: kolejka prób (natywnie / MSE / HLS) */
    sources: [],
    sourceIndex: 0,
    cycle: 0,
    engine: "",
    engineInstance: null,
    engineLoading: false,
    watchChannel: null,
    watchProgram: null,
    /* przewijanie archiwum: ostatni skok (kierunek i ile sekund). Pasek opisuje
       nim chwilę, w której dekoder donosi obraz na nową pozycję — bez tego
       wyglądało to jak wczytywanie strumienia od zera. */
    seekAt: 0,
    seekDirection: 0,
    seekSize: 0,
    osdTimer: null,
    osdTicker: null,
    /* Pasek otwarty klawiszem OK / dotknięciem to menu: ▲ ▼ chodzą wtedy po jego
       przyciskach („Pauza”, „EPG”, …), a nie po kanałach. Pasek pokazany przy
       zmianie kanału albo skoku to tylko informacja — wtedy ▲ ▼ z obrazu dalej
       przełączają kanały (patrz obsługa klawiszy w odtwarzaczu). */
    osdMenu: false,
    /* EPG: programy w pamięci i odcisk źródła — patrz sekcja PAMIĘĆ EPG */
    /* klawisz OK trzymany wciśnięty (menu kontekstowe na TV) */
    okHoldTimer: null,
    okFired: false,
    okAction: null,
    /* odrzucanie zdublowanych błędów <video> (jeden błąd = jedno przejście) */
    lastErrorAt: 0,
    /* budzik sprawdzający, czy obraz w ogóle się pojawił */
    startTimer: null,
    /* drugi budzik: dźwięk już gra, a klatki obrazu nie ma (patrz
       armPictureWatchdog) — pilnuje czarnego ekranu na Androidzie */
    pictureTimer: null,
    /* czy przy tym wpisie kolejki próbowaliśmy już naprawy warstwy obrazu;
       bez tego jedna próba zamieniałaby się w pętlę */
    pictureRetried: false,
    /* Kanał 4K (metadane klatki, manifest HLS albo sama nazwa — patrz noteUhd,
       markUhdChannel): obraz nie dostaje wymuszonej warstwy, a do kolejki prób
       wchodzą na czele drogi sprzętowe (patrz buildSourceQueue). */
    uhdSeen: false,
    /* Kiedy w tej próbie naprawdę ruszył dźwięk (zdarzenie „playing”). Twardy
       budzik obrazu liczy od tego miejsca czas „dźwięk bez ani jednej klatki”,
       więc dociąganie danych przy czarnym ekranie nie przedłuża próby
       (patrz AUDIO_ONLY_TIMEOUT). */
    audioStartedAt: 0,
    /* czy bieżący wpis kolejki czyta playlistę własnym czytnikiem HLS→TS */
    engineFeeder: false,
    /* Panel diagnostyki obrazu pokazał się już sam przy tym kanale (dźwięk gra,
       a klatki nie ma) — bez tej blokady wracałby po każdym nieudanym sposobie
       odtwarzania (patrz maybeAutoDiagnose). Budzik panelu liczy się od startu
       dźwięku, więc trzyma go ten sam stan co reszta budzików (armDiagAuto). */
    diagAutoShown: false,
    diagAutoTimer: null,
    /* Jedna próba odtwarzania to nie wyścig z zegarem: liczymy, od kiedy trwa
       („entryWaitStart”) i kiedy strumień ostatnio naprawdę coś dociągnął
       („lastActivityAt”). Kanał 4K potrzebuje na pierwsze klatki dużo więcej
       czasu niż SD/HD, a restart w połowie wczytywania cofa go do zera —
       dlatego budziki patrzą na ruch strumienia, nie tylko na upływ czasu
       (patrz streamStillComing). */
    entryWaitStart: 0,
    lastActivityAt: 0,
    /* Kondycja obrazu na żywo (patrz guardTick): ile razy obraz stanął i ile klatek
       odrzucił dekoder w oknie czasu, ile razy odświeżyliśmy już strumień przy tym
       kanale i czy doszliśmy do granicy tego odtwarzacza. Bez tych liczb „obraz się
       rozsypał” kończyło się wyjściem z aplikacji, a nie świeżym startem strumienia. */
    guardTicker: null,
    guardWindowAt: 0,
    guardStalls: 0,
    guardDroppedBase: 0,
    guardDroppedSum: 0,
    guardRecycles: 0,
    guardGaveUp: false,
    /* Droga natywna (Android: odtwarzacz systemowy za WebView — patrz
       startExoSource). Element <video> nie bierze w niej udziału, więc stan obrazu
       (czy leci, jaką ma klatkę, czy jest wyciszony) trzymamy tutaj; most donosi
       o nim zdarzeniami (patrz exoEvent). */
    exoPlaying: false,
    exoWidth: 0,
    exoHeight: 0,
    exoMuted: false,
    exoPictureWaited: false,
    /* To samo dla silnika VLC (patrz startVlcSource): obraz rysuje on, a nie
       element <video>, więc stan obrazu trzymamy tutaj osobno. */
    vlcPlaying: false,
    vlcWidth: 0,
    vlcHeight: 0,
    vlcMuted: false,
    vlcFirstFrame: false,
    vlcPictureWaited: false,
    /* czy obraz VLC stanął na jednej klatce (patrz countFrames w VlcEngine) */
    vlcStalled: false,
    /* Zegar obrazu VLC: pozycja i długość okna w milisekundach, w tej samej
       jednostce co <video>. Obraz VLC nie ma elementu <video>, więc pasek
       odtwarzania i przewijanie nagrania czytają te liczby z mostu (patrz
       vlcEvent, seekBy). Silnik, który nie zna długości okna (kanał na żywo),
       zostawia vlcLength = 0 — wtedy nie ma po czym skakać (patrz
       seekArchiveHardware). */
    vlcTime: 0,
    vlcLength: 0,
    /* blokada zdarzeń przewijania listy (rysujemy jedną porcję na raz) */
    listScrollLock: false
  };

  var overlayTimer = null;
  var settingsWriteTimer = null;
  var logoObserver = null;   // wspólny obserwator dla leniwego wczytywania logotypów
  var epgAliases = {};   // nazwa wyświetlana (małe litery) -> id kanału EPG

  var guide = {          // widok "Program TV"
    windowStart: 0,
    hours: 3,
    hourWidth: 300,
    /* wiersze rysujemy porcjami („okienkowo”): w DOM jest tylko widok z zapasem
       (winStart … winStart + rendered), a resztę udają odstępy o wysokości
       wiersza — patrz renderGuide, guideFill i guideFollowScroll */
    items: [],
    winStart: 0,
    rendered: 0,
    /* wysokość wiersza z CSS (.guide-row) — odstępy i krok przewijania muszą
       trafiać w piksel, więc po pierwszym wierszu jest jeszcze mierzona */
    rowHeight: 96,
    /* wiersz, od którego ma się zacząć widok (po przewinięciu dnia/godzin albo
       po powrocie z odtwarzacza); -1 = wybierz sam */
    anchor: -1,
    token: 0,
    scrollLock: false,
    resizeTimer: null,
    /* kanał, na którym EPG ma stanąć po otwarciu (oglądany kanał), oraz ekran,
       do którego wracamy po zamknięciu programu TV */
    focusKey: "",
    returnTo: "browserScreen",
    /* zegar przesuwający linię bieżącej godziny (działa tylko na widocznym
       programie TV — pilnuje tego showScreen) */
    lineTimer: null
  };

  /* Ekran „Archiwum / programy kanału”. Ten sam ekran obsługuje dwa wejścia:
     z listy kanałów (nagrania z ostatnich dni) i z odtwarzacza (wszystkie
     programy oglądanego kanału: poprzednie, bieżący i następne). Pamięta więc,
     skąd przyszedł i dokąd wraca klawisz „Wstecz”. */
  var archive = {
    channel: null,
    fromPlayer: false,
    returnTo: "browserScreen",
    /* Dwa wpisy, na których lista otwarta z paska „EPG” staje fokusem: materiał
       odtwarzany teraz (nagranie z archiwum) i program, który leci na żywo.
       Wybiera je programEntry, a używa openArchive. */
    playingButton: null,
    liveButton: null
  };

  var DEFAULTS = {
    profiles: [],
    profilesInitialized: false,
    activeProfileId: "",
    playlistUrl: "",
    playlistFileText: "",
    playlistFileName: "",
    epgUrl: "",
    archiveDays: 7,
    seekSeconds: 10,
    retryAttempts: 3,
    dpadSeek: true,
    catchupTemplate: "",
    catchupAll: true,
    epgRefreshMinutes: 0,
    epgReloadOnStart: true,
    /* Przesunięcie godzin EPG (w godzinach). Nadawca, który w XMLTV podaje czas
       zimowy, gdy u nas jest letni (albo odwrotnie), dostaje tu „+1” / „−1” —
       bez tego lista programów i archiwum wypadają godzinę obok (patrz
       applyEpgShift). Przesunięcie działa też na czasy archiwum, więc materiał
       z catch-up trafia dokładnie w wybrany program. */
    epgShiftHours: 0,
    language: "pl",
    theme: "dark",
    uiMode: "auto",
    uiScale: "auto",
    /* Zapamiętany sposób odtwarzania („native” / „mse” / „hls”). Ustawia go
       aplikacja sama, gdy tylko zobaczy pierwszy obraz — patrz rememberEngine().
       Dzięki temu dekoder, który oddaje sam dźwięk, nie jest próbowany
       od nowa przy każdym kanale. */
    engineHint: "",
    /* Naprawa warstwy obrazu dla Androidów, które grają dźwięk bez klatki —
       patrz applyVideoLayerFix(). Włącza się tylko wtedy, gdy naprawdę pomogła. */
    videoLayerFix: false,
    osdEnabled: true,
    clockEnabled: false,
    /* Odtwarzacz systemowy (Android): domyślnie wyłączony — to droga beta. Po
       włączeniu kanał na żywo oddaje adres odtwarzaczowi odbiornika (patrz
       startExoSource); gdy zostaje wyłączony, obraz idzie dotychczasowymi drogami. */
    nativePlayer: false,
    /* Odtwarzacz VLC (Android): domyślnie WŁĄCZONY. Kanał na żywo i nagranie
       z archiwum oddają adres silnikowi VLC (patrz startVlcSource), więc droga,
       która na dekoderze odbiornika radzi sobie z każdym strumieniem, stoi
       pierwsza, a pozostałe zostają jako automatyczne zapasy (patrz
       buildSourceQueue). Przełącznik wyłącza ją całkiem — dla odbiorników, na
       których obraz VLC wypada gorzej niż drogą przeglądarki. */
    vlcPlayer: true,
    /* Droga obrazu dla VLC: przez kopiowanie klatek do kompozytora GPU
       (TextureView) albo wprost na płaszczyźnie obrazu odbiornika. To właśnie
       to porównujemy na telewizorze (patrz VlcEngine). */
    vlcTexture: true,
    favorites: {},
    recentChannels: {},
    groupOrder: {}
  };

  var settings = loadSettings();

  /* TŁUMACZENIA — polski */
  var I18N_PL = {
    settings: "Ustawienia", new: "Nowy", delete: "Usuń", profile_name: "Nazwa profilu",
    sources: "ŹRÓDŁA", source_type: "Typ źródła", m3u_url: "Link do M3U", m3u_file: "Plik M3U",
    xtream: "Xtream (login)", playlist_url: "Adres playlisty M3U", pick_m3u_file: "Wybierz plik M3U",
    add_local_file: "dodaj lokalny plik", active_file: "Aktywny plik: {name}",
    xtream_hint: "Dane z panelu Xtream Codes. Podaj sam adres (host:port) — kanały, kategorie, EPG i archiwum pobiorą się automatycznie.",
    xtream_server: "Adres serwera Xtream", username: "Użytkownik", password: "Hasło",
    epg_url: "EPG XMLTV (opcjonalny — Xtream pobiera go sam)", pick_epg_file: "Wybierz plik EPG",
    use_link: "Użyj linku", add_local_epg: "lub dodaj lokalny plik XMLTV",
    pick_no_files: "Ten telewizor nie ma czym wybrać pliku — wpisz adres playlisty (Typ źródła: Link do M3U) albo dane Xtream.",
    pick_m3u_error: "Nie udało się odczytać pliku M3U.",
    pick_epg_error: "Nie udało się odczytać pliku EPG.",
    pick_epg_unzip: "Nie udało się rozpakować pliku EPG: {error}",
    epg_update: "EPG — AKTUALIZACJA",
    epg_refresh: "Odświeżanie EPG", on_start: "Tylko przy starcie", every_30min: "Co 30 minut",
    every_1h: "Co 1 godzinę", every_2h: "Co 2 godziny", every_6h: "Co 6 godzin",
    every_12h: "Co 12 godzin", every_24h: "Co 24 godziny", epg_reload_on_start: "Pobieraj EPG przy starcie",
    epg_shift: "Przesunięcie czasu EPG",
    epg_shift_hint: "Program na liście wypada godzinę obok (nadawca podaje czas zimowy, a u nas jest letni — albo odwrotnie)? Ustaw przesunięcie: lista programów i czasy archiwum przeliczą się od razu, bez pobierania EPG.",
    epg_refresh_now: "Pobierz EPG teraz",
    epg_shift_none: "bez zmian (0)",
    epg_refresh_wait: "Kanały nie są jeszcze wczytane — najpierw użyj „Zapisz i pobierz”.",
    archive_playback: "ARCHIWUM I ODTWARZANIE", archive_days: "Dni EPG/archiwum wstecz",
    seek_step: "Krok przewijania archiwum", sec5: "5 sekund", sec10: "10 sekund", sec30: "30 sekund",
    min1: "1 minuta", min5: "5 minut", min10: "10 minut",
    retry_attempts: "Próby ponownego uruchomienia kanału", disabled: "Wyłączone",
    attempt1: "1 próba", attempt2: "2 próby", attempt3: "3 próby", attempt5: "5 prób", attempt10: "10 prób",
    dpad_seek: "Strzałki sterują transmisją: ◀ ▶ przewija, ▲ ▼ zmienia kanał", advanced: "ZAAWANSOWANE (OPCJONALNE)",
    catchup_template: "Globalny szablon catch-up", catchup_all: "Catch-up na wszystkich kanałach (HLS)", save: "Zapisz i pobierz",
    appearance: "WYGLĄD I JĘZYK", language: "Język", theme: "Motyw", theme_dark: "Ciemny", theme_light: "Jasny",
    search: "Szukaj", refresh: "Odśwież", guide_title: "Program TV", guide_prev_day: "‹ Dzień",
    guide_next_day: "Dzień ›", guide_yesterday: "Wczoraj", guide_day_before: "Przedwczoraj", today: "Dziś", date: "Data", time: "Godzina",
    guide_pan_hint: "◀ ▶ — programy • ▲ ▼ — kanały",
    /* podpis podświetlonego programu nad siatką — pełna nazwa i godziny,
       także gdy wąski kafelek ucina tytuł (patrz guideFocusNote) */
    guide_focus_name: "{from}–{to} • {title}",
    back: "Wstecz", live: "LIVE", catchup: "CATCH-UP", archive: "Archiwum",
    program_playing: "ODTWARZANE",
    loading: "Pobieranie…", all: "Wszystkie", favorites: "★ Ulubione", recent: "Ostatnio oglądane",
    group_order: "⇅ Kolejność grup", group_order_done: "✓ Gotowe", order_reset: "Alfabetycznie",
    order_hint: "Przestaw grupy przyciskami ▲ / ▼, a potem wybierz „Gotowe”.",
    other: "Pozostałe", channel: "Kanał", program: "Program",
    connecting_xtream: "Łączenie z panelem Xtream…", loading_playlist: "Pobieranie playlisty…",
    loading_epg: "Pobieranie EPG…", parsing_epg: "Parsowanie EPG…",
    channels_count: "kanałów", epg_programs: "programów", epg_no_data: "brak danych",
    no_epg: "Brak informacji EPG", next: "Następnie", error: "Błąd:", hourly_recording: "Nagranie godzinowe",
    archive_title: "Archiwum • ", days_back: " dni wstecz", archive_catchup: "Archiwum / catch-up",
    err_http: "Serwer zwrócił HTTP {code}", err_http_access: "Serwer zwrócił HTTP {code} (brak dostępu).",
    err_network: "Nie można pobrać danych (sieć / CORS).", err_timeout: "Przekroczono czas połączenia.",
    err_xtream_auth: "Xtream: nieprawidłowy adres serwera, użytkownik lub hasło.",
    err_xtream_inactive: "Xtream: konto nieaktywne ({status}). Sprawdź datę ważności.",
    err_xtream_no_channels: "Xtream nie zwrócił żadnych kanałów live dla tego konta.",
    err_xtream_json: "Panel Xtream zwrócił nieprawidłową odpowiedź (oczekiwano JSON).",
    err_not_m3u: "To nie jest playlista M3U.", err_no_channels: "Playlista nie zawiera kanałów.",
    err_epg_xml: "EPG nie jest poprawnym XMLTV.", err_gzip: "Brak biblioteki rozpakowującej GZIP.",
    err_playback: "Nie udało się rozpocząć odtwarzania.",
    err_stream: "Błąd odtwarzania strumienia. Format lub serwer może nie być obsługiwany przez ten model TV.",
    err_no_picture: "Obraz się nie pojawia (gra tylko dźwięk) — próbuję innego sposobu odtwarzania.",
    err_no_picture_hint: "Żaden sposób odtwarzania nie dał obrazu — ten telewizor odtwarza z tego kanału sam dźwięk (najczęściej nieobsługiwany kodek wideo tej transmisji, np. 4K HEVC). Jeśli ten kanał jest na liście także w wersji HD, wybierz tamtą.",
    err_catchup: "Brak obsługiwanego szablonu catch-up dla tego kanału.",
    err_read_file: "Nie udało się odczytać pliku.", err_read_m3u: "Nie udało się odczytać pliku M3U.",
    err_read_epg: "Nie udało się odczytać pliku EPG.", err_gunzip: "Nie udało się rozpakować pliku EPG: {msg}",
    err_worker: "Nie udało się uruchomić parsera EPG.",
    err_xtream_required: "Xtream: podaj adres serwera, użytkownika i hasło.",
    err_m3u_file_required: "Wybierz lokalny plik M3U.",
    err_m3u_url_required: "Podaj pełny adres http:// lub https:// do playlisty M3U.",
    err_epg_url: "Adres EPG musi zaczynać się od http:// lub https://",
    err_storage: "Dane są zbyt duże, aby zapisać je w pamięci aplikacji (zbyt duży plik M3U/EPG).",
    err_delete_confirm: "Usunąć ten profil (playlistę, login Xtream i EPG)?",
    retry_msg: "Ponawiam próbę {n} z {total}…", retry_fail: "Nie udało się uruchomić kanału po {total} próbach.",
    retry_off: "Automatyczne ponawianie jest wyłączone.", back_hint: "Naciśnij Wstecz, aby wybrać inny kanał.",
    retry_alt_hls: "Kanał nie działa jako TS — próbuję HLS (m3u8)…",
    media_code: "kod {code}", media_aborted: "przerwane", media_network: "błąd sieci / serwera",
    media_decode: "błąd dekodowania materiału", media_unsupported: "format nieobsługiwany", media_url: "Adres",

    /* ---------- 1.18.0 ---------- */
    ui_mode: "Tryb interfejsu",
    ui_mode_auto: "Automatyczny (TV / telefon)",
    ui_mode_tv: "Telewizor (pilot, 10 stóp)",
    ui_mode_touch: "Dotykowy (telefon / tablet)",
    ui_scale: "Rozmiar interfejsu",
    ui_scale_auto: "Automatyczny (wg rozdzielczości ekranu)",
    ui_scale_100: "100%",
    ui_scale_115: "115% — większe litery",
    ui_scale_130: "130% — duże litery",
    ui_scale_150: "150% — największe",
    screen_info: "Wykryty ekran: {width}×{height} px, gęstość {dpr}× — układ {canvas} px, skala {scale}% ({source}).",
    scale_source_auto: "automatyczna",
    scale_source_manual: "ustawiona ręcznie",
    osd_enabled: "Mini-EPG na kanale (co teraz leci)",
    clock_enabled: "Zegar w rogu obrazu (widoczny tylko podczas oglądania)",
    native_player: "Odtwarzacz systemowy (beta) — kanał gra odtwarzaczem odbiornika, a nie przez JavaScript (droga zapasowa, gdy silnik VLC nie da obrazu)",
    vlc_player: "Odtwarzacz VLC (zalecany) — kanał na żywo i nagranie z archiwum gra silnikiem VLC (jego własny demukser TS/HLS); gdy nie da obrazu, aplikacja sama próbuje pozostałych dróg",
    vlc_texture: "VLC: obraz przez powierzchnię obrazu (TextureView) — lekarstwo na czarny ekran (wyłączone rysuje wprost na płaszczyźnie obrazu odbiornika)",
    platform_line: "Wykryto: {name} • interfejs: {mode}",
    platform_firetv: "Fire TV", platform_androidtv: "Android TV", platform_googletv: "Google TV", platform_webos: "webOS",
    platform_android: "Android", platform_ios: "iOS", platform_browser: "komputer / przeglądarka",
    mode_tv: "telewizyjny (pilot)", mode_touch: "dotykowy",
    tv_hint: "OK – oglądaj • MENU / długie OK – opcje • ◀ ▲ ▼ ▶ – nawigacja • EPG: ◀ ▶ – godziny • w kanale: ▲ ▼ kanał, ◀ ▶ przewijanie",
    osd_restart: "⏪ Od początku",
    osd_prev_program: "◀ Poprzedni",
    osd_next_program: "Następny ▶",
    osd_live: "⏵ Na żywo",
    osd_back: "✕ Wstecz",
    osd_pause: "⏸ Pauza",
    osd_play: "⏵ Wznów",
    osd_hint_live: "OK – pasek • pauza – play/pause na pilocie • ◀ ▶ – cofnij / do przodu • ▲ ▼ – kanał • EPG – programy kanału • MENU – opcje",
    osd_hint_archive: "OK – pasek • pauza – play/pause na pilocie • ◀ ▶ – przewijanie nagrania • ▲ ▼ – kanał • EPG – programy kanału • Wstecz – wyjście",
    osd_now: "Teraz:",
    osd_next_label: "Następnie:",
    osd_paused: "PAUZA",
    osd_epg: "📅 EPG",
    osd_mute: "🔇 Wycisz",
    osd_diag: "ⓘ Diagnostyka",
    osd_unmute: "🔊 Dźwięk",
    osd_muted: "WYCISZONE",
    ctx_menu: "Kanał",
    ctx_play: "⏵ Oglądaj",
    ctx_fav_add: "☆ Dodaj do ulubionych",
    ctx_fav_del: "★ Usuń z ulubionych",
    ctx_archive: "⏪ Archiwum / catch-up",
    ctx_epg: "📅 Program TV (EPG)",
    ctx_close: "✕ Zamknij",
    epg_parsing_progress: "EPG… {pct}%",
    epg_filtered: "EPG dla {shown} kanałów",
    err_player_lib: "Nie udało się wczytać odtwarzacza ({name}).",
    err_no_mse: "Brak obsługi strumieni TS w tym odtwarzaczu (MSE).",
    retry_engine_mse: "Próbuję odtwarzacz TS (MSE)…",
    retry_engine_hls: "Próbuję odtwarzacz HLS…",
    engine_mse: "TS/MSE", engine_hls: "HLS",
    engine_native: "natywnie",
    /* panel diagnostyki obrazu (czarny ekran) — patrz openDiagnostics */
    osd_diag: "ⓘ Diagnostyka",
    diag_title: "Diagnostyka obrazu",
    diag_hint: "Zdjęcie tego ekranu wystarczy, żeby zgłosić problem. ▲ ▼ przewija treść, Wstecz zamyka.",
    diag_close: "✕ Zamknij",
    diag_device: "URZĄDZENIE",
    diag_codecs: "KODEKI — CO POTRAFI TEN ODTWARZACZ",
    diag_stream: "STRUMIEŃ",
    diag_manifest: "MANIFEST HLS",
    diag_events: "DZIENNIK ZDARZEŃ",
    diag_yes: "tak", diag_no: "nie", diag_maybe: "może", diag_unknown: "?",
    diag_platform: "system", diag_native_app: "aplikacja natywna",
    diag_screen: "ekran", diag_window: "okno", diag_cores: "rdzenie",
    diag_pointer: "dotyk", diag_webview: "WebView", diag_ua: "identyfikator",
    diag_container: "kontenery",
    diag_channel: "kanał", diag_engine: "sposób odtwarzania", diag_entry: "próba",
    diag_retries: "powtórzenia", diag_layer: "warstwa obrazu", diag_uhd: "4K",
    diag_uhd_named: "tak (rozpoznane)",
    diag_uhd_note: "kanał 4K w nazwie — zdejmuję wymuszoną warstwę obrazu",
    diag_size: "obraz", diag_frames: "klatki", diag_dropped: "odrzucone",
    diag_audio: "dźwięk", diag_playing: "gra", diag_paused: "pauza",
    diag_time: "czas", diag_buffer: "bufor", diag_muted: "wyciszony",
    diag_error: "błąd", diag_none: "brak",
    diag_probing: "sondowanie…", diag_opened: "panel otwarty",
    diag_auto: "brak obrazu przy grającym dźwięku — panel otwarty sam",
    diag_probe_none: "brak adresu .m3u8 do sprawdzenia",
    diag_probe_failed: "nie udało się pobrać manifestu",
    diag_probe_media: "playlista z segmentami", diag_probe_codec: "kodek z manifestu",
    diag_encrypted: "zaszyfrowany (EXT-X-KEY)", diag_variants: "wariantów",
    /* ---------------- 2.1.1: kanał z playlisty (4K HEVC) i twardy budzik obrazu -------------
       Kanał, który leci tylko jako playlista .m3u8, może w ogóle nie mieć obrazu:
       hls.js nie rozbiera HEVC, a <video> nie czyta playlisty. Dostaje więc trzeci
       sposób — własny czytnik playlisty podający strumień TS do mpegts.js — a budzik
       obrazu przestaje czekać w nieskończoność na kanał grający sam dźwięk. */
    retry_engine_mse_hls: "Kanał nadaje jako playlista (HLS) — próbuję odtwarzacz TS (MSE)…",
    err_feeder_playlist: "Nie udało się pobrać playlisty kanału.",
    err_feeder_variants: "Playlista kanału prowadzi do kolejnej playlisty wariantów.",
    err_feeder_fmp4: "Kanał nadaje kawałki MP4 (fMP4) — odtwarzacz TS ich nie rozbierze.",
    err_feeder_encrypted: "Kanał jest zaszyfrowany (HLS z kluczem) — odtwarzacz TS go nie rozbierze.",
    err_feeder_empty: "Playlista kanału nie ma odcinków do odtworzenia.",
    err_feeder_segment: "Nie udało się pobrać odcinka strumienia ({reason}).",
    diag_engine_start: "start sposobu odtwarzania: {engine} ({n}/{total})",
    diag_engine_fail: "sposób odtwarzania zawiódł: {reason}",
    diag_no_picture_advance: "dźwięk gra bez obrazu przez {s} s — następny sposób odtwarzania",
    diag_picture_ok: "obraz jest ({engine}) — zostaję przy tym sposobie",
    diag_giveup_audio: "żaden sposób nie dał obrazu — dźwięk zatrzymany",
    diag_mpegts: "mpegts.js (MSE) — co potrafi",
    diag_feeder_lag: "zaległość wobec transmisji: {s} s — łącze wolniejsze niż kanał",
    diag_feeder: "z playlisty",
    diag_feeder_start: "HLS→TS: podaję odtwarzaczowi TS {n} odcinków playlisty",
    diag_feeder_failed: "HLS→TS: {reason}",
    /* ---------------- 2.1.5: kondycja obrazu na żywo (zrywy, pamięć, świeży strumień) ----------
       Obraz 4K przez MSE potrafi się rozsypać po dłuższym oglądaniu: dekoder odrzuca
       klatki, pamięć rośnie, a system zamyka aplikację. Aplikacja mierzy jedno
       i drugie i wystawia strumień na świeżo — panel mówi, ile razy (patrz guardTick). */
    diag_health: "KONDYCJA OBRAZU",
    diag_heap: "pamięć JS", diag_stalls: "zrywy", diag_recycles: "przestrajania",
    diag_recycle: "obraz się rozsypywał — strumień wystartował ponownie ({n}.)",
    diag_recycle_stop: "zrywy wracają także na świeżym strumieniu: to granica tego odtwarzacza (MSE w WebView), nie łącze",
    osd_recycle: "Przestrajanie obrazu…",
    diag_feeder_drop: "kolejka odcinków skrócona o {n} (obraz nadgania na żywo)",
    /* ---------------- 2.1.6: odtwarzacz systemowy (Android, ExoPlayer) ----------------
       Kanał na żywo oddajemy odtwarzaczowi odbiornika: on rozbiera TS i HLS sprzętowo,
       więc 4K nie idzie przez JavaScript i MSE (patrz startExoSource). Te napisy są
       dla niego — na innych drogach zostają nieużywane. */
    engine_exo: "odtwarzacz systemowy",
    engine_vlc: "odtwarzacz VLC",
    diag_exo: "obraz systemowy",
    diag_exo_buffer: "prowadzi go odtwarzacz systemowy",
    diag_exo_start: "oddaję kanał odtwarzaczowi systemowemu",
    diag_native_player: "odtwarzacz systemowy (ExoPlayer)",
    diag_exo_frames: "klatki na obrazie",
    diag_exo_dropped: "zgubione klatki",
    /* Wiersz silnika VLC (przełącznik „Odtwarzacz VLC (beta)”) — pokazuje to, co
       odróżnia „strumień nie nadchodzi” od „dekoder nie wyrabia”: klatki, które
       doszły na obraz, te które wypadły, uszkodzone dane i bitrate strumienia. */
    diag_vlc: "obraz VLC",
    diag_vlc_buffer: "prowadzi go silnik VLC",
    diag_vlc_start: "oddaję kanał silnikowi VLC",
    diag_vlc_native: "odtwarzacz VLC (libVLC)",
    diag_vlc_frames: "klatki na obrazie",
    diag_vlc_lost: "zgubione klatki",
    diag_vlc_displayed: "odtworzone klatki",
    diag_vlc_corrupted: "uszkodzone dane strumienia",
    diag_vlc_bitrate: "strumień",
    diag_vlc_texture: "obraz przez powierzchnię obrazu (TextureView)",
    diag_vlc_plane: "obraz wprost na płaszczyźnie obrazu",
    diag_vlc_surface: "klatki z powierzchni obrazu",
    diag_vlc_fps: "klatki na sekundę",
    diag_vlc_nofps: "nie liczone",
    diag_stall: "obraz stanął — klatki przestały dochodzić",
    diag_exo_surface: "powierzchnia obrazu",
    diag_layer_on: "widoczna", diag_layer_off: "ukryta",
    epg_none: "Brak danych EPG dla tego kanału.",
    archive_day_today: "Dziś", archive_day_yesterday: "Wczoraj", archive_day_before: "Przedwczoraj",
    archive_limited: "pokazano {shown} z {total}",
    guide_count: "kanałów: {count}",
    osd_buffering: "Ładowanie strumienia…",
    seek_back: "Cofnięto o {s} s",
    seek_forward: "Przesunięto o +{s} s",
    engine_line: "Silnik: {name}",

    /* ---------- 1.19.0 ---------- */
    updates: "AKTUALIZACJE",
    updates_hint: "Nic nie instaluje się samo: przy wejściu w ustawienia aplikacja tylko mówi, że jest nowsza wersja, i krótko wypisuje, co się zmieniło. Aktualizację uruchamia dopiero przycisk „Pobierz i zainstaluj”.",
    update_check: "Sprawdź aktualizacje",
    update_install: "Pobierz i zainstaluj",
    update_checking: "Sprawdzam najnowsze wydanie…",
    update_current: "Masz najnowszą wersję (v{version}).",
    update_available: "Dostępna nowa wersja {latest} — masz {current}.",
    update_changes: "Co nowego w {latest}:",
    update_asset: "Paczka: {name} ({size})",
    update_manual: "webOS nie instaluje paczek sam — pobierz .{ext} na komputerze i wgraj przez tryb deweloperski (ares-install). Adres: {url}",
    update_downloading: "Pobieram paczkę… {pct}%",
    update_permission: "Włącz dla TeleIPTV zgodę na instalowanie aplikacji z nieznanych źródeł i naciśnij „Pobierz i zainstaluj” ponownie.",
    update_installer: "Paczka pobrana — potwierdź aktualizację w instalatorze na ekranie.",
    update_err: "Nie udało się zaktualizować: {msg}",
    update_err_data: "GitHub nie zwrócił informacji o wydaniu.",
    update_err_404: "GitHub nie widzi wydań tej aplikacji (HTTP 404). Sprawdzanie aktualizacji w aplikacji działa tylko wtedy, gdy repozytorium i wydania są publiczne.",
    update_err_json: "GitHub zwrócił nieprawidłową odpowiedź (oczekiwano JSON).",
    update_notice: "Nowa wersja {latest} (masz {current}) — Ustawienia → Aktualizacje.",
    update_err_unknown: "nieznany błąd",

    /* ---------- 1.21.0 — wyjście z aplikacji pytaniem, nie od razu ---------- */
    exit_title: "Wyjść z aplikacji?",
    exit_hint: "Zamknij TeleIPTV albo zostań na liście kanałów.",
    exit_confirm: "⏻ Wyjdź z aplikacji",
    exit_cancel: "✕ Zostań",
    exit_manual: "Ta platforma nie pozwala zamknąć okna z aplikacji — użyj przycisku zakończenia na pilocie.",

    /* ---------- 1.21.0 — instrukcja pilota w ustawieniach (sekcja „PILOT W ODTWARZACZU”) ---------- */
    player_keys: "PILOT W ODTWARZACZU",
    player_keys_hint: "Tak działa pilot, gdy leci kanał albo archiwum. Ustawienie „◀ ▶ przewija” dotyczy tylko strzałek — ⏪ ⏩ przewijają zawsze. Na dotykowym ekranie te same akcje są na pasku u dołu obrazu. Gdy pasek jest otwarty, ▲ ▼ wybierają jego przyciski.",
    key_ok_short: "Pasek z nazwą kanału, programem i postępem: pokaż albo schowaj. Przy otwartym pasku ▲ ▼ przechodzą na jego przyciski (pauza, EPG…).",
    key_ok_hold: "Przytrzymaj około sekundy: menu opcji kanału (ulubione, archiwum, program TV, od początku, cisza).",
    key_menu: "To samo menu opcji kanału, bez trzymania OK.",
    key_updown: "Następny i poprzedni kanał z widocznej listy (jak CH+ / CH−), z zawijaniem na końcach. Jedno naciśnięcie to jedna zmiana. Gdy pasek jest otwarty, ▲ ▼ wchodzą najpierw w jego przyciski — kanały znowu przełącza się po wyjściu z paska.",
    key_leftright: "Przewijanie o krok z ustawienia „Krok przewijania archiwum”: na nagraniu skok w tył i w przód, na kanale na żywo ◀ wchodzi w catch-up, a ▶ wznawia zatrzymany obraz. Po skoku komunikat („Cofnięto o 10 s”) widać na środku obrazu.",
    key_rewff: "Przewijanie pilota działa zawsze, także przy wyłączonych strzałkach; ⏩ na końcu programu wraca na żywo.",
    key_playpause: "Pauza i wznowienie. Po dłuższej pauzie kanał na żywo wraca do chwili zatrzymania przez catch-up, a bez archiwum obraz dogania transmisję.",
    key_stop: "Zatrzymanie obrazu — to samo co pauza.",
    key_mute: "Cisza w odtwarzaczu; głośność telewizora zostaje bez zmian.",
    key_back: "Wstecz",
    key_back_desc: "Zamyka otwarty pasek albo menu; gdy nic nie jest otwarte, obraz wraca do listy kanałów, a z listy pyta „Wyjdź z aplikacji?”.",

    /* ---------- 1.21.4 — zakładki w ustawieniach i EPG w odtwarzaczu ---------- */
    tab_general: "Ogólne",
    tab_update: "Aktualizacja",
    tab_help: "Instrukcja",
    tabs_hint: "Zakładki ustawień: ◀ ▶ zmieniają zakładkę, ▼ wchodzi w treść.",
    help_title: "JAK KORZYSTAĆ Z APLIKACJI",
    help_intro: "Poradnik w trzech krokach: źródło kanałów, poruszanie się pilotem i odtwarzacz z archiwum.",
    help_setup: "1. ŹRÓDŁO KANAŁÓW",
    help_setup_text: "Playlistę wpisuje się w zakładce „Ogólne”: adres M3U, plik z pamięci urządzenia albo login Xtream. Po zapisaniu kanały, EPG i archiwum pobierają się same.",
    help_nav: "2. PORUSZANIE SIĘ",
    help_nav_move: "Strzałki chodzą po przyciskach, grupach i liście kanałów — podświetlenie zawsze widać.",
    help_nav_ok: "Wybierz podświetloną pozycję: kategorię, kanał albo przycisk.",
    help_nav_menu: "Menu opcji kanału bez trzymania OK — to samo, co przytrzymane OK na kafelku kanału.",
    help_nav_search: "Pole szukania. Wychodzi się z niego strzałkami: ▼ do listy kanałów, ◀ na początku tekstu do grup, ▶ na końcu do paska u góry.",
    help_nav_back: "Zamyka nakładkę albo wraca o ekran wstecz. Na liście kanałów pyta, czy wyjść z aplikacji.",
    help_epg: "PROGRAM TV (EPG)",
    help_epg_grid: "Przycisk „EPG” w nagłówku otwiera siatkę wszystkich kanałów na osi czasu. Program, który leci teraz, ma podpis LIVE, a pionowa linia pokazuje bieżącą godzinę.",
    help_epg_pan: "◀ ▶ chodzą po programach tego samego kanału, a ▲ ▼ przechodzą na kanał wyżej albo niżej — na program z tego samego momentu. Oś czasu dosuwa się razem z podświetleniem, a z górnego wiersza ▲ wraca do przycisków dnia. Nazwę i godziny programu pod podświetleniem pokazuje podpis nad siatką.",
    help_epg_days: "Skok o dzień wstecz albo w przód; obok są pola daty i godziny do wskazania dokładnej chwili.",
    help_epg_pick: "Zakończony program włącza się z archiwum, a ten, który leci teraz — na żywo.",
    help_catchup: "ARCHIWUM I CATCH-UP",
    help_catchup_list: "Przycisk „EPG” na pasku odtwarzacza otwiera listę programów oglądanego kanału: poprzednie, bieżący i następne. Lista staje na programie, który leci teraz, a wybraną pozycję odtwarza się z archiwum po naciśnięciu OK.",
    help_catchup_live: "Przycisk „Na żywo” (na pasku odtwarzacza albo nad listą programów) wraca do bieżącej chwili.",
    help_catchup_days: "Ile dni wstecz sięga archiwum, ustawia „Dni EPG/archiwum wstecz” w zakładce „Ogólne”, a wielkość skoku — „Krok przewijania archiwum”.",
    help_catchup_note: "Kanał bez archiwum pokaże komunikat zamiast obrazu, a kanał bez EPG dostaje nagrania godzinowe — dzięki temu archiwum zostaje użyteczne.",
    help_catchup_uhd: "Nagranie kanału 4K odtwarza silnik VLC — drogi przeglądarki nie dają tam obrazu, a przewijanie idzie wtedy zegarem silnika. Ten sam silnik gra zwykłe kanały i nagrania; gdy nie da obrazu, aplikacja sama próbuje kolejnych dróg.",
    help_touch: "TELEFON I TABLET",
    help_touch_bar: "Te same akcje są na pasku u dołu obrazu — wystarczy dotknąć. Tylko tutaj, bez pilota, pasek ma także „Kanał” (menu opcji) i „Wstecz”, i zawija się do kilku rzędów.",
    help_touch_back: "Wyjście z obrazu: przycisk „Wstecz” na pasku albo systemowy przycisk wstecz na telefonie.",
    help_update: "AKTUALIZACJA",
    help_update_text: "Aktualizacja siedzi we własnej zakładce „Aktualizacja”: nic nie instaluje się samo, a pobranie paczki uruchamia dopiero przycisk.",
    epg_list_title: "Program • {name}",
    epg_list_hint: "poprzednie • teraz • następne",
    epg_list_days: " • {days} dni wstecz",
    epg_list_future: "jeszcze nie było"
  };

  /* TŁUMACZENIA — angielski */
  var I18N_EN = {
    settings: "Settings", new: "New", delete: "Delete", profile_name: "Profile name",
    sources: "SOURCES", source_type: "Source type", m3u_url: "M3U link", m3u_file: "M3U file",
    xtream: "Xtream (login)", playlist_url: "M3U playlist URL", pick_m3u_file: "Choose M3U file",
    add_local_file: "add a local file", active_file: "Active file: {name}",
    xtream_hint: "Xtream Codes panel credentials. Enter just the address (host:port) — channels, categories, EPG and archive will load automatically.",
    xtream_server: "Xtream server address", username: "Username", password: "Password",
    epg_url: "EPG XMLTV (optional — Xtream loads it automatically)", pick_epg_file: "Choose EPG file",
    use_link: "Use link", add_local_epg: "or add a local XMLTV file",
    pick_no_files: "This TV has no way to pick a file — enter the playlist address (Source type: M3U link) or Xtream credentials.",
    pick_m3u_error: "Could not read the M3U file.",
    pick_epg_error: "Could not read the EPG file.",
    pick_epg_unzip: "Could not unpack the EPG file: {error}",
    epg_update: "EPG — UPDATES",
    epg_refresh: "EPG refresh", on_start: "Only on start", every_30min: "Every 30 minutes",
    every_1h: "Every 1 hour", every_2h: "Every 2 hours", every_6h: "Every 6 hours",
    every_12h: "Every 12 hours", every_24h: "Every 24 hours", epg_reload_on_start: "Load EPG on start",
    epg_shift: "EPG time offset",
    epg_shift_hint: "Programmes an hour off (the broadcaster sends winter time while we are on summer time — or the other way round)? Set the offset: the guide and the archive times are recalculated at once, without downloading the EPG again.",
    epg_refresh_now: "Load EPG now",
    epg_shift_none: "no change (0)",
    epg_refresh_wait: "Channels are not loaded yet — use “Save & load” first.",
    archive_playback: "ARCHIVE & PLAYBACK", archive_days: "EPG/archive days back",
    seek_step: "Archive seek step", sec5: "5 seconds", sec10: "10 seconds", sec30: "30 seconds",
    min1: "1 minute", min5: "5 minutes", min10: "10 minutes",
    retry_attempts: "Channel retry attempts", disabled: "Disabled",
    attempt1: "1 attempt", attempt2: "2 attempts", attempt3: "3 attempts", attempt5: "5 attempts", attempt10: "10 attempts",
    dpad_seek: "Arrow keys control playback: ◀ ▶ seek, ▲ ▼ change channel", advanced: "ADVANCED (OPTIONAL)",
    catchup_template: "Global catch-up template", catchup_all: "Catch-up on all channels (HLS)", save: "Save & load",
    appearance: "APPEARANCE & LANGUAGE", language: "Language", theme: "Theme", theme_dark: "Dark", theme_light: "Light",
    search: "Search", refresh: "Refresh", guide_title: "TV Guide", guide_prev_day: "‹ Day",
    guide_next_day: "Day ›", guide_yesterday: "Yesterday", guide_day_before: "2 days ago", today: "Today", date: "Date", time: "Time",
    guide_pan_hint: "◀ ▶ — programmes • ▲ ▼ — channels",
    /* highlighted programme above the grid — see guideFocusNote */
    guide_focus_name: "{from}–{to} • {title}",
    back: "Back", live: "LIVE", catchup: "CATCH-UP", archive: "Archive",
    program_playing: "PLAYING",
    loading: "Loading…", all: "All", favorites: "★ Favorites", recent: "Recently watched",
    group_order: "⇅ Group order", group_order_done: "✓ Done", order_reset: "Alphabetical",
    order_hint: "Move groups with the ▲ / ▼ buttons, then choose “Done”.",
    other: "Other", channel: "Channel", program: "Program",
    connecting_xtream: "Connecting to Xtream panel…", loading_playlist: "Loading playlist…",
    loading_epg: "Loading EPG…", parsing_epg: "Parsing EPG…",
    channels_count: "channels", epg_programs: "programs", epg_no_data: "no data",
    no_epg: "No EPG info", next: "Next", error: "Error:", hourly_recording: "Hourly recording",
    archive_title: "Archive • ", days_back: " days back", archive_catchup: "Archive / catch-up",
    err_http: "Server returned HTTP {code}", err_http_access: "Server returned HTTP {code} (access denied).",
    err_network: "Cannot fetch data (network / CORS).", err_timeout: "Connection timed out.",
    err_xtream_auth: "Xtream: invalid server address, username or password.",
    err_xtream_inactive: "Xtream: account inactive ({status}). Check the expiry date.",
    err_xtream_no_channels: "Xtream returned no live channels for this account.",
    err_xtream_json: "Xtream panel returned an invalid response (expected JSON).",
    err_not_m3u: "This is not an M3U playlist.", err_no_channels: "Playlist contains no channels.",
    err_epg_xml: "EPG is not valid XMLTV.", err_gzip: "Missing GZIP decompression library.",
    err_playback: "Failed to start playback.",
    err_stream: "Stream playback error. The format or server may not be supported by this TV model.",
    err_no_picture: "No picture (audio only) — trying another playback method.",
    err_no_picture_hint: "No playback method produced a picture — this TV plays only the audio of this channel (usually a video codec it cannot decode).",
    err_catchup: "No supported catch-up template for this channel.",
    err_read_file: "Failed to read file.", err_read_m3u: "Failed to read M3U file.",
    err_read_epg: "Failed to read EPG file.", err_gunzip: "Failed to decompress EPG file: {msg}",
    err_worker: "Failed to start EPG parser.",
    err_xtream_required: "Xtream: enter server address, username and password.",
    err_m3u_file_required: "Choose a local M3U file.",
    err_m3u_url_required: "Enter a full http:// or https:// M3U playlist URL.",
    err_epg_url: "EPG URL must start with http:// or https://",
    err_storage: "Data is too large to store in app memory (M3U/EPG file too big).",
    err_delete_confirm: "Delete this profile (playlist, Xtream login and EPG)?",
    retry_msg: "Retrying attempt {n} of {total}…", retry_fail: "Failed to start the channel after {total} attempts.",
    retry_off: "Automatic retry is disabled.", back_hint: "Press Back to choose another channel.",
    retry_alt_hls: "Channel failed as TS — trying HLS (m3u8)…",
    media_code: "code {code}", media_aborted: "aborted", media_network: "network / server error",
    media_decode: "decoding error", media_unsupported: "unsupported format", media_url: "URL",

    /* ---------- 1.18.0 ---------- */
    ui_mode: "Interface mode",
    ui_mode_auto: "Automatic (TV / phone)",
    ui_mode_tv: "TV (remote, 10-foot)",
    ui_mode_touch: "Touch (phone / tablet)",
    ui_scale: "Interface size",
    ui_scale_auto: "Automatic (by screen resolution)",
    ui_scale_100: "100%",
    ui_scale_115: "115% — larger text",
    ui_scale_130: "130% — large text",
    ui_scale_150: "150% — largest",
    screen_info: "Detected screen: {width}×{height} px, density {dpr}× — layout {canvas} px, scale {scale}% ({source}).",
    scale_source_auto: "automatic",
    scale_source_manual: "set by hand",
    osd_enabled: "Mini-EPG on channel (what's on now)",
    clock_enabled: "Clock in the corner (visible only while watching)",
    native_player: "System player (beta) — a channel plays on the device player, not through JavaScript (a backup path when the VLC engine shows no picture)",
    vlc_player: "VLC player (recommended) — a live channel and an archive recording play through the VLC engine (its own TS/HLS demuxer); when it shows no picture, the app tries the other paths by itself",
    vlc_texture: "VLC: picture through the picture surface (TextureView) — the cure for a black screen (off draws straight onto the device picture plane)",
    platform_line: "Detected: {name} • interface: {mode}",
    platform_firetv: "Fire TV", platform_androidtv: "Android TV", platform_googletv: "Google TV", platform_webos: "webOS",
    platform_android: "Android", platform_ios: "iOS", platform_browser: "desktop / browser",
    mode_tv: "TV (remote)", mode_touch: "touch",
    tv_hint: "OK – watch • MENU / long OK – options • ◀ ▲ ▼ ▶ – navigate • Guide: ◀ ▶ – hours • in a channel: ▲ ▼ channel, ◀ ▶ seek",
    osd_restart: "⏪ From start",
    osd_prev_program: "◀ Previous",
    osd_next_program: "Next ▶",
    osd_live: "⏵ Live",
    osd_back: "✕ Back",
    osd_pause: "⏸ Pause",
    osd_play: "⏵ Resume",
    osd_hint_live: "OK – info bar • pause – play/pause on the remote • ◀ ▶ – back / forward • ▲ ▼ – channel • EPG – channel guide • MENU – options",
    osd_hint_archive: "OK – info bar • pause – play/pause on the remote • ◀ ▶ – seek the recording • ▲ ▼ – channel • EPG – channel guide • Back – exit",
    osd_now: "Now:",
    osd_next_label: "Next:",
    osd_paused: "PAUSED",
    osd_epg: "📅 EPG",
    osd_mute: "🔇 Mute",
    osd_diag: "ⓘ Diagnostics",
    osd_unmute: "🔊 Sound",
    osd_muted: "MUTED",
    ctx_menu: "Channel",
    ctx_play: "⏵ Watch",
    ctx_fav_add: "☆ Add to favourites",
    ctx_fav_del: "★ Remove from favourites",
    ctx_archive: "⏪ Archive / catch-up",
    ctx_epg: "📅 TV guide (EPG)",
    ctx_close: "✕ Close",
    epg_parsing_progress: "EPG… {pct}%",
    epg_filtered: "EPG for {shown} channels",
    err_player_lib: "Failed to load the player ({name}).",
    err_no_mse: "This player does not support TS streams (no MSE).",
    retry_engine_mse: "Trying the TS player (MSE)…",
    retry_engine_hls: "Trying the HLS player…",
    engine_mse: "TS/MSE", engine_hls: "HLS",
    engine_native: "native",
    /* picture diagnostics panel (black screen) — see openDiagnostics */
    osd_diag: "ⓘ Diagnostics",
    diag_title: "Picture diagnostics",
    diag_hint: "A photo of this screen is enough to report the problem. ▲ ▼ scrolls, Back closes.",
    diag_close: "✕ Close",
    diag_device: "DEVICE",
    diag_codecs: "CODECS — WHAT THIS PLAYER CAN DO",
    diag_stream: "STREAM",
    diag_manifest: "HLS MANIFEST",
    diag_events: "EVENT LOG",
    diag_yes: "yes", diag_no: "no", diag_maybe: "maybe", diag_unknown: "?",
    diag_platform: "system", diag_native_app: "native app",
    diag_screen: "screen", diag_window: "window", diag_cores: "cores",
    diag_pointer: "touch", diag_webview: "WebView", diag_ua: "identity",
    diag_container: "containers",
    diag_channel: "channel", diag_engine: "playback path", diag_entry: "attempt",
    diag_retries: "retries", diag_layer: "picture layer", diag_uhd: "4K",
    diag_uhd_named: "yes (recognised)",
    diag_uhd_note: "4K in the channel name — clearing the forced picture layer",
    diag_size: "picture", diag_frames: "frames", diag_dropped: "dropped",
    diag_audio: "audio", diag_playing: "playing", diag_paused: "paused",
    diag_time: "time", diag_buffer: "buffer", diag_muted: "muted",
    diag_error: "error", diag_none: "none",
    diag_probing: "probing…", diag_opened: "panel opened",
    diag_auto: "audio playing with no picture — panel opened on its own",
    diag_probe_none: "no .m3u8 address to check",
    diag_probe_failed: "could not fetch the manifest",
    diag_probe_media: "media playlist with segments", diag_probe_codec: "codec from manifest",
    /* ---------------- 2.1.1: playlist-only channels (4K HEVC) and the hard picture watchdog -------------
       A channel that only comes as an .m3u8 playlist can end up with audio alone:
       hls.js cannot parse HEVC and <video> cannot read a playlist. It therefore gets
       a third path — our own playlist reader feeding a TS stream into mpegts.js — and
       the picture watchdog stops waiting forever on a channel playing audio only. */
    retry_engine_mse_hls: "The channel streams as a playlist (HLS) — trying the TS player (MSE)…",
    err_feeder_playlist: "Could not fetch the channel playlist.",
    err_feeder_variants: "The channel playlist points to another variant playlist.",
    err_feeder_fmp4: "The channel streams MP4 chunks (fMP4) — the TS player cannot parse them.",
    err_feeder_encrypted: "The channel is encrypted (HLS with a key) — the TS player cannot decrypt it.",
    err_feeder_empty: "The channel playlist has no segments to play.",
    err_feeder_segment: "Could not fetch a stream segment ({reason}).",
    diag_engine_start: "playback path started: {engine} ({n}/{total})",
    diag_engine_fail: "playback path failed: {reason}",
    diag_no_picture_advance: "audio playing with no picture for {s} s — next playback path",
    diag_picture_ok: "picture is there ({engine}) — staying on this path",
    diag_giveup_audio: "no playback path produced a picture — audio stopped",
    diag_mpegts: "mpegts.js (MSE) — what it supports",
    diag_feeder_lag: "lag behind the broadcast: {s} s — connection slower than the channel",
    diag_feeder: "feed from playlist",
    diag_feeder_start: "HLS→TS: feeding {n} playlist segments to the TS player",
    diag_feeder_failed: "HLS→TS: {reason}",
    /* ---------------- 2.1.5: live picture health (hiccups, memory, fresh stream) ----------
       A 4K picture over MSE can fall apart after longer watching: the decoder drops
       frames, memory grows and the system closes the app. The app measures both and
       brings the stream back on a fresh decoder — the panel says how many times. */
    diag_health: "PICTURE HEALTH",
    diag_heap: "JS heap", diag_stalls: "hiccups", diag_recycles: "restarts",
    diag_recycle: "the picture was falling apart — the stream restarted ({n})",
    diag_recycle_stop: "hiccups come back on a fresh stream too: this is the limit of this player (MSE in the WebView), not the link",
    osd_recycle: "Restarting the picture…",
    diag_feeder_drop: "segment queue trimmed by {n} (catching up with live)",
    /* ---------------- 2.1.6: the system player (Android, ExoPlayer) ----------------
       A live channel goes to the device's own player: it demuxes TS and HLS in
       hardware, so 4K does not travel through JavaScript and MSE (see startExoSource). */
    engine_exo: "system player",
    engine_vlc: "VLC player",
    diag_exo: "system picture",
    diag_exo_buffer: "the system player keeps it",
    diag_exo_start: "handing the channel to the system player",
    diag_native_player: "system player (ExoPlayer)",
    diag_exo_frames: "frames on screen",
    diag_exo_dropped: "dropped frames",
    diag_vlc: "VLC picture",
    diag_vlc_buffer: "the VLC engine keeps it",
    diag_vlc_start: "handing the channel to the VLC engine",
    diag_vlc_native: "VLC player (libVLC)",
    diag_vlc_frames: "frames on screen",
    diag_vlc_lost: "dropped frames",
    diag_vlc_displayed: "displayed frames",
    diag_vlc_corrupted: "corrupted stream data",
    diag_vlc_bitrate: "stream",
    diag_vlc_texture: "picture through the picture surface (TextureView)",
    diag_vlc_plane: "picture straight onto the picture plane",
    diag_vlc_surface: "frames from the picture surface",
    diag_vlc_fps: "frames per second",
    diag_vlc_nofps: "not counted",
    diag_stall: "picture stopped — frames stopped arriving",
    diag_exo_surface: "picture surface",
    diag_layer_on: "visible", diag_layer_off: "hidden",
    diag_encrypted: "encrypted (EXT-X-KEY)", diag_variants: "variants",
    epg_none: "No EPG data for this channel.",
    archive_day_today: "Today", archive_day_yesterday: "Yesterday", archive_day_before: "2 days ago",
    archive_limited: "showing {shown} of {total}",
    guide_count: "channels: {count}",
    osd_buffering: "Loading stream…",
    seek_back: "Back {s} s",
    seek_forward: "Forward +{s} s",
    engine_line: "Engine: {name}",

    /* ---------- 1.19.0 ---------- */
    updates: "UPDATES",
    updates_hint: "Nothing installs itself: when you open the settings the app only says a newer version exists and briefly lists what changed. The update starts with the “Download & install” button.",
    update_check: "Check for updates",
    update_install: "Download & install",
    update_checking: "Checking the latest release…",
    update_current: "You have the latest version (v{version}).",
    update_available: "New version {latest} is available — you have {current}.",
    update_changes: "What's new in {latest}:",
    update_asset: "Package: {name} ({size})",
    update_manual: "webOS does not install packages on its own — download the .{ext} on a computer and push it with developer mode (ares-install). Address: {url}",
    update_downloading: "Downloading the package… {pct}%",
    update_permission: "Allow TeleIPTV to install apps from unknown sources, then press “Download & install” again.",
    update_installer: "Package downloaded — confirm the update in the installer on screen.",
    update_err: "Update failed: {msg}",
    update_err_data: "GitHub returned no release information.",
    update_err_404: "GitHub cannot see this app's releases (HTTP 404). The in-app update check works only when the repository and its releases are public.",
    update_err_json: "GitHub returned an invalid response (expected JSON).",
    update_notice: "New version {latest} (you have {current}) — Settings → Updates.",
    update_err_unknown: "unknown error",

    /* ---------- 1.21.0 ---------- */
    exit_title: "Quit the app?",
    exit_hint: "Close TeleIPTV or stay on the channel list.",
    exit_confirm: "⏻ Quit the app",
    exit_cancel: "✕ Stay",
    exit_manual: "This platform does not let the app close its own window — use the exit button on the remote.",

    /* ---------- 1.21.0 — remote manual in the settings (“REMOTE IN THE PLAYER”) ---------- */
    player_keys: "REMOTE IN THE PLAYER",
    player_keys_hint: "This is how the remote works while a channel or a recording plays. The “◀ ▶ seek” option affects the arrow keys only — ⏪ ⏩ always seek. On a touch screen the same actions sit on the bar at the bottom of the picture. While the bar is open, ▲ ▼ choose its buttons.",
    key_ok_short: "The bar with the channel name, current programme and progress: show or hide. With the bar open, ▲ ▼ move onto its buttons (pause, EPG…).",
    key_ok_hold: "Hold for about a second: the channel options menu (favourites, archive, TV guide, restart, mute).",
    key_menu: "The same channel options menu, without holding OK.",
    key_updown: "Next and previous channel on the visible list (like CH+ / CH−), wrapping around at both ends. One press is one change. While the bar is open, ▲ ▼ walk its buttons first — channels switch again once you leave the bar.",
    key_leftright: "Seeking by the “archive seek step” setting: on a recording it jumps back and forward, on a live channel ◀ enters catch-up and ▶ resumes the paused picture. After a jump the message (“Back 10 s”) shows in the middle of the picture.",
    key_rewff: "The remote's own seek keys always work, even with the arrows switched off; ⏩ at the end of a programme goes back live.",
    key_playpause: "Pause and resume. After a longer pause a live channel returns to the moment you stopped it through catch-up; without archive the picture simply rejoins the stream.",
    key_stop: "Freeze the picture — the same as pause.",
    key_mute: "Mutes the player; the TV volume is left untouched.",
    key_back: "Back",
    key_back_desc: "Closes the open bar or menu; with nothing open the player goes back to the channel list, and from the list it asks “Quit the app?”.",

    /* ---------- 1.21.4 — settings tabs and the channel guide in the player ---------- */
    tab_general: "General",
    tab_update: "Update",
    tab_help: "Manual",
    tabs_hint: "Settings tabs: ◀ ▶ switch the tab, ▼ enters the content.",
    help_title: "HOW TO USE THE APP",
    help_intro: "A guide in three steps: the channel source, moving around with the remote, and the player with archive.",
    help_setup: "1. CHANNEL SOURCE",
    help_setup_text: "The playlist goes in the “General” tab: an M3U address, a file from the device, or Xtream credentials. After saving, channels, EPG and archive load on their own.",
    help_nav: "2. MOVING AROUND",
    help_nav_move: "The arrow keys walk through buttons, categories and the channel list — the highlight is always visible.",
    help_nav_ok: "Picks the highlighted item: a category, a channel or a button.",
    help_nav_menu: "Channel options menu without holding OK — the same as holding OK on a channel card.",
    help_nav_search: "The search box. Leave it with the arrows: ▼ to the channel list, ◀ at the start of the text to the categories, ▶ at the end to the top bar.",
    help_nav_back: "Closes an overlay or goes one screen back. On the channel list it asks whether to quit the app.",
    help_epg: "TV GUIDE (EPG)",
    help_epg_grid: "The “EPG” button in the header opens a grid of all channels on a time axis. The programme on air carries a LIVE tag and the vertical line marks the current time.",
    help_epg_pan: "The ◀ ▶ arrows step through the programmes of the same channel, and ▲ ▼ move to the channel above or below — onto the programme at the same moment. The time axis follows the highlight, and ▲ from the top row returns to the day buttons. The name and the times of the highlighted programme are shown above the grid.",
    help_epg_days: "Jumps a day back or forward; the date and time fields next to it jump to an exact moment.",
    help_epg_pick: "A finished programme plays from the archive, the one on air goes live.",
    help_catchup: "ARCHIVE AND CATCH-UP",
    help_catchup_list: "The “EPG” button on the player bar opens the programme list of the channel you watch: previous, current and next. The list stops on the programme on air; pick a position and press OK to play it from the archive.",
    help_catchup_live: "The “Live” button (on the player bar or above the programme list) returns to the current moment.",
    help_catchup_days: "How many days back the archive goes is set by “EPG/archive days back” in the “General” tab, and the jump size by “Archive seek step”.",
    help_catchup_note: "A channel without archive shows a message instead of the picture, and a channel without EPG gets hourly recordings — so the archive stays useful.",
    help_catchup_uhd: "A 4K recording plays through the VLC engine — the browser paths show no picture there, and seeking follows the engine's own clock. The same engine plays ordinary channels and recordings; when it shows no picture, the app tries the next paths by itself.",
    help_touch: "PHONE AND TABLET",
    help_touch_bar: "The same actions sit on the bar at the bottom of the picture — just tap. Only here, without a remote, the bar also carries “Channel” (options menu) and “Back”, and wraps into a few rows.",
    help_touch_back: "Leaving the picture: the “Back” button on the bar or the system back button on the phone.",
    help_update: "UPDATES",
    help_update_text: "Updates live in their own “Update” tab: nothing installs itself, and only the button downloads the package.",
    epg_list_title: "Guide • {name}",
    epg_list_hint: "previous • now • next",
    epg_list_days: " • {days} days back",
    epg_list_future: "not aired yet"
  };

  var I18N = { pl: I18N_PL, en: I18N_EN };

  function t(key, params) {
    var lang = settings.language === "en" ? "en" : "pl";
    var s = (I18N[lang] && I18N[lang][key]) || (I18N.pl && I18N.pl[key]) || key;
    if (params) {
      for (var p in params) s = s.split("{" + p + "}").join(String(params[p]));
    }
    return s;
  }

  /* =====================  IKONY WEKTOROWE PRZYCISKÓW  =====================
     Ikony rysujemy jako SVG, a nie znakami emoji: na dekoderach telewizyjnych
     (Fire TV, webOS) czcionka emoji bywa okrojona i z „📅 Program TV” zostaje
     kropka — a przyciski bez napisu (zębatka, odświeżanie) na telewizorze
     dodatkowo dostawały padding reguły ogólnej i ich SVG był ściśnięty do
     kreski (patrz styles.css: body.uimode-tv .icon-button).

     Napisy w słownikach nadal mają emoji na początku — jest z nich czytelny
     kod i instrukcja — więc przy wstawianiu na przycisk odcinamy ten znak
     (labelWithoutIcon) i zamiast niego wstawiamy ikonę. Kolejność: znak przed
     napisem („✕ Wstecz”) albo po nim („Następny ▶”). */

  var ICON_PATHS = {
    calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 10.5h18"/>',
    play: '<polygon fill="currentColor" points="7 5 19 12 7 19"/>',
    pause: '<rect fill="currentColor" x="6.5" y="5" width="4" height="14" rx="1"/><rect fill="currentColor" x="13.5" y="5" width="4" height="14" rx="1"/>',
    stop: '<rect fill="currentColor" x="6" y="6" width="12" height="12" rx="2"/>',
    rewind: '<polygon fill="currentColor" points="13 12 21 6.5 21 17.5"/><polygon fill="currentColor" points="3 12 11 6.5 11 17.5"/>',
    forward: '<polygon fill="currentColor" points="11 12 3 6.5 3 17.5"/><polygon fill="currentColor" points="21 12 13 6.5 13 17.5"/>',
    prev: '<path d="M15 18l-6-6 6-6"/>',
    next: '<path d="M9 18l6-6-6-6"/>',
    star: '<polygon points="12 2.8 14.9 8.7 21.4 9.6 16.7 14.2 17.8 20.6 12 17.6 6.2 20.6 7.3 14.2 2.6 9.6 9.1 8.7"/>',
    "star-filled": '<polygon fill="currentColor" points="12 2.8 14.9 8.7 21.4 9.6 16.7 14.2 17.8 20.6 12 17.6 6.2 20.6 7.3 14.2 2.6 9.6 9.1 8.7"/>',
    mute: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19"/><path d="M22 9l-6 6M16 9l6 6"/>',
    volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11.2v5.4"/><circle fill="currentColor" stroke="none" cx="12" cy="7.6" r="1.2"/>',
    power: '<path d="M18.4 6.6a9 9 0 1 1-12.8 0"/><path d="M12 2.5v9"/>',
    swap: '<path d="M8 3v18M4 7l4-4 4 4M16 21V3M12 17l4 4 4-4"/>',
    check: '<path d="M20 6L9 17l-5-5"/>'
  };

  /* znak (albo para znaków) na brzegu napisu → nazwa ikony SVG */
  var ICON_BY_LEAD = {
    "⏵": "play", "⏸": "pause", "⏹": "stop", "⏪": "rewind", "⏩": "forward",
    "◀": "prev", "▶": "next", "★": "star-filled", "☆": "star",
    "📅": "calendar", "🔇": "mute", "🔊": "volume", "✕": "close",
    "⏻": "power", "⇅": "swap", "✓": "check", "ⓘ": "info"
  };

  /* emoji trzymają się parami znaków (📅 = D83D DCC5), dlatego próbujemy dwa
     znaki, a dopiero potem jeden — inaczej „Następny ▶” złapałoby złą ikonę */
  function iconEdge(text, fromEnd) {
    for (var i = 2; i > 0; i--) {
      var part = fromEnd ? text.slice(-i) : text.slice(0, i);
      if (ICON_BY_LEAD[part]) return { name: ICON_BY_LEAD[part], size: i, atEnd: !!fromEnd };
    }
    return null;
  }

  function iconForLabel(label) {
    var text = String(label === undefined || label === null ? "" : label);
    var head = iconEdge(text, false);
    if (head) return head.name;
    var tail = iconEdge(text, true);
    return tail ? tail.name : null;
  }

  /* ten sam napis, ale bez znaku ikony — na przycisku rysuje ją SVG */
  function labelWithoutIcon(label) {
    var text = String(label === undefined || label === null ? "" : label);
    var head = iconEdge(text, false);
    if (head) return text.slice(head.size).replace(/^\s+/, "");
    var tail = iconEdge(text, true);
    if (tail) return text.slice(0, -tail.size).replace(/\s+$/, "");
    return text;
  }

  function iconHtml(name) {
    var body = ICON_PATHS[name];
    if (!body) return "";
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
      ' aria-hidden="true" focusable="false">' + body + "</svg>";
  }

  /* Napis przycisku razem z ikoną. Ikona jest SVG, więc nie zależy od czcionki
     emoji, a textContent nie może jej zjeść — dlatego wszystkie przyciski
     z ikoną przechodzą przez tę funkcję. Bez drugiego argumentu ikonę bierzemy
     ze znaku na brzegu napisu. */
  function setIconLabel(element, iconName, label) {
    if (!element) return "";
    if (arguments.length === 2) { label = iconName; iconName = iconForLabel(label); }
    var text = labelWithoutIcon(label);
    element.classList.add("has-icon");
    element.innerHTML = iconHtml(iconName);
    if (!iconName) element.classList.remove("has-icon");
    if (text) {
      var span = document.createElement("span");
      span.className = "icon-label";
      span.textContent = text;
      element.appendChild(span);
    }
    return text;
  }

  function applyTranslations() {
    var els = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < els.length; i++) {
      var v = t(els[i].getAttribute("data-i18n"));
      if (v === undefined) continue;
      /* napisy ze znakiem ikony („⇅ Kolejność grup”) dostają SVG — ale tylko
         przyciski: do <option> i innych kontenerów tekstowych nie wolno
         wstawiać elementów potomnych, a legenda pilota („◀ ▶ — przewijanie
         godzin”) ma zostać tekstem. Rozmiar ikony bierze się z reguł
         przycisku („button .icon”), więc w innym kontenerze SVG rozjeżdżał
         się na cały nagłówek programu TV. */
      if (els[i].tagName === "BUTTON" && iconForLabel(v)) setIconLabel(els[i], v);
      else els[i].textContent = v;
    }
    var ph = document.querySelectorAll("[data-i18n-placeholder]");
    for (var j = 0; j < ph.length; j++) {
      ph[j].placeholder = t(ph[j].getAttribute("data-i18n-placeholder"));
    }
    var ti = document.querySelectorAll("[data-i18n-title]");
    for (var k = 0; k < ti.length; k++) {
      ti[k].title = t(ti[k].getAttribute("data-i18n-title"));
    }
    document.documentElement.lang = settings.language;
  }

  function applyTheme() {
    document.body.classList.toggle("light", settings.theme === "light");
  }

  /* ====================  TYP URZĄDZENIA I TRYBY INTERFEJSU  ====================
     Ten sam kod działa na Fire TV / Android TV (pilot), na webOS oraz na
     telefonach i tabletach. Interfejs ma dwa tryby:

       • „tv”    — 10 stóp: duże elementy, obszar bezpieczny pod overscan,
                   tani fokus (bez transformacji), menu pilota (MENU / długie OK),
       • „touch” — palec: kategorie jako poziome „chipsy”, lista na całą szerokość.

     Tryb wykrywamy automatycznie, ale można go wymusić w ustawieniach. */

  function isTabletSize() {
    var screenRef = window.screen || {};
    var smaller = Math.min(screenRef.width || 0, screenRef.height || 0);
    var dpr = window.devicePixelRatio || 1;
    return (smaller / dpr) >= 600;
  }

  function detectPlatform() {
    var ua = (navigator.userAgent || "").toLowerCase();
    var maxTouch = navigator.maxTouchPoints || 0;
    var touch = ("ontouchstart" in window) || maxTouch > 0;
    var native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    var kind = "desktop";
    var os = "browser";
    var android = /android/.test(ua);

    if (/web0s|webos|netcast|smarttv|hbbtv|viera|bravia/.test(ua)) {
      os = "webos";
      kind = "tv";
    } else if (/firetv|fire tv|\baft[a-z0-9]{1,2}\b|kindle/.test(ua)) {
      os = "firetv";
      kind = "tv";
    } else if (android) {
      /* Google TV to też Android, ale odmiana inna niż Android TV: inny WebView
         (aktualizowany ze Sklepu Play), więc panel diagnostyki musi to pokazać
         wprost — na 4K HEVC te dwie drogi wypadają różnie. Ta sama gałąź łapie
         Chromecast z Google TV („CrKey” w UA). */
      if (/google tv|chromecast|crkey/.test(ua)) {
        os = "googletv";
        kind = "tv";
      } else if (/android tv|\btv\b|bravia|shield|droidlogic|leanback|aft/.test(ua)) {
        os = "androidtv";
        kind = "tv";
      } else {
        os = "android";
        kind = touch ? (isTabletSize() ? "tablet" : "phone") : "desktop";
      }
    } else if (/iphone|ipod/.test(ua)) {
      os = "ios";
      kind = "phone";
    } else if (/ipad/.test(ua) || (/macintosh/.test(ua) && maxTouch > 1)) {
      os = "ios";
      kind = "tablet";
    }
    return { kind: kind, os: os, touch: touch, native: native, tv: kind === "tv", android: android };
  }

  var platformInfo = detectPlatform();

  /* tryb z ustawień albo automatyczny: TV → „tv”, telefon/tablet → „touch”,
     komputer → „tv” (mysz i klawiatura obsługują ten sam układ bez przeszkód) */
  function uiMode() {
    var forced = settings.uiMode;
    if (forced === "tv" || forced === "touch") return forced;
    if (platformInfo.tv) return "tv";
    if (platformInfo.kind === "phone" || platformInfo.kind === "tablet") return "touch";
    return "tv";
  }

  function isTvMode() {
    return uiMode() === "tv";
  }

  function platformName() {
    return t("platform_" + (platformInfo.os || "browser"));
  }

  function applyUiMode() {
    var mode = uiMode();
    document.body.classList.toggle("uimode-tv", mode === "tv");
    document.body.classList.toggle("uimode-touch", mode === "touch");
    document.body.classList.toggle("platform-firetv", platformInfo.os === "firetv");
    document.body.setAttribute("data-uimode", mode);
    document.body.setAttribute("data-platform", platformInfo.os);
    var hint = $("tvHint");
    if (hint) hint.textContent = t("tv_hint");
    var info = $("platformInfo");
    if (info) {
      info.textContent = t("platform_line", {
        name: platformName(),
        mode: t(mode === "tv" ? "mode_tv" : "mode_touch")
      });
    }
    applyUiScale();
  }

  /* ---------- rozmiar interfejsu: rozdzielczość ekranu → skala układu ----------
     Cała matematyka jest w www/ui-scale.js — ten sam kod ustawia szerokość
     układu zaraz po wczytaniu index.html, więc interfejs nie pojawia się
     najpierw w złym rozmiarze. Tutaj: ustawienie z formularza, informacja
     o wykrytym ekranie i przeliczenie skali, gdy telewizor zmieni rozdzielczość
     już w trakcie pracy (np. 720p → 1080p przy materiale 4K). */
  function scaleApi() {
    return window.OpenIPTVScale || null;
  }

  function scaleContext() {
    var api = scaleApi();
    if (api) return api.context(window);
    return { tv: isTvMode(), mobile: false, native: false, viewport: false };
  }

  /* wartość z <select id="uiScale">: „auto” albo jedna z gotowych skal */
  function normalizeUiScale(value) {
    var api = scaleApi();
    return api && api.isFactor(value) ? String(value) : "auto";
  }

  function uiScaleFactor(ctx) {
    var api = scaleApi();
    if (!api) return 1;
    return api.factor(settings.uiScale, api.metrics(window), ctx || scaleContext());
  }

  function applyUiScale() {
    var info = $("screenInfo");
    var api = scaleApi();
    if (!api) {
      if (info) info.textContent = "";
      return;
    }
    var ctx = scaleContext();
    var factor = uiScaleFactor(ctx);
    api.applyToPage(document, factor, ctx);
    document.body.setAttribute("data-uiscale", String(Math.round(factor * 100)));
    if (info) {
      var m = api.metrics(window);
      info.textContent = t("screen_info", {
        width: m.physW,
        height: m.physH,
        dpr: m.dpr.toFixed(1),
        canvas: api.canvasWidth(factor, ctx) || m.viewW,
        scale: Math.round(factor * 100),
        source: t(settings.uiScale === "auto" ? "scale_source_auto" : "scale_source_manual")
      });
    }
    watchScreen();
  }

  var screenWatchTimer = null;
  var screenWatchPhys = 0;

  /* Ekran telewizora potrafi zmienić rozdzielczość już w trakcie pracy, a wtedy
     sama zmienia się skala „automatyczna”. Sprawdzamy to co dwie sekundy, ale
     przy skali wybranej ręcznie nie robimy nic. */
  function watchScreen() {
    var api = scaleApi();
    if (!api || settings.uiScale !== "auto" || !isTvMode()) {
      if (screenWatchTimer) {
        window.clearInterval(screenWatchTimer);
        screenWatchTimer = null;
      }
      return;
    }
    screenWatchPhys = api.metrics(window).physH;
    if (screenWatchTimer) return;
    screenWatchTimer = window.setInterval(function () {
      var phys = scaleApi().metrics(window).physH;
      if (phys === screenWatchPhys) return;
      screenWatchPhys = phys;
      applyUiScale();
    }, 2000);
  }

  /* robocza kopia edytowanego profilu (pliki wybrane z dysku) */
  var draft = {
    editingId: "",
    playlistText: "",
    playlistName: "",
    epgText: "",
    epgName: ""
  };

  var suppressProfileSelect = false;
  var suppressProfileSwitcher = false;

  /* ============================  POMOCNICZE  ============================ */

  function $(id) {
    return document.getElementById(id);
  }

  function loadSettings() {
    var stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {};
    } catch (e) {
      stored = {};
    }
    var schema = parseInt(stored.schemaVersion, 10) || 0;
    for (var key in DEFAULTS) {
      if (typeof stored[key] === "undefined") stored[key] = DEFAULTS[key];
    }
    /* migracja 1.16.0: istniejące instalacje dostają nowe domyślne
       (catch-up włączony, krok przewijania 10 s) — jednorazowo */
    if (schema < 2) {
      stored.catchupAll = true;
      stored.seekSeconds = 10;
    }
    /* migracja 1.17.0: usunięte ustawienie „Proxy CORS" — czyścimy zapisany klucz */
    if (schema < 3) {
      delete stored.corsProxy;
    }
    /* migracja 2.1.12: droga VLC jest włączana domyślnie (patrz DEFAULTS) i raz
       włączamy ją także instalacjom, które mają zapisane „false” — inaczej nowy
       domyślny wybór nigdy by się nie przebił. Kto jej nie chce, wyłącza
       przełącznik, a jego wybór jest już respektowany (schema 5). */
    if (schema < 5) {
      stored.vlcPlayer = true;
    }
    /* migracja 1.18.0: wielkie teksty (playlista/EPG wczytane z pliku) idą do
       osobnego klucza — w głównym zostają tylko lekkie ustawienia */
    var blobs = {};
    try { blobs = JSON.parse(localStorage.getItem(BLOBS_KEY) || "{}") || {}; } catch (e2) { blobs = {}; }
    var profiles = Array.isArray(stored.profiles) ? stored.profiles : [];
    for (var pi = 0; pi < profiles.length; pi++) {
      var prof = profiles[pi];
      if (!prof || !prof.id) continue;
      var bucket = blobs[prof.id] || (blobs[prof.id] = {});
      if (prof[BLOB_FIELDS[0]]) bucket.playlistFileText = prof.playlistFileText;
      if (prof[BLOB_FIELDS[1]]) bucket.epgFileText = prof.epgFileText;
      if (prof[BLOB_FIELDS[2]]) bucket.playlistFileName = prof.playlistFileName;
      if (prof[BLOB_FIELDS[3]]) bucket.epgFileName = prof.epgFileName;
      /* w pamięci zostawiamy teksty (korzysta z nich wczytywanie katalogu),
         ale do głównego klucza już ich nie zapisujemy */
      prof.playlistFileText = bucket.playlistFileText || "";
      prof.playlistFileName = bucket.playlistFileName || "";
      prof.epgFileText = bucket.epgFileText || "";
      prof.epgFileName = bucket.epgFileName || "";
    }
    stored.__blobs = blobs;

    if (schema < SCHEMA_VERSION) {
      stored.schemaVersion = SCHEMA_VERSION;
      try { localStorage.setItem(BLOBS_KEY, JSON.stringify(blobs)); } catch (err) {}
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(compactSettings(stored))); } catch (err2) {}
    }
    return stored;
  }

  /* kopia ustawień bez wielkich tekstów — to trafia do localStorage */
  function compactSettings(source) {
    var src = source || settings;
    var out = {};
    for (var key in src) {
      if (key === "__blobs" || key === "profiles") continue;
      out[key] = src[key];
    }
    out.profiles = (src.profiles || []).map(function (p) {
      var copy = {};
      for (var field in p) {
        if (BLOB_FIELDS.indexOf(field) >= 0) continue;
        copy[field] = p[field];
      }
      return copy;
    });
    return out;
  }

  /* Zapis „na gorąco” (ulubione, kolejność grup, ostatnio oglądane): odroczony
     o 400 ms i bez wielkich tekstów, więc interfejs się nie zacina. */
  function saveSettings() {
    if (settingsWriteTimer) return;
    settingsWriteTimer = window.setTimeout(flushSettings, 400);
  }

  function flushSettings() {
    if (settingsWriteTimer) {
      window.clearTimeout(settingsWriteTimer);
      settingsWriteTimer = null;
    }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(compactSettings()));
    } catch (e) {
      /* brak miejsca w pamięci urządzenia */
    }
  }

  /* Pełny zapis: profil wraz z plikami (playlista/EPG) — używany przez formularz
     ustawień i przy usuwaniu profilu. */
  function saveSettingsFull() {
    flushSettings();
    try {
      localStorage.setItem(BLOBS_KEY, JSON.stringify(settings.__blobs || {}));
    } catch (e) {
      /* brak miejsca w pamięci urządzenia */
    }
  }

  function newProfileId() {
    return "profile-" + Date.now() + "-" + Math.floor(1000000 * Math.random());
  }

  function normalizeProfile(p) {
    if (p.sourceType !== "xtream" && p.sourceType !== "m3u-file" && p.sourceType !== "m3u-url") {
      p.sourceType = "m3u-url";
    }
    p.playlistUrl = p.playlistUrl || "";
    p.playlistFileText = p.playlistFileText || "";
    p.playlistFileName = p.playlistFileName || "";
    p.xtreamServer = p.xtreamServer || "";
    p.xtreamUser = p.xtreamUser || "";
    p.xtreamPass = p.xtreamPass || "";
    p.epgUrl = p.epgUrl || "";
    p.epgFileText = p.epgFileText || "";
    p.epgFileName = p.epgFileName || "";
    if (!p.name) p.name = "Playlista";
    if (!p.id) p.id = newProfileId();
    return p;
  }

  function keyOf(channel) {
    return channel.tvgId || channel.streamUrl.split("|")[0];
  }

  function perProfile(bucket) {
    if (!bucket[settings.activeProfileId]) bucket[settings.activeProfileId] = [];
    return bucket[settings.activeProfileId];
  }

  function isFavorite(channel) {
    return perProfile(settings.favorites).indexOf(keyOf(channel)) >= 0;
  }

  function activeProfile() {
    for (var i = 0; i < settings.profiles.length; i++) {
      if (settings.profiles[i].id === settings.activeProfileId) return settings.profiles[i];
    }
    if (settings.profiles.length) {
      settings.activeProfileId = settings.profiles[0].id;
      return settings.profiles[0];
    }
    return null;
  }

  /* lista „Ostatnio oglądane” zmienia się w trakcie oglądania — odświeżamy ją
     w momencie powrotu do listy kanałów */
  function refreshRecentGroup() {
    if (!state.recentDirty) return;
    state.recentDirty = false;
    if (state.selectedGroup !== "@recent" || !state.channels.length) return;
    selectGroup("@recent", document.querySelector(".category.active"));
  }

  /* Android TV / Fire TV: natywny odbiornik musi wiedzieć, że na ekranie jest
     odtwarzacz — tylko wtedy oddaje stronie klawisze multimedialne pilota
     ⏵‖ / ⏹ (MainActivity.onKeyDown -> window.__openiptvKey). Bez mostu
     (webOS, przeglądarka, stary APK) nic się nie dzieje. */
  function notifyNativePlayer(on) {
    var bridge = window.OpenIptvNative;
    if (!bridge || !bridge.setPlayerMode) return;
    try {
      bridge.setPlayerMode(!!on);
    } catch (error) { /* starszy APK bez tego mostu */ }
  }

  function showScreen(id) {
    exitPlayerEpg();
    if (id === "browserScreen") refreshRecentGroup();
    for (var i = 0; i < SCREENS.length; i++) {
      $(SCREENS[i]).classList.toggle("hidden", SCREENS[i] !== id);
    }
    notifyNativePlayer(id === "playerScreen");
    /* zegar w rogu obrazu ma sens tylko na widocznym ekranie odtwarzacza */
    syncCornerClock();
    /* zegar linii bieżącej godziny chodzi tylko na widocznym programie TV */
    if (id !== "guideScreen") stopGuideNowLine();
    window.setTimeout(function () {
      /* Ekran mógł już ustawić fokus sam: program TV po narysowaniu siatki
         staje na programie, który leci teraz (patrz focusGuideWatched). Bez
         tego warunku to odroczone ustawienie zabierało mu fokus po 30 ms —
         podświetlenie z siatki uciekało na przycisk dnia i dopiero ▼ wchodziło
         w program, który i tak był wybrany. */
      var active = document.activeElement;
      var screen = $(id);
      if (active && screen && active !== document.body && screen.contains(active)) return;
      /* fokus wchodzi na przycisk, nigdy na pole tekstowe: na telewizorze
         klawiatura ekranowa zasłaniałaby listę, a po zapisaniu ustawień samo
         włączało się szukanie kanałów (patrz entryFocusTarget) */
      var first = entryFocusTarget(screen);
      if (first && first.focus) first.focus();
    }, 30);
  }

  /* Tryb dzielony: obraz (lewa kolumna) i lista programów oglądanego kanału
     (prawa kolumna) widoczne naraz, więc „EPG” w odtwarzaczu nie zasłania już
     transmisji. Układ robi CSS (body.player-epg), a warstwę obrazu na Androidzie
     zwęża most setVideoSplit — obraz rysuje się pod stroną (patrz MainActivity
     i VlcEngine), więc sam CSS jej nie ruszy. */
  function showPlayerEpg() {
    if (!state.watchChannel) { showScreen("archiveScreen"); return; }
    exitPlayerEpg();
    for (var i = 0; i < SCREENS.length; i++) {
      $(SCREENS[i]).classList.toggle("hidden",
        SCREENS[i] !== "playerScreen" && SCREENS[i] !== "archiveScreen");
    }
    document.body.classList.add("player-epg");
    playerEpgNative(true);
    notifyNativePlayer(true);
    syncCornerClock();
    stopGuideNowLine();
  }

  /* Powrót do zwykłego jednego ekranu zdejmuje tryb dzielony; woła to showScreen,
     więc każde przejście (zmiana kanału, wybór programu, Wstecz) samo go zamyka. */
  function exitPlayerEpg() {
    if (!document.body || !document.body.classList) return;
    if (!document.body.classList.contains("player-epg")) return;
    document.body.classList.remove("player-epg");
    playerEpgNative(false);
  }

  /* Warstwa obrazu Androida rysuje się pod stroną, więc CSS jej nie zwęzi —
     prosimy o to most (patrz setVideoSplit w MainActivity i VlcEngine). Na webOS
     i w przeglądarce mostu nie ma i wystarcza sam CSS. */
  function playerEpgNative(on) {
    var bridge = window.OpenIptvNative;
    if (bridge && typeof bridge.setVideoSplit === "function") {
      try { bridge.setVideoSplit(!!on); } catch (error) { /* starszy APK bez mostu */ }
    }
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  /* =======================  USTAWIENIA (FORMULARZ)  ======================= */

  /* ==========================  ZAKŁADKI USTAWIEŃ  ==========================
     Trzy zakładki trzymają porządek: „Ogólne” (sama aplikacja — profil,
     źródła, EPG, odtwarzanie, wygląd i język), „Aktualizacja” (tylko wydania
     i instalacja paczki) oraz „Instrukcja” (poradnik obsługi pilota). Pasek
     zakładek jest nad treścią, a pilot zmienia zakładkę strzałkami ◀ ▶
     (obsługa klawiszy w sekcji OBSŁUGA PILOTA) i wchodzi w treść klawiszem ▼. */

  var SETTINGS_TABS = ["general", "update", "help"];
  var settingsTab = "general";

  function settingsTabName(name) {
    return SETTINGS_TABS.indexOf(name) < 0 ? "general" : name;
  }

  function settingsTabId(name) {
    return "settingsTab" + name.charAt(0).toUpperCase() + name.slice(1);
  }

  function settingsPanelId(name) {
    return "settingsPanel" + name.charAt(0).toUpperCase() + name.slice(1);
  }

  function showSettingsTab(name) {
    settingsTab = settingsTabName(name);
    for (var i = 0; i < SETTINGS_TABS.length; i++) {
      var key = SETTINGS_TABS[i];
      var on = key === settingsTab;
      var tab = $(settingsTabId(key));
      var panel = $(settingsPanelId(key));
      if (tab) {
        tab.classList.toggle("active", on);
        tab.setAttribute("aria-selected", on ? "true" : "false");
      }
      if (panel) panel.classList.toggle("hidden", !on);
    }
  }

  /* ◀ ▶ na pasku zakładek: sąsiednia zakładka (z zawijaniem na końcach) */
  function stepSettingsTab(direction) {
    var index = SETTINGS_TABS.indexOf(settingsTab);
    if (index < 0) index = 0;
    var next = SETTINGS_TABS[(index + direction + SETTINGS_TABS.length) % SETTINGS_TABS.length];
    showSettingsTab(next);
    var tab = $(settingsTabId(next));
    if (tab && tab.focus) tab.focus();
  }

  /* ▼ z paska zakładek: fokus wchodzi w treść widocznej zakładki. Zakładka
     „Instrukcja” jest samym tekstem, więc gdy nie ma w niej czego sfokusować,
     fokus idzie po prostu niżej (do „Zapisz i pobierz” / „Wstecz”) — inaczej
     z paska nie dałoby się zjechać w dół. */
  function focusSettingsPanel() {
    var target = entryFocusTarget($(settingsPanelId(settingsTab)));
    if (target && target.focus) {
      target.focus();
      return;
    }
    focusNearest(40);
  }

  /* fokus na zakładce, w której użytkownik był ostatnio */
  function focusSettingsTabs() {
    var tab = $(settingsTabId(settingsTab));
    if (tab && tab.focus) tab.focus();
  }

  function bindSettingsTabs() {
    for (var i = 0; i < SETTINGS_TABS.length; i++) {
      var name = SETTINGS_TABS[i];
      var tab = $(settingsTabId(name));
      if (tab) tab.onclick = (function (chosen) {
        return function () { showSettingsTab(chosen); };
      })(name);
    }
  }

  /* Opcje przesunięcia EPG budujemy w kodzie: pełne i pół godziny od −12 do +12.
     Napis jest ten sam w obu językach („+1 h”), więc nie ma czego tłumaczyć. */
  function fillEpgShiftOptions() {
    var select = $("epgShiftHours");
    if (!select || select.options.length) return;
    for (var half = -24; half <= 24; half++) {
      var hours = half / 2;
      var option = document.createElement("option");
      option.value = String(hours);
      option.textContent = hours === 0 ? t("epg_shift_none")
        : (hours > 0 ? "+" : "-") + String(Math.abs(hours)).replace(".", ",") + " h";
      select.appendChild(option);
    }
  }

  function openSettings() {
    fillEpgShiftOptions();
    $("epgShiftHours").value = String(normalizeEpgShift(settings.epgShiftHours));
    $("archiveDays").value = String(settings.archiveDays);
    $("seekSeconds").value = String(settings.seekSeconds);
    $("retryAttempts").value = String(settings.retryAttempts);
    $("dpadSeek").checked = !!settings.dpadSeek;
    $("catchupTemplate").value = settings.catchupTemplate;
    $("catchupAll").checked = !!settings.catchupAll;
    $("epgRefreshMinutes").value = String(settings.epgRefreshMinutes);
    $("epgReloadOnStart").checked = !!settings.epgReloadOnStart;
    $("language").value = settings.language === "en" ? "en" : "pl";
    $("theme").value = settings.theme === "light" ? "light" : "dark";
    $("uiMode").value = settings.uiMode === "tv" || settings.uiMode === "touch" ? settings.uiMode : "auto";
    $("uiScale").value = normalizeUiScale(settings.uiScale);
    $("osdEnabled").checked = settings.osdEnabled !== false;
    $("clockEnabled").checked = settings.clockEnabled === true;
    $("nativePlayer").checked = settings.nativePlayer === true;
    $("vlcPlayer").checked = settings.vlcPlayer === true;
    $("vlcTexture").checked = settings.vlcTexture !== false;
    $("settingsError").textContent = "";
    resetUpdateStatus();
    /* „Wstecz” w ustawieniach wychodzi bez zapisu — przy pierwszym uruchomieniu
       (brak playlisty) nie ma dokąd wrócić, więc przycisk jest ukryty */
    var backButton = $("settingsBack");
    if (backButton) backButton.classList.toggle("hidden", !state.channels.length);
    /* ciche sprawdzenie: pokaże tylko informację o nowszej wersji i krótko,
       co się zmieniło — żadnego pobierania ani instalacji bez naciśnięcia przycisku */
    checkForUpdates(true);
    applyUiMode();
    refreshProfileSelect();
    loadProfileIntoForm(activeProfile());
    /* otwieramy tę zakładkę, w której użytkownik był ostatnio */
    showSettingsTab(settingsTab);
    showScreen("settingsScreen");
    /* fokus na widocznej zakładce — showScreen() stawia go na pierwszym
       przycisku karty, a to nie zawsze jest zakładka otwarta */
    window.setTimeout(focusSettingsTabs, 60);
  }

  function refreshProfileSelect() {
    var select = $("settingsProfile");
    suppressProfileSelect = true;
    select.textContent = "";
    settings.profiles.forEach(function (p) {
      var option = document.createElement("option");
      option.value = p.id;
      option.textContent = p.name;
      select.appendChild(option);
    });
    select.value = settings.activeProfileId;
    suppressProfileSelect = false;
  }

  /* ---------- pola z listą wyboru widoczne w całości ---------------------- */
  /* Rozwinięte menu systemowe (<select>) na dekoderach TV bywa ciemne na
     ciemnym i nie widać, która pozycja jest podświetlona. Pole, na którym wybór
     ma być jednoznaczny („Typ źródła”), rysujemy więc jako rząd przycisków:
     wszystkie pozycje widać naraz, a wybrana jest w kolorze akcentu. Ukryty
     <select> zostaje w formularzu jako miejsce, z którego wartość czytają
     pozostałe funkcje (`$("sourceType").value`), więc zmienia się tylko wygląd.
     Znacznik w index.html: <div class="choice-row" data-choice-for="sourceType">. */

  /* zdarzenie „change” takie, jak z prawdziwej listy: kod podłączony do
     <select> (pokazywanie pól Xtream, skok do pola adresu) działa bez zmian */
  function fireChange(element) {
    var event;
    try {
      event = new Event("change", { bubbles: true });
    } catch (error) {
      event = document.createEvent("HTMLEvents");
      event.initEvent("change", true, false);
    }
    element.dispatchEvent(event);
  }

  function syncChoiceRow(row) {
    var select = $(row.getAttribute("data-choice-for"));
    if (!select) return;
    var buttons = row.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute("data-value") === select.value;
      buttons[i].setAttribute("aria-checked", on ? "true" : "false");
    }
  }

  function syncChoiceRows() {
    var rows = document.querySelectorAll("[data-choice-for]");
    for (var i = 0; i < rows.length; i++) syncChoiceRow(rows[i]);
  }

  function pickChoice(button) {
    var row = button.parentNode;
    var select = $(row.getAttribute("data-choice-for"));
    if (!select) return;
    var chosen = button.getAttribute("data-value");
    var changed = select.value !== chosen;
    if (changed) select.value = chosen;
    syncChoiceRow(row);
    if (changed) fireChange(select);
  }

  function buildChoiceRow(row) {
    var select = $(row.getAttribute("data-choice-for"));
    if (!select || !select.options) return;
    row.textContent = "";
    for (var i = 0; i < select.options.length; i++) {
      var option = select.options[i];
      var button = document.createElement("button");
      button.type = "button";
      button.className = "choice";
      button.tabIndex = 0;
      button.setAttribute("role", "radio");
      button.setAttribute("data-value", option.value);
      /* napis pozycji przechodzi przez tłumaczenia tak samo jak <option> */
      var key = option.getAttribute("data-i18n");
      if (key) button.setAttribute("data-i18n", key);
      button.textContent = option.textContent;
      button.onclick = function () { pickChoice(this); };
      row.appendChild(button);
    }
    syncChoiceRow(row);
  }

  function buildChoiceRows() {
    var rows = document.querySelectorAll("[data-choice-for]");
    for (var i = 0; i < rows.length; i++) buildChoiceRow(rows[i]);
  }

  function loadProfileIntoForm(profile) {
    draft.editingId = profile ? profile.id : newProfileId();
    draft.playlistText = (profile && profile.playlistFileText) || "";
    draft.playlistName = (profile && profile.playlistFileName) || "";
    draft.epgText = (profile && profile.epgFileText) || "";
    draft.epgName = (profile && profile.epgFileName) || "";

    $("profileName").value = profile ? profile.name : "Nowa playlista";
    $("sourceType").value = profile ? profile.sourceType : "m3u-url";
    $("playlistUrl").value = (profile && profile.playlistUrl) || "";
    $("xtreamServer").value = (profile && profile.xtreamServer) || "";
    $("xtreamUser").value = (profile && profile.xtreamUser) || "";
    $("xtreamPass").value = (profile && profile.xtreamPass) || "";
    $("epgUrl").value = (profile && profile.epgUrl) || "";

    updateSourceSections();
    /* lista wyboru pokazuje wartość wczytaną z profilu */
    syncChoiceRows();
    updatePlaylistPicker();
    updateEpgPicker();
  }

  function updateSourceSections() {
    var type = $("sourceType").value;
    $("m3uUrlSection").classList.toggle("hidden", type !== "m3u-url");
    $("m3uFileSection").classList.toggle("hidden", type !== "m3u-file");
    $("xtreamSection").classList.toggle("hidden", type !== "xtream");
  }

  function updatePlaylistPicker() {
    var hasFile = !!draft.playlistText;
    $("selectedPlaylistFile").textContent = hasFile
      ? t("active_file", { name: draft.playlistName || "playlist.m3u" })
      : t("add_local_file");
  }

  function updateEpgPicker() {
    var hasFile = !!draft.epgText;
    $("epgUrl").disabled = hasFile;
    $("useEpgLink").classList.toggle("hidden", !hasFile);
    $("selectedEpgFile").textContent = hasFile
      ? t("active_file", { name: draft.epgName || "epg.xml" })
      : t("add_local_epg");
  }

  function readFile(file, asBinary) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error("Nie udało się odczytać pliku."));
      };
      if (asBinary) reader.readAsArrayBuffer(file);
      else reader.readAsText(file, "UTF-8");
    });
  }

  /* --------------- wybór pliku M3U / EPG bez okna systemowego ----------------
     W przeglądarce i na telefonie plik wybiera systemowe okno (ukryte pole
     <input type="file"> pod przyciskiem). Na telewizorze — typowy Fire TV — takiego
     okna często nie ma w ogóle i przycisk „Wybierz plik” tylko milczy. Wybór
     przejmuje wtedy natywny plugin OpenIptvFiles (paczka Android): pokazuje
     własną listę katalogów pamięci i karty USB, kopiuje plik do pamięci aplikacji
     i oddaje tu jego ścieżkę. Plik czytamy przez lokalny serwer Capacitora. */

  function nativeFilePicker() {
    var C = (typeof window !== "undefined") ? window.Capacitor : null;
    var plugin = C && C.Plugins ? C.Plugins.OpenIptvFiles : null;
    return plugin && plugin.pickFile ? plugin : null;
  }

  function pickedFileUrl(path) {
    var C = (typeof window !== "undefined") ? window.Capacitor : null;
    if (C && typeof C.convertFileSrc === "function") return C.convertFileSrc(path);
    return (window.location.origin || "") + "/_capacitor_file_" + path;
  }

  function pickedFileRead(path, asBinary) {
    return fetch(pickedFileUrl(path)).then(function (response) {
      if (!response.ok) throw new Error(String(response.status));
      return asBinary ? response.arrayBuffer() : response.text();
    });
  }

  function setSettingsError(message) {
    $("settingsError").textContent = message || "";
  }

  function applyPlaylistFile(name, text) {
    draft.playlistText = String(text || "");
    draft.playlistName = name || "playlist.m3u";
    setSettingsError("");
    updatePlaylistPicker();
  }

  function applyEpgFile(name, buffer) {
    draft.epgText = gunzipText(buffer);
    draft.epgName = name || "epg.xml";
    setSettingsError("");
    updateEpgPicker();
  }

  /* Wybór pliku: najpierw systemowy (plugin w paczce Android), a gdy go nie ma —
     zostaje ukryte pole <input type="file"> (przeglądarka, webOS). */
  function startFilePick(kind) {
    var input = $(kind === "epg" ? "epgFile" : "playlistFile");
    var plugin = nativeFilePicker();
    if (!plugin) {
      /* Na webOS systemowe okno wyboru pliku nie istnieje, więc zamiast milczeć
         mówimy wprost, czym zastąpić plik (link albo Xtream). */
      if (platformInfo && platformInfo.os === "webos") setSettingsError(t("pick_no_files"));
      else if (input) input.click();
      return;
    }

    plugin.pickFile({ kind: kind, title: t(kind === "epg" ? "pick_epg_file" : "pick_m3u_file") })
      .then(function (picked) {
        if (!picked || picked.cancelled) return;
        if (!picked.path) {
          setSettingsError(t("pick_no_files"));
          return;
        }
        loadPickedFile(kind, picked.name, picked.path);
      }, function () {
        setSettingsError(t("pick_no_files"));
      });
  }

  function loadPickedFile(kind, name, path) {
    pickedFileRead(path, kind === "epg").then(function (data) {
      try {
        if (kind === "epg") applyEpgFile(name, data);
        else applyPlaylistFile(name, data);
      } catch (error) {
        setSettingsError(t("pick_epg_unzip", { error: error.message }));
      }
    }, function () {
      setSettingsError(t(kind === "epg" ? "pick_epg_error" : "pick_m3u_error"));
    });
  }

  function normalizeServer(value) {
    var server = String(value || "").trim().replace(/\/+$/, "");
    if (!server) return "";
    if (!/^https?:\/\//i.test(server)) server = "http://" + server;
    return server;
  }

  function xtreamEndpoint(profile, extra) {
    var server = normalizeServer(profile.xtreamServer);
    var user = encodeURIComponent(profile.xtreamUser || "");
    var pass = encodeURIComponent(profile.xtreamPass || "");
    return server + "/player_api.php?username=" + user + "&password=" + pass + (extra ? "&" + extra : "");
  }

  /* =============================  AKTUALIZACJE  =============================
     Aktualizacja nie jest przymusowa i nigdy nie dzieje się sama. Przy wejściu
     w ustawienia aplikacja cicho pyta GitHuba o najnowsze wydanie
     (releases/latest) i pokazuje tylko informację: numer nowszej wersji oraz
     krótko, co się zmieniło. Pobranie i instalację uruchamia dopiero przycisk
     „Pobierz i zainstaluj” — na Androidzie / Fire TV paczkę pobiera natywny
     plugin OpenIptvUpdater i oddaje ją systemowemu instalatorowi (FileProvider),
     więc aktualizacja nie wymaga ADB ani komputera. webOS nie instaluje .ipk
     sam — tam pokazujemy adres wydania, a paczkę wgrywa się z komputera. */

  var UPDATE_REPO = "keczup21/teleiptv";
  var UPDATE_API = "https://api.github.com/repos/" + UPDATE_REPO + "/releases/latest";
  var UPDATE_PAGE = "https://github.com/" + UPDATE_REPO + "/releases/latest";
  var updateState = { asset: null, busy: false, progressBound: false };

  /* „1.19.0” albo „v1.19.0” → [1, 19, 0]; brakujące i nieliczbowe części to zera */
  function versionParts(text) {
    var head = String(text || "").trim().replace(/^v/i, "").split("+")[0].split("-")[0];
    var parts = head.split(".");
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var value = parseInt(parts[i], 10);
      out.push(isNaN(value) || value < 0 ? 0 : value);
    }
    while (out.length < 3) out.push(0);
    return out;
  }

  function compareVersions(a, b) {
    var left = versionParts(a);
    var right = versionParts(b);
    for (var i = 0; i < 3; i++) {
      if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
    }
    return 0;
  }

  /* Rozszerzenie paczki dla tej platformy: .apk (Android / Fire TV) lub .ipk (webOS) */
  function updateExtension() {
    if (platformInfo.native && /^(android|androidtv|googletv|firetv)$/.test(platformInfo.os)) return "apk";
    if (platformInfo.os === "webos") return "ipk";
    return "";
  }

  /* Paczka z wydania: plik z właściwym rozszerzeniem; gdy wydanie ma ich kilka,
     wybieramy „TeleIPTV-…”; starsze wydania miały „OpenIPTV-…”, więc liczą się oba */
  /* Która nazwa jest „nasza paczka”: 2 – obecna nazwa, 1 – nazwa z wydań przed
     przemianowaniem (wersja 2.0.0), 0 – cokolwiek innego z właściwym
     rozszerzeniem (tak zostaje, gdy wydanie ma tylko taki plik). */
  function updatePackageRank(name) {
    if (/^teleiptv/i.test(name)) return 2;
    if (/^openiptv/i.test(name)) return 1;
    return 0;
  }

  function updateAssetFor(release, extension) {
    if (!release || !release.assets || !extension) return null;
    var pattern = new RegExp("\\." + extension + "$", "i");
    var found = null;
    var rank = 0;
    for (var i = 0; i < release.assets.length; i++) {
      var asset = release.assets[i];
      var name = (asset && asset.name) || "";
      if (!pattern.test(name)) continue;
      var value = updatePackageRank(name);
      if (!found || value > rank) {
        found = asset;
        rank = value;
      }
    }
    return found;
  }

  /* Adres, spod którego plugin pobiera paczkę. Pole `url` z API GitHuba
     (api.github.com/repos/.../releases/assets/N) oddaje metadane pliku, a nie
     sam plik — bez nagłówka „Accept: application/octet-stream” przychodzi
     kilkaset bajtów JSON-a, więc instalator mówił „problem z analizowaniem
     pakietu”. Właściwa paczka leży pod browser_download_url
     (github.com/.../releases/download/<tag>/<plik>); adres API zostaje tylko
     jako zapas, bo plugin dokłada wtedy wymagany nagłówek. */
  function updateDownloadUrl(asset) {
    if (!asset) return "";
    if (asset.browser_download_url) return asset.browser_download_url;
    return asset.url || "";
  }

  /* Instalację robi natywny plugin — istnieje tylko w paczce Android / Fire TV */
  function nativeUpdater() {
    var C = (typeof window !== "undefined") ? window.Capacitor : null;
    var plugin = C && C.Plugins ? C.Plugins.OpenIptvUpdater : null;
    return plugin && plugin.install ? plugin : null;
  }

  function setUpdateStatus(message, kind) {
    var el = $("updateStatus");
    if (!el) return;
    el.textContent = message || "";
    el.className = "update-status" + (kind ? " " + kind : "");
  }

  /* Opis wydania z GitHuba w wersji „na ekran”: bez markdownu i nagłówków sekcji,
     kilka pierwszych punktów i limit znaków — na pilocie nikt nie przewinie
     całego changelogu */
  function shortReleaseNotes(body, maxLines, maxChars) {
    if (!body) return "";
    var lines = String(body).replace(/\r/g, "").split("\n");
    var out = [];
    for (var i = 0; i < lines.length && out.length < (maxLines || 3); i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === "#") continue;
      line = line
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .replace(/\*\*|__|`/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
      if (!line) continue;
      out.push("• " + line);
    }
    var text = out.join("\n");
    if (text.length > (maxChars || 320)) {
      text = text.slice(0, (maxChars || 320) - 1).replace(/[\s.,;:•]+$/, "") + "…";
    }
    return text;
  }

  /* Krótkie „co nowego” pokazujemy tylko wtedy, gdy wydanie faktycznie jest nowsze */
  function setUpdateNotes(latest, body) {
    var el = $("updateNotes");
    if (!el) return;
    var summary = shortReleaseNotes(body);
    if (!summary) {
      hideUpdateNotes();
      return;
    }
    el.textContent = t("update_changes", { latest: latest }) + "\n" + summary;
    el.classList.remove("hidden");
  }

  function hideUpdateNotes() {
    var el = $("updateNotes");
    if (!el) return;
    el.textContent = "";
    el.classList.add("hidden");
  }

  /* Przyciski w trakcie pobierania zostają dostępne dla pilota. `disabled`
     zabierało fokus (przeglądarka oddaje go wtedy ciału strony), więc po
     naciśnięciu „Pobierz i zainstaluj” nawigacja wracała na początek
     ustawień i nie dało się już zjechać do opisu zmian ani do „Zapisz”.
     Drugie naciśnięcie i tak odrzuca updateState.busy — pilnują tego
     checkForUpdates() i installAvailableUpdate(). */
  function setButtonBusy(button, busy) {
    if (!button) return;
    if (busy) {
      button.classList.add("busy");
      button.setAttribute("aria-disabled", "true");
      return;
    }
    button.classList.remove("busy");
    button.removeAttribute("aria-disabled");
  }

  function setUpdateBusy(busy) {
    updateState.busy = !!busy;
    setButtonBusy($("checkUpdates"), busy);
    setButtonBusy($("installUpdate"), busy);
  }

  function hideInstallButton() {
    var install = $("installUpdate");
    if (install) install.classList.add("hidden");
  }

  /* Informacja pod nazwą aplikacji, w nagłówku ekranu głównego: po włączeniu
     widać, że jest nowsza wersja i gdzie po nią pójść. Nic się nie pobiera
     ani nie instaluje bez naciśnięcia przycisku w ustawieniach. */
  function showUpdateNotice(latest) {
    var el = $("updateNotice");
    if (!el) return;
    el.textContent = t("update_notice", { latest: latest, current: APP_VERSION });
    el.classList.remove("hidden");
  }

  function hideUpdateNotice() {
    var el = $("updateNotice");
    if (!el) return;
    el.textContent = "";
    el.classList.add("hidden");
  }

  function updateErrorText(error) {
    if (error && error.message) return error.message;
    return t("update_err_unknown");
  }

  /* 404 z API GitHuba znaczy jedno: nie widzimy tego repozytorium (jest prywatne).
     Wtedy komunikat z kodem HTTP nic nie tłumaczy, więc mówimy wprost. */
  function updateErrorStatus(error) {
    var text = updateErrorText(error);
    if (/404/.test(text)) return t("update_err_404");
    return t("update_err", { msg: text });
  }

  function reportUpdateError(error) {
    setUpdateBusy(false);
    hideInstallButton();
    hideUpdateNotes();
    setUpdateStatus(updateErrorStatus(error), "warn");
  }

  function updateSizeLabel(asset) {
    var bytes = asset && typeof asset.size === "number" ? asset.size : 0;
    if (bytes <= 0) return "";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  /* Po wejściu w ustawienia wynik poprzedniego sprawdzania nie wisi już na ekranie */
  function resetUpdateStatus() {
    setUpdateBusy(false);
    hideInstallButton();
    hideUpdateNotes();
    setUpdateStatus("", "");
  }

  /* Wynik sprawdzenia. `silent` = ciche sprawdzenie przy wejściu w ustawienia:
     przy aktualnej wersji nie pokazujemy niczego, żeby nie zasypywać ekranu
     komunikatami, których nikt nie prosił */
  function applyRelease(release, installButton, silent) {
    var latest = (release && release.tag_name) || "";
    if (!latest) {
      if (silent) return;
      throw new Error(t("update_err_data"));
    }

    if (compareVersions(latest, APP_VERSION) <= 0) {
      updateState.asset = null;
      hideInstallButton();
      hideUpdateNotes();
      hideUpdateNotice();
      if (!silent) setUpdateStatus(t("update_current", { version: APP_VERSION }), "ok");
      return;
    }

    var asset = updateAssetFor(release, updateExtension());
    updateState.asset = asset;

    /* informacja na ekranie głównym — sam numer nowszej wersji */
    showUpdateNotice(latest);

    var message = t("update_available", { latest: latest, current: APP_VERSION });
    var size = updateSizeLabel(asset);
    if (asset) message += " " + t("update_asset", { name: asset.name, size: size || "?" });

    /* sama informacja: numer nowszej wersji i krótko, co się zmieniło */
    setUpdateNotes(latest, release && release.body);

    if (nativeUpdater() && asset) {
      /* instalację uruchamia dopiero naciśnięcie przycisku — pobranie
         i otwarcie instalatora robi plugin, gdy użytkownik o to poprosi */
      setUpdateStatus(message, "ok");
      if (installButton) installButton.classList.remove("hidden");
      return;
    }

    /* webOS i przeglądarka: paczkę trzeba pobrać i wgrać samemu */
    hideInstallButton();
    setUpdateStatus(
      message + " " + t("update_manual", { ext: updateExtension() || "apk", url: UPDATE_PAGE }),
      "warn"
    );
  }

  function checkForUpdates(silent) {
    if (updateState.busy) return;

    if (silent) {
      fetchJson(UPDATE_API, "update_err_json").then(function (release) {
        try {
          applyRelease(release, $("installUpdate"), true);
        } catch (error) {
          /* brak sensownej odpowiedzi — nie ma czego pokazywać */
        }
      }, function () {
        /* brak sieci nie jest błędem, o którym trzeba mówić po wejściu w ustawienia */
      });
      return;
    }

    setUpdateBusy(true);
    hideInstallButton();
    hideUpdateNotes();
    setUpdateStatus(t("update_checking"), "busy");

    fetchJson(UPDATE_API, "update_err_json").then(function (release) {
      setUpdateBusy(false);
      try {
        applyRelease(release, $("installUpdate"));
      } catch (error) {
        reportUpdateError(error);
      }
    }, reportUpdateError);
  }

  /* Postęp pobierania z pluginu. Brak nasłuchu niczego nie przerywa — wynik
     końcowy i tak przychodzi jako odpowiedź obietnicy z install(). */
  function bindUpdaterProgress(plugin) {
    if (updateState.progressBound) return;
    updateState.progressBound = true;
    try {
      plugin.addListener("progress", function (data) {
        var percent = data && typeof data.percent === "number" ? Math.round(data.percent) : 0;
        if (percent < 0) percent = 0;
        if (percent > 100) percent = 100;
        setUpdateStatus(t("update_downloading", { pct: percent }), "busy");
      });
    } catch (error) {
      /* cisza: komunikat końcowy wystarczy */
    }
  }

  function installAvailableUpdate() {
    var plugin = nativeUpdater();
    var asset = updateState.asset;
    if (!plugin || !asset || updateState.busy) return;

    setUpdateBusy(true);
    setUpdateStatus(t("update_downloading", { pct: 0 }), "busy");
    bindUpdaterProgress(plugin);

    var allowed = plugin.canInstall ? plugin.canInstall() : Promise.resolve({ allowed: true });
    var askedForPermission = false;

    allowed.then(function (result) {
      if (result && result.allowed === false) {
        /* system nie pozwala instalować z nieznanych źródeł — otwieramy ekran,
           na którym włącza się tę zgodę dla TeleIPTV */
        askedForPermission = true;
        setUpdateStatus(t("update_permission"), "warn");
        if (!plugin.openInstallSettings) return null;
        return plugin.openInstallSettings().then(null, function () { return null; });
      }
      return plugin.install({ url: updateDownloadUrl(asset), name: asset.name });
    }).then(function () {
      setUpdateBusy(false);
      if (askedForPermission) return;
      setUpdateStatus(t("update_installer"), "ok");
    }, function (error) {
      setUpdateBusy(false);
      setUpdateStatus(updateErrorStatus(error), "warn");
    });
  }

  /* ================================  SIEĆ  ================================ */

  function nativeHttpAvailable() {
    var C = (typeof window !== "undefined") ? window.Capacitor : null;
    return !!(C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.CapacitorHttp && C.Plugins.CapacitorHttp.get);
  }

  function base64ToUint8Array(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function nativeHttpGet(url, asArrayBuffer) {
    var Http = window.Capacitor.Plugins.CapacitorHttp;
    return Http.get({
      url: url,
      responseType: asArrayBuffer ? "arraybuffer" : "text",
      connectTimeout: 30000,
      readTimeout: 120000
    }).then(function (res) {
      if (res.status < 200 || res.status >= 300) {
        var e = new Error(t("err_http", { code: res.status }));
        e.isHttp = true;
        throw e;
      }
      /* Capacitor zwraca już sparsowany JSON, gdy serwer odpowiedział
         „application/json” (tak robi GitHub API), a nasze ścieżki tekstowe
         czytają string — obiekt wraca więc do postaci tekstu */
      if (!asArrayBuffer) {
        if (res.data && typeof res.data === "object") return JSON.stringify(res.data);
        return res.data;
      }
      if (res.data instanceof ArrayBuffer) return res.data;
      if (res.data && res.data.buffer instanceof ArrayBuffer) return res.data;
      if (typeof res.data === "string") return base64ToUint8Array(res.data);
      return res.data;
    });
  }

  function webosServiceAvailable() {
    return !!(typeof webOS !== "undefined" && webOS.service && webOS.service.request);
  }

  function webosHttpGet(url, asArrayBuffer) {
    return new Promise(function (resolve, reject) {
      var method = asArrayBuffer ? "fetchBinary" : "fetch";
      webOS.service.request(
        "luna://pl.openiptv.player.service.fetch/" + method,
        { url: url },
        function (result) {
          if (result && result.returnValue) {
            if (asArrayBuffer) resolve(base64ToUint8Array(result.dataBase64 || ""));
            else resolve(result.data || "");
          } else {
            var e = new Error(result && result.errorText ? result.errorText : "service error");
            if (result && result.status) e.isHttp = true;
            reject(e);
          }
        },
        function (err) {
          reject(new Error(err && err.errorText ? err.errorText : "service error"));
        }
      );
    });
  }

  function httpGet(url, asArrayBuffer, onProgress) {
    /* natywne HTTP omija CORS — Android (Capacitor) oraz webOS (serwis) */
    if (nativeHttpAvailable()) {
      return nativeHttpGet(url, asArrayBuffer).then(null, function (e) {
        if (e && e.isHttp) throw e;
        return httpGetOnce(url, asArrayBuffer, onProgress);
      });
    }
    if (webosServiceAvailable()) {
      return webosHttpGet(url, asArrayBuffer).then(null, function (e) {
        if (e && e.isHttp) throw e;
        return httpGetOnce(url, asArrayBuffer, onProgress);
      });
    }
    return httpGetOnce(url, asArrayBuffer, onProgress);
  }

  function httpGetOnce(url, asArrayBuffer, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      if (asArrayBuffer) xhr.responseType = "arraybuffer";
      xhr.timeout = 120000;
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response);
        } else if (xhr.status === 401 || xhr.status === 403) {
          var e = new Error(t("err_http_access", { code: xhr.status }));
          e.isHttp = true;
          reject(e);
        } else {
          var e2 = new Error(t("err_http", { code: xhr.status }));
          e2.isHttp = true;
          reject(e2);
        }
      };
      xhr.onerror = function () {
        reject(new Error(t("err_network")));
      };
      xhr.ontimeout = function () {
        reject(new Error(t("err_timeout")));
      };
      if (onProgress) {
        xhr.onprogress = function (event) {
          if (event.lengthComputable) {
            onProgress({ loaded: event.loaded, total: event.total });
          } else if (event.loaded) {
            onProgress({ loaded: event.loaded, total: 0 });
          }
        };
      }
      xhr.send();
    });
  }

  function fetchText(url, onProgress) {
    return httpGet(url, false, onProgress).then(function (text) {
      return String(text || "");
    });
  }

  /* `errorKey` mówi, czyjego adresu dotyczy odpowiedź — panelu Xtream czy
     GitHuba (aktualizacje). Bez tego każdy zły JSON zrzucał winę na panel.
     Natywne HTTP oddaje gotowy obiekt, gdy serwer odpowiedział
     „application/json”, więc obiekt przechodzi bez zmian. */
  function fetchJson(url, errorKey) {
    return fetchText(url).then(function (text) {
      if (text && typeof text === "object") return text;
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error(t(errorKey || "err_xtream_json"));
      }
    });
  }

  function decodeUtf8(bytes) {
    if (window.TextDecoder) return new TextDecoder("utf-8").decode(bytes);
    var out = "";
    for (var i = 0; i < bytes.length; i += 8192) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.length)));
    }
    try {
      return decodeURIComponent(escape(out));
    } catch (e) {
      return out;
    }
  }

  function decodeText(bytes, encoding) {
    if (window.TextDecoder) {
      try {
        return new TextDecoder(encoding).decode(bytes);
      } catch (error) {
        /* nieznany kodek — zostaje UTF-8 */
      }
    }
    return decodeUtf8(bytes);
  }

  /* dekodowanie XMLTV z obsługą BOM (UTF-8 oraz UTF-16LE/BE) */
  function decodeXmlBytes(bytes) {
    if (bytes.length > 1) {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) return decodeText(bytes, "utf-16le");
      if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeText(bytes, "utf-16be");
    }
    if (bytes.length > 2 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return decodeUtf8(bytes.subarray(3));
    }
    return decodeUtf8(bytes);
  }

  function stripBom(text) {
    return String(text || "").replace(/^\uFEFF/, "");
  }

  function gunzipText(buffer) {
    var bytes = new Uint8Array(buffer || []);
    if (bytes.length > 1 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (!window.pako) throw new Error(t("err_gzip"));
      return stripBom(decodeXmlBytes(window.pako.ungzip(bytes)));
    }
    return stripBom(decodeXmlBytes(bytes));
  }

  /* EPG pobieramy ZAWSZE binarnie i sami wykrywamy GZIP po nagłówku pliku
     (0x1f 0x8b) — nie po rozszerzeniu adresu. Wiele serwerów podaje spakowany
     plik pod adresem .xml, .php albo bez rozszerzenia i takie EPG wcześniej
     w ogóle się nie wczytywało. Zwracamy surowe bajty, bo rozpakowanie (pako)
     i zamiana na tekst to najdroższa część wczytywania EPG — robi je wątek
     parsera (patrz parseXmltvAsync), żeby nie zamrozić obrazu i pilota. */
  function fetchEpg(url, onProgress) {
    return httpGet(url, true, onProgress).then(function (buffer) {
      return { buffer: buffer };
    });
  }

  /* ===============================  PARSERY  =============================== */

  function parseAttributes(line) {
    var attrs = {};
    var re = /([A-Za-z0-9_-]+)="([^"]*)"/g;
    var m;
    while ((m = re.exec(line))) attrs[m[1].toLowerCase()] = m[2];
    return attrs;
  }

  function resolveUrl(base, url) {
    try {
      return new URL(url, base).href;
    } catch (e) {
      return url;
    }
  }

  function parseXmltvDate(value) {
    var m = String(value || "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/);
    if (!m) return 0;
    var utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    if (m[7]) {
      var offset = 60000 * (60 * +m[8] + +m[9]);
      utc += m[7] === "+" ? -offset : offset;
    }
    return utc;
  }

  function parsePlaylist(text, baseUrl) {
    var lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
    if (!lines.length || lines[0].trim().toUpperCase().indexOf("#EXTM3U") !== 0) {
      throw new Error("To nie jest playlista M3U.");
    }
    var header = parseAttributes(lines[0]);
    var headerEpg = (header["url-tvg"] || header["x-tvg-url"] || "").split(",")[0].trim();
    var channels = [];
    var current = null;

    for (var i = 1; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.toUpperCase().indexOf("#EXTINF") === 0) {
        current = line;
      } else if (line && line.charAt(0) !== "#" && current) {
        var attrs = parseAttributes(current);
        var commaAt = current.lastIndexOf(",");
        var name = (commaAt >= 0 ? current.substring(commaAt + 1) : attrs["tvg-name"] || "Kanał").trim();
        var streamUrl = resolveUrl(baseUrl, line);
        channels.push({
          key: channels.length + "|" + streamUrl,
          name: name || t("channel") + " " + (channels.length + 1),
          streamUrl: streamUrl,
          tvgId: attrs["tvg-id"] || "",
          group: attrs["group-title"] || t("other"),
          logoUrl: attrs["tvg-logo"] ? resolveUrl(baseUrl, attrs["tvg-logo"]) : "",
          catchupType: attrs["catchup-type"] || attrs.catchup || attrs.timeshift || "",
          catchupSource: attrs["catchup-source"] || "",
          catchupDays: Math.max(0, Math.min(30, parseInt(attrs["catchup-days"] || attrs.timeshift || "0", 10) || 0)),
          correction: parseFloat(attrs["catchup-correction"] || "0") || 0
        });
        current = null;
      }
    }
    if (!channels.length) throw new Error("Playlista nie zawiera kanałów.");
    return { channels: channels, epgUrl: headerEpg ? resolveUrl(baseUrl, headerEpg) : "" };
  }

  function parseXmltv(text, daysBack) {
    var doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) {
      throw new Error("EPG nie jest poprawnym XMLTV.");
    }
    var nodes = doc.getElementsByTagName("programme");
    var now = Date.now();
    var from = now - 86400000 * daysBack;
    var to = now + 86400000 * 2;
    var programs = {};
    epgAliases = {};

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var channelId = node.getAttribute("channel") || "";
      var start = parseXmltvDate(node.getAttribute("start"));
      var end = parseXmltvDate(node.getAttribute("stop"));
      if (!channelId || start < from || start > to || end <= start) continue;
      var titles = node.getElementsByTagName("title");
      var title = titles.length ? titles[0].textContent.trim() : "Program";
      if (!programs[channelId]) programs[channelId] = [];
      programs[channelId].push({
        channelId: channelId,
        start: start,
        end: end,
        title: title || "Program"
      });

      /* alias po nazwie wyświetlanej — kanały bez tvg-id też dostaną EPG */
      var names = node.getElementsByTagName("display-name");
      for (var d = 0; d < names.length; d++) {
        var dn = (names[d].textContent || "").trim();
        if (dn) epgAliases[dn.toLowerCase()] = channelId;
      }
    }
    for (var key in programs) {
      programs[key].sort(function (a, b) {
        return b.start - a.start;
      });
    }
    return programs;
  }

  /* =============================  XTREAM CODES  ============================= */

  function xtreamStreamUrl(profile, stream) {
    var server = normalizeServer(profile.xtreamServer);
    var user = encodeURIComponent(profile.xtreamUser || "");
    var pass = encodeURIComponent(profile.xtreamPass || "");
    var ext = String(stream.container_extension || "ts").replace(/^\./, "") || "ts";
    return server + "/live/" + user + "/" + pass + "/" + stream.stream_id + "." + ext;
  }

  function xtreamXmltvUrl(profile) {
    var server = normalizeServer(profile.xtreamServer);
    var user = encodeURIComponent(profile.xtreamUser || "");
    var pass = encodeURIComponent(profile.xtreamPass || "");
    /* next_days ogranicza rozmiar EPG; jeśli panel go nie obsługuje, zwróci pełny plik (bez szkody) */
    var days = Math.max(1, (parseInt(settings.archiveDays, 10) || 7) + 1);
    return server + "/xmltv.php?username=" + user + "&password=" + pass + "&next_days=" + days;
  }

  /* krok 1: logowanie (player_api.php bez akcji) → user_info.auth
     krok 2: kategorie live       (action=get_live_categories)
     krok 3: lista kanałów live   (action=get_live_streams)
     krok 4: EPG                  (xmltv.php, o ile nie podano własnego adresu) */
  function loadXtreamCatalog(profile) {
    var categories = [];
    var streams = [];

    return fetchJson(xtreamEndpoint(profile, "")).then(function (info) {
      var userInfo = info && info.user_info;
      if (!userInfo || String(userInfo.auth) !== "1") {
        throw new Error("Xtream: nieprawidłowy adres serwera, użytkownik lub hasło.");
      }
      if (userInfo.status && String(userInfo.status).toLowerCase() !== "active") {
        throw new Error("Xtream: konto nieaktywne (" + userInfo.status + "). Sprawdź datę ważności.");
      }
      return fetchJson(xtreamEndpoint(profile, "action=get_live_categories"));
    }).then(function (data) {
      if (Array.isArray(data)) categories = data;
      return fetchJson(xtreamEndpoint(profile, "action=get_live_streams"));
    }).then(function (data) {
      if (Array.isArray(data)) streams = data;
      if (!streams.length) {
        throw new Error("Xtream nie zwrócił żadnych kanałów live dla tego konta.");
      }
      var groupNames = {};
      categories.forEach(function (category) {
        groupNames[String(category.category_id)] = category.category_name || t("other");
      });

      var channels = streams.map(function (stream, index) {
        var archiveDays = Math.max(0, Math.min(30, parseInt(stream.tv_archive_duration || "0", 10) || 0));
        var hasArchive = String(stream.tv_archive) === "1" || archiveDays > 0;
        return {
          key: "xtream-" + stream.stream_id,
          name: stream.name || "Kanał " + (index + 1),
          streamUrl: xtreamStreamUrl(profile, stream),
          tvgId: stream.epg_channel_id || "",
          group: groupNames[String(stream.category_id)] || stream.category_name || t("other"),
          logoUrl: stream.stream_icon || "",
          catchupType: hasArchive ? "xtream" : "",
          catchupSource: "",
          catchupDays: hasArchive ? archiveDays : 0,
          correction: 0
        };
      });

      return {
        channels: channels,
        epgUrl: profile.epgUrl || xtreamXmltvUrl(profile)
      };
    });
  }

  /* ==========================  WCZYTANIE KATALOGU  ========================== */

  function setStatus(text) {
    $("status").textContent = text;
  }

  function formatProgress(info) {
    if (info && info.total > 0) {
      return Math.round((info.loaded / info.total) * 100) + "%";
    }
    if (info && info.loaded > 0) {
      return (info.loaded / 1048576).toFixed(1) + " MB";
    }
    return "";
  }

  /* parsuje XMLTV w Web Workerze, żeby nie blokować UI; z fallbackiem synchronicznym */
  /* Rozpakowanie zapasowe: to samo, co robi epg-worker.js, tylko na głównym
     wątku i z pako wczytanym przez index.html. Sięgamy po nie wyłącznie wtedy,
     gdy wątek nie wystartował (np. brak pliku) — normalnie bajty zostają
     w wątku i obraz się nie zacina. */
  function epgTextFrom(pack) {
    if (pack && pack.text) return String(pack.text);
    return gunzipText(pack ? pack.buffer : null);
  }

  /* Parsowanie XMLTV w wątku. Wątek dostaje albo gotowy tekst (EPG z pliku),
     albo surowe, ewentualnie spakowane bajty z pobrania — rozpakowanie
     i zamiana na tekst dla dużego EPG trwały kilka sekund i blokowały obraz. */
  function parseXmltvAsync(payload, daysBack) {
    var pack = payload && (payload.text || payload.buffer) ? payload : { text: payload };
    return new Promise(function (resolve, reject) {
      var settled = false;
      var finish = function (programs) {
        if (!settled) {
          settled = true;
          resolve(programs);
        }
      };
      var fail = function (error) {
        if (!settled) {
          settled = true;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
      /* bez wątku nie ma na co czekać — liczymy od razu, a błąd parsowania
         pokazujemy w pasku zamiast zostawiać napis „parsowanie EPG” */
      var fallback = function () {
        try {
          finish(parseXmltv(epgTextFrom(pack), daysBack));
        } catch (error) {
          fail(error);
        }
      };
      var worker;
      try {
        worker = new Worker("epg-worker.js");
      } catch (e) {
        fallback();
        return;
      }
      worker.onmessage = function (event) {
        var data = event.data || {};
        try { worker.terminate(); } catch (e2) {}
        if (data.error) {
          fallback();
        } else {
          epgAliases = data.aliases || {};
          finish(data.programs || {});
        }
      };
      worker.onerror = function () {
        try { worker.terminate(); } catch (e2) {}
        fallback();
      };
      /* Bajty idą do wątku bez przenoszenia własności: gdyby wątek się nie
         uruchomił, parser zapasowy musi mieć z czego czytać. */
      if (pack.buffer && !pack.text) worker.postMessage({ buffer: pack.buffer, daysBack: daysBack });
      else worker.postMessage({ text: pack.text || "", daysBack: daysBack });
    });
  }

  /* ---------------------------  PAMIĘĆ EPG  ---------------------------
     Trzy rzeczy trzymają się razem: surowy wynik parsowania (epgRaw), programy
     z nałożonym przesunięciem godzin (programs, patrz applyEpgShift) i odcisk
     źródła (epgKey, patrz epgKey). Dzięki temu:

       • zmiana „Przesunięcia czasu EPG” przelicza programy od razu, bez pobierania,
       • zapis ustawień (loadCatalog) nie zaciąga EPG po raz drugi, dopóki źródło
         i zakres dni są te same — pobrane programy zostają na liście kanałów. */

  /* EPG bez danych: czyścimy wszystko razem, żeby kolejne wejście na listę
     kanałów pobrało programy od nowa (patrz loadCatalog) */
  function clearEpg() {
    state.programs = {};
    state.epgRaw = null;
    state.epgKey = "";
  }

  /* „Odcisk” źródła EPG: profil, adres (albo plik) i zakres dni. loadCatalog()
     woła go przy każdym wejściu na listę kanałów — także po zapisaniu ustawień —
     i gdy odcisk się zgadza, programy zostają te, które już mamy. */
  function epgKey(profile, url) {
    if (!profile) return "";
    var source = profile.epgFileText ? "file:" + profile.epgFileText.length : (url || "");
    return profile.id + "|" + source + "|" + settings.archiveDays;
  }

  /* Przesunięcie godzin EPG (ustawienie „Przesunięcie czasu EPG”). Nadawca,
     który w XMLTV podaje czas zimowy, gdy u nas jest letni (albo odwrotnie),
     opisuje program godzinę obok: na liście widać wtedy złą pozycję, a archiwum
     sięga po zły materiał. Przesunięcie nakładamy na wynik parsowania, więc
     działa też w czasach catch-up (patrz buildCatchupUrl). */
  function shiftPrograms(programs, hours) {
    var src = programs || {};
    var shift = Math.round((parseFloat(hours) || 0) * 3600000);
    if (!shift) return src;
    var out = {};
    for (var key in src) {
      if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
      out[key] = (src[key] || []).map(function (program) {
        var copy = {};
        for (var field in program) copy[field] = program[field];
        copy.start = program.start + shift;
        copy.end = program.end + shift;
        return copy;
      });
    }
    return out;
  }

  /* Programy w pamięci = surowy wynik parsowania + przesunięcie z ustawień */
  function applyEpgShift() {
    if (!state.epgRaw) return state.programs;
    state.programs = shiftPrograms(state.epgRaw, settings.epgShiftHours);
    return state.programs;
  }

  /* Przesunięcie z formularza: pół godziny dokładności i zakres ±12 h (czas
     zimowy/letni to pełna godzina, ale bywają źródła o pół godziny obok) */
  function normalizeEpgShift(value) {
    var hours = parseFloat(value);
    if (!isFinite(hours)) return 0;
    return Math.max(-12, Math.min(12, Math.round(hours * 2) / 2));
  }

  function loadEpgInBackground(profile, epgUrl) {
    if (!profile.epgFileText && !epgUrl) {
      clearEpg();
      setStatus(state.channels.length + " " + t("channels_count"));
      return;
    }
    setStatus(state.channels.length + " " + t("channels_count") + " • " + t("loading_epg"));
    var epgSource = profile.epgFileText
      ? Promise.resolve({ text: profile.epgFileText })
      : fetchEpg(epgUrl, function (info) {
          setStatus(state.channels.length + " " + t("channels_count") + " • " + t("loading_epg") + " " + formatProgress(info));
        });
    epgSource.then(function (payload) {
      setStatus(state.channels.length + " " + t("channels_count") + " • " + t("parsing_epg"));
      return parseXmltvAsync(payload, settings.archiveDays).then(function (programs) {
        /* zapamiętujemy surowy wynik i odcisk źródła, a przesunięcie godzin
           nakładamy na wierzch (patrz applyEpgShift) */
        state.epgRaw = programs;
        state.epgKey = epgKey(profile, epgUrl);
        var shifted = applyEpgShift();
        var count = 0;
        for (var k in shifted) count += shifted[k].length;
        if (state.channels.length) {
          selectGroup(state.selectedGroup, document.querySelector(".category.active"));
        }
        setStatus(state.channels.length + " " + t("channels_count") + " • EPG: " + count + " " + t("epg_programs"));
      });
    }, function (error) {
      clearEpg();
      setStatus(state.channels.length + " " + t("channels_count") + " • EPG: " + t("epg_no_data") + " (" + error.message + ")");
    }).catch(function (error) {
      /* błąd rozpakowania albo parsowania nie może zostawić na pasku napisu
         „parsowanie EPG” — pokazujemy powód obok liczby kanałów */
      clearEpg();
      setStatus(state.channels.length + " " + t("channels_count") + " • EPG: " + t("epg_no_data") +
        " (" + (error && error.message ? error.message : error) + ")");
    });
  }

  /* EPG ruszamy dopiero wtedy, gdy lista kanałów jest już narysowana, pilot ma
     fokus, a przeglądarka nie ma pilniejszej roboty. Wcześniej pobieranie
     i parsowanie XMLTV startowało natychmiast po wczytaniu listy i konkurowało
     z pierwszym malowaniem ekranu — aplikacja zamarzała na starcie. */
  var epgStartTimer = null;
  var EPG_START_DELAY_MS = 1500;

  function scheduleEpgStart(profile, epgUrl) {
    cancelEpgStart();
    var run = function () {
      epgStartTimer = null;
      if (!state.channels.length) return;
      var current = activeProfile();
      /* profil zdążył się zmienić albo zniknął — nie ładujemy już niczego */
      if (!current || current.id !== profile.id) return;
      loadEpgInBackground(current, epgUrl);
    };
    if (typeof window.requestIdleCallback === "function") {
      epgStartTimer = window.requestIdleCallback(run, { timeout: 4000 });
      return;
    }
    epgStartTimer = window.setTimeout(run, EPG_START_DELAY_MS);
  }

  function cancelEpgStart() {
    if (!epgStartTimer) return;
    if (typeof window.cancelIdleCallback === "function") {
      try { window.cancelIdleCallback(epgStartTimer); } catch (error) { /* to nie był idle */ }
    }
    window.clearTimeout(epgStartTimer);
    epgStartTimer = null;
  }

  function refreshEpg() {
    var profile = activeProfile();
    if (!profile || !state.channels.length) return;
    cancelEpgStart();
    loadEpgInBackground(profile, state.epgUrl);
  }

  function scheduleEpgRefresh() {
    clearInterval(state.epgTimer);
    state.epgTimer = null;
    var mins = parseInt(settings.epgRefreshMinutes, 10) || 0;
    if (mins > 0) state.epgTimer = setInterval(refreshEpg, mins * 60000);
  }

  function loadCatalog() {
    var profile = activeProfile();
    if (!profile) {
      openSettings();
      return;
    }
    normalizeProfile(profile);
    showScreen("browserScreen");
    scheduleEpgRefresh();
    /* nowy katalog unieważnia odroczony start EPG poprzedniego profilu */
    cancelEpgStart();

    var switcher = $("profileSwitcher");
    suppressProfileSwitcher = true;
    switcher.textContent = "";
    settings.profiles.forEach(function (item) {
      var option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      switcher.appendChild(option);
    });
    switcher.value = settings.activeProfileId;
    suppressProfileSwitcher = false;

    /* UWAGA: NIE czyścimy tutaj #categories — to <aside>, w którym
       renderCategories trzyma #categoryList oraz narzędzia kolejności grup.
       Wyczyszczenie go usuwało te elementy z DOM i kolejny render kończył się
       błędem „Cannot set properties of null (setting 'textContent')”.
       Listę kategorii czyści renderCategories(). */
    $("channels").textContent = "";

    var loadSource;
    if (profile.sourceType === "xtream") {
      setStatus(t("connecting_xtream"));
      loadSource = loadXtreamCatalog(profile);
    } else if (profile.playlistFileText) {
      var fileBase = "file:///" + (profile.playlistFileName || "playlist.m3u");
      loadSource = Promise.resolve(parsePlaylist(profile.playlistFileText, fileBase));
    } else {
      setStatus(t("loading_playlist"));
      loadSource = fetchText(profile.playlistUrl).then(function (text) {
        return parsePlaylist(text, profile.playlistUrl);
      });
    }

    loadSource.then(function (catalog) {
      state.channels = catalog.channels;
      state.epgUrl = profile.epgUrl || catalog.epgUrl;

      /* 1) najpierw pokazujemy kanały */
      renderCategories();

      /* Pilot: po wczytaniu listy fokus wchodzi w kanały — inaczej zostawał
         w nagłówku (albo w polu szukania) i trzeba było szukać listy strzałkami.
         Gdy użytkownik właśnie pisze zapytanie, nie przerywamy mu. */
      if (isTvMode() && document.activeElement !== $("searchInput")) focusChannelEntry();

      /* 2) EPG w tle (o ile włączone przy starcie) — start jest odroczony do
         chwili, gdy lista kanałów i fokus są już gotowe (patrz scheduleEpgStart),
         żeby pobieranie i parsowanie nie zamroziło startu aplikacji */
      if (!settings.epgReloadOnStart) {
        clearEpg();
        setStatus(state.channels.length + " " + t("channels_count"));
        return;
      }
      /* Programy z tego samego źródła zostają. Tędy przechodzi też zapis
         ustawień („Zapisz i pobierz” woła loadCatalog), a pobieranie EPG od nowa
         tylko dlatego, że ktoś zapisał ustawienia, kasowało z listy kanałów to,
         co już było widać, i mieliło megabajty XMLTV (patrz epgKey). */
      if (state.epgKey && state.epgKey === epgKey(profile, state.epgUrl)) {
        var known = 0;
        for (var knownKey in state.programs) known += state.programs[knownKey].length;
        setStatus(state.channels.length + " " + t("channels_count") + " • EPG: " + known + " " + t("epg_programs"));
        return;
      }
      setStatus(state.channels.length + " " + t("channels_count"));
      scheduleEpgStart(profile, state.epgUrl);
    }).catch(function (error) {
      state.channels = [];
      setStatus(t("error") + " " + error.message);
    });
  }

  /* ---------- kolejność grup (ręczna, zapisywana per profil) ---------- */

  function groupNames() {
    var groups = [];
    var seen = {};
    state.channels.forEach(function (channel) {
      if (!seen[channel.group]) {
        seen[channel.group] = true;
        groups.push(channel.group);
      }
    });
    var saved = perProfile(settings.groupOrder);
    var rank = {};
    saved.forEach(function (name, i) { rank[name] = i; });
    return groups.sort(function (a, b) {
      var ra = typeof rank[a] === "number" ? rank[a] : -1;
      var rb = typeof rank[b] === "number" ? rank[b] : -1;
      if (ra >= 0 && rb >= 0) return ra - rb;
      if (ra >= 0) return -1;
      if (rb >= 0) return 1;
      return a.localeCompare(b, settings.language === "en" ? "en" : "pl");
    });
  }

  function moveGroup(name, direction) {
    var groups = groupNames();
    var from = groups.indexOf(name);
    var to = from + direction;
    if (from < 0 || to < 0 || to >= groups.length) return;

    groups.splice(to, 0, groups.splice(from, 1)[0]);
    var saved = perProfile(settings.groupOrder);
    saved.length = 0;
    groups.forEach(function (g) { saved.push(g); });
    saveSettings();

    state.orderFocus = { key: name, dir: direction };
    renderCategories();
  }

  function resetGroupOrder() {
    var saved = perProfile(settings.groupOrder);
    saved.length = 0;
    saveSettings();
    renderCategories();
  }

  function setGroupOrderEdit(on) {
    state.orderEdit = !!on;
    if (!state.orderEdit) state.orderFocus = null;
    renderCategories();
  }

  function orderButton(key, glyph, dir, disabled) {
    var button = document.createElement("button");
    button.className = "order-btn";
    button.type = "button";
    button.tabIndex = 0;
    button.textContent = glyph;
    button.title = t(dir < 0 ? "move_up" : "move_down");
    button.setAttribute("data-move-key", key);
    button.setAttribute("data-move-dir", String(dir));
    if (disabled) {
      button.disabled = true;
      button.tabIndex = -1;
    }
    button.onclick = function (event) {
      if (event && event.stopPropagation) event.stopPropagation();
      moveGroup(key, dir);
    };
    return button;
  }

  /* Odporność na niekompletny HTML (starsze/zmiksowane zasoby w WebView):
     jeśli brakuje kontenera listy lub narzędzi kolejności grup, tworzymy je w locie. */
  function ensureCategoryLayout() {
    var host = $("categories") || document.body;
    var container = $("categoryList");
    if (!container) {
      container = document.createElement("div");
      container.id = "categoryList";
      host.appendChild(container);
    }

    var toggle = $("groupOrderToggle");
    var reset = $("groupOrderReset");
    if (!toggle || !reset) {
      var tools = document.createElement("div");
      tools.className = "category-tools";
      if (!toggle) {
        toggle = document.createElement("button");
        toggle.id = "groupOrderToggle";
        toggle.type = "button";
        toggle.tabIndex = 0;
        toggle.className = "order-toggle hidden";
        toggle.onclick = function () { setGroupOrderEdit(!state.orderEdit); };
      }
      if (!reset) {
        reset = document.createElement("button");
        reset.id = "groupOrderReset";
        reset.type = "button";
        reset.tabIndex = 0;
        reset.className = "order-reset hidden";
        reset.onclick = function () { resetGroupOrder(); };
      }
      tools.appendChild(toggle);
      tools.appendChild(reset);
      host.insertBefore(tools, container);
    }

    if (!$("groupOrderHint")) {
      var hint = document.createElement("p");
      hint.id = "groupOrderHint";
      hint.className = "order-hint hidden";
      hint.textContent = t("order_hint");
      host.insertBefore(hint, container);
    }

    return container;
  }

  function renderCategories() {
    var groups = groupNames();
    var container = ensureCategoryLayout();
    container.textContent = "";

    var canOrder = groups.length > 1;
    var toggle = $("groupOrderToggle");
    var reset = $("groupOrderReset");
    var hint = $("groupOrderHint");
    if (toggle) {
      toggle.classList.toggle("hidden", !canOrder);
      setIconLabel(toggle, t(state.orderEdit ? "group_order_done" : "group_order"));
    }
    if (reset) {
      reset.classList.toggle("hidden", !(canOrder && state.orderEdit));
      setIconLabel(reset, t("order_reset"));
    }
    if (hint) hint.classList.toggle("hidden", !(canOrder && state.orderEdit));

    var items = [
      { key: "@favorites", label: t("favorites") },
      { key: "@recent", label: t("recent") },
      { key: "@all", label: t("all") }
    ].concat(groups.map(function (g) { return { key: g, label: g }; }));

    var buttons = {};

    items.forEach(function (item, index) {
      var fixed = item.key.charAt(0) === "@";
      var button = document.createElement("button");
      button.className = "category";
      button.type = "button";
      button.tabIndex = 0;
      setIconLabel(button, item.label);
      button.setAttribute("data-key", item.key);
      /* Grupa zmienia się tylko po naciśnięciu OK (klik) — samo dojechanie
         fokusem nie może przełączać listy kanałów: pilot schodząc z kanałów
         na przyciski grup przerzucał wtedy kategorię w trakcie przewijania. */
      button.onclick = function () {
        selectGroup(item.key, button);
        if (nextFocusAfterGroup(isTvMode()) === "channels") focusChannelEntry();
      };
      buttons[item.key] = button;

      if (!state.orderEdit || fixed) {
        container.appendChild(button);
        return;
      }

      var row = document.createElement("div");
      row.className = "category-row";
      var tools = document.createElement("div");
      tools.className = "order-btns";
      tools.appendChild(orderButton(item.key, "▲", -1, index === 3));
      tools.appendChild(orderButton(item.key, "▼", 1, index === items.length - 1));
      row.appendChild(button);
      row.appendChild(tools);
      container.appendChild(row);
    });

    var target = buttons[state.selectedGroup] || buttons["@all"];
    selectGroup(target.getAttribute("data-key"), target);

    /* pilot: po przesunięciu grupy wracamy na ten sam przycisk strzałki */
    if (state.orderFocus) {
      var wanted = state.orderFocus;
      state.orderFocus = null;
      var all = container.querySelectorAll(".order-btn");
      for (var i = 0; i < all.length; i++) {
        if (all[i].getAttribute("data-move-key") === wanted.key &&
            all[i].getAttribute("data-move-dir") === String(wanted.dir)) {
          all[i].focus();
          break;
        }
      }
    }
  }

  /* -------------------------------  EPG  ------------------------------- */

  function programsFor(channel) {
    if (state.programs[channel.tvgId]) return state.programs[channel.tvgId];
    if (state.programs[channel.name]) return state.programs[channel.name];
    var alias = epgAliases[String(channel.name || "").toLowerCase()];
    return alias ? (state.programs[alias] || []) : [];
  }

  function currentProgram(channel) {
    var list = programsFor(channel);
    var now = Date.now();
    for (var i = 0; i < list.length; i++) {
      if (now >= list[i].start && now < list[i].end) return list[i];
    }
    return null;
  }

  function nextProgram(channel) {
    var list = programsFor(channel);
    var now = Date.now();
    var next = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].start >= now && (!next || list[i].start < next.start)) next = list[i];
    }
    return next;
  }

  function hasArchive(channel) {
    if (settings.catchupAll) return true;
    if (channel.catchupSource || settings.catchupTemplate) return true;
    var type = String(channel.catchupType || "").toLowerCase();
    if (type === "append" || type === "shift" || type === "flussonic") return true;
    if (channel.catchupDays > 0 || channel.catchupType) {
      return !!buildTimeshiftUrl(channel.streamUrl, 1, 1);
    }
    return false;
  }

  /* ===============================  KANAŁY  =============================== */

  function selectGroup(name, button) {
    state.selectedGroup = name;
    var active = document.querySelectorAll(".category.active");
    for (var i = 0; i < active.length; i++) active[i].classList.remove("active");
    if (button) button.classList.add("active");

    var container = $("channels");
    container.textContent = "";
    var query = ($("searchInput").value || "").trim().toLowerCase();
    var recents = perProfile(settings.recentChannels);

    var visible = state.channels.filter(function (channel) {
      var inGroup =
        name === "@all" ||
        (name === "@favorites" && isFavorite(channel)) ||
        (name === "@recent" && recents.indexOf(keyOf(channel)) >= 0) ||
        channel.group === name;
      if (!inGroup) return false;
      if (!query) return true;
      if (channel.name.toLowerCase().indexOf(query) >= 0) return true;
      return programsFor(channel).some(function (program) {
        return program.title.toLowerCase().indexOf(query) >= 0;
      });
    });

    if (name === "@recent") {
      visible.sort(function (a, b) {
        return recents.indexOf(keyOf(a)) - recents.indexOf(keyOf(b));
      });
    }

    /* Lista rysowana porcjami (LIST_CHUNK) — na playlistach z tysiącami kanałów
       do DOM trafia tylko to, co realnie widać, a resztę dokładamy przy przewijaniu */
    state.listItems = visible;
    state.listRendered = 0;
    state.listToken++;
    container.textContent = "";
    container.scrollTop = 0;
    bindListScroll();
    renderListChunk(true);
  }

  function renderListChunk(focusFirst) {
    var container = $("channels");
    if (!container || state.listRendered >= state.listItems.length) return;

    var token = state.listToken;
    var end = Math.min(state.listRendered + LIST_CHUNK, state.listItems.length);
    for (var i = state.listRendered; i < end; i++) {
      container.appendChild(buildChannelCard(state.listItems[i]));
    }
    state.listRendered = end;

    /* w trybie TV fokus musi od razu wylądować na pierwszym kanale */
    if (focusFirst && end > 0 && isTvMode() && document.activeElement === document.body) {
      var first = container.querySelector(".channel-main");
      if (first) {
        try { first.focus(); } catch (error) { /* bez fokusu też da się kliknąć */ }
      }
    }

    /* gdy porcja nie zapełniła jeszcze ekranu, dokładamy kolejną */
    if (container.clientHeight > 0 && container.scrollHeight <= container.clientHeight) {
      setTimeout(function () {
        if (token === state.listToken && !state.listScrollLock) renderListChunk(false);
      }, 0);
    }
  }

  /* doładowanie przy przewijaniu: jedna porcja na raz, bez mielenia DOM-u */
  function bindListScroll() {
    var container = $("channels");
    if (!container || container.getAttribute("data-scroll-bound")) return;
    container.setAttribute("data-scroll-bound", "1");
    container.addEventListener("scroll", function () {
      if (state.listScrollLock) return;
      var remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (remaining > LOGO_MARGIN) return;
      state.listScrollLock = true;
      setTimeout(function () {
        state.listScrollLock = false;
        if (state.listRendered < state.listItems.length) renderListChunk(false);
      }, 80);
    });
  }

  /* nawigacja pilotem: dokładamy porcje, zanim fokus dojdzie do końca listy */
  function ensureListAhead() {
    var container = $("channels");
    var active = document.activeElement;
    if (!container || !active || !active.closest) return;
    var card = active.closest(".channel");
    if (!card) return;
    var index = Array.prototype.indexOf.call(container.children, card);
    if (index >= state.listRendered - 12) renderListChunk(false);
  }

  /* logotyp wczytujemy dopiero, gdy kafelek zbliży się do ekranu — inaczej
     duża playlista zasypuje łącze setkami obrazków na starcie */
  function observeLogo(image) {
    var url = image.dataset ? image.dataset.logo : "";
    if (!url) return;
    if (!("IntersectionObserver" in window)) {
      image.src = url;
      return;
    }
    if (!logoObserver) {
      logoObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var target = entry.target;
          logoObserver.unobserve(target);
          if (target.dataset.logo) target.src = target.dataset.logo;
        });
      }, { root: $("channels"), rootMargin: LOGO_MARGIN + "px 0px" });
    }
    logoObserver.observe(image);
  }

  function buildChannelCard(channel) {
    var card = document.createElement("article");
    card.className = "channel";

    var logo = document.createElement("img");
    logo.className = "channel-logo";
    logo.alt = "";
    if (channel.logoUrl) {
      /* adres trafia do src dopiero, gdy kafelek wejdzie w obszar widzenia */
      logo.dataset.logo = channel.logoUrl;
      logo.loading = "lazy";
      logo.decoding = "async";
      logo.onerror = function () {
        this.style.display = "none";
      };
      observeLogo(logo);
    } else {
      logo.style.display = "none";
    }
    card.appendChild(logo);

    var main = document.createElement("button");
    main.className = "channel-main";
    main.tabIndex = 0;

    var title = document.createElement("span");
    title.className = "channel-name";
    title.textContent = channel.name;
    main.appendChild(title);

    var now = currentProgram(channel);
    var next = nextProgram(channel);

    var nowRow = document.createElement("small");
    nowRow.className = "channel-now";
    nowRow.textContent = now
      ? pad2(new Date(now.start).getHours()) + ":" + pad2(new Date(now.start).getMinutes()) + "  " + now.title
      : t("no_epg");
    main.appendChild(nowRow);

    if (next) {
      var nextRow = document.createElement("small");
      nextRow.className = "channel-next";
      nextRow.textContent = t("next") + " " + pad2(new Date(next.start).getHours()) + ":" + pad2(new Date(next.start).getMinutes()) + "  " + next.title;
      main.appendChild(nextRow);
    }

    if (now) {
      var progress = document.createElement("i");
      progress.className = "channel-progress";
      var pct = Math.max(0, Math.min(100, (Date.now() - now.start) / (now.end - now.start) * 100));
      progress.style.width = pct + "%";
      main.appendChild(progress);
    }

    main.onclick = function () {
      playChannel(channel, null, "browserScreen");
    };
    card.appendChild(main);

    /* Na kafelku zostaje sama gwiazdka ulubionych. Przycisk archiwum („⏪”)
       rysował się obok niej jak „<<” i był tu zbędny — do nagrań wchodzi się
       z menu opcji kanału (przytrzymane OK / MENU) oraz z programu TV, gdzie
       wybiera się konkretny program z przeszłości. */
    var favorite = document.createElement("button");
    favorite.className = "favorite-button";
    favorite.tabIndex = 0;
    setIconLabel(favorite, isFavorite(channel) ? "★" : "☆");
    favorite.onclick = function () {
      toggleFavorite(channel);
    };
    card.appendChild(favorite);

    return card;
  }

  function toggleFavorite(channel) {
    var list = perProfile(settings.favorites);
    var key = keyOf(channel);
    var index = list.indexOf(key);
    if (index >= 0) list.splice(index, 1);
    else list.push(key);
    saveSettings();

    /* odświeżamy tylko gwiazdki widocznych kafelków — pełne przerysowanie listy
       gubi pozycję przewijania i miga na telewizorze */
    refreshFavoriteButtons(channel);
    if (state.selectedGroup === "@favorites") {
      selectGroup("@favorites", document.querySelector(".category.active"));
    }
  }

  function refreshFavoriteButtons(channel) {
    var container = $("channels");
    if (!container) return;
    var key = keyOf(channel);
    var cards = container.children;
    for (var i = 0; i < cards.length && i < state.listItems.length; i++) {
      if (keyOf(state.listItems[i]) !== key) continue;
      var button = cards[i].querySelector(".favorite-button");
      if (button) button.textContent = isFavorite(channel) ? "★" : "☆";
    }
  }

  /* ==============================  ARCHIWUM  ============================== */

  /* zakres w jednej linii — pasek odtwarzacza pokazuje tak nagranie z archiwum */
  function formatRange(start, end) {
    var from = new Date(start);
    var to = new Date(end);
    return pad2(from.getDate()) + "." + pad2(from.getMonth() + 1) + " " +
      pad2(from.getHours()) + ":" + pad2(from.getMinutes()) + "–" +
      pad2(to.getHours()) + ":" + pad2(to.getMinutes());
  }

  /* Dzień z rokiem dla listy programów. Lista sięga kilka dni (a przy „dniach
     EPG wstecz” także przez granicę roku), więc data bez roku myliła dni:
     „07.10” nic nie mówiło o tym, czy program był wczoraj, czy rok temu. */
  function formatDay(ms) {
    var day = new Date(ms);
    return pad2(day.getDate()) + "." + pad2(day.getMonth() + 1) + "." + day.getFullYear();
  }

  /* Sama godzina od–do: data stoi wiersz wyżej (patrz programEntry), więc
     w jednej linii została tylko ta część, którą naprawdę wybiera się pilotem. */
  function formatClock(start, end) {
    var from = new Date(start);
    var to = new Date(end);
    return pad2(from.getHours()) + ":" + pad2(from.getMinutes()) + "–" +
      pad2(to.getHours()) + ":" + pad2(to.getMinutes());
  }

  /* Ekran „Archiwum / programy kanału”. Dwa wejścia na ten sam ekran:
       • z listy kanałów — nagrania z ostatnich dni (ustawienie „dni wstecz”),
       • z odtwarzacza (opts.fromPlayer) — wszystkie programy oglądanego
         kanału: poprzednie, bieżący i następne, żeby wybrać materiał
         z archiwum albo wrócić do bieżącej chwili.
     Program, który jeszcze się nie zaczął, jest nieaktywny (archiwum go nie
     ma), a ten, który leci teraz, dostaje podpis LIVE i odtwarza się od
     początku. */
  function openArchive(channel, options) {
    var opts = options || {};
    var fromPlayer = !!opts.fromPlayer;
    state.selectedChannel = channel;
    archive.channel = channel;
    archive.fromPlayer = fromPlayer;
    archive.playingButton = null;
    archive.liveButton = null;
    /* „Wstecz” wraca do obrazu tylko wtedy, gdy coś tam jeszcze leci —
       pilnuje tego closeArchive() */
    archive.returnTo = fromPlayer ? "playerScreen" : "browserScreen";

    var days = channel.catchupDays > 0 ? Math.min(channel.catchupDays, settings.archiveDays) : settings.archiveDays;
    var now = Date.now();
    var from = now - 86400000 * days;
    /* lista otwarta z odtwarzacza pokazuje też to, co dopiero będzie */
    var until = fromPlayer ? now + ARCHIVE_AHEAD : now;
    var entries = programsFor(channel).filter(function (program) {
      return program.start >= from && program.start < until && program.end > program.start;
    });

    /* brak EPG → pozycje godzinowe, żeby archiwum było nadal użyteczne */
    if (!entries.length) {
      var hourStart = now - (now % 3600000);
      for (var i = 1; i <= 24 * days; i++) {
        entries.push({
          start: hourStart - 3600000 * i,
          end: hourStart - 3600000 * (i - 1),
          title: t("hourly_recording")
        });
      }
    }

    $("archiveTitle").textContent = fromPlayer
      ? t("epg_list_title", { name: channel.name })
      : t("archive_title") + channel.name;
    $("archiveSubtitle").textContent = fromPlayer
      ? t("epg_list_hint") + t("epg_list_days", { days: days })
      : days + t("days_back");

    var container = $("programs");
    container.textContent = "";
    entries.sort(function (a, b) {
      return b.start - a.start;
    });
    if (entries.length > ARCHIVE_MAX) {
      $("archiveSubtitle").textContent += " • " + t("archive_limited", { shown: ARCHIVE_MAX, total: entries.length });
      entries = entries.slice(0, ARCHIVE_MAX);
    }
    entries.forEach(function (program) {
      container.appendChild(programEntry(channel, program, fromPlayer));
    });

    /* Lista otwarta z paska „EPG” w odtwarzaczu pokazuje się obok obrazu (tryb
       dzielony), a nie na całym ekranie — transmisja zostaje widoczna z lewej. */
    if (fromPlayer && state.watchChannel) showPlayerEpg();
    else showScreen("archiveScreen");

    /* Lista otwarta z paska „EPG” staje na tym, co leci: fokus (i widok) idą na
       program bieżący, żeby od razu było widać kanał, na którym jesteśmy —
       bez tego lista pokazywała początek (a więc programy z przyszłości, bo
       najnowszy start jest na górze), a podświetlenie wchodziło w program LIVE
       dopiero po ▼. Gdy kanał nie ma teraz żadnego programu (brak EPG), ekran
       staje na pierwszym wpisie, który da się wybrać — pilnuje tego
       entryFocusTarget w showScreen. showScreen ustawia fokus po 30 ms, dlatego
       ten krok musi być późniejszy. */
    var live = archive.playingButton || archive.liveButton;
    if (fromPlayer && live) {
      window.setTimeout(function () {
        if (!live.parentNode) return;
        try { live.focus(); } catch (error) { return; }
        keepInView(live);
      }, 60);
    }
  }

  /* Czy ten wpis listy to materiał, który leci teraz w odtwarzaczu? Początek
     i koniec to jedyne liczby wspólne dla obu stron (lista i odtwarzacz), więc
     porównujemy je wprost. Dzięki temu na liście otwartej z paska „EPG” widać,
     co jest odtwarzane (patrz programEntry, buildGuideProgram). */
  function isWatchedProgram(program) {
    var current = state.watchProgram;
    if (!current || !program) return false;
    return current.start === program.start && current.end === program.end;
  }

  /* jedna pozycja listy programów: godzina, tytuł, podpis LIVE dla programu,
     który leci teraz, i brak wyboru dla tego, co dopiero będzie */
  function programEntry(channel, program, fromPlayer) {
    var now = Date.now();
    var isNow = program.start <= now && program.end > now;
    var isFuture = program.start > now;
    var watching = isWatchedProgram(program);

    var button = document.createElement("button");
    button.className = "program" + (isNow ? " now" : "") + (isFuture ? " future" : "") +
      (watching ? " playing" : "");
    button.tabIndex = 0;

    /* Trzy linie, każda z tym, czego szuka pilot: pełna data (z rokiem), godzina
       od–do i dopiero pod nimi nazwa programu z podpisem LIVE / ODTWARZANE.
       Wcześniej data i godzina stały sklejone w jednej linii („07.10 11:00–12:00”)
       i na telewizorze wyglądały jak jedna liczba. */
    var time = document.createElement("time");
    var day = document.createElement("b");
    day.className = "program-date";
    day.textContent = formatDay(program.start);
    time.appendChild(day);
    time.appendChild(document.createTextNode(formatClock(program.start, program.end)));
    button.appendChild(time);

    var row = document.createElement("span");
    row.className = "program-title-row";
    var label = document.createElement("span");
    label.className = "program-title";
    label.textContent = program.title;
    row.appendChild(label);
    /* Podpis stoi w tej samej linii co nazwa, po myślniku („Strażnik Teksasu
       - LIVE”), a nie w osobnej linii pod nią — tak czyta to oko na liście. */
    if (watching) {
      /* to ten materiał leci teraz w odtwarzaczu — podpis mówi to wprost, a na
         liście otwartej z paska „EPG” fokus staje właśnie tutaj (patrz
         openArchive) */
      row.appendChild(document.createTextNode(" - "));
      var playing = document.createElement("em");
      playing.className = "program-playing";
      playing.textContent = t("program_playing");
      row.appendChild(playing);
      archive.playingButton = button;
    } else if (isNow) {
      row.appendChild(document.createTextNode(" - "));
      var live = document.createElement("em");
      live.className = "guide-live";
      live.textContent = t("live");
      row.appendChild(live);
      /* program bieżący — na nim staje fokus, gdy lista otwiera się z paska
         „EPG” w odtwarzaczu (patrz openArchive) */
      archive.liveButton = button;
    }
    button.appendChild(row);

    if (isFuture) {
      var note = document.createElement("span");
      note.className = "program-note";
      note.textContent = t("epg_list_future");
      button.appendChild(note);
      button.disabled = true;
    } else {
      button.onclick = function () {
        /* Z listy otwartej w odtwarzaczu wracamy potem do listy kanałów (była
           tylko wyborem materiału), a z listy kanałów — do archiwum. */
        playChannel(channel, program, fromPlayer ? "browserScreen" : "archiveScreen");
      };
    }
    return button;
  }

  /* Powrót z archiwum / listy programów. Do obrazu wracamy tylko wtedy, gdy
     coś tam jeszcze leci: po wyjściu z odtwarzacza kanał jest już zatrzymany
     i ekran odtwarzacza byłby czarnym prostokątem bez obrazu. */
  function closeArchive() {
    var target = archive.returnTo === "playerScreen" && state.watchChannel ? "playerScreen" : "browserScreen";
    archive.returnTo = "browserScreen";
    archive.fromPlayer = false;
    showScreen(target);
  }

  /* „Na żywo” nad listą programów: wraca do bieżącej chwili na tym kanale */
  function playArchiveLive() {
    if (!archive.channel) return;
    playChannel(archive.channel, null, "archiveScreen");
  }

  /* ==============================  CATCH-UP  ============================== */

  function formatStamp(seconds, pattern) {
    var date = new Date(seconds * 1000);
    return pattern
      .replace(/Y/g, date.getFullYear())
      .replace(/m/g, pad2(date.getMonth() + 1))
      .replace(/d/g, pad2(date.getDate()))
      .replace(/H/g, pad2(date.getHours()))
      .replace(/i/g, pad2(date.getMinutes()))
      .replace(/s/g, pad2(date.getSeconds()));
  }

  /* Xtream timeshift liczy czas wg UTC — niezależnie od strefy urządzenia */
  function formatStampUtc(seconds, pattern) {
    var date = new Date(seconds * 1000);
    return pattern
      .replace(/Y/g, date.getUTCFullYear())
      .replace(/m/g, pad2(date.getUTCMonth() + 1))
      .replace(/d/g, pad2(date.getUTCDate()))
      .replace(/H/g, pad2(date.getUTCHours()))
      .replace(/i/g, pad2(date.getUTCMinutes()))
      .replace(/s/g, pad2(date.getUTCSeconds()));
  }

  /* Xtream / standard: <serwer>/timeshift/<user>/<pass>/<minuty>/<YYYY-MM-DD:HH-mm>/<id>.<ext> */
  function buildTimeshiftUrl(streamUrl, startSeconds, durationMinutes) {
    try {
      var anchor = document.createElement("a");
      anchor.href = streamUrl.split("|")[0];
      var parts = anchor.pathname.replace(/^\/+|\/+$/g, "").split("/");
      if (parts.length < 3) return "";
      var file = parts[parts.length - 1];
      if (!/^\d+$/.test(file.split(".")[0])) return "";
      var stamp = formatStampUtc(startSeconds, "Y-m-d:H-i");
      return anchor.protocol + "//" + anchor.host + "/timeshift/" +
        parts[parts.length - 3] + "/" + parts[parts.length - 2] + "/" +
        durationMinutes + "/" + stamp + "/" + file;
    } catch (e) {
      return "";
    }
  }

  function fillCatchupTemplate(template, channel, startSeconds, endSeconds) {
    var durationSeconds = Math.max(1, endSeconds - startSeconds);
    var durationMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
    var streamId = (channel.streamUrl.split("|")[0].split("?")[0].split("/").pop() || "").split(".")[0];
    var out = template.replace(/\$\{(start|end):([^}]+)\}/g, function (match, which, pattern) {
      return formatStamp(which === "start" ? startSeconds : endSeconds, pattern);
    });
    return out
      .replace(/\$\{start\}/g, startSeconds)
      .replace(/\$\{end\}/g, endSeconds)
      .replace(/\$\{timestamp\}/g, startSeconds)
      .replace(/\$\{duration\}/g, durationMinutes)
      .replace(/\{utc\}/g, startSeconds)
      .replace(/\{utcend\}/g, endSeconds)
      .replace(/\{start\}/g, startSeconds)
      .replace(/\{end\}/g, endSeconds)
      .replace(/\{timestamp\}/g, startSeconds)
      .replace(/\{duration\}/g, durationSeconds)
      .replace(/\{channel_id\}/g, streamId);
  }

  function buildCatchupUrl(channel, start, end) {
    var correction = 3600 * channel.correction;
    var startSeconds = Math.floor(start / 1000 + correction);
    var endSeconds = Math.floor(end / 1000 + correction);
    var type = String(channel.catchupType || "").toLowerCase();
    var template = channel.catchupSource || settings.catchupTemplate;
    var base = channel.streamUrl;

    if (template) return fillCatchupTemplate(template, channel, startSeconds, endSeconds);

    /* append / shift → ?utc=&lutc= */
    if (type === "append" || type === "shift") {
      return base + (base.indexOf("?") >= 0 ? "&" : "?") + "utc=" + startSeconds + "&lutc=" + endSeconds;
    }
    /* flussonic → ?from=&to= */
    if (type === "flussonic") {
      return base + (base.indexOf("?") >= 0 ? "&" : "?") + "from=" + startSeconds + "&to=" + endSeconds;
    }
    /* default / xtream / xc / xs / timeshift → /timeshift/... */
    var url = buildTimeshiftUrl(base, startSeconds, Math.max(1, Math.ceil((endSeconds - startSeconds) / 60)));
    if (url) return url;
    /* generyczny fallback dla HLS */
    if (/\.m3u8/i.test(base)) {
      return base + (base.indexOf("?") >= 0 ? "&" : "?") + "utc=" + startSeconds + "&lutc=" + endSeconds;
    }
    throw new Error(t("err_catchup"));
  }

  /* =============================  ODTWARZANIE  ============================= */

  /* maskuje login i hasło w adresie, żeby komunikat można było bezpiecznie pokazać */
  function maskUrl(url) {
    return String(url || "")
      .replace(/(\/(?:live|movie|series|timeshift)\/)[^/]+\/[^/]+\//i, "$1****/****/")
      .replace(/(username|password)=([^&]*)/gi, "$1=****");
  }

  /* Diagnostyka błędów <video>: kod błędu + host/adres źródła. Dzięki temu
     komunikat mówi, CZY zawiódł format/dekoder, sieć, czy sam serwer. */
  function playbackDetails() {
    var video = $("video");
    var code = video && video.error ? video.error.code : 0;
    var details = "";
    if (code) {
      var known = { 1: "media_aborted", 2: "media_network", 3: "media_decode", 4: "media_unsupported" }[code];
      details += " (" + t("media_code", { code: code }) + (known ? ": " + t(known) : "") + ")";
    }
    var message = video && video.error && video.error.message;
    if (message) details += " " + String(message).slice(0, 80);

    var shown = maskUrl(state.currentSource);
    if (shown && shown.length > 92) shown = shown.slice(0, 48) + "…" + shown.slice(-40);
    if (shown) details += "\n" + t("media_url") + ": " + shown;

    return details;
  }

  /* ----------  sesja multimediów: ⏵‖ i ⏹ na pilocie ----------
     Na Androidzie i Fire TV system kieruje przyciski pilota do sesji
     multimediów strony, a nie do zdarzeń klawiatury — bez zarejestrowania
     akcji przycisk play/pauza nie robił nic. Akcje są te same co na pasku
     (pauza / wznowienie / przewijanie), a stan sesji zmienia się razem
     z obrazem, więc pilot widzi, czy kanał gra. */
  var mediaSessionBound = false;

  function updateMediaSession() {
    var session = navigator.mediaSession;
    var video = $("video");
    var inPlayer = !$("playerScreen").classList.contains("hidden");
    if (session) {
      try {
        /* Obraz silnika odbiornika (VLC, odtwarzacz systemowy) nie jest w elemencie
           <video>, więc o stanie odtwarzania mówi most (patrz nativePlaying) —
           inaczej pilot pokazywałby „pauza” na lecącym obrazie. */
        var playing = nativeLayerActive() ? nativePlaying() : !!(video && !video.paused);
        session.playbackState = inPlayer && playing ? "playing" : "paused";
      } catch (error) { /* starsze WebView nie znają stanu sesji */ }
    }
    /* nazwa kanału i programu na wyświetlaczu pilota (AVRCP) */
    if (!session || !inPlayer || !state.watchChannel || typeof window.MediaMetadata !== "function") return;
    try {
      session.metadata = new window.MediaMetadata({
        title: state.watchProgram ? state.watchProgram.title : state.watchChannel.name,
        artist: state.watchChannel.name,
        album: state.watchProgram ? t("catchup") : t("live")
      });
    } catch (error2) { /* bez metadanych przyciski i tak działają */ }
  }

  function bindMediaSession() {
    var session = navigator.mediaSession;
    if (!session || typeof session.setActionHandler !== "function") return;
    if (!mediaSessionBound) {
      mediaSessionBound = true;
      var handlers = {
        play: resumePlayback,
        pause: pausePlayback,
        stop: pausePlayback,
        seekbackward: function () { seekBy(-1); },
        seekforward: function () { seekBy(1); }
      };
      for (var name in handlers) {
        try { session.setActionHandler(name, handlers[name]); } catch (error) { /* brak obsługi */ }
      }
    }
    updateMediaSession();
  }

  /* Dowód, że strumień naprawdę coś robi: dociąga dane albo dekoder rośnie
     w gotowości. To jedyny uczciwy sygnał, że kanał się wczytuje — bez niego
     budziki uznawały wolny kanał 4K za zepsuty i restartowały go co kilka
     sekund (patrz armStartWatchdog / armPictureWatchdog). */
  function noteStreamActivity() {
    state.lastActivityAt = Date.now();
  }

  function bindVideoEvents(video) {
    /* Dziennik zdarzeń dla panelu diagnostyki: nazwa, gotowość i wymiary klatki —
       po tym widać, czy dekoder stanął na metadanych, czy w ogóle nie doszedł do
       obrazu (patrz diagEventLogger). */
    ["playing", "loadedmetadata", "canplay", "waiting", "seeked", "stalled",
      "suspend", "error", "ended"].forEach(function (name) {
        video.addEventListener(name, diagEventLogger(name, video));
      });

    video.addEventListener("playing", function () {
      noteStreamActivity();
      $("playerError").classList.add("hidden");
      /* obraz naprawdę leci — komunikat o wczytywaniu nie ma po co się pokazywać
         (patrz „waiting” niżej: krótkie zrywki meldujemy dopiero po chwili) */
      clearTimeout(state.bufferTimer);
      state.bufferTimer = null;
      clearStartWatchdog();
      /* dźwięk naprawdę ruszył — od tego miejsca pilnujemy, czy dojdzie do tego
         obraz; jeśli nie, panel diagnostyki otworzy się sam (armDiagAuto) */
      armDiagAuto();
      /* Od tego miejsca liczy się czas „dźwięk bez ani jednej klatki”: budzik
         obrazu ma budżet liczony właśnie stąd, a nie z ruchu w strumieniu —
         inaczej dociąganie danych przy czarnym ekranie przedłużałoby próbę
         w nieskończoność (patrz AUDIO_ONLY_TIMEOUT). Kolejne zdarzenia
         „playing” (bufor się podniósł) tego czasu nie zerują. */
      state.audioStartedAt = state.audioStartedAt || Date.now();
      /* Dźwięk wystartował, ale to jeszcze nie znaczy, że jest obraz —
         dopiero on zdejmuje budzik obrazu (patrz notePicture). Gdy obrazu nie ma,
         budzik uzbrajamy na nowo: token mógł się zmienić w trakcie wczytywania
         silnika (MSE/HLS biorą własny), a bez tego kanał grający sam dźwięk
         nie miałby już żadnego budzika i wisiał tak do końca świata. */
      if (!notePicture()) armPictureWatchdog();
      /* od tego momentu liczy się czas oglądania dla „Ostatnio oglądane” */
      state.watchStart = state.watchStart || Date.now();
      scheduleRecentRecord();
      clearTimeout(state.stableTimer);
      state.stableTimer = setTimeout(function () {
        var current = $("video");
        if (state.currentSource && current && !current.paused) {
          /* obraz stoi już 10 s — kolejne błędy liczymy od nowa */
          state.retryCount = 0;
          state.cycle = 0;
        }
      }, 10000);
      updateOsd();
      scheduleOsdHide();
      updateMediaSession();
    });

    video.addEventListener("pause", function () {
      markWatchedTime();
      clearTimeout(state.recentTimer);
      updateOsd();
      updateMediaSession();
      /* obraz zatrzymany — pasek informacyjny zostaje na ekranie */
      clearTimeout(state.osdTimer);
      state.osdTimer = null;
    });

    /* dane naprawdę przychodzą — strumień się wczytuje (albo nadgania bufor);
       wolny kanał 4K nie może być za to ukarany restartem */
    video.addEventListener("progress", noteStreamActivity);

    /* buforowanie: pasek mówi wprost, co się dzieje i który silnik pracuje */
    video.addEventListener("waiting", function () {
      if (!state.currentSource) return;
      /* chwilę po przewinięciu dekoder donosi obraz na nową pozycję — to nie
         jest wczytywanie strumienia od zera, więc pasek pokazuje skok
         („Cofnięto o 10 s”), a nie „Ładowanie strumienia…” */
      if (seekNotice()) { showOsd(); return; }
      /* Zrywka liczy się do kondycji obrazu (patrz guardTick): pojedyncza nie znaczy
         nic, ale ich gęstość mówi już, że ten odtwarzacz nie wyrabia za strumieniem. */
      noteStall();
      /* Zrywka na kanale na żywo bywa krótsza niż mrugnięcie oka. Komunikat
         pokazujemy więc dopiero wtedy, gdy obraz naprawdę nie wraca: na kanale 4K
         migał on przy każdym odcinku i wyglądało to jak zepsuty kanał, choć obraz
         wracał po ułamku sekundy. */
      clearTimeout(state.bufferTimer);
      state.bufferTimer = setTimeout(function () {
        state.bufferTimer = null;
        var current = $("video");
        if (!state.currentSource) return;
        /* obraz wrócił w międzyczasie (klatki lecą, gotowość wysoka) — nie ma
           czego meldować */
        if (current && !current.paused && current.readyState >= 3) return;
        showPlayerError(t("osd_buffering") + " (" + engineName(state.engine) + ")");
      }, 800);
    });

    video.addEventListener("timeupdate", function () {
      /* kolejna klatka w kolejce odtwarzania = strumień żyje */
      noteStreamActivity();
      /* Pierwsza klatka może pojawić się już po zdarzeniu „canplay” (dekoder
         zdekodował ją później) — dlatego budzik obrazu sprawdzamy też tutaj. */
      notePicture();
      updateOsdProgress();
    });
    video.addEventListener("loadedmetadata", function () {
      noteStreamActivity();
      /* Metadane mówią, jaka to rozdzielczość — od tego momentu wiemy, czy kanał
         jest 4K. Taki kanał wraca do tego, jak grał, zanim aplikacja zaczęła się
         uczyć silników: bez wymuszonej warstwy obrazu i ze sprzętowym dekoderem
         na pierwszym miejscu (patrz noteUhd). */
      if (videoIsUhd() && noteUhd()) return;
      /* obraz wczytał metadane — nie ma sensu czekać na kolejny sposób */
      clearStartWatchdog();
      notePicture();
      updateOsd();
    });
    video.addEventListener("canplay", function () {
      noteStreamActivity();
      clearStartWatchdog();
      notePicture();
    });

    video.addEventListener("error", function () {
      markWatchedTime();
      clearTimeout(state.recentTimer);
      /* jeden błąd = jedno przejście do następnego silnika (błąd potrafi dublować) */
      if (Date.now() - state.lastErrorAt < 500) return;
      state.lastErrorAt = Date.now();
      handlePlaybackError(t("err_stream") + playbackDetails());
    });
  }

  /* webOS potrafi „zakleszczyć” pipeline po błędzie — świeży element <video>
     resetuje dekoder, więc ponowienie ma szansę zadziałać. */
  function resetVideoElement() {
    var old = $("video");
    if (!old || !old.parentNode) return old;
    var fresh = document.createElement("video");
    fresh.id = "video";
    fresh.setAttribute("autoplay", "autoplay");
    fresh.playsInline = true;
    bindVideoEvents(fresh);
    old.parentNode.replaceChild(fresh, old);
    return fresh;
  }

  function playSource(source) {
    var video = resetVideoElement();
    if (!video) return;
    video.src = source;
    video.load();
    var promise = video.play();
    if (promise && promise.catch) promise.catch(function () {});
  }

  /* ==================  SILNIKI ODTWARZANIA (natywnie → MSE → HLS)  ==================
     Różne telewizory i przystawki różnie radzą sobie z surowym MPEG-TS:

       • natywnie — sprzętowy dekoder Fire TV / webOS potrafi zagrać .ts wprost,
       • MSE      — gdy nie potrafi, ten sam strumień wciąga mpegts.js (MSE w WebView),
       • HLS      — dostawcy często udostępniają ten sam kanał jako .m3u8 (hls.js).

     Biblioteki leżą w www/lib i wczytują się LENIWIE — dopiero gdy są naprawdę
     potrzebne, więc start aplikacji na to nie płaci. */

  var engineCache = {};

  function loadEngineScript(src) {
    if (engineCache[src]) return engineCache[src];
    engineCache[src] = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = function () { resolve(); };
      script.onerror = function () {
        delete engineCache[src];
        reject(new Error(t("err_player_lib", { name: src })));
      };
      (document.head || document.documentElement).appendChild(script);
    });
    return engineCache[src];
  }

  /* zamyka poprzedni silnik (odłącza MSE) — bez tego zostaje drugi dekoder w tle */
  function destroyEngine() {
    var instance = state.engineInstance;
    state.engineInstance = null;
    state.engineLoading = false;
    clearStartWatchdog();
    /* Budziki pilnujące obrazu nie mają już czego pilnować — nowy wpis
       kolejki uzbroi je od nowa (patrz startSourceEntry). */
    clearPictureWatchdog();
    /* Kondycja obrazu też gaśnie razem z silnikiem: bez tego strumień, którego
       aplikacja już się wyrzekła (koniec kolejki prób), byłby przez strażnika
       wskrzeszany w kółko (patrz guardTick). */
    stopGuard();
    if (!instance) return;
    try { instance.close(); } catch (error) { /* już zamknięty */ }
  }

  /* Nazwa silnika dla komunikatów o wczytywaniu obrazu. Osobno od engineLabel,
     bo tam „LIVE” opisuje stan obrazu na pasku odtwarzacza, a w komunikacie
     czytało się jak informacja o strumieniu — przy catch-upie wyglądało to,
     jakby aplikacja wczytywała kanał na żywo zamiast nagrania. */
  function engineName(engine) {
    if (engine === "exo") return t("engine_exo");
    if (engine === "vlc") return t("engine_vlc");
    if (engine === "mse") return t("engine_mse");
    if (engine === "hls") return t("engine_hls");
    return t("engine_native");
  }

  function engineLabel(engine) {
    if (engine === "exo") return t("engine_exo");
    if (engine === "vlc") return t("engine_vlc");
    if (engine === "mse") return t("engine_mse");
    if (engine === "hls") return t("engine_hls");
    return t("live");
  }

  /* =========================  DIAGNOSTYKA OBRAZU  =========================
     Panel dla przypadku, którego z kanapy nie widać: dźwięk leci, a obrazu nie
     ma ani jednej klatki. Pokazuje to, czego nie da się odczytać z ekranu
     telewizora — na czym stoi odbiornik (system, WebView, ekran), które kodeki
     ten odtwarzacz potrafi rozebrać (natywnie i przez MSE) oraz co robi sam
     element <video>: gotowość, błąd i liczbę oddanych klatek. Do tego
     sondowanie manifestu HLS mówi, co to naprawdę za strumień (kodek,
     rozdzielczość, liczba klatek na sekundę) — dopiero te dwie rzeczy razem
     odpowiadają, czy obraz ma prawo się pojawić.

     Panel otwiera się z paska odtwarzacza („ⓘ Diagnostyka”) i sam, gdy budzik
     obrazu widzi dźwięk bez ani jednej klatki (patrz maybeAutoDiagnose).
     Treść jest do zdjęcia telefonem: w telewizorze nie ma schowka ani pliku,
     do którego można by zajrzeć. */

  var DIAG_LOG_MAX = 14;           /* ile ostatnich zdarzeń <video> pamiętamy */
  var DIAG_PROBE_TIMEOUT = 8000;   /* ile czekamy na manifest HLS */

  var diagEvents = [];         /* { at: ms, label: „…” } — najnowsze na końcu */
  var diagManifest = "";       /* opis manifestu HLS albo komunikat błędu */
  var diagManifestFor = "";    /* adres, którego dotyczy diagManifest */
  var diagProbing = false;
  var diagShown = "";          /* ostatnio pokazany tekst — bez przerysowań */
  var diagTicker = null;       /* zegar odświeżający liczby w otwartym panelu */

  /* Ostatnie zdarzenia trafiają do dziennika panelu. Wołane z gorących miejsc
     odtwarzacza (zdarzenia <video>, start silnika), więc tylko dopisuje wiersz —
     ekran odświeża osobny zegar (patrz startDiagTicker).

     Gdy panel jest otwarty, przerysowujemy treść od razu: inaczej nowy wpis
     czekał do sekundowego zegara, a godzina w nagłówku zostawała w tyle za
     dziennikiem (wyglądało to jak panel, który „przestał się odświeżać”). */
  function diagNote(label) {
    diagEvents.push({ at: Date.now(), label: String(label) });
    if (diagEvents.length > DIAG_LOG_MAX) diagEvents.shift();
    if (diagVisible()) renderDiagnostics();
  }

  /* Zdarzenie <video> widziane z panelu: nazwa, gotowość i wymiary klatki — po
     tym widać, czy dekoder stanął na metadanych, czy w ogóle nie doszedł do
     obrazu (dźwięk gra także wtedy, gdy klatek nie ma). */
  function diagEventLogger(name, video) {
    return function () {
      var current = video || $("video");
      diagNote(name + " · readyState " + (current ? (current.readyState | 0) : "?") +
        " · " + (current ? ((current.videoWidth | 0) + "×" + (current.videoHeight | 0)) : "?"));
    };
  }

  function diagClock(at) {
    var date = new Date(at);
    return pad2(date.getHours()) + ":" + pad2(date.getMinutes()) + ":" + pad2(date.getSeconds());
  }

  function diagSeconds(value) {
    var seconds = Number(value);
    if (!isFinite(seconds) || seconds < 0) return "0.0";
    return seconds.toFixed(1);
  }

  /* Ile klatek dekoder naprawdę oddał — przy czarnym obrazie to jedyny dowód,
     że cokolwiek rozebrał. */
  function diagFrames(video) {
    var quality = null;
    if (video && video.getVideoPlaybackQuality) {
      try { quality = video.getVideoPlaybackQuality(); } catch (error) { quality = null; }
    }
    if (quality) {
      return {
        total: quality.totalVideoFrames | 0,
        dropped: quality.droppedVideoFrames | 0
      };
    }
    return {
      total: (video && video.webkitDecodedFrameCount) | 0,
      dropped: (video && video.webkitDroppedFrameCount) | 0
    };
  }

  /* Ile sekund obrazu jest już pobrane przed bieżącą chwilą. */
  function diagBuffered(video) {
    if (!video || !video.buffered || !video.buffered.length) return "0.0";
    var at = video.currentTime || 0;
    for (var i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= at && video.buffered.end(i) >= at) {
        return diagSeconds(video.buffered.end(i) - at);
      }
    }
    return "0.0";
  }

  /* Ile pamięci zjada sam interfejs. To jedyna liczba, która pokazuje, czy
     odtwarzanie rośnie w tle — z takiego wzrostu bierze się „aplikacja sama się
     zamyka” po dłuższym oglądaniu kanału 4K (patrz guardTick). Chromium podaje ją
     wprost; gdy jej nie ma, w panelu zostaje znak zapytania. */
  function diagHeapMb() {
    var memory = window.performance && window.performance.memory;
    if (!memory || !memory.usedJSHeapSize) return "?";
    return String(Math.round(memory.usedJSHeapSize / 1048576));
  }

  function diagMediaError(video) {
    var error = video && video.error;
    if (!error) return t("diag_none");
    var names = { 1: "aborted", 2: "network", 3: "decode", 4: "not supported" };
    var name = names[error.code | 0] ? " " + names[error.code | 0] : "";
    return (error.code | 0) + name +
      (error.message ? " · " + String(error.message).slice(0, 90) : "");
  }

  /* Co potrafi ten odtwarzacz: canPlayType to droga natywna, MSE — droga
     mpegts.js i hls.js (własny demukser). Bez tej tabeli nie da się
     powiedzieć, czy czarny ekran to wina kanału, czy dekodera. */
  function diagSupport(type) {
    var probe = document.createElement("video");
    var native = probe.canPlayType ? String(probe.canPlayType(type)) : "";
    var mse = t("diag_no");
    if (window.MediaSource && window.MediaSource.isTypeSupported) {
      try { mse = window.MediaSource.isTypeSupported(type) ? t("diag_yes") : t("diag_no"); }
      catch (error) { mse = t("diag_unknown"); }
    }
    var labels = { "": t("diag_no"), maybe: t("diag_maybe"), probably: t("diag_yes") };
    return { native: labels[native] || native, mse: mse };
  }

  /* ---- linie treści panelu: urządzenie, kodeki, strumień, manifest, dziennik ----

     Próbki kodeków: 4K H.264 (to, co nadaje większość dostawców) oraz HEVC,
     którym nadaje się kanały 4K — jeśli tu jest „nie”, obrazu nie będzie. */
  var DIAG_CODECS = [
    { name: "H.264 1080p", type: 'video/mp4; codecs="avc1.640028"' },
    { name: "H.264 4K", type: 'video/mp4; codecs="avc1.640034"' },
    { name: "HEVC 4K (hvc1)", type: 'video/mp4; codecs="hvc1.1.6.L150.B0"' },
    { name: "HEVC 4K (hev1)", type: 'video/mp4; codecs="hev1.1.6.L150.B0"' },
    { name: "HEVC Main10", type: 'video/mp4; codecs="hvc1.2.4.L153.B0"' }
  ];

  function diagWebView() {
    var match = /(Chrome|Chromium)\/([\d.]+)/.exec(navigator.userAgent || "");
    if (match) return match[1] + " " + match[2];
    return String(navigator.userAgent || "").slice(0, 60);
  }

  function diagDeviceLines() {
    var screenRef = window.screen || {};
    var lines = [t("diag_device")];
    lines.push(" " + t("diag_platform") + ": " + platformName() + " (" + platformInfo.os +
      ") · " + t("diag_native_app") + ": " + (platformInfo.native ? t("diag_yes") : t("diag_no")));
    lines.push(" " + t("diag_screen") + ": " + (screenRef.width | 0) + "×" + (screenRef.height | 0) +
      " @" + (window.devicePixelRatio || 1) +
      " · " + t("diag_window") + ": " + (window.innerWidth | 0) + "×" + (window.innerHeight | 0) +
      " · " + t("diag_cores") + ": " + (navigator.hardwareConcurrency || "?") +
      " · " + t("diag_pointer") + ": " + (platformInfo.touch ? t("diag_yes") : t("diag_no")));
    lines.push(" " + t("diag_webview") + ": " + diagWebView() +
      " · " + t("diag_ua") + ": " + String(navigator.userAgent || "").slice(0, 150));
    return lines;
  }

  function diagCodecLines() {
    var lines = [t("diag_codecs")];
    for (var i = 0; i < DIAG_CODECS.length; i++) {
      var support = diagSupport(DIAG_CODECS[i].type);
      lines.push(" " + DIAG_CODECS[i].name + " — <video>: " + support.native +
        " · MSE: " + support.mse);
    }
    lines.push(" " + t("diag_container") + ": HLS (.m3u8) " +
      diagSupport("application/vnd.apple.mpegurl").native +
      " · TS (video/mp2t) " + diagSupport("video/mp2t").native);
    /* Co potrafi sam mpegts.js: to jego własny test MSE dla HEVC, a nie nasze
       zgadywanie. Od tego zależy jedyna droga do obrazu dla kanału 4K nadawanego
       jako playlista (patrz createHlsTsLoader), więc gdy obrazu nie ma, to jest
       pierwsze miejsce, w które trzeba spojrzeć. */
    try {
      if (window.mpegts && window.mpegts.getFeatureList) {
        var features = window.mpegts.getFeatureList();
        lines.push(" " + t("diag_mpegts") + ": MSE " +
          (features.msePlayback ? t("diag_yes") : t("diag_no")) + " · MSE HEVC " +
          (features.mseH265Playback ? t("diag_yes") : t("diag_no")) +
          " · " + String(features.networkLoaderName || "?"));
      }
    } catch (error) { /* starsza biblioteka bez tego testu */ }
    /* Odtwarzacz systemowy (Android): to nim idzie obraz 4K, więc panel musi
       pokazać, czy w ogóle jest i czy odbiornik ma sprzętowy dekoder HEVC —
       bez niego żadna droga nie da obrazu (patrz startExoSource). */
    var native = exoInfo();
    if (native) {
      lines.push(" " + t("diag_native_player") + ": media3 " + String(native.media3) +
        " · API " + (native.api | 0) +
        " · HEVC: " + (native.hevc ? t("diag_yes") : t("diag_no")) +
        /* Nazwa dekodera, fakt dotarcia klatki na obraz i liczba zgubionych klatek
           rozstrzygają, czy brak obrazu to wina dekodera, czy warstwy obrazu
           (patrz nativeInfo w MainActivity). Liczone dla ostatniej próby kanału. */
        (native.decoder ? " · " + String(native.decoder) : "") +
        " · " + t("diag_exo_frames") + ": " +
        (native.firstFrame ? t("diag_yes") : t("diag_no")) +
        " · " + t("diag_exo_dropped") + ": " + (native.dropped | 0) +
        /* Warstwa ukryta przy przezroczystej stronie znaczy dokładnie to, co widać
           jako czarny (przed 2.1.10 biały) ekran; „powierzchnia obrazu” mówi, czy
           warstwa zdążyła ją mieć, a błąd — co tę próbę zakończyło (nativeInfo). */
        " · " + t("diag_layer") + ": " +
        (native.layerVisible ? t("diag_layer_on") : t("diag_layer_off")) +
        " · " + t("diag_exo_surface") + ": " +
        (native.surfaceReady ? t("diag_yes") : t("diag_no")) +
        (native.error ? " · " + t("diag_error") + ": " + String(native.error).slice(0, 80) : ""));
    }
    /* Silnik VLC: te same pytania, co droga systemowa, plus to, czego tam nie ma —
       ile klatek odtworzono, ile danych strumienia było uszkodzonych i jaki jest
       realny bitrate kanału (patrz VlcEngine → infoJson). */
    var vlc = vlcInfo();
    if (vlc) {
      lines.push(" " + t("diag_vlc_native") + " " + String(vlc.libvlc) +
        " · API " + (vlc.api | 0) +
        " · " + (vlc.texture ? t("diag_vlc_texture") : t("diag_vlc_plane")) +
        (vlc.decoder ? " · " + String(vlc.decoder) : "") +
        " · " + t("diag_vlc_frames") + ": " +
        (vlc.firstFrame ? t("diag_yes") : t("diag_no")) +
        " · " + t("diag_vlc_lost") + ": " + (vlc.lost | 0) +
        " · " + t("diag_vlc_displayed") + ": " + (vlc.displayed | 0) +
        " · " + t("diag_vlc_corrupted") + ": " + (vlc.corrupted | 0) +
        " · " + t("diag_vlc_bitrate") + ": " + vlcBitrate(vlc.bitrate) +
        /* Klatki na sekundę i licznik powierzchni obrazu: dopiero one odróżniają
           obraz żywy od zatrzymanego na jednej klatce (patrz countFrames). */
        " · " + t("diag_vlc_fps") + ": " + vlcFps(vlc) +
        " · " + t("diag_vlc_surface") + ": " +
        (vlc.sawFrames ? String(vlc.texFrames | 0) : t("diag_none")));
    }
    return lines;
  }

  function diagStreamLines() {
    var lines = [t("diag_stream")];
    if (!state.watchChannel) {
      lines.push(" " + t("diag_none"));
      return lines;
    }
    lines.push(" " + t("diag_channel") + ": " + state.watchChannel.name);
    lines.push(" " + t("diag_engine") + ": " + engineName(state.engine) +
      /* kanał z playlisty rozbiera własny czytnik HLS→TS — bez tego wiersz
         wyglądałby jak zwykłe MSE, choć to zupełnie inna droga (patrz
         createHlsTsLoader) */
      (state.engineFeeder ? " (" + t("diag_feeder") + ")" : "") +
      " · " + t("diag_entry") + ": " + ((state.sourceIndex | 0) + 1) + "/" + state.sources.length +
      " · " + t("diag_retries") + ": " + (state.retryCount | 0) +
      " · " + t("diag_layer") + ": " +
      (document.body.classList.contains("video-layer-fix") ? t("diag_yes") : t("diag_no")));
    lines.push(" " + t("diag_uhd") + " (" + t("diag_size") + "): " +
      (videoIsUhd() ? t("diag_yes") : (state.uhdSeen ? t("diag_uhd_named") : t("diag_no"))));

    var video = $("video");
    /* Obraz systemowy nie jest w elemencie <video>, więc panel pokazuje jego stan
       z mostu — inaczej wiersze niżej mówiłyby „pauza, 0×0”, choć obraz leci. */
    if (exoActive()) {
      lines.push(" " + t("diag_exo") + ": " + (state.exoPlaying ? t("diag_playing") : t("diag_paused")) +
        " · " + t("diag_size") + ": " + (state.exoWidth | 0) + "×" + (state.exoHeight | 0) +
        " · " + t("diag_muted") + ": " + (state.exoMuted ? t("diag_yes") : t("diag_no")) +
        " · " + t("diag_buffer") + ": " + t("diag_exo_buffer"));
      lines.push(" " + maskUrl(state.currentSource || ""));
      return lines;
    }
    /* Obraz rysowany przez VLC też nie jest w elemencie <video>, więc jego stan
       przychodzi z mostu (patrz vlcEvent). */
    if (vlcActive()) {
      lines.push(" " + t("diag_vlc") + ": " + (state.vlcPlaying ? t("diag_playing") : t("diag_paused")) +
        " · " + t("diag_size") + ": " + (state.vlcWidth | 0) + "×" + (state.vlcHeight | 0) +
        " · " + t("diag_muted") + ": " + (state.vlcMuted ? t("diag_yes") : t("diag_no")) +
        /* Pozycja i długość okna nagrania: bez tego nie da się w terenie stwierdzić,
           czy skok o krok (⏪/⏩) naprawdę przesunął obraz (patrz seekBy). */
        " · " + t("diag_time") + ": " + diagSeconds(state.vlcTime / 1000) + " s" +
        (state.vlcLength > 0 ? " / " + diagSeconds(state.vlcLength / 1000) + " s" : "") +
        /* obraz stanął w tej próbie — kanał idzie dalej kolejką (patrz vlcEvent) */
        (state.vlcStalled ? " · " + t("diag_stall") : "") +
        " · " + t("diag_buffer") + ": " + t("diag_vlc_buffer"));
      lines.push(" " + maskUrl(state.currentSource || ""));
      return lines;
    }
    if (!video) {
      lines.push(" <video>: " + t("diag_none"));
      return lines;
    }
    var frames = diagFrames(video);
    lines.push(" " + t("diag_size") + ": " + (video.videoWidth | 0) + "×" + (video.videoHeight | 0) +
      " · " + t("diag_frames") + ": " + frames.total +
      " (" + t("diag_dropped") + ": " + frames.dropped + ")");
    /* Kondycja obrazu: pamięć interfejsu, zrywy i przestrajania. To liczby, po których
       widać, czy obraz zrywa się przez ten odtwarzacz, czy przez łącze — i czy system
       ma powód, żeby zamknąć aplikację (patrz guardTick). */
    lines.push(" " + t("diag_health") + ": " + t("diag_heap") + " " + diagHeapMb() + " MB" +
      " · " + t("diag_stalls") + ": " + (state.guardStalls | 0) +
      (state.guardRecycles
        ? " · " + t("diag_recycles") + ": " + (state.guardRecycles | 0)
        : ""));
    lines.push(" " + t("diag_audio") + ": " + (video.paused ? t("diag_paused") : t("diag_playing")) +
      " · " + t("diag_time") + ": " + diagSeconds(video.currentTime) + " s" +
      " · " + t("diag_buffer") + ": " + diagBuffered(video) + " s" +
      " · " + t("diag_muted") + ": " + (video.muted ? t("diag_yes") : t("diag_no")));
    lines.push(" readyState: " + (video.readyState | 0) + " · networkState: " + (video.networkState | 0) +
      " · " + t("diag_error") + ": " + diagMediaError(video));
    lines.push(" " + maskUrl(state.currentSource || ""));
    return lines;
  }

  function diagManifestLines() {
    return [t("diag_manifest"), " " + (diagManifest || t("diag_probing"))];
  }

  function diagEventLines() {
    var lines = [t("diag_events")];
    if (!diagEvents.length) {
      lines.push(" " + t("diag_none"));
      return lines;
    }
    for (var i = 0; i < diagEvents.length; i++) {
      lines.push(" " + diagClock(diagEvents[i].at) + "  " + diagEvents[i].label);
    }
    return lines;
  }

  function diagText() {
    var lines = ["TeleIPTV v" + APP_VERSION + " · " + diagClock(Date.now()), ""];
    lines = lines.concat(diagDeviceLines(), [""]);
    lines = lines.concat(diagCodecLines(), [""]);
    lines = lines.concat(diagStreamLines(), [""]);
    lines = lines.concat(diagManifestLines(), [""]);
    lines = lines.concat(diagEventLines());
    return lines.join("\n");
  }

  /* ---- sam panel: treść nad obrazem, własne klawisze, sondowanie manifestu ---- */

  function diagVisible() {
    var panel = $("diagPanel");
    return !!panel && !panel.classList.contains("hidden");
  }

  /* Panel powstaje przy pierwszym otwarciu i zostaje w DOM — kolejne otwarcia
     tylko go pokazują. Trzymamy go poza listą SCREENS: to nakładka nad tym, co
     jest na ekranie (obraz, ustawienia), a nie kolejny ekran do przełączania. */
  function diagPanel() {
    var panel = $("diagPanel");
    if (panel) return panel;

    panel = document.createElement("section");
    panel.id = "diagPanel";
    panel.className = "diag-panel hidden";

    var card = document.createElement("div");
    card.className = "diag-card";

    var title = document.createElement("h2");
    title.className = "diag-title";
    title.textContent = t("diag_title");
    card.appendChild(title);

    var text = document.createElement("pre");
    text.id = "diagText";
    text.className = "diag-text";
    card.appendChild(text);

    var hint = document.createElement("p");
    hint.className = "diag-hint";
    hint.textContent = t("diag_hint");
    card.appendChild(hint);

    var actions = document.createElement("div");
    actions.className = "ctx-actions";
    actions.appendChild(ctxButton(t("diag_close"), closeDiagnostics));
    card.appendChild(actions);

    panel.appendChild(card);
    document.body.appendChild(panel);
    return panel;
  }

  function renderDiagnostics() {
    var text = $("diagText");
    if (!text) return;
    var value = diagText();
    if (value === diagShown) return;      /* nic się nie zmieniło — bez przerysowań */
    diagShown = value;
    text.textContent = value;
  }

  function startDiagTicker() {
    stopDiagTicker();
    /* Liczby w panelu (klatki, bufor, readyState) zmieniają się w tle, więc
       odświeżamy je raz na sekundę — to jedyne miejsce, które przerysowuje
       ekran; dziennik tylko dopisuje wiersze (patrz diagNote). */
    diagTicker = setInterval(function () {
      /* Obraz jednak się pojawił — panel otwarty sam schodzi z drogi, żeby nie
         zasłaniać tego, co właśnie się naprawiło. Panel otwarty ręcznie zostaje:
         ktoś czyta go na własne życzenie. Drugi raz sam się nie otworzy przy
         tym kanale (diagAutoShown), bo obraz już tu raz był. */
      if (state.diagAutoShown && videoHasPicture($("video"))) {
        closeDiagnostics();
        return;
      }
      renderDiagnostics();
    }, 1000);
  }

  function stopDiagTicker() {
    if (diagTicker) clearInterval(diagTicker);
    diagTicker = null;
  }

  /* Klawisze panelu łapiemy w fazie przechwytywania i nie puszczamy dalej: pod
     spodem jest odtwarzacz, w którym te same strzałki zmieniałyby kanał. */
  function diagKeydown(event) {
    var key = event.keyCode;
    if (key === 38 || key === 40 || key === 33 || key === 34) {
      event.preventDefault();
      event.stopImmediatePropagation();
      diagScroll(key === 38 || key === 33 ? -1 : 1);
      return;
    }
    if (key === 13 || key === 23 || key === 66 || key === 27 || key === 8 ||
        key === 4 || key === 461) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeDiagnostics();
    }
  }

  function diagScroll(direction) {
    var text = $("diagText");
    if (text) text.scrollTop += direction * 80;
  }

  function openDiagnostics() {
    var panel = diagPanel();
    panel.classList.remove("hidden");
    diagNote(t("diag_opened"));
    diagProbeStream();
    renderDiagnostics();
    startDiagTicker();
    /* Zamykanie musi mieć na czym stanąć: fokus zostawiony pod panelem
       (na przycisku paska) nie dałby się przesunąć wzrokiem na treść. */
    document.addEventListener("keydown", diagKeydown, true);
    var close = panel.querySelector("button");
    if (close && close.focus) close.focus();
  }

  function closeDiagnostics() {
    var panel = $("diagPanel");
    document.removeEventListener("keydown", diagKeydown, true);
    stopDiagTicker();
    if (panel) panel.classList.add("hidden");
  }

  function toggleDiagnostics() {
    if (diagVisible()) closeDiagnostics();
    else openDiagnostics();
  }

  /* ---- sondowanie manifestu HLS (co naprawdę nadaje dostawca) ---- */

  /* Adres manifestu dla tego, co gra, tą samą drogą co kolejka prób: .m3u8,
     a przy surowym .ts ten sam adres z rozszerzeniem .m3u8. Sondowanie nie może
     trafić na sam strumień — .ts leci bez końca, a m3u8 to kilka linijek. */
  function diagManifestUrl(url) {
    var value = String(url || "");
    if (/\.m3u8([?#]|$)/i.test(value)) return value;
    if (/\.ts([?#]|$)/i.test(value)) return value.replace(/\.ts([?#]|$)/i, ".m3u8$1");
    return "";
  }

  /* Atrybuty linii #EXT-X-… (RESOLUTION=1920x1080, CODECS="…", …) — wartości
     bywają w cudzysłowie i same zawierają przecinki, więc nie wystarczy
     dzielenie po przecinku. */
  function diagAttributes(text) {
    var result = {};
    var pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
    var match;
    while ((match = pattern.exec(text))) {
      result[match[1]] = match[2].replace(/"/g, "");
    }
    return result;
  }

  /* Co mówi manifest: rozdzielczość, liczba klatek i kodek pierwszego wariantu,
     a do tego rodzaj segmentów i informacja o szyfrowaniu. Kodek sprawdzamy od
     razu z tabelą możliwości odtwarzacza — to jest odpowiedź na pytanie, czy
     obraz może się pojawić. */
  function diagManifestInfo(text) {
    var lines = String(text || "").split(/\r?\n/);
    var streams = [];
    var map = false;
    var segments = "";
    var encrypted = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.indexOf("#EXT-X-STREAM-INF:") === 0) {
        streams.push(diagAttributes(line.slice("#EXT-X-STREAM-INF:".length)));
      } else if (line.indexOf("#EXT-X-MAP") === 0) {
        map = true;
      } else if (line.indexOf("#EXT-X-KEY:") === 0 && /METHOD=(?!NONE)/i.test(line)) {
        encrypted = true;
      } else if (line.charAt(0) !== "#" && /\.(ts|m4s|mp4|aac|mp3)([?#]|$)/i.test(line)) {
        segments = /\.(m4s|mp4)([?#]|$)/i.test(line) ? "fMP4" : "TS";
      }
    }

    var info = [];
    var best = streams.length ? streams[0] : null;
    if (best) {
      if (best.RESOLUTION) info.push(best.RESOLUTION);
      if (best["FRAME-RATE"]) info.push(best["FRAME-RATE"] + " fps");
      if (best.CODECS) info.push(best.CODECS);
      if (streams.length > 1) info.push(streams.length + " " + t("diag_variants"));
    } else {
      info.push(t("diag_probe_media"));
    }
    if (map) info.push("fMP4");
    else if (segments) info.push(segments);
    if (encrypted) info.push(t("diag_encrypted"));

    if (best && best.CODECS) {
      var codec = String(best.CODECS).split(",")[0].trim();
      var support = diagSupport('video/mp4; codecs="' + codec + '"');
      diagNote(t("diag_probe_codec") + " " + codec + " — <video>: " +
        support.native + " · MSE: " + support.mse);
    }
    return info.join(" · ");
  }

  /* Pobranie manifestu idzie tą samą drogą co playlisty (httpGet, a na
     Androidzie nativeHttpGet), więc działa też tam, gdzie przeglądarka blokuje
     zapytania między domenami. */
  function diagProbeStream() {
    var url = diagManifestUrl(state.currentSource);
    if (!url) {
      diagManifest = t("diag_probe_none");
      return;
    }
    if (url === diagManifestFor) return;      /* ten sam strumień — wynik już jest */
    diagManifestFor = url;
    diagManifest = t("diag_probing");
    diagProbing = true;
    var token = url;
    setTimeout(function () {
      if (diagProbing && diagManifestFor === token) {
        diagProbing = false;
        diagManifest = t("diag_probe_failed") + " (timeout)";
        renderDiagnostics();
      }
    }, DIAG_PROBE_TIMEOUT);
    httpGet(url, false).then(function (text) {
      if (diagManifestFor !== token) return;
      diagProbing = false;
      diagManifest = diagManifestInfo(text);
      renderDiagnostics();
    }, function (error) {
      if (diagManifestFor !== token) return;
      diagProbing = false;
      diagManifest = t("diag_probe_failed") + " (" +
        String(error && error.message ? error.message : error).slice(0, 80) + ")";
      renderDiagnostics();
    });
  }

  /* ---- otwarcie panelu bez pytania: dźwięk gra, a obrazu nie ma ---- */

  /* Ile czekamy od startu dźwięku, zanim uznamy, że obraz się już nie pojawi.
     Krótsze czekanie łapałoby kanał 4K w połowie wczytywania (pierwsze klatki
     potrafią iść kilka sekund — patrz UHD_WAIT), więc panel wyskakiwałby bez
     powodu. */
  var DIAG_AUTO_DELAY = 8000;

  /* Budzik panelu uzbraja się raz na próbę odtwarzania, na starcie dźwięku
     (zdarzenie „playing” — patrz bindVideoEvents). Dzięki temu panel otwiera
     się tylko tam, gdzie naprawdę leci dźwięk, a klatek nie ma. */
  function armDiagAuto() {
    if (state.diagAutoTimer) return;      /* ten kanał ma już swój budzik */
    if (state.diagAutoShown || diagVisible()) return;
    state.diagAutoTimer = setTimeout(function () {
      state.diagAutoTimer = null;
      maybeAutoDiagnose(t("diag_auto"));
    }, DIAG_AUTO_DELAY);
  }

  /* Panel otwiera się sam tylko w jednym przypadku: dźwięk już leci, a klatek
     nie ma ani jednej. Raz na kanał (diagAutoShown), bo kolejka prób wraca do
     tego samego kanału po każdym nieudanym sposobie odtwarzania. */
  function maybeAutoDiagnose(reason) {
    if (state.diagAutoShown || diagVisible()) return false;
    var video = $("video");
    /* „gra, a nie ma obrazu”: odtwarzacz nie stoi, dane już doszły
       (readyState ≥ 2), a szerokość klatki jest zerowa */
    if (!video || video.paused || video.readyState < 2) return false;
    if (videoHasPicture(video)) return false;
    state.diagAutoShown = true;
    diagNote(reason || t("diag_auto"));
    openDiagnostics();
    return true;
  }

  /* nowy token unieważnia trwające wczytywanie biblioteki po zmianie kanału */
  function nextEngineToken() {
    state.engineToken = (state.engineToken || 0) + 1;
    return state.engineToken;
  }

  /* =========  KANAŁ Z PLAYLIŚCIE (HLS) BEZ OBRAZU: WŁASNY CZYTNIK HLS→TS  =========

     Kanał 4K HEVC nadawany wyłącznie jako playlista .m3u8 nie ma na Androidzie
     czym się odtworzyć: hls.js nie rozbiera HEVC (MSE w WebView go nie ma),
     a <video> nie czyta playlisty. Zostaje jedno wyjście — samemu przeczytać
     playlistę, pobrać odcinki i podać je mpegts.js jako JEDEN ciągły strumień TS
     (tak, jakby czytał plik .ts z sieci). mpegts.js ma na to gotowe miejsce:
     config.customLoader (patrz _createLoader w lib/mpegts.min.js).

     Kontrakt loadera jest taki jak w bibliotece: tworzy go IOController przez
     `new Loader(seekHandler, config)`, woła `open(dataSource, range)` i odbiera
     dane przez `this._onDataArrival(ArrayBuffer, byteStart)`. Numer bajtu nie
     musi być prawdziwym offsetem w pliku — musi tylko rosnąć (IOController
     skleja po nim resztki między wywołaniami), więc liczymy go sami. */

  var FEEDER_LIVE_SEGMENTS = 2;      /* od ilu ostatnich odcinków startujemy na żywo */
  var FEEDER_LIVE_SEGMENTS_UHD = 6;  /* 4K: od tylu — patrz feederLiveSegments */
  var FEEDER_SEGMENT_RETRIES = 2;    /* ile razy ponawiamy odcinek, zanim to błąd */
  var FEEDER_PLAYLIST_FAILS = 3;     /* ile nieudanych odczytów playlisty przerywa próbę */
  var FEEDER_PLAYLIST_MIN = 1000;    /* najkrótsza przerwa między odczytami playlisty */
  var FEEDER_PLAYLIST_MAX = 4000;    /* najdłuższa przerwa między odczytami playlisty */
  var FEEDER_BUFFER_AHEAD = 10;      /* ile sekund obrazu trzymamy przed odtwarzaniem */

  /* Zapas 4K jest większy niż HD i to jest cała różnica między obrazem gładkim
     a zrywającym się. Odcinek 4K to kilka–kilkanaście megabajtów: gdy łącze
     zwolni na parę sekund, zapas 10 s kończy się w połowie odcinka, obraz staje,
     a po odebraniu reszty dekoder nadrabia go serią klatek — dokładnie to wygląda
     jak „strumień nagle przyspieszył”. Zapas ~24 s zjada taki skok. Ceną jest
     opóźnienie wobec transmisji i to jest świadomy wybór: nieprzerwany obraz jest
     ważniejszy niż kilkanaście sekund różnicy. */
  var FEEDER_BUFFER_AHEAD_UHD = 24;

  /* Ile najdłużej każemy czekać na zapas przed startem odtwarzania (patrz
     playWhenBuffered) — czytnik ma tyle, ile jego budżet na pierwsze klatki. */
  var FEEDER_START_WAIT = 15000;

  /* Od tylu sekund zaległości wobec transmisji meldujemy to w panelu diagnostyki:
     po tym widać, czy obraz zrywa się przez za wolne łącze, czy z innego powodu. */
  var FEEDER_LAG_NOTE = 30;

  var FEEDER_SEEN_MAX = 480;         /* po ilu odcinkach zapominamy już wysłane adresy */

  /* Ile odcinków może czekać w kolejce na wysłanie. Gdy łącze nie wyrabia za
     kanałem, odcinki z playlisty przychodzą szybciej, niż je oddajemy — bez tego
     limitu kolejka rosłaby w nieskończoność i obraz odjeżdżałby od transmisji coraz
     dalej (patrz _noteLag), a pamięć zamiast wracać rosła (patrz guardTick). Limit
     jest z zapasem nad okno playlisty 4K (FEEDER_LIVE_SEGMENTS_UHD), bo tyle odcinków
     bierzemy naraz przy pierwszym odczycie. Nadmiar przepada, więc obraz wraca na
     żywo — te adresy są już w _seen, więc nie wrócą do kolejki jako „nowe”. */
  var FEEDER_PENDING_MAX = 8;

  /* Ile obrazu czeka w buforze przed miejscem odtwarzania. Liczymy to sami, bo
     mpegts.js trzyma własny zapas dopiero za tym, co już oddał odtwarzaczowi —
     a odtwarzaczowi trzeba podać następny odcinek, zanim skończy się poprzedni.

     Dwa przypadki, w których starszy rachunek („przedział, w którym stoi
     odtwarzanie”) zwracał zero: strumień ze znacznikami czasu zaczynającymi się
     za zerem (świeży bufor) i odtwarzanie stojące w dziurze bufora. Zero znaczyło
     „brak zapasu”, więc czytnik pobierał odcinki dalej — zapas rósł bez końca,
     a obraz oddalał się od transmisji. Teraz zerem jest naprawdę brak danych:
     cokolwiek jest przed odtwarzaniem, liczy się jako zapas. */
  function videoBufferedAhead(video) {
    var buffered = video && video.buffered;
    if (!buffered || !buffered.length) return 0;
    var at = video.currentTime || 0;
    var ahead = 0;
    for (var i = 0; i < buffered.length; i++) {
      if (buffered.start(i) <= at && buffered.end(i) >= at) return buffered.end(i) - at;
      if (buffered.end(i) > at && buffered.end(i) - at > ahead) ahead = buffered.end(i) - at;
    }
    return ahead;
  }

  /* Czy kanał jest (albo bywa) 4K — z nazwy kanału (patrz markUhdChannel) albo
     z rozmiaru klatki (patrz videoIsUhd). Pytamy ostrożnie, bo czytnik działa
     także wtedy, gdy odpowiedzi jeszcze nie ma: kanał dopiero się wczytuje. */
  function feederChannelIsUhd() {
    try {
      if (typeof videoIsUhd === "function" && videoIsUhd()) return true;
      return !!(typeof state !== "undefined" && state && state.uhdSeen);
    } catch (error) {
      return false;
    }
  }

  /* Kanał 4K trzyma większy zapas (patrz FEEDER_BUFFER_AHEAD_UHD). */
  function feederBufferAheadLimit() {
    return feederChannelIsUhd() ? FEEDER_BUFFER_AHEAD_UHD : FEEDER_BUFFER_AHEAD;
  }

  /* Od ilu ostatnich odcinków playlisty startujemy. Zapas obrazu nie rośnie sam
     z siebie: playlista publikuje odcinki w tempie transmisji, więc zapas przed
     odtwarzaniem to dokładnie to, ile odcinków weźmiemy z jej końca. Dwa odcinki
     (HD) to kilka sekund — dla zwykłego kanału dość. Na 4K to za mało: odcinek
     waży kilka–kilkanaście megabajtów, więc jeden wolniejszy odcinek opróżnia
     cały zapas i obraz staje. Sześć odcinków to ~24 s zapasu, którym da się zjeść
     skok łącza (patrz FEEDER_LIVE_SEGMENTS_UHD). */
  function feederLiveSegments() {
    return feederChannelIsUhd() ? FEEDER_LIVE_SEGMENTS_UHD : FEEDER_LIVE_SEGMENTS;
  }

  function feederReason(error) {
    var text = String((error && error.message) || error || "");
    return text.slice(0, 80) || "?";
  }

  /* Atrybuty wiersza playlisty (#EXT-X-STREAM-INF: BANDWIDTH=…, RESOLUTION=…,
     CODECS="…") — tyle, ile trzeba do wyboru poziomu. */
  function feederAttributes(text) {
    var result = {};
    var pattern = /([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g;
    var match;
    while ((match = pattern.exec(String(text || "")))) {
      result[match[1]] = match[2] !== undefined ? match[2] : match[3];
    }
    return result;
  }

  /* Adres z playlisty bywa względny („od1.ts”, „/live/od1.ts”) — musi trafić do
     tej samej domeny i katalogu co playlista. */
  function feederResolveUrl(base, ref) {
    var value = String(ref || "");
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
    var root = String(base || "");
    var mark = root.indexOf("://");
    if (mark < 0) return value;
    var origin = root.slice(0, mark + 3);
    var rest = root.slice(mark + 3);
    var slash = rest.indexOf("/");
    var host = slash < 0 ? rest : rest.slice(0, slash);
    var path = slash < 0 ? "/" : rest.slice(slash);
    if (value.charAt(0) === "/") return origin + host + value;
    path = path.replace(/[?#].*$/, "");
    path = path.slice(0, path.lastIndexOf("/") + 1);
    return origin + host + path + value;
  }

  /* Co jest w playliście: warianty (playlista wariantów), odcinki, czy odcinki są
     w TS, czy w MP4, i czy strumień jest zaszyfrowany. Pełny parser HLS nie jest
     tu do niczego potrzebny. */
  function parseHlsPlaylist(text) {
    var lines = String(text || "").split(/\r?\n/);
    var list = {
      variants: [], segments: [], targetDuration: 0,
      endList: false, fmp4: false, encrypted: false
    };
    var variant = null;
    var segment = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.indexOf("#EXT-X-STREAM-INF:") === 0) {
        variant = feederAttributes(line.slice("#EXT-X-STREAM-INF:".length));
        continue;
      }
      if (line.indexOf("#EXTINF") === 0) { segment = true; continue; }
      if (line.indexOf("#EXT-X-TARGETDURATION:") === 0) {
        list.targetDuration = parseFloat(line.slice("#EXT-X-TARGETDURATION:".length)) || 0;
        continue;
      }
      if (line.indexOf("#EXT-X-MAP") === 0) { list.fmp4 = true; continue; }
      if (line.indexOf("#EXT-X-KEY:") === 0 && /METHOD=(?!NONE)/i.test(line)) {
        list.encrypted = true;
        continue;
      }
      if (line.indexOf("#EXT-X-ENDLIST") === 0) { list.endList = true; continue; }
      if (line.charAt(0) === "#") continue;
      if (variant) {
        list.variants.push({
          url: line,
          bandwidth: parseInt(variant.BANDWIDTH, 10) || 0,
          height: parseInt(String(variant.RESOLUTION || "").split("x")[1], 10) || 0
        });
        variant = null;
        continue;
      }
      if (segment) { list.segments.push(line); segment = false; }
    }
    return list;
  }

  /* Sam czytnik. Nie zna niczego poza playlistą: pobiera odcinki po kolei i podaje
     je odtwarzaczowi. Kolejność i kompletność są tu na wagę obrazu — mpegts.js
     parsuje strumień liniowo, więc odcinki muszą iść jeden po drugim, bez dziur. */
  function createHlsTsLoader(lib, videoRef) {
    function FeederLoader() {
      var self = lib.BaseLoader.call(this, "hls-ts-loader") || this;
      self._playlistUrl = "";
      self._stopped = true;
      self._fetching = false;
      self._pending = [];
      self._seen = {};
      self._seenCount = 0;
      self._started = false;
      self._offset = 0;
      self._target = 4;
      self._endList = false;
      self._segmentFails = 0;
      self._playlistFails = 0;
      self._refreshTimer = null;
      self._pumpTimer = null;
      return self;
    }
    FeederLoader.prototype = Object.create(lib.BaseLoader.prototype);
    FeederLoader.prototype.constructor = FeederLoader;

    FeederLoader.prototype.destroy = function () {
      this._stop();
      lib.BaseLoader.prototype.destroy.call(this);
    };

    FeederLoader.prototype.abort = function () {
      this._stop();
    };

    /* wszystko, co trzyma budziki i kolejkę odcinków — po tym nie robimy już nic
       (spóźnione odpowiedzi sieci sprawdzają ten znacznik). Status wraca do
       bezczynności: tak samo robi każdy czytnik mpegts.js po przerwaniu, a
       IOController patrzy na niego, pytając czy próba jeszcze trwa. */
    FeederLoader.prototype._stop = function () {
      this._stopped = true;
      this._fetching = false;
      this._pending = [];
      this._status = lib.LoaderStatus.kIdle;
      if (this._refreshTimer) clearTimeout(this._refreshTimer);
      if (this._pumpTimer) clearTimeout(this._pumpTimer);
      this._refreshTimer = null;
      this._pumpTimer = null;
    };

    FeederLoader.prototype.open = function (dataSource, range) {
      this._stop();
      this._stopped = false;
      this._dataSource = dataSource || {};
      this._playlistUrl = String(this._dataSource.url || "");
      this._offset = 0;
      this._status = lib.LoaderStatus.kConnecting;
      /* Playlista na żywo nie ma początku w bajtach, więc przewijanie po offsetcie
         (range) nie ma tu czego szukać — startujemy od ostatnich odcinków. */
      this._readPlaylist(0);
    };

    /* Playlista: albo od razu odcinki, albo lista wariantów (wtedy schodzimy
       poziom niżej po jej adres). Sama playlista też jest na żywo — czytamy ją
       wielokrotnie (patrz _scheduleRefresh). */
    FeederLoader.prototype._readPlaylist = function (depth) {
      var self = this;
      if (this._stopped) return;
      httpGet(this._playlistUrl, false).then(function (text) {
        if (self._stopped) return;
        self._playlistFails = 0;
        /* Odebrana playlista to ruch w strumieniu tego kanału. Bez tego budziki
           widziały ciszę w <video> (odcinki jeszcze się pobierają) i ucinały
           próbę, choć czytnik właśnie pracuje — patrz noteStreamActivity. */
        noteStreamActivity();
        var list = parseHlsPlaylist(text);
        if (list.variants.length) {
          if (depth >= 2) { self._fail(t("err_feeder_variants")); return; }
          var best = list.variants[0];
          for (var i = 1; i < list.variants.length; i++) {
            if (self._variantBetter(list.variants[i], best)) best = list.variants[i];
          }
          self._playlistUrl = feederResolveUrl(self._playlistUrl, best.url);
          self._readPlaylist(depth + 1);
          return;
        }
        if (list.fmp4) { self._fail(t("err_feeder_fmp4")); return; }
        if (list.encrypted) { self._fail(t("err_feeder_encrypted")); return; }
        if (!list.segments.length) { self._fail(t("err_feeder_empty")); return; }
        self._endList = list.endList;
        self._target = list.targetDuration || self._target;
        self._queueSegments(list);
        if (!self._started) {
          self._started = true;
          diagNote(t("diag_feeder_start", { n: self._pending.length }));
        }
        self._pump();
        self._scheduleRefresh();
      }, function (error) {
        if (self._stopped) return;
        /* Pierwszy odczyt playlisty rozstrzyga o całej próbie — bez niej nie ma
           czego podawać odtwarzaczowi. Przy kolejnych odczytach dajemy serwerowi
           jeszcze szansę: jedno nieodebrane zapytanie to nie koniec kanału. */
        self._playlistFails++;
        if (!self._started || self._playlistFails >= FEEDER_PLAYLIST_FAILS) {
          self._fail(t("err_feeder_playlist") + " (" + feederReason(error) + ")");
          return;
        }
        self._scheduleRefresh();
      });
    };

    /* Najlepszy poziom to największy bitrate — 4K HEVC jest zwykle tam, gdzie
       obraz jest najcięższy, a przy tym samym bitracie wyższa rozdzielczość. */
    FeederLoader.prototype._variantBetter = function (candidate, current) {
      if (candidate.bandwidth !== current.bandwidth) return candidate.bandwidth > current.bandwidth;
      return candidate.height > current.height;
    };

    /* Na żywo playlista trzyma kilkanaście odcinków wstecz — puszczenie ich
       wszystkich od początku dałoby obraz pół minuty za kanałem. Startujemy od
       ostatnich (ile ich brać, mówi feederLiveSegments — 4K bierze więcej, bo
       tylko tak powstaje jego zapas), a starsze tylko zapamiętujemy: bez tego przy
       kolejnym odczycie playlisty wróciłyby jako „nowe” i zagrały po najnowszych
       (czas w strumieniu stanąłby w miejscu), a przy kolejnych odczytach dokładamy
       wyłącznie nowe. */
    FeederLoader.prototype._queueSegments = function (list) {
      var start = this._started || this._endList
        ? 0
        : Math.max(0, list.segments.length - feederLiveSegments());
      if (this._seenCount > FEEDER_SEEN_MAX) { this._seen = {}; this._seenCount = 0; }
      for (var i = 0; i < list.segments.length; i++) {
        var url = feederResolveUrl(this._playlistUrl, list.segments[i]);
        if (this._seen[url]) continue;
        this._seen[url] = true;
        this._seenCount++;
        if (i < start) continue;
        this._pending.push(url);
      }
      /* Kolejka jest ograniczona (patrz FEEDER_PENDING_MAX): gdy odcinki przychodzą
         szybciej, niż je oddajemy, przepadają najstarsze — obraz dogania transmisję,
         zamiast zostać z niej wyprzedzonym na zawsze. */
      var extra = this._pending.length - FEEDER_PENDING_MAX;
      if (extra > 0) {
        this._pending.splice(0, extra);
        diagNote(t("diag_feeder_drop", { n: extra }));
      }
    };

    /* Rachunek zapasu jest wspólny z resztą odtwarzania (patrz videoBufferedAhead):
       start kanału czeka na ten sam zapas, więc nie ma dwóch różnych prawd o tym,
       ile obrazu jest przed odtwarzaniem. */
    FeederLoader.prototype._bufferedAhead = function (video) {
      return videoBufferedAhead(video);
    };

    /* Zaległość wobec transmisji meldujemy w panelu diagnostyki, ale nie częściej
       niż raz na kilkanaście sekund: przy wolnym łączu ta sama linia rosłaby w kółko,
       a dziennik panelu jest krótki. Linia jest po to, żeby odróżnić zrywający się
       obraz (kodek, dekoder) od kanału, którego łącze nie wyrabia — przy drugim
       zapas rośnie i to widać właśnie tutaj (patrz domyślny budżet lagu). */
    FeederLoader.prototype._noteLag = function (ahead) {
      var lag = ahead + this._pending.length * (this._target || 4);
      if (lag < FEEDER_LAG_NOTE) { this._lagNoted = false; return; }
      var now = Date.now();
      if (this._lagNoted && now - (this._lagNotedAt || 0) < 15000) return;
      this._lagNoted = true;
      this._lagNotedAt = now;
      diagNote(t("diag_feeder_lag", { s: Math.round(lag) }));
    };
    /* Odcinki idą po jednym i w kolejności: dopiero po odebraniu jednego zaczynamy
       następny, żeby nie trzymać w pamięci całej playlisty. */
    FeederLoader.prototype._pump = function () {
      var self = this;
      if (this._stopped || this._fetching) return;
      if (!this._pending.length) {
        if (this._endList && this._offset > 0) {
          this._status = lib.LoaderStatus.kComplete;
          if (this._onComplete) this._onComplete(0, this._offset);
        }
        return;
      }
      var video = videoRef ? videoRef() : null;
      var ahead = video ? this._bufferedAhead(video) : 0;
      /* Zaległość wobec transmisji: to, co czeka w buforze, plus to, co leży
         jeszcze w kolejce odcinków. Rośnie tylko wtedy, gdy łącze nie wyrabia za
         kanałem — wtedy obraz gra dalej, ale coraz dalej od „na żywo”, i to trzeba
         zobaczyć w panelu diagnostyki (patrz _noteLag). */
      this._noteLag(ahead);
      /* Nie wyprzedzamy obrazu: kilkadziesiąt sekund buforu na kanale na żywo to
         obraz daleko za transmisją (mpegts.js musiałby go potem „gonić”). Zapas 4K
         jest większy niż HD (patrz FEEDER_BUFFER_AHEAD_UHD) — jeden wolniejszy
         odcinek nie może opróżnić bufora do zera, bo właśnie z tego brały się
         zrywania obrazu. */
      if (video && ahead > feederBufferAheadLimit()) {
        /* pół sekundy, a nie sekunda: tyle wystarczy, żeby nie przegapić chwili,
           w której zapas spadnie pod limit */
        this._schedulePump(500);
        return;
      }

      var url = this._pending.shift();
      this._fetching = true;
      httpGet(url, true).then(function (data) {
        self._fetching = false;
        if (self._stopped) return;
        var chunk = self._asChunk(data);
        /* odpowiedź w nieoczekiwanym formacie to także nieodebrany odcinek —
           nie wolno go po cichu przeskoczyć, bo dziura w strumieniu rozwala
           parsowanie TS (patrz _segmentFailed) */
        if (!chunk) { self._segmentFailed(url, typeof data); return; }
        if (!chunk.byteLength) { self._pump(); return; }
        self._segmentFails = 0;
        /* Odebrany odcinek = strumień naprawdę coś dociągnął: to trzyma próbę
           przy życiu i przedłuża budżet czytnika (patrz streamStillComing) */
        noteStreamActivity();
        self._status = lib.LoaderStatus.kBuffering;
        if (self._onDataArrival) self._onDataArrival(chunk, self._offset, self._offset + chunk.byteLength);
        self._offset += chunk.byteLength;
        self._pump();
      }, function (error) {
        self._fetching = false;
        if (self._stopped) return;
        self._segmentFailed(url, feederReason(error));
      });
    };

    /* Jeden nieodebrany odcinek to jeszcze nie koniec kanału (serwer potrafi nie
       odpowiedzieć na jedno zapytanie), ale nie oddajemy go zgubionego — wracamy
       po niego na początek kolejki, bo dziura w strumieniu rozwala parsowanie TS.
       Kilka nieudanych odcinków pod rząd kończy tę próbę (patrz _fail). */
    FeederLoader.prototype._segmentFailed = function (url, reason) {
      this._segmentFails++;
      if (this._segmentFails <= FEEDER_SEGMENT_RETRIES) {
        this._pending.unshift(url);
        this._schedulePump(500);
        return true;
      }
      this._fail(t("err_feeder_segment", { reason: reason }));
      return false;
    };

    /* Odcinek może wrócić jako ArrayBuffer (Android, przeglądarka) albo jako bajty
       (webOS) — mpegts.js oczekuje w obu przypadkach bajtów w ArrayBufferze. */
    FeederLoader.prototype._asChunk = function (data) {
      if (!data) return null;
      if (data instanceof ArrayBuffer) return data;
      if (data.buffer instanceof ArrayBuffer) {
        return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
          ? data.buffer
          : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      }
      return null;
    };

    FeederLoader.prototype._schedulePump = function (delay) {
      var self = this;
      if (this._stopped || this._pumpTimer) return;
      this._pumpTimer = setTimeout(function () {
        self._pumpTimer = null;
        self._pump();
      }, delay);
    };

    /* Playlista na żywo sama się przewija, więc czytamy ją co pół target duration —
       inaczej skończyłyby się odcinki do pobrania i obraz stanął. */
    FeederLoader.prototype._scheduleRefresh = function () {
      var self = this;
      if (this._stopped || this._endList || this._refreshTimer) return;
      var wait = Math.max(FEEDER_PLAYLIST_MIN,
        Math.min(FEEDER_PLAYLIST_MAX, Math.round(this._target * 500)));
      this._refreshTimer = setTimeout(function () {
        self._refreshTimer = null;
        self._readPlaylist(0);
      }, wait);
    };

    /* Porażka czytnika to porażka tej próby: zgłaszamy ją odtwarzaczowi tak, jak
       zrobiłby to każdy loader mpegts.js — IOController zamieni ją na zdarzenie
       ERROR i kolejka przejdzie do następnego sposobu odtwarzania. */
    FeederLoader.prototype._fail = function (message) {
      if (this._stopped) return;
      this._stop();
      this._status = lib.LoaderStatus.kError;
      diagNote(t("diag_feeder_failed", { reason: String(message) }));
      if (this._onError) {
        this._onError(lib.LoaderErrors.EXCEPTION, { code: -1, msg: String(message) });
      }
    };

    return FeederLoader;
  }

  function startMseSource(entry) {
    var token = nextEngineToken();
    state.engine = "mse";
    state.engineLoading = true;
    loadEngineScript("lib/mpegts.min.js").then(function () {
      if (state.engineToken !== token || !state.watchChannel) return;
      if (!window.mpegts || !window.mpegts.isSupported || !window.mpegts.isSupported()) {
        handlePlaybackError(t("err_no_mse"));
        return;
      }
      var video = resetVideoElement();
      if (!video) return;
      /* Konfiguracja wspólna dla każdej drogi przez mpegts.js. Trzy rzeczy są tu
         wybrane świadomie i wszystkie trzy dotyczą 4K:

         • bez doganiania „na żywo” (liveBufferLatencyChasing). To ustawienie robi
           dokładnie to, co użytkownik opisuje jako „strumień nagle przyspieszył”:
           po każdym dołożonym odcinku przeskakuje currentTime na koniec buforu
           (buffered.end - 0.5 s). Na 4K odpala się to bez przerwy, bo zapas rośnie
           skokowo po każdym odcinku — obraz skacze do przodu razem z dźwiękiem
           albo obok niego. Zapasu pilnuje sama aplikacja: na kanale z playlisty
           czytnik (FEEDER_BUFFER_AHEAD_UHD), a od startu każdego kanału
           playWhenBuffered. Nie ma czego doganiać.

         • pamięć wstecz: domyślne 180 s w MSE to przy 4K (kilkanaście megabajtów
           na sekundę) setki megabajtów trzymane bez potrzeby. Przeglądarka zaczyna
           wtedy przycinać bufor — i to też widać jako zrywanie obrazu. Kanałowi na
           żywo wstecz nie jest potrzebne nic: 15–30 s wystarcza na chwilowe
           zatrzymanie, a każdy megabajt mniej to dalej od zamknięcia aplikacji przez
           system (patrz guardTick — on pilnuje już tylko kondycji obrazu).

         • lazyLoad zostaje wyłączony: dane muszą się wczytywać także wtedy, gdy
           odtwarzanie jeszcze nie ruszyło (patrz playWhenBuffered). */
      var config = {
        enableWorker: true,               /* parsowanie TS poza wątkiem UI */
        lazyLoad: false,
        enableStashBuffer: false,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 30,
        autoCleanupMinBackwardDuration: 15,
        liveBufferLatencyChasing: false
      };
      /* Kanał nadawany jako playlista (typowy 4K HEVC): mpegts.js nie czyta .m3u8,
         więc dostaje własny czytnik, który skleja odcinki playlisty w jeden ciągły
         strumień TS. Dla takiego kanału to jedyna droga do obrazu na Androidzie —
         hls.js nie rozbiera HEVC, a <video> nie czyta playlisty (patrz
         createHlsTsLoader). */
      if (entry.hls) {
        config.customLoader = createHlsTsLoader(window.mpegts, function () { return $("video"); });
      }
      var player;
      try {
        player = window.mpegts.createPlayer(
          { type: "mpegts", isLive: !state.watchProgram, url: entry.url },
          config
        );
      } catch (createError) {
        /* np. WebView bez MediaSource — od razu przechodzimy dalej */
        handlePlaybackError(t("err_stream") + " (" + engineLabel("mse") + ": " + createError.message + ")");
        return;
      }
      state.engineInstance = {
        kind: "mse",
        close: function () {
          try { player.pause(); } catch (e) {}
          try { player.unload(); } catch (e2) {}
          try { player.detachMediaElement(); } catch (e3) {}
          try { player.destroy(); } catch (e4) {}
        }
      };
      player.on(window.mpegts.Events.ERROR, function (type, detail) {
        handlePlaybackError(t("err_stream") + " (" + engineLabel("mse") + ": " + type + "/" + detail + ")");
      });
      try {
        player.attachMediaElement(video);
        player.load();
        /* Start dopiero na zapasie, a nie na pierwszych kilobajtach: dekoder, któremu
           każe się grać od razu, przez kilka sekund nadrabia to, co przyszło, a przy
           4K wygląda to jak zrywanie. Patrz playWhenBuffered. */
        playWhenBuffered(
          player,
          video,
          token,
          mseStartAhead(),
          state.engineFeeder ? FEEDER_START_WAIT : MSE_START_WAIT
        );
      } catch (playError) {
        handlePlaybackError(t("err_stream") + " (" + engineLabel("mse") + ": " + playError.message + ")");
        return;
      }
      state.engineLoading = false;
    }, function (error) {
      if (state.engineToken !== token) return;
      nextSourceEntry(String(error && error.message ? error.message : ""), 1200);
    });
  }

  /* =========  START NA ZAPASIE: NIE ZACZYNAMY, DOPÓKI NIE MA CZEGO GRAĆ  =========

     Kanał na żywo startuje inaczej niż film: pierwsze kilobajty przychodzą
     natychmiast, ale obraz z nich to ułamek sekundy. Dekoder, któremu każe się
     grać od razu, przez kilka sekund „dogania” to, co przyszło — klatka po klatce,
     z przycięciami, a każdy wolniejszy odcinek w 4K wygląda dokładnie tak, jak
     zrywanie. Dlatego odtwarzanie rusza dopiero wtedy, gdy w buforze jest zapas —
     i to liczony z elementu <video> (patrz videoBufferedAhead), czyli z tego, co
     naprawdę weszło do bufora MSE, a nie z liczby pobranych odcinków. Gotowość
     dekodera („canplay”) nie jest tu miarodajna: przy 4K potrafi przyjść przy
     jednej sekundzie obrazu.

     Czekanie jest ograniczone (MSE_START_WAIT, dla czytnika playlisty
     FEEDER_START_WAIT — tyle, ile ma budżet na pierwsze klatki): kanał, który nie
     zdąży zebrać zapasu, startuje na tym, co ma, a budziki obrazu pilnują go
     dalej jak dotąd. Film z archiwum startuje od razu (ahead = 0) — tam nie ma
     czego doganiać, a użytkownik czeka na obraz po wybraniu pozycji. */

  var MSE_START_AHEAD = 3;         /* HD: od ilu sekund zapasu zaczynamy grać */
  var MSE_START_AHEAD_UHD = 12;    /* 4K: odcinek jest cięższy, zapas musi być większy */
  var MSE_START_WAIT = 9000;       /* dłużej niż to nie każemy czekać na zapas */

  function mseStartAhead() {
    if (state.watchProgram) return 0;
    return (state.uhdSeen || videoIsUhd()) ? MSE_START_AHEAD_UHD : MSE_START_AHEAD;
  }

  function playWhenBuffered(player, video, token, ahead, wait) {
    var startedAt = Date.now();
    var limit = wait || MSE_START_WAIT;
    function attempt() {
      /* kanał zmieniony albo próba porzucona — nie ma czego startować */
      if (state.engineToken !== token || !state.watchChannel) return;
      var ready = videoBufferedAhead(video) >= ahead;
      var expired = Date.now() - startedAt >= limit;
      /* błąd dekodera też kończy czekanie: zdarzenie „error” zajmie się kanałem */
      if (ready || expired || video.error) {
        try {
          var promise = player.play();
          if (promise && promise.catch) promise.catch(function () {});
        } catch (error) { /* dekoder zgłosi to zdarzeniem „error” */ }
        return;
      }
      /* Dane naprawdę przychodzą (gotowość rośnie) — trzymajmy próbę przy życiu,
         bo budziki patrzą właśnie na ruch w strumieniu (patrz streamStillComing). */
      if (video.readyState >= 1) noteStreamActivity();
      setTimeout(attempt, 250);
    }
    attempt();
  }

  /* =========  KONDYCJA OBRAZU: ZRYWY, PAMIĘĆ I ŚWIEŻY STRUMIEŃ  =========

     Kanał 4K nadawany jako TS wchodzi do obrazu przez MSE: mpegts.js rozbiera
     strumień w JavaScripcie, a WebView dekoduje go własnym stosem. Ta droga ma dwa
     końce, których z kanapy nie widać:

       • obraz zaczyna się zrywać (dekoder nie wyrabia, bufor MSE się przycina),
       • po dłuższym oglądaniu strumień zabiera tyle pamięci, że system zamyka
         aplikację.

     Pod tymi objawami bywa i łącze, i dekoder, i samo kodowanie kanału — z jednego
     zdjęcia panelu tego nie rozstrzygniemy i właśnie dlatego nie zgadujemy. Patrzymy
     na to, co <video> mówi wprost: ile razy obraz stanął (zrywy liczone w oknie
     czasu) i ile klatek odrzucił dekoder (webkitDroppedFrameCount — to samo, co
     pokazuje panel, patrz diagFrames). Gdy obraz naprawdę się rozsypuje, ten sam
     strumień startuje na świeżym elemencie <video> i świeżym MSE (patrz
     resetVideoElement): to zwalnia pamięć dekodera i kolejki, których przeglądarka
     sama nie oddaje. Użytkownik widzi wtedy sekundę „przestrajania”, a nie wyjście
     z aplikacji.

     Odświeżamy tylko obraz NA ŻYWO i tylko przez MSE: film z archiwum straciłby po
     tym swoją pozycję, a droga natywna i HLS mają dekoder sprzętowy, któremu nie ma
     czego zwalniać. Liczba odświeżeń jest ograniczona — kanał, który zrywa się także
     na świeżym strumieniu, nie naprawi się kolejnym restartem, a pętla restartów
     zabetonowałaby aplikację. Wtedy panel diagnostyki mówi wprost, że doszliśmy do
     granicy tego odtwarzacza (patrz diag_recycle_stop). */

  var GUARD_TICK = 1000;             /* co ile patrzymy na kondycję obrazu */
  var GUARD_WINDOW = 90000;          /* okno, w którym liczą się zrywy i klatki */
  var GUARD_STALLS = 8;              /* ile zrywów w oknie to już rozsypka */
  var GUARD_DROPPED = 1500;          /* ile klatek odrzuconych w tym oknie */
  var GUARD_UPTIME = 20000;          /* świeżego obrazu nie ruszamy */
  var GUARD_MAX_RECYCLES = 3;        /* ile razy odświeżamy strumień przy kanale */

  /* Budzik kondycji chodzi tylko tam, gdzie ma co pilnować: obraz na żywo przez MSE
     (patrz startSourceEntry). Poza tym nie ma po co budzić procesora co sekundę. */
  function startGuard() {
    if (!state.guardTicker) {
      state.guardTicker = setInterval(guardTick, GUARD_TICK);
    }
    /* okno liczy się od świeżego obrazu: zrywy z poprzedniego kanału (albo z okresu
       przed odświeżeniem strumienia) nie mogą spadać na ten */
    state.guardWindowAt = Date.now();
    state.guardStalls = 0;
    state.guardDroppedSum = 0;
    state.guardDroppedBase = 0;
  }

  function stopGuard() {
    if (!state.guardTicker) return;
    clearInterval(state.guardTicker);
    state.guardTicker = null;
  }

  /* Zryw: obraz był, stanął i wrócił. Pojedyncze zdarzenie nie znaczy nic (tak
     zachowuje się każdy kanał na żywo), więc liczymy je w oknie czasu i dopiero
     gęstość tych zrywów ocenia guardTick. */
  function noteStall() {
    if (state.watchProgram || state.engine !== "mse") return;
    var now = Date.now();
    if (now - state.guardWindowAt > GUARD_WINDOW) {
      state.guardWindowAt = now;
      state.guardStalls = 0;
      state.guardDroppedSum = 0;
    }
    state.guardStalls++;
  }

  /* Czy wyczerpaliśmy już odświeżenia przy tym kanale (patrz GUARD_MAX_RECYCLES) */
  function guardLimitReached() {
    return (state.guardRecycles | 0) >= GUARD_MAX_RECYCLES;
  }

  /* Czy wolno odświeżyć strumień (patrz komentarz nad sekcją): tylko obraz na żywo,
     tylko przez MSE, nigdy w pierwszych sekundach po starcie i tylko do wyczerpania
     limitu odświeżeń. */
  function guardCanRecycle() {
    if (!state.watchChannel || state.watchProgram) return false;
    if (state.engine !== "mse") return false;
    if (Date.now() - (state.entryWaitStart || 0) < GUARD_UPTIME) return false;
    return !guardLimitReached();
  }

  /* Jedna próbka na sekundę: zrywy z okna plus klatki, które dekoder odrzucił od
     poprzedniej próbki. Liczymy różnicę, a nie sumę od startu kanału, bo licznik
     zeruje się razem z elementem <video> (patrz resetVideoElement) — po odświeżeniu
     strumienia nowy element zaczyna od zera i nie wygląda to na skok. */
  function guardTick() {
    if (!state.watchChannel) { stopGuard(); return; }
    var video = $("video");
    if (!video) return;
    var now = Date.now();
    if (now - state.guardWindowAt > GUARD_WINDOW) {
      state.guardWindowAt = now;
      state.guardStalls = 0;
      state.guardDroppedSum = 0;
    }
    var total = video.webkitDroppedFrameCount ? video.webkitDroppedFrameCount | 0 : 0;
    if (total >= state.guardDroppedBase) state.guardDroppedSum += total - state.guardDroppedBase;
    state.guardDroppedBase = total;

    /* Obraz, któremu dekoder najpierw przestaje wyrabiać, a potem staje — jedno
       i drugie znaczy to samo: ten odtwarzacz nie nadąża za tym strumieniem. */
    if (state.guardStalls < GUARD_STALLS && state.guardDroppedSum < GUARD_DROPPED) return;
    /* Limit odświeżeń wyczerpany: nic już nie restartujemy, tylko pokazujemy liczby
       z panelu (patrz guardGiveUp). Świeżego obrazu nie ruszamy — zrywy z pierwszych
       sekund wczytywania nie są jeszcze powodem do restartu. */
    if (guardLimitReached()) { guardGiveUp(); return; }
    if (!guardCanRecycle()) return;
    recycleStream();
  }

  /* Ten sam strumień na świeżym MSE i świeżym elemencie <video>. To nie jest
     przejście do następnego sposobu odtwarzania, więc wpis kolejki i liczniki prób
     (cycle, sourceIndex) zostają bez zmian (patrz nextSourceEntry). */
  function recycleStream() {
    var entry = state.sources[state.sourceIndex];
    if (!entry) return;
    state.guardRecycles = (state.guardRecycles | 0) + 1;
    state.guardWindowAt = Date.now();
    state.guardStalls = 0;
    state.guardDroppedSum = 0;
    diagNote(t("diag_recycle", { n: state.guardRecycles }));
    showPlayerToast(t("osd_recycle"));
    clearPictureWatchdog();
    clearStartWatchdog();
    destroyEngine();
    startSourceEntry(entry);
  }

  /* Zrywy wracają na świeżym strumieniu, więc nic już nie zgadujemy: pokazujemy
     liczby z panelu (pamięć interfejsu, odrzucone klatki, liczba zrywów) — to one
     mówią, czy granicą jest ten odtwarzacz, czy łącze. Obraz gra dalej. */
  function guardGiveUp() {
    if (state.guardGaveUp) return;
    state.guardGaveUp = true;
    diagNote(t("diag_recycle_stop"));
    if (diagVisible()) return;
    state.diagAutoShown = true;
    openDiagnostics();
  }

  /* Czy hls.js mówi wprost, że tego strumienia nie rozbierze (a nie, że jeden
     fragment był zepsuty)? Takie ostrzeżenia wracają przy każdym fragmencie:
     „Unsupported HEVC in M2TS found”, kodek którego nie ma w MSE itd. — wtedy
     czekanie na obraz już nic nie da. */
  function hlsCannotPlay(data) {
    var reason = String((data && data.error && data.error.message) || (data && data.reason) || "");
    return /hevc|hvc1|hev1|m2ts|codec|support/i.test(reason);
  }

  function startHlsSource(entry) {
    var token = nextEngineToken();
    state.engine = "hls";
    state.engineLoading = true;
    loadEngineScript("lib/hls.min.js").then(function () {
      if (state.engineToken !== token || !state.watchChannel) return;
      var video = resetVideoElement();
      if (!video) return;

      if (!window.Hls || !window.Hls.isSupported()) {
        /* webOS / Safari często grają HLS sprzętowo, bez żadnej biblioteki */
        var nativeHls = video.canPlayType("application/vnd.apple.mpegurl");
        if (nativeHls) {
          state.engine = "native";
          video.src = entry.url;
          video.load();
          var direct = video.play();
          if (direct && direct.catch) direct.catch(function () {});
          state.engineLoading = false;
          return;
        }
        handlePlaybackError(t("err_player_lib", { name: t("engine_hls") }));
        return;
      }

      var hls;
      try {
        hls = new window.Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 });
      } catch (createError) {
        handlePlaybackError(t("err_stream") + " (" + engineLabel("hls") + ": " + createError.message + ")");
        return;
      }
      state.engineInstance = {
        kind: "hls",
        close: function () {
          try { hls.stopLoad(); } catch (e) {}
          try { hls.detachMedia(); } catch (e2) {}
          try { hls.destroy(); } catch (e3) {}
        }
      };
      hls.on(window.Hls.Events.ERROR, function (event, data) {
        if (!data) return;
        /* Źle rozebrany fragment nie kończy się błędem krytycznym: hls.js gra
           dalej to, co zrozumiał, i ostrzeżenie wraca przy każdym fragmencie.
           Przy 4K HEVC zostaje wtedy sam dźwięk i obrazu już nie będzie, a
           dźwięk bez obrazu nie jest odtwarzaniem — dlatego taką próbę
           kończymy od razu i oddajemy kanał innemu silnikowi. */
        var unplayable = data.details === "fragParsingError" && hlsCannotPlay(data) &&
          !videoHasPicture(video);
        if (!data.fatal && !unplayable) return;
        handlePlaybackError(t("err_stream") + " (" + engineLabel("hls") + ": " + data.type + "/" + data.details + ")");
      });
      hls.on(window.Hls.Events.MANIFEST_PARSED, function (event, data) {
        if (state.engineToken !== token) return;
        /* Manifest wie o strumieniu więcej niż obraz: przy HEVC 4K klatek nie ma
           czasem wcale (MSE nie wciągnie tego kodeka i dekoder oddaje sam dźwięk),
           a wysokość poziomu mówi o 4K od razu — dlatego 4K rozpoznajemy także
           tutaj (patrz noteUhd). */
        if (manifestIsUhd(data) && noteUhd()) return;
        var promise = video.play();
        if (promise && promise.catch) promise.catch(function () {});
      });
      try {
        hls.loadSource(entry.url);
        hls.attachMedia(video);
      } catch (loadError) {
        handlePlaybackError(t("err_stream") + " (" + engineLabel("hls") + ": " + loadError.message + ")");
        return;
      }
      state.engineLoading = false;
    }, function (error) {
      if (state.engineToken !== token) return;
      nextSourceEntry(String(error && error.message ? error.message : ""), 1200);
    });
  }

  /* ==============  ODTWARZACZ SYSTEMOWY (Android: ExoPlayer)  ==============

     Kanał 4K HEVC z playlisty szedł dotąd przez MSE: mpegts.js rozbierał TS
     w JavaScripcie, a WebView dekodował gotowe fragmenty. To dwie kopie tych samych
     danych i cała praca na procesorze odbiornika, więc obraz się zrywał, a po
     dłuższym oglądaniu system zamykał aplikację. Każda inna aplikacja IPTV na
     Androidzie robi to inaczej: oddaje adres kanału odtwarzaczowi odbiornika
     (ExoPlayer), który rozbiera TS i HLS w kodzie natywnym i rysuje klatki wprost na
     warstwie sprzętowej (patrz MainActivity -> ODTWARZACZ NATYWNY).

     Ta droga jest pierwsza w kolejce kanału na żywo, ale tylko tam, gdzie most
     istnieje — czyli w aplikacji na Androidzie. Obraz rysuje się POD stroną, więc
     na czas odtwarzania strona jest przezroczysta (klasa „exo-player”, patrz
     styles.css). Gdy mostu nie ma, kanał nie ruszy albo nie da obrazu, kolejka idzie
     dalej jak dotąd (natywnie → MSE → HLS) — nic nie jest zamknięte na jedną drogę. */

  var EXO_START_WAIT = 9000;         /* ile czekamy, aż obraz systemowy ruszy */
  var EXO_PICTURE_WAIT = 6000;       /* dźwięk gra, a klatek nie ma */

  /* Most do odtwarzacza systemowego: jest tylko w aplikacji na Androidzie. W
     przeglądarce i na webOS zwracamy null i kanał idzie dotychczasowymi drogami. */
  function exoBridge() {
    try {
      if (!platformInfo.native) return null;
      var bridge = window.OpenIptvNative;
      if (!bridge || typeof bridge.playNative !== "function") return null;
      return bridge;
    } catch (error) {
      return null;
    }
  }

  /* Co potrafi odtwarzacz systemowy — panel diagnostyki pokazuje to obok testu MSE
     (patrz diagCodecLines). Bez mostu nie ma czego pokazywać. */
  function exoInfo() {
    var bridge = exoBridge();
    if (!bridge || typeof bridge.nativeInfo !== "function") return null;
    try {
      var info = JSON.parse(String(bridge.nativeInfo() || ""));
      return info && info.media3 ? info : null;
    } catch (error) {
      return null;
    }
  }

  /* Czy obraz w tej próbie rysuje odtwarzacz systemowy (a nie element <video>). */
  function exoActive() {
    return state.engine === "exo";
  }

  /* Na czas obrazu systemowego strona musi być przezroczysta — inaczej zasłoni
     klatki rysowane pod nią. */
  function markExoMode(on) {
    var want = on !== false;
    var root = document.documentElement;
    if (root && root.classList) root.classList.toggle("exo-player", want);
    if (document.body && document.body.classList) document.body.classList.toggle("exo-player", want);
  }

  /* Element <video> nie bierze udziału w obrazie systemowym: gasimy go, żeby żaden
     dekoder nie został w tle i żeby drogi MSE/HLS zaczynały od zera. */
  function clearVideoQuietly() {
    var video = $("video");
    if (!video) return;
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch (error) { /* element bez źródła nie może zatrzymać kanału */ }
  }

  /* Pauza, wznowienie i wyciszenie obrazu systemowego — most przyjmuje sam stan. */
  function exoPlay(playing) {
    var bridge = exoBridge();
    if (!bridge || typeof bridge.setNativePlaying !== "function") return;
    try { bridge.setNativePlaying(playing !== false); } catch (error) { /* most milczy */ }
  }

  function exoVolume(muted) {
    var bridge = exoBridge();
    if (!bridge || typeof bridge.setNativeMuted !== "function") return;
    try { bridge.setNativeMuted(muted === true); } catch (error) { /* most milczy */ }
  }

  /* ---- wspólne dla obu silników odbiornika (ExoPlayer i VLC) ----

     Pasek odtwarzacza, pauza i wyciszenie pytają o obraz, którego nie ma
     w elemencie <video> — obojętnie, który silnik go rysuje (patrz state.exoPlaying
     i state.vlcPlaying). Dzięki temu reszta kodu pyta o jedno, a nie o dwa. */
  function nativeLayerActive() {
    return exoActive() || vlcActive();
  }

  function nativePlaying() {
    return vlcActive() ? !!state.vlcPlaying : !!state.exoPlaying;
  }

  function nativeSetPlaying(playing) {
    if (vlcActive()) {
      state.vlcPlaying = playing !== false;
      vlcPlay(playing);
      return;
    }
    state.exoPlaying = playing !== false;
    exoPlay(playing);
  }

  function nativeMuted() {
    return vlcActive() ? !!state.vlcMuted : !!state.exoMuted;
  }

  function nativeSetMuted(muted) {
    if (vlcActive()) {
      state.vlcMuted = muted === true;
      vlcVolume(state.vlcMuted);
      return;
    }
    state.exoMuted = muted === true;
    exoVolume(state.exoMuted);
  }

  function startExoSource(entry) {
    var bridge = exoBridge();
    var token = nextEngineToken();
    state.engine = "exo";
    state.engineLoading = true;
    state.exoPlaying = false;
    state.exoWidth = 0;
    state.exoHeight = 0;
    state.exoPictureWaited = false;
    state.engineInstance = {
      kind: "exo",
      close: function () { stopExo(); }
    };
    if (!bridge) {
      /* Most zniknął w trakcie (albo go tu nie ma) — kolejka idzie dalej. */
      handlePlaybackError(t("err_stream") + " (" + engineName("exo") + ")");
      return;
    }
    clearVideoQuietly();
    markExoMode(true);
    var result = "";
    try {
      /* Identyfikator przeglądarki wysyłamy ten sam, którym posługuje się strona:
         dostawcy potrafią po nim filtrować dostęp do kanału. */
      result = String(bridge.playNative(entry.url, navigator.userAgent || ""));
    } catch (error) {
      result = "error: " + error.message;
    }
    if (result !== "ok") {
      handlePlaybackError(t("err_stream") + " (" + engineName("exo") + ": " + result + ")");
      return;
    }
    /* Wyciszenie jest stanem tej sesji — nowy obraz musi je dostać od razu. */
    if (state.exoMuted) exoVolume(true);
    diagNote(t("diag_exo_start"));
    armExoWatchdog(token, EXO_START_WAIT);
  }

  /* Zamknięcie obrazu systemowego: most gasi odtwarzacz, a strona wraca do
     zwykłego wyglądu (patrz destroyEngine → engineInstance.close). */
  function stopExo() {
    var bridge = exoBridge();
    if (bridge && typeof bridge.stopNative === "function") {
      try { bridge.stopNative(); } catch (error) { /* most już nie odpowiada */ }
    }
    markExoMode(false);
    state.exoPlaying = false;
  }

  /* Zdarzenia z odtwarzacza systemowego (MainActivity -> emitNative). Trzymają ten
     sam stan, co zdarzenia <video> na innych drogach: bez tego pasek, budziki
     i panel diagnostyki nie wiedziałyby, że obraz naprawdę leci. */
  function exoEvent(event) {
    if (!exoActive() || !state.watchChannel) return;
    var type = event && event.type;
    if (type === "size") {
      state.exoWidth = event.width | 0;
      state.exoHeight = event.height | 0;
      noteStreamActivity();
      return;
    }
    if (type === "playing") {
      state.engineLoading = false;
      state.exoPlaying = true;
      clearStartWatchdog();
      noteStreamActivity();
      var error = $("playerError");
      if (error) error.classList.add("hidden");
      /* od tego momentu liczy się czas oglądania dla „Ostatnio oglądane” */
      state.watchStart = state.watchStart || Date.now();
      scheduleRecentRecord();
      updateOsd();
      scheduleOsdHide();
      return;
    }
    if (type === "paused") {
      state.exoPlaying = false;
      updateOsd();
      return;
    }
    if (type === "buffering" || type === "ended") return;
    if (type === "error") {
      handlePlaybackError(t("err_stream") + " (" + engineName("exo") +
        (event.message ? ": " + String(event.message).slice(0, 120) : "") + ")");
    }
  }
  window.__openiptvNativeEvent = exoEvent;

  /* Budzik drogi natywnej: brak obrazu musi oddać kanał kolejce, a nie zostawić
     czarny ekran. Dwa pytania i oba rozstrzyga most:
       • czy cokolwiek ruszyło (po EXO_START_WAIT),
       • czy razem z dźwiękiem są klatki (po EXO_PICTURE_WAIT) — dekoder potrafi
         oddać sam dźwięk, tak jak na drodze MSE. */
  function armExoWatchdog(token, delay) {
    clearStartWatchdog();
    state.startTimer = setTimeout(function () {
      state.startTimer = null;
      if (!state.watchChannel || state.engineToken !== token || !exoActive()) return;
      if (!state.exoPlaying) {
        handlePlaybackError(t("err_stream") + " (" + engineName("exo") + ")");
        return;
      }
      if (state.exoWidth > 0) return;
      if (!state.exoPictureWaited) {
        state.exoPictureWaited = true;
        armExoWatchdog(token, EXO_PICTURE_WAIT);
        return;
      }
      handlePlaybackError(t("err_stream") + " (" + engineName("exo") + ": " + t("err_no_picture") + ")");
    }, delay || EXO_START_WAIT);
  }

  /* ==============  ODTWARZACZ VLC (Android: libVLC)  ==============

     Trzecia droga obrazu (patrz VlcEngine w projekcie Androida): ten sam pomysł,
     co odtwarzacz systemowy, ale inny silnik — libVLC ma własny demukser TS/HLS
     i oddaje obraz przez TextureView, czyli tą samą drogą, którą idą klatki
     pozostałych odtwarzaczy. Włączany jest ręcznie („Odtwarzacz VLC (beta)”)
     i tylko dla kanału NA ŻYWO, żeby droga testowa nie mogła zaszkodzić temu, co
     działa; gdy nie da obrazu, kolejka prób idzie dalej jak dotąd. */

  var VLC_START_WAIT = 9000;         /* ile czekamy, aż obraz VLC ruszy */
  var VLC_PICTURE_WAIT = 6000;       /* dźwięk gra, a klatek nie ma */

  /* Most do silnika VLC: jest tylko w aplikacji na Androidzie i tylko wtedy, gdy
     w paczce są biblioteki dla architektury tego odbiornika (patrz VlcEngine). */
  function vlcBridge() {
    try {
      if (!platformInfo.native) return null;
      var bridge = window.OpenIptvNative;
      if (!bridge || typeof bridge.playVlc !== "function") return null;
      return bridge;
    } catch (error) {
      return null;
    }
  }

  /* Co silnik VLC widzi w strumieniu — panel diagnostyki pokazuje to obok drogi
     systemowej (patrz diagCodecLines). Bez mostu nie ma czego pokazywać. */
  function vlcInfo() {
    var bridge = vlcBridge();
    if (!bridge || typeof bridge.vlcInfo !== "function") return null;
    try {
      var info = JSON.parse(String(bridge.vlcInfo() || ""));
      return info && info.libvlc ? info : null;
    } catch (error) {
      return null;
    }
  }

  /* Bitrate z VLC (demuxBitrate) jest w kb/s — pokazujemy go w Mb/s, bo tak mówi
     się o kanałach. Brak liczby to „brak”, a nie zero: silnik, który jeszcze nic
     nie odebrał, nie ma czego pokazać (patrz readStats w VlcEngine). */
  function vlcBitrate(kbps) {
    var value = kbps | 0;
    if (value <= 0) return t("diag_none");
    return (Math.round(value / 100) / 10) + " Mb/s";
  }

  /* Klatki na sekundę z silnika VLC. VLC nie zawsze oddaje swoje liczniki, więc
     brak liczby mówimy wprost („nie liczone”) — brak liczby nie jest dowodem, że
     obraz stoi (patrz countFrames w VlcEngine). */
  function vlcFps(vlc) {
    if (!vlc || !vlc.sawFrames || !(vlc.fps >= 0)) return t("diag_vlc_nofps");
    return (vlc.fps | 0) + "/s" + (vlc.stalled ? " (" + t("diag_stall") + ")" : "");
  }

  /* Czy obraz w tej próbie rysuje VLC (a nie element <video>). */
  function vlcActive() {
    return state.engine === "vlc";
  }

  /* Pauza, wznowienie i wyciszenie obrazu VLC — most przyjmuje sam stan. */
  function vlcPlay(playing) {
    var bridge = vlcBridge();
    if (!bridge || typeof bridge.setVlcPlaying !== "function") return;
    try { bridge.setVlcPlaying(playing !== false); } catch (error) { /* most milczy */ }
  }

  function vlcVolume(muted) {
    var bridge = vlcBridge();
    if (!bridge || typeof bridge.setVlcMuted !== "function") return;
    try { bridge.setVlcMuted(muted === true); } catch (error) { /* most milczy */ }
  }

  /* Przewijanie obrazu VLC (nagranie — patrz seekBy, seekArchiveHardware). Most
     przyjmuje pozycję w milisekundach, czyli w tej samej jednostce, w jakiej
     silnik donosi ją zdarzeniem (patrz emitClock w VlcEngine). Zwracamy false,
     gdy mostu nie ma — wtedy nagrania nie ma po czym przewijać i wołający
     zostaje przy zmianie okna catch-up. */
  function vlcSeek(ms) {
    var bridge = vlcBridge();
    if (!bridge || typeof bridge.setVlcTime !== "function") return false;
    var target = Math.max(0, Math.round(ms));
    try {
      bridge.setVlcTime(target);
    } catch (error) {
      return false;
    }
    /* Pasek ma ruszyć od razu, a nie dopiero po zdarzeniu z silnika: ono przychodzi
       co ćwierć sekundy i przy skoku o krok widać byłoby zwłokę. */
    state.vlcTime = target;
    return true;
  }

  /* Start kanału silnikiem VLC. Adres idzie do mostu razem z identyfikatorem
     przeglądarki (dostawcy potrafią po nim filtrować dostęp do kanału) i z drogą
     obrazu z ustawień — tym, co na telewizorze porównujemy. */
  function startVlcSource(entry) {
    var bridge = vlcBridge();
    var token = nextEngineToken();
    state.engine = "vlc";
    state.engineLoading = true;
    state.vlcPlaying = false;
    state.vlcWidth = 0;
    state.vlcHeight = 0;
    state.vlcFirstFrame = false;
    state.vlcPictureWaited = false;
    state.vlcStalled = false;
    state.engineInstance = {
      kind: "vlc",
      close: function () { stopVlc(); }
    };
    if (!bridge) {
      /* Most zniknął w trakcie (albo go tu nie ma) — kolejka idzie dalej. */
      handlePlaybackError(t("err_stream") + " (" + engineName("vlc") + ")");
      return;
    }
    clearVideoQuietly();
    markExoMode(true);
    var result = "";
    try {
      result = String(bridge.playVlc(entry.url, navigator.userAgent || "", settings.vlcTexture !== false));
    } catch (error) {
      result = "error: " + error.message;
    }
    if (result !== "ok") {
      handlePlaybackError(t("err_stream") + " (" + engineName("vlc") + ": " + result + ")");
      return;
    }
    /* Wyciszenie jest stanem tej sesji — nowy obraz musi je dostać od razu. */
    if (state.vlcMuted) vlcVolume(true);
    diagNote(t("diag_vlc_start"));
    armVlcWatchdog(token, VLC_START_WAIT);
  }

  /* Zamknięcie obrazu VLC: most gasi silnik, a strona wraca do zwykłego wyglądu
     (patrz destroyEngine → engineInstance.close). */
  function stopVlc() {
    var bridge = vlcBridge();
    if (bridge && typeof bridge.stopVlc === "function") {
      try { bridge.stopVlc(); } catch (error) { /* most już nie odpowiada */ }
    }
    markExoMode(false);
    state.vlcPlaying = false;
    /* zegar silnika dotyczył zamkniętego obrazu — nowy kanał liczy go od zera
       (patrz playChannel) */
    state.vlcTime = 0;
    state.vlcLength = 0;
  }

  /* Zdarzenia z silnika VLC (VlcEngine → emitVlc). Trzymają ten sam stan, co
     zdarzenia <video> i drogi systemowej: bez tego pasek, budziki i panel
     diagnostyki nie wiedziałyby, że obraz naprawdę leci. */
  function vlcEvent(event) {
    if (!vlcActive() || !state.watchChannel) return;
    var type = event && event.type;
    /* Zegar silnika: pozycja obrazu i długość okna nagrania. Pasek odtwarzania
       i skok o krok (⏪/⏩) czytają je stąd, bo obraz VLC nie ma elementu <video>
       (patrz updateOsdProgress, seekBy). Silnik, który długości nie zna (kanał na
       żywo), zostawia vlcLength w spokoju — zero znaczy „nie ma po czym skakać”. */
    if (type === "time") {
      state.vlcTime = Math.max(0, event.time | 0);
      if ((event.length | 0) > 0) state.vlcLength = event.length | 0;
      return;
    }
    if (type === "size") {
      state.vlcWidth = event.width | 0;
      state.vlcHeight = event.height | 0;
      /* klatka doszła na obraz — dokładnie to, czego brakuje przy samym dźwięku */
      if (state.vlcWidth > 0) state.vlcFirstFrame = true;
      noteStreamActivity();
      return;
    }
    if (type === "stalled") {
      /* obraz stanął: klatki przestały dochodzić, a silnik dalej twierdzi, że gra.
         Kanał wraca do kolejki, zamiast trzymać jedną klatkę na ekranie przez
         resztę meczu (patrz countFrames w VlcEngine). */
      state.vlcStalled = true;
      diagNote(t("diag_stall"));
      handlePlaybackError(t("err_stream") + " (" + engineName("vlc") + ": " + t("diag_stall") + ")");
      return;
    }
    if (type === "playing") {
      state.engineLoading = false;
      state.vlcPlaying = true;
      clearStartWatchdog();
      noteStreamActivity();
      var error = $("playerError");
      if (error) error.classList.add("hidden");
      /* od tego momentu liczy się czas oglądania dla „Ostatnio oglądane” */
      state.watchStart = state.watchStart || Date.now();
      scheduleRecentRecord();
      updateOsd();
      scheduleOsdHide();
      return;
    }
    if (type === "paused") {
      state.vlcPlaying = false;
      updateOsd();
      return;
    }
    if (type === "buffering" || type === "ended" || type === "stopped") return;
    if (type === "error") {
      handlePlaybackError(t("err_stream") + " (" + engineName("vlc") +
        (event.message ? ": " + String(event.message).slice(0, 120) : "") + ")");
    }
  }
  window.__openiptvVlcEvent = vlcEvent;

  /* Budzik drogi VLC: brak obrazu musi oddać kanał kolejce, a nie zostawić czarny
     ekran. Pytamy o to samo, co przy odtwarzaczu systemowym: czy cokolwiek ruszyło
     i czy razem z dźwiękiem doszła jakakolwiek klatka (patrz armExoWatchdog). */
  function armVlcWatchdog(token, delay) {
    clearStartWatchdog();
    state.startTimer = setTimeout(function () {
      state.startTimer = null;
      if (!state.watchChannel || state.engineToken !== token || !vlcActive()) return;
      if (!state.vlcPlaying) {
        handlePlaybackError(t("err_stream") + " (" + engineName("vlc") + ")");
        return;
      }
      if (state.vlcFirstFrame || state.vlcWidth > 0) return;
      if (!state.vlcPictureWaited) {
        state.vlcPictureWaited = true;
        armVlcWatchdog(token, VLC_PICTURE_WAIT);
        return;
      }
      handlePlaybackError(t("err_stream") + " (" + engineName("vlc") + ": " + t("err_no_picture") + ")");
    }, delay || VLC_START_WAIT);
  }

  /* Kolejka prób dla kanału. Na Androidzie drogi sprzętowe (VLC i odtwarzacz
     systemowy) stoją przed odtwarzaczem sprzętowym strony, a za nim są MSE i HLS. */
  function buildSourceQueue(primaryUrl) {
    /* Drogi sprzętowe bierzemy tylko tam, gdzie most istnieje (Android) i gdzie
       użytkownik włączył przełącznik w ustawieniach. Gdy włączone są oba, kanał
       dostaje VLC — to on jest drogą dla strumieni, na których dekoder odbiornika
       nie wyrabia (patrz startVlcSource, startExoSource). */
    var hardware = [];
    if (settings.vlcPlayer === true && vlcBridge()) {
      hardware.push({ engine: "vlc", url: primaryUrl });
    }
    if (settings.nativePlayer === true && exoBridge()) {
      hardware.push({ engine: "exo", url: primaryUrl });
    }

    var browser = [];
    browser.push({ engine: "native", url: primaryUrl });
    var bare = String(primaryUrl || "").split("#")[0].split("?")[0].toLowerCase();
    var extension = bare.indexOf(".") >= 0 ? bare.substring(bare.lastIndexOf(".") + 1) : "";
    var tsLike =
      !extension ||
      extension === "ts" || extension === "mpegts" || extension === "mts" ||
      extension === "php" || extension === "m3u";
    if (extension === "m3u8") {
      browser.push({ engine: "hls", url: primaryUrl });
      /* Ostatnia deska ratunku dla kanału 4K HEVC: playlistę czyta własny czytnik,
         a strumień rozbiera mpegts.js (patrz createHlsTsLoader). hls.js takiego
         kodeka nie ruszy, a <video> nie czyta playlisty wcale — bez tego wpisu
         kolejka kończyła się na samym dźwięku. Ten wpis zostaje na końcu kolejki
         także dla zapamiętanego silnika (patrz preferEngine). */
      browser.push({ engine: "mse", url: primaryUrl, hls: true });
    } else if (tsLike) {
      browser.push({ engine: "mse", url: primaryUrl });
    }

    /* ten sam kanał jako HLS — najczęstsza deska ratunku na telewizorach */
    var hlsUrl = primaryUrl.replace(/\.ts(\?.*)?$/i, ".m3u8$1");
    if (hlsUrl !== primaryUrl) {
      browser.push({ engine: "native", url: hlsUrl });
      browser.push({ engine: "hls", url: hlsUrl });
    }

    /* Drogi sprzętowe stają na CZELE kolejki — i na kanale na żywo, i w nagraniu
       z archiwum. Powód jest jeden: to one mają najwięcej szans z materiałem,
       którego przeglądarka nie rozbierze (<video> nie czyta MPEG-TS, a MSE na 4K
       HEVC gubi obraz — patrz startMseSource), a w archiwum dodatkowo znają
       własny zegar, więc przewijanie nagrania idzie u nich natychmiast (patrz
       seekBy, seekArchiveHardware). Reszta zostaje w kolejce jako automatyczne
       zapasy: gdy silnik nie da obrazu, nextSourceEntry() sam przechodzi do
       następnej drogi — nie trzeba nic zaznaczać w ustawieniach ani przestawiać
       ręcznie. */
    if (!hardware.length) return preferEngine(browser, settings.engineHint);
    return preferEngine(hardware.concat(browser), settings.engineHint);
  }

  /* Zapamiętany sposób odtwarzania idzie na początek kolejki. Jeśli telewizor
     oddaje przez natywny dekoder sam dźwięk, a obraz pojawia się dopiero przez
     MSE albo HLS, nie ma sensu kazać użytkownikowi czekać na to samo przy
     każdym kanale. Pozostałe wpisy zostają w kolejce, więc gdy zapamiętany
     sposób zawiedzie (np. inny kodek), przejście dalej działa jak dotąd.

     Warunek „ten sam adres” jest tu istotny: zapasowy HLS („kanał.ts” →
     „kanał.m3u8”) to inny strumień — nie wiadomo, czy w ogóle istnieje i co
     nadaje, a kanał 4K potrafi w nim trafić na HEVC, którego hls.js nie
     rozbierze. Pamięć po innym kanale nie może więc wypychać go przed adres,
     który dla tego kanału naprawdę działa.

     Wyjątkiem jest czytnik playlisty (wpis z „hls: true”): on zostaje tam,
     gdzie go postawiono, czyli na końcu kolejki — patrz niżej. */
  function preferEngine(queue, hint) {
    if (hint !== "mse" && hint !== "hls") return queue;
    /* Droga sprzętowa (VLC albo odtwarzacz systemowy) zostaje na czele kolejki:
       to nie jest „sposób odtwarzania”, który można zapamiętać i przeskoczyć —
       a gdy nie da obrazu, kolejka idzie dalej jak dotąd (patrz buildSourceQueue). */
    if (queue[0] && (queue[0].engine === "exo" || queue[0].engine === "vlc")) return queue;
    for (var i = 1; i < queue.length; i++) {
      /* Czytnik playlisty (wpis z „hls: true”) zostaje na końcu kolejki. Z
         nazwy wygląda jak zwykłe MSE, więc zapamiętany MSE wybierał właśnie
         jego — ale to zupełnie inna droga: sam pobiera odcinki playlisty i
         trzyma kilkanaście sekund obrazu przed odtwarzaniem. Kanał nadawany
         zwykłym strumieniem gra lepiej natywnie albo przez HLS, a dla kanału
         z playlisty ta próba i tak jest ostatnia — dzięki temu zapamiętany
         sposób odtwarzania nie ciągnie do czytnika każdego kanału z playlisty
         (także tych HD, które nie mają z HEVC nic wspólnego). */
      if (queue[i].hls) continue;
      if (queue[i].engine === hint && queue[i].url === queue[0].url) {
        var entry = queue.splice(i, 1)[0];
        queue.unshift(entry);
        break;
      }
    }
    return queue;
  }

  function startSourceEntry(entry) {
    if (!entry || !state.watchChannel) return;
    /* Nowy token na każdą próbę: unieważnia spóźnione wczytanie biblioteki
       (albo odpowiedź MSE) z wpisu, który już porzuciliśmy. */
    nextEngineToken();
    state.currentSource = entry.url;
    state.engine = entry.engine;
    state.pictureRetried = false;
    /* nowa próba: czas jej trwania, ruch strumienia i czas dźwięku bez obrazu
       liczą się od zera — budziki patrzą na to, czy kanał naprawdę się wczytuje
       (patrz streamStillComing), więc bez tego liczyłyby ciszę po poprzedniej
       próbie, a twardy budzik obrazu (AUDIO_ONLY_TIMEOUT) dostałby od razu
       cudzy czas dźwięku */
    state.entryWaitStart = Date.now();
    state.lastActivityAt = Date.now();
    state.audioStartedAt = 0;
    /* czy ten wpis czyta playlistę własnym czytnikiem HLS→TS — panel
       diagnostyki pokazuje to wprost (patrz diagStreamLines) */
    state.engineFeeder = !!(entry.engine === "mse" && entry.hls);
    /* Kondycję obrazu (zrywy i odrzucone klatki) pilnuje tylko droga MSE na żywo: to
       ona ma własny bufor i własną pamięć do zwolnienia (patrz guardTick). */
    if (entry.engine === "mse" && !state.watchProgram) startGuard();
    else stopGuard();
    if (entry.engine === "vlc") startVlcSource(entry);
    else if (entry.engine === "exo") startExoSource(entry);
    else if (entry.engine === "mse") startMseSource(entry);
    else if (entry.engine === "hls") startHlsSource(entry);
    else playSource(entry.url);
    /* Budziki uzbrajamy PO starcie silnika: MSE i HLS tworzą w środku własny
       token (unieważniają poprzednie wczytywanie), więc token wzięty wcześniej
       nigdy by się nie zgadzał i budzik nie zadziałałby wcale — a to właśnie on
       ratuje czarny obraz. Droga natywna pilnuje się sama (patrz armExoWatchdog):
       jej obrazu nie ma w elemencie <video>, więc te budziki widziałyby tylko
       czarny ekran i ucięłyby kanał w połowie wczytywania. */
    var token = state.engineToken;
    if (entry.engine !== "exo" && entry.engine !== "vlc") {
      armStartWatchdog(token);
      armPictureWatchdog(token);
    }
    /* który sposób odtwarzania właśnie startuje — w panelu diagnostyki widać
       wtedy całe przejście kolejki (natywnie → HLS → MSE), a nie tylko stan,
       na którym kanał się zatrzymał */
    diagNote(t("diag_engine_start", {
      engine: engineName(entry.engine) + (state.engineFeeder ? " (" + t("diag_feeder") + ")" : ""),
      n: (state.sourceIndex | 0) + 1,
      total: state.sources.length
    }));
  }

  /* Nie każdy telewizor zgłasza błąd odtwarzania — czasem <video> po prostu
     „wisi” na czarnym ekranie. Ten budzik pilnuje, żeby brak obrazu w ciągu
     START_TIMEOUT ms przełączył kolejkę na następny sposób odtwarzania. */
  function armStartWatchdog(token) {
    clearTimeout(state.startTimer);
    if (typeof token !== "number") token = state.engineToken;
    state.startTimer = setTimeout(function () {
      state.startTimer = null;
      if (!state.watchChannel || state.engineToken !== token) return;
      /* Kanał, który wciąż dociąga dane, nie jest zepsuty — tylko wolny.
         Bez tego 4K był ucinany w połowie wczytywania i startował od nowa. */
      if (streamStillComing()) { armStartWatchdog(token); return; }
      var video = $("video");
      if (video && video.readyState >= 2 && !video.paused) {
        /* Dźwięk już leci, więc zwykły budzik uznałby odtwarzanie za udane.
           Sprawdzamy, czy jest także obraz — i jeśli nie, oddajemy sprawę
           budzikowi obrazu (jest już uzbrojony, patrz armPictureWatchdog). */
        if (videoHasPicture(video)) return;
        armPictureWatchdog(token);
        return;
      }
      nextSourceEntry(t("err_stream") + " (" + t("osd_buffering") + ")", 0);
    }, START_TIMEOUT);
  }

  /* Ile ms odtwarzania bez ani jednej klatki uznajemy za zablokowany dekoder. */
  var PICTURE_TIMEOUT = 6000;

  /* Kanał z playlisty dostaje własne, dłuższe budżety na pierwsze klatki: czytnik
     (patrz createHlsTsLoader) musi najpierw pobrać dwa odcinki, a przy 4K HEVC to
     kilka megabajtów i start ciężkiego dekodera. Sześć sekund ucinało taki kanał
     w połowie wczytywania, a ponieważ to ostatnia droga do obrazu, po wyczerpaniu
     kolejki zostawał komunikat, że kanału nie da się odtworzyć. Inna jest też
     cisza w strumieniu: o tym, czy odcinek przyszedł, mówi sam czytnik
     (patrz streamStillComing). */
  var FEEDER_PICTURE_TIMEOUT = 20000;
  var FEEDER_AUDIO_ONLY_TIMEOUT = 20000;
  var FEEDER_STREAM_STALL = 15000;

  /* Twardy budżet dla przypadku „dźwięk gra, a obrazu nie ma ANI JEDNEJ klatki”.
     To nie jest wolne wczytywanie: dekoder już odtwarza strumień, tylko obrazu
     nie oddaje — na kanale 4K HEVC dźwięk grał tak bez końca (80 s nic nie
     zmieniło). Czas liczy się od startu dźwięku w tej próbie i ruch w strumieniu
     go NIE przedłuża, bo dociąganie danych przy czarnym ekranie nic tu nie
     zmieni (patrz armPictureWatchdog). */
  var AUDIO_ONLY_TIMEOUT = 8000;

  /* Budżety jednej próby. Kanał czytany z playlisty ma je dłuższe, bo jego obraz
     dopiero się pobiera (patrz FEEDER_PICTURE_TIMEOUT) — a to jedyna droga do
     obrazu dla takiego kanału, więc nie wolno jej uciąć jak zwykłego HD. */
  function pictureTimeout() {
    return state.engineFeeder ? FEEDER_PICTURE_TIMEOUT : PICTURE_TIMEOUT;
  }

  function audioOnlyTimeout() {
    return state.engineFeeder ? FEEDER_AUDIO_ONLY_TIMEOUT : AUDIO_ONLY_TIMEOUT;
  }

  /* Jedna próba dostaje więcej czasu niż PICTURE_TIMEOUT, gdy wiadomo, że
     strumień jest „ciężki” albo dopiero się łączy:

       • 4K / HEVC — dekoder składa dużo większą klatkę, start trwa najdłużej,
       • brak metadanych — kanał jeszcze się łączy (wolny serwer, duży bufor),
       • SD / HD    — po PICTURE_TIMEOUT dłuższe czekanie nic już nie zmieni.

     Każdy z tych czasów obowiązuje tylko dopóki coś naprawdę przychodzi
     (patrz streamStillComing) — martwy kanał leci dalej od razu. */
  var CONNECT_WAIT = 45000;
  var UHD_WAIT = 30000;
  /* tyle ciszy w strumieniu znaczy, że kanał stanął i szkoda na niego czasu */
  var STREAM_STALL = 6000;

  /* Rozdzielczość znamy od „loadedmetadata” — wymiary klatki to jedyny ślad,
     że to naprawdę 4K (ustawienia strumienia w playliście bywają nieprawdziwe). */
  function videoIsUhd() {
    /* obraz systemowy i VLC nie mają elementu <video> — rozdzielczość klatki
       przychodzi z mostu (patrz exoEvent i vlcEvent) */
    if (state.engine === "exo") {
      return (state.exoHeight | 0) >= 1440 || (state.exoWidth | 0) >= 2560;
    }
    if (state.engine === "vlc") {
      return (state.vlcHeight | 0) >= 1440 || (state.vlcWidth | 0) >= 2560;
    }
    var video = $("video");
    if (!video) return false;
    return (video.videoHeight | 0) >= 1440 || (video.videoWidth | 0) >= 2560;
  }

  /* To samo, ale z manifestu HLS: przy 4K HEVC dekoder potrafi oddać sam dźwięk,
     więc wymiarów klatki nie ma wcale, a wysokość poziomu mówi o 4K od razu
     (patrz noteUhd). */
  function manifestIsUhd(data) {
    var levels = (data && data.levels) || [];
    for (var i = 0; i < levels.length; i++) {
      if ((levels[i].height | 0) >= 1440 || (levels[i].width | 0) >= 2560) return true;
    }
    return false;
  }

  /* Nazwa kanału to jedyna informacja o rozdzielczości, jaką mamy PRZED startem
     odtwarzania — a właśnie wtedy trzeba wiedzieć, że wymuszona warstwa obrazu
     zostawia kanał 4K na czarnym ekranie (patrz noteUhd). */
  function channelNameIsUhd(name) {
    return /(4k|uhd|2160)/i.test(String(name || ""));
  }

  /* Kanał 4K rozpoznany z nazwy traktujemy jak rozpoznany od razu: zdejmujemy
     wymuszoną warstwę obrazu jeszcze przed pierwszym sposobem odtwarzania.
     Bez tego 4K wychodziło dopiero z metadanych klatki i przeładowywało kanał na
     świeżym elemencie — a na kanale z playlisty to przeładowanie kosztowało
     ponowne pobranie odcinków i kończyło się „brakiem obrazu” (patrz noteUhd). */
  function markUhdChannel() {
    state.uhdSeen = true;
    if (applyVideoLayerFix(false)) diagNote(t("diag_uhd_note"));
  }

  /* Kanał okazał się 4K (metadane klatki albo manifest HLS — patrz videoIsUhd,
     manifestIsUhd). Przy takim strumieniu wracamy do tego, jak grał, zanim
     aplikacja zaczęła się uczyć silników (preferEngine, applyVideoLayerFix):

       • zdejmujemy wymuszoną warstwę obrazu — przy 4K to ona zostawia czarny
         ekran (dekoder coś składa, ale obraz nie trafia na ekran),
       • brak obrazu zostawiamy kolejce prób: drogi sprzętowe (silnik VLC,
         odtwarzacz systemowy) stoją w niej na czele (patrz buildSourceQueue),
         a gdy któraś nie da obrazu, nextSourceEntry() sam przechodzi do
         następnej — bez przestawiania kolejki i bez kręcenia się w kółko.

     Klasę warstwy da się zdjąć tylko razem z elementem <video> — na gotowym
     dekoderze samo jej zdjęcie nie pomaga (patrz resetVideoElement) — a sposób
     odtwarzania, który już coś pokazuje, zostaje. Zwracamy true, gdy obraz jest
     już przeładowywany: wołający nie może wtedy nic więcej robić ze starym
     elementem. */
  function noteUhd() {
    state.uhdSeen = true;
    var hasPicture = videoHasPicture($("video"));
    var cleared = applyVideoLayerFix(false);
    /* obraz gra i warstwy nie było czego zdejmować — nie ma czego naprawiać */
    if (!cleared && hasPicture) return false;
    /* obraz już coś pokazuje, więc nie zmieniamy sposobu odtwarzania: kolejna
       próba tego samego wpisu kolejki, tylko na świeżym elemencie */
    if (hasPicture) {
      destroyEngine();
      retryCurrentEntry();
      return true;
    }
    /* obrazu nie ma, a warstwy obrazu nie było czego zdejmować — nie ma czego
       naprawiać: do następnej drogi przejdzie sama kolejka prób
       (patrz nextSourceEntry) */
    if (!cleared) return false;
    destroyEngine();
    retryCurrentEntry();
    return true;
  }

  function waitBudget() {
    /* 4K bywa rozpoznane, zanim pojawi się pierwsza klatka: z nazwy kanału
       (patrz markUhdChannel) albo z manifestu HLS (patrz noteUhd) */
    if (videoIsUhd() || state.uhdSeen) return UHD_WAIT;
    var video = $("video");
    if (!video || video.readyState < 1) return CONNECT_WAIT;
    return PICTURE_TIMEOUT;
  }

  /* Czy warto jeszcze czekać na tę próbę: musi coś przychodzić (dane albo
     kolejne etapy wczytywania) i nie może się skończyć czas przeznaczony na
     jedną próbę. Bez tego kanał 4K był restartowany co 6 s i nigdy nie zdążył
     pokazać obrazu — z obrazu robiło się „co chwila ładuje”. */
  function streamStillComing() {
    if (!state.entryWaitStart) return false;
    /* Cisza znaczy „kanał stanął”, ale u czytnika playlisty cisza w <video> nic
       nie znaczy: odcinki pobiera on sam i o ruchu mówi dopiero odebrany odcinek
       (patrz _pump, noteStreamActivity). Jego próbę przedłużamy więc do końca
       czasu przeznaczonego na wpis kolejki (patrz waitBudget). */
    var stall = state.engineFeeder ? FEEDER_STREAM_STALL : STREAM_STALL;
    if (Date.now() - state.lastActivityAt >= stall) return false;
    return Date.now() - state.entryWaitStart < waitBudget();
  }

  /* obraz to nie dźwięk: dopóki nie ma ani jednej klatki, <video> jest czarne.
     Wymiary klatki (videoWidth/videoHeight) to jedyny sygnał — stan odtwarzania
     i dźwięk są wtedy poprawny, więc po nich czarnego ekranu nie widać. */
  function videoHasPicture(video) {
    return !!video && (video.videoWidth | 0) > 0 && (video.videoHeight | 0) > 0;
  }

  /* Drugi budzik: dźwięk już gra, czekamy jeszcze chwilę na pierwszą klatkę.
     Bez tego kanał, którego dekoder oddaje tylko audio, zostawał czarny na
     zawsze — kolejka prób nie przechodziła dalej, bo <video> „grało”.

     Kolejność reakcji jest celowa:
       1. twardy budżet — dźwięk bez ANI JEDNEJ klatki przez audioOnlyTimeout()
          (patrz FEEDER_AUDIO_ONLY_TIMEOUT): koniec tej próby, bo taki kanał nie
          naprawi się samym czekaniem,
       2. kanał, który naprawdę coś jeszcze dociąga (albo dopiero się łączy),
          dostaje kolejny pictureTimeout() — bez tego wolny 4K był restartowany
          w połowie wczytywania,
       3. naprawa warstwy obrazu (Fire TV potrafi oddać sam dźwięk) i jedna
          powtórka tego samego strumienia — działa u większości telewizorów,
          a nie zmienia wybranego sposobu odtwarzania,
       4. dopiero potem następny wpis kolejki: to jedyna szansa, gdy dźwięk
          odtwarza dekoder sprzętowy, a obrazu nie potrafi (MSE dekoduje ten
          sam strumień inną drogą). */
  function armPictureWatchdog(token) {
    armPictureWatchdogIn(token, pictureTimeout());
  }

  /* Budzik obrazu z własnym odstępem — przy dźwięku bez obrazu nie ma po co
     czekać całego pictureTimeout(), gdy do twardego budżetu zostało mniej. */
  function armPictureWatchdogIn(token, delay) {
    clearPictureWatchdog();
    if (typeof token !== "number") token = state.engineToken;
    state.pictureTimer = setTimeout(function () {
      state.pictureTimer = null;
      if (!state.watchChannel || state.engineToken !== token) return;
      var video = $("video");
      /* klatka jest — budzik zdejmujemy i zapamiętujemy silnik, który ją dał */
      if (videoHasPicture(video)) { notePicture(); return; }
      /* Dźwięk gra (dekoder oddał już metadane) i od jak dawna: liczymy od
         zdarzenia „playing” w tej próbie, a gdy go nie było — od startu próby.
         Ruch w strumieniu tego czasu nie zeruje (patrz state.audioStartedAt) —
         dociąganie danych przy czarnym ekranie to nie wczytywanie obrazu. */
      var audioPlaying = !!video && video.readyState >= 2 && !video.paused;
      var audioSince = state.audioStartedAt || state.entryWaitStart || 0;
      var audioFor = audioSince ? Date.now() - audioSince : -1;
      /* 1. twardy budżet: dźwięk bez ani jednej klatki — następny sposób
         odtwarzania. Dekoder, który przez tyle sekund nie oddał ani jednej
         klatki, nie zrobi tego także później. */
      if (audioPlaying && audioFor >= audioOnlyTimeout()) {
        diagNote(t("diag_no_picture_advance", { s: Math.round(audioFor / 1000) }));
        nextSourceEntry(t("err_no_picture"), 0, false, 0, t("err_no_picture_hint"));
        return;
      }
      /* 2. strumień naprawdę coś dociąga — próbę przedłużamy, ale tylko do końca
         czasu przewidzianego dla jednego wpisu kolejki. */
      if (streamStillComing()) { armPictureWatchdogIn(token, pictureTimeout()); return; }
      /* 3. Warstwa obrazu pomaga dekoderom, które oddają sam dźwięk — ale przy 4K
         była to tylko niepotrzebna zmiana ciężkiego obrazu (a sama warstwa
         potrafi tam zostawić czarny ekran), więc kanał rozpoznany jako 4K od
         razu przechodzi do następnego sposobu odtwarzania (patrz noteUhd). */
      if (!state.pictureRetried && !videoIsUhd() && !state.uhdSeen && applyVideoLayerFix(true)) {
        state.pictureRetried = true;
        retryCurrentEntry(t("err_no_picture"));
        return;
      }
      /* 4. Dźwięk gra, ale do twardego budżetu jeszcze zostało (kanał dopiero co
         ruszył) — dobierzemy się do końca budżetu, a nie po PICTURE_TIMEOUT. */
      if (audioPlaying && audioSince > 0) {
        armPictureWatchdogIn(token, audioOnlyTimeout() - audioFor);
        return;
      }
      /* 5. Jedna runda po wszystkich sposobach odtwarzania wystarczy: powtarzanie
         tego samego dekodera na tym samym strumieniu nic nowego nie pokaże. */
      nextSourceEntry(t("err_no_picture"), 0, false, 0, t("err_no_picture_hint"));
    }, delay);
  }

  /* Powtórzenie TEGO SAMEGO wpisu kolejki (bez przesuwania się do następnego
     sposobu odtwarzania) — używane po zmianie w warstwie obrazu. */
  function retryCurrentEntry(message) {
    var entry = state.sources[state.sourceIndex];
    if (!entry) return;
    if (message) showPlayerError(message);
    clearTimeout(state.retryTimer);
    state.retryTimer = setTimeout(function () {
      state.retryTimer = null;
      if (!state.watchChannel) return;
      startSourceEntry(entry);
    }, 400);
  }

  function clearPictureWatchdog() {
    clearTimeout(state.pictureTimer);
    state.pictureTimer = null;
  }

  /* Pierwsza klatka obrazu = odtwarzanie naprawdę działa. Zdejmujemy wtedy
     budzik obrazu i zapamiętujemy sposób odtwarzania, który obraz przyniósł. */
  function notePicture() {
    if (!videoHasPicture($("video"))) return false;
    clearPictureWatchdog();
    rememberEngine(state.engine);
    return true;
  }

  /* Warstwa obrazu dla Androida, na którym gra sam dźwięk: WebView rysuje
     klatki w osobnej warstwie compositingu, więc wymuszamy ją jawnie. Zmiana
     jest nieszkodliwa dla dekoderów, które radzą sobie bez niej, ale stan
     zapisujemy w ustawieniach — inaczej ekran mrugałby przy każdym włączeniu
     aplikacji. Zwracamy true tylko wtedy, gdy naprawdę coś zmieniliśmy: dzięki
     temu budzik obrazu wie, czy jest sens powtarzać próbę. */
  function applyVideoLayerFix(on) {
    var want = on !== false;
    var changed = settings.videoLayerFix !== want;
    /* Klasę ustawiamy zawsze (także przy starcie aplikacji), a zapis i wynik
       „czy coś się zmieniło” tylko wtedy, gdy naprawdę zmieniamy stan. */
    if (document.body) document.body.classList.toggle("video-layer-fix", want);
    if (!changed) return false;
    settings.videoLayerFix = want;
    saveSettings();
    return true;
  }

  /* Udany sposób odtwarzania pamiętamy między kanałami (patrz preferEngine).
     Zapis jest odroczony, bo to zwykłe ustawienie — nie może zatrzymać obrazu. */
  function rememberEngine(engine) {
    var hint = engine === "mse" || engine === "hls" ? engine : "native";
    if (settings.engineHint === hint) return;
    settings.engineHint = hint;
    saveSettings();
  }

  function clearStartWatchdog() {
    clearTimeout(state.startTimer);
    state.startTimer = null;
  }

  /* Przejście do następnego sposobu odtwarzania. Po wyczerpaniu całej listy
     rusza kolejna runda prób (ustawienie „Próby ponownego uruchomienia”), więc
     kanał ma realną szansę podnieść się po chwilowym błędzie serwera.
     `maxCycles` ogranicza liczbę rund (używa go brak obrazu — patrz
     armPictureWatchdog — bo powtarzanie tego samego dekodera nic nie da),
     a `finalHint` to dodatkowe zdanie pokazywane dopiero na końcu, gdy kanału
     nie udało się uruchomić. */
  function nextSourceEntry(message, delay, silent, maxCycles, finalHint) {
    if (!state.watchChannel) return;

    /* Zanim stary sposób odtwarzania zostanie zamknięty, panel diagnostyki ma
       jeszcze co zbierać: element <video> pamięta wtedy stan, w którym dźwięk
       grał bez ani jednej klatki, a restart te liczby zeruje (patrz
       maybeAutoDiagnose — panel otwiera się wyłącznie w takiej sytuacji). */
    maybeAutoDiagnose(t("diag_auto"));

    /* Do dziennika panelu trafia też to, co kończy poprzednią próbę (brak obrazu,
       błąd strumienia) — restart silnika zacierał ten ślad i nie było widać,
       dlaczego kolejka poszła dalej. */
    if (!silent) {
      diagNote(t("diag_engine_fail", { reason: message || t("osd_buffering") }));
    }

    var attempts = parseInt(settings.retryAttempts, 10) || 0;
    var custom = typeof maxCycles === "number";
    var limit = custom ? maxCycles : attempts;

    state.sourceIndex++;
    if (state.sourceIndex >= state.sources.length) {
      state.sourceIndex = 0;
      state.cycle++;
    }
    if (state.cycle > limit) {
      var lines = [];
      if (message) lines.push(message);
      if (finalHint) lines.push(finalHint);
      /* Przy własnym limicie (brak obrazu) liczba „prób ponowienia” nic nie
         znaczy — jest jedna runda po sposobach odtwarzania. */
      if (!custom || limit > 0) {
        lines.push(attempts ? t("retry_fail", { total: attempts }) : t("retry_off"));
      }
      lines.push(t("back_hint"));
      showPlayerError(lines.join("\n"));
      /* Dźwięk bez obrazu nie jest odtwarzaniem. Po wyczerpaniu wszystkich
         sposobów gasimy silnik i zatrzymujemy obraz, żeby kanał nie grał dalej
         w tle pod komunikatem — a w komunikacie jest już powiedziane, co zrobić
         (pick HD). Sam element <video> zostaje, więc wznowienie klawiszem
         odtwarzania nadal działa. */
      diagNote(t("diag_giveup_audio"));
      destroyEngine();
      var stuck = $("video");
      if (stuck && !stuck.paused) {
        try { stuck.pause(); } catch (error) { /* stoi już zatrzymany */ }
      }
      return;
    }

    var entry = state.sources[state.sourceIndex];
    if (!entry) return;

    if (!silent) {
      var lines = [];
      if (message) lines.push(message);
      if (entry.engine === "mse" && entry.hls) lines.push(t("retry_engine_mse_hls"));
      else if (entry.engine === "mse") lines.push(t("retry_engine_mse"));
      else if (entry.engine === "hls") lines.push(t("retry_engine_hls"));
      else lines.push(t("osd_buffering"));
      if (state.cycle > 0) lines.push(t("retry_msg", { n: state.cycle, total: attempts }));
      showPlayerError(lines.join("\n"));
    }

    clearTimeout(state.retryTimer);
    state.retryTimer = setTimeout(function () {
      state.retryTimer = null;
      if (!state.watchChannel) return;
      startSourceEntry(entry);
    }, delay || 0);
  }

  /* ================  „OSTATNIO OGLĄDANE” (10 s / maks. 15 kanałów)  ================ */

  /* nowy kanał do obserwacji — licznik oglądania startuje od zera */
  function startRecentWatch(channel) {
    clearTimeout(state.recentTimer);
    state.recentTimer = null;
    state.recentChannel = channel || null;
    state.watchedMs = 0;
    state.watchStart = 0;
    state.recentRecorded = false;
  }

  /* dolicza realny czas odtwarzania (pauza i buforowanie się nie liczą) */
  function markWatchedTime() {
    if (state.recentChannel && state.watchStart) {
      state.watchedMs += Date.now() - state.watchStart;
      state.watchStart = 0;
    }
  }

  function scheduleRecentRecord() {
    if (!state.recentChannel || state.recentRecorded) return;
    clearTimeout(state.recentTimer);
    var left = Math.max(0, RECENT_DELAY - state.watchedMs);
    state.recentTimer = setTimeout(function () {
      if (!state.recentChannel || !state.currentSource) return;
      state.recentRecorded = true;
      addRecent(state.recentChannel);
    }, left);
  }

  /* wpis na początek listy, bez duplikatów i z limitem 15 pozycji —
     kanał, który wypadł poza 15 ostatnich, znika z tej listy */
  function addRecent(channel) {
    if (!channel) return;
    var recents = perProfile(settings.recentChannels);
    var key = keyOf(channel);
    var index = recents.indexOf(key);
    if (index >= 0) recents.splice(index, 1);
    recents.unshift(key);
    if (recents.length > RECENT_LIMIT) recents.splice(RECENT_LIMIT);
    saveSettings();
    state.recentDirty = true;
  }

  function playChannel(channel, program, returnScreen) {
    clearTimeout(state.retryTimer);
    clearTimeout(state.stableTimer);
    /* nowy kanał nie może dostać panelu diagnostyki z poprzedniej próby
       (patrz armDiagAuto / maybeAutoDiagnose) */
    clearTimeout(state.diagAutoTimer);
    state.diagAutoTimer = null;
    /* kanał trafi na listę „Ostatnio oglądane” dopiero po 10 s oglądania */
    startRecentWatch(channel);

    /* Ekran, do którego wraca „Wstecz” po wyjściu z obrazu. Akcje wykonywane
       wewnątrz odtwarzacza (następny program, „od początku”, „na żywo”,
       wznowienie) podają jako cel playerScreen — to nie jest miejsce, do
       którego można wrócić po zatrzymaniu kanału: nie ma tam już czego
       odtwarzać i zostawał czarny prostokąt bez obrazu i bez paska.
       Dlatego taki cel zachowuje poprzednią wartość (lista kanałów). */
    if (returnScreen && returnScreen !== "playerScreen") state.playerReturn = returnScreen;
    else if (!state.playerReturn) state.playerReturn = "browserScreen";
    state.isArchive = !!program;
    state.retryCount = 0;
    state.cycle = 0;
    /* nowy kanał: rozdzielczość liczy się od zera */
    state.uhdSeen = false;
    /* Kondycja obrazu liczy się przy tym kanale od zera: zrywy i odświeżenia
       strumienia z poprzedniego obrazu nie mogą tu nic znaczyć (patrz guardTick). */
    state.guardStalls = 0;
    state.guardDroppedSum = 0;
    state.guardDroppedBase = 0;
    state.guardRecycles = 0;
    state.guardGaveUp = false;
    stopGuard();
    /* obraz systemowy i VLC też liczą się od zera: stan z poprzedniego kanału (czy
       leciał, jaką miał klatkę) nie może opisywać nowego (patrz startExoSource
       i startVlcSource) */
    state.exoPlaying = false;
    state.exoWidth = 0;
    state.exoHeight = 0;
    state.exoPictureWaited = false;
    state.vlcPlaying = false;
    state.vlcWidth = 0;
    state.vlcHeight = 0;
    state.vlcFirstFrame = false;
    state.vlcPictureWaited = false;
    state.vlcStalled = false;
    /* zegar obrazu VLC: pozycja i długość okna poprzedniego kanału nie mogą
       opisywać nowego (patrz vlcEvent, seekBy, updateOsdProgress) */
    state.vlcTime = 0;
    state.vlcLength = 0;
    markExoMode(false);
    /* nazwa kanału mówi wprost, że to 4K — rozpoznajemy to przed startem
       odtwarzania, żeby wymuszona warstwa obrazu nie zdążyła wejść kanałowi
       w drogę (patrz markUhdChannel) */
    if (channelNameIsUhd(channel.name)) markUhdChannel();
    /* nowy kanał = nowa szansa na świeżą diagnozę obrazu (patrz maybeAutoDiagnose) */
    state.diagAutoShown = false;
    state.sourceIndex = -1;          /* -1 → pierwszy wpis wybierze nextSourceEntry() */
    state.watchChannel = channel;
    state.watchProgram = program || null;
    /* nowy kanał (albo nowe okno archiwum) = poprzednia pauza na żywo nie
       obowiązuje — inaczej „wznów” wróciłoby do starego kanału */
    state.livePauseAt = 0;
    state.lastErrorAt = 0;
    /* nowy obraz nie jest przewinięciem: kasujemy wpis o poprzednim skoku, żeby
       „waiting” przy wczytywaniu nie pokazał go na cudzym kanale */
    clearSeekMark();
    destroyEngine();

    var source;
    try {
      source = program
        ? buildCatchupUrl(channel, program.start, Math.min(program.end, Date.now()))
        : channel.streamUrl;
    } catch (error) {
      alert(error.message);
      return;
    }
    source = String(source).split("|")[0];
    /* kolejka prób: silnik (VLC / systemowy) → natywnie → MSE → HLS */
    state.sources = buildSourceQueue(source);

    showScreen("playerScreen");
    $("playerError").classList.add("hidden");
    /* klawisze ⏵‖ / ⏹ pilota: system kieruje je do sesji multimediów */
    bindMediaSession();
    var badge = $("playerBadge");
    badge.textContent = program ? t("catchup") : t("live");
    badge.classList.toggle("archive", !!program);
    buildOsdActions();
    updateOsd();
    if (settings.osdEnabled !== false) showOsd();

    nextSourceEntry("", 0, true);
  }

  /* ▲ / ▼ (oraz CH+ / CH− na pilocie) w odtwarzaczu: kanał wyżej albo niżej na
     tej samej liście, którą widzi użytkownik (kategoria i wyszukiwanie), z
     zawijaniem na końcach. Kanał oglądany z EPG innej kategorii szukamy w całej
     playliście, żeby przełączanie nigdy nie „nie działało”. */
  function zapChannel(direction) {
    var channel = state.watchChannel;
    if (!channel) return;

    var list = state.listItems && state.listItems.length ? state.listItems : state.channels;
    var index = listIndex(list, channel);
    if (index < 0) {
      list = state.channels;
      index = listIndex(list, channel);
    }
    if (index < 0 || list.length < 2) return;

    var next = list[(index + direction + list.length) % list.length];
    if (!next) return;
    /* nowy kanał startuje na żywo — tak jak przy przełączaniu z listy */
    playChannel(next, null, "playerScreen");
  }

  function listIndex(list, channel) {
    var key = keyOf(channel);
    for (var i = 0; i < list.length; i++) {
      if (keyOf(list[i]) === key) return i;
    }
    return -1;
  }

  function showPlayerError(message) {
    $("playerError").textContent = message;
    $("playerError").classList.remove("hidden");
  }

  /* Błąd odtwarzania: zamykamy bieżący silnik i przechodzimy do następnego
     sposobu (natywnie → MSE → HLS), a po wyczerpaniu listy — kolejna runda
     prób wg ustawień. Cały łańcuch pilnuje nextSourceEntry(). */
  function handlePlaybackError(message) {
    if (!state.currentSource) return;
    clearTimeout(state.stableTimer);
    clearTimeout(state.retryTimer);
    destroyEngine();
    nextSourceEntry(message, 900);
  }

  function stopPlayback() {
    var video = $("video");
    clearTimeout(state.retryTimer);
    clearTimeout(state.stableTimer);
    clearTimeout(state.recentTimer);
    clearTimeout(state.okHoldTimer);
    clearTimeout(state.osdTimer);
    clearInterval(state.osdTicker);
    /* obraz zamknięty — nie ma już czego pilnować (patrz guardTick) */
    stopGuard();
    /* obraz systemowy i VLC gasną razem z kanałem, a strona wraca do zwykłego wyglądu */
    stopExo();
    stopVlc();
    state.retryTimer = null;
    state.stableTimer = null;
    state.recentTimer = null;
    state.okHoldTimer = null;
    state.osdTimer = null;
    state.osdTicker = null;
    markWatchedTime();
    state.recentChannel = null;
    state.currentSource = "";
    state.sources = [];
    state.sourceIndex = 0;
    state.cycle = 0;
    state.watchChannel = null;
    state.watchProgram = null;
    /* wpis o przewinięciu dotyczył zamkniętego obrazu — na pasku nie ma czego
       pokazywać, gdy kanał zostanie włączony ponownie */
    clearSeekMark();
    state.livePauseAt = 0;
    /* unieważnia spóźnione wczytywanie biblioteki po wyjściu z kanału */
    nextEngineToken();
    destroyEngine();
    hideContextMenu();
    hideExitDialog();
    /* panel diagnostyki leży nad obrazem, więc gaśnie razem z nim, a jego
       budzik nie może już nic otworzyć (patrz armDiagAuto) */
    clearTimeout(state.diagAutoTimer);
    state.diagAutoTimer = null;
    closeDiagnostics();
    hideOsd();
    video.pause();
    video.removeAttribute("src");
    video.load();
    /* Zabezpieczenie: ekran odtwarzacza bez kanału to czarny prostokąt, więc
       nigdy nie wracamy na niego po zatrzymaniu obrazu. */
    var target = state.playerReturn && state.playerReturn !== "playerScreen"
      ? state.playerReturn
      : "browserScreen";
    showScreen(target);
    /* sesja multimediów gaśnie razem z obrazem, żeby pilot nie pauzował
       odtwarzacza, którego już nie ma */
    updateMediaSession();
  }

  /* Krok przewijania z ustawień („Krok przewijania archiwum”: 5 / 10 / 30 s) */
  function seekStep() {
    var step = parseInt(settings.seekSeconds, 10);
    return step > 0 ? step : 10;
  }

  /* ---------  ŚLAD PRZEWINIĘCIA („Cofnięto o 10 s” / „Przesunięto o +10 s”)  ---------
     Po skoku w archiwum dekoder musi donieść obraz na nową pozycję i zgłasza
     wtedy „waiting” — identycznie jak przy wczytywaniu strumienia od zera, więc
     pasek pisał „Ładowanie strumienia…”. Przez chwilę po skoku pamiętamy więc
     kierunek i krok i to nimi opisujemy oczekiwanie na obraz. Skoki w tę samą
     stronę doliczają się do jednego wpisu, bo tak się je robi pilotem: kilka
     naciśnięć pod rząd to jeden skok o kilka kroków. */

  var SEEK_GRACE = 6000;

  function markSeek(direction, seconds) {
    /* Kolejne naciśnięcia pilota sumujemy: pięć ⏩ pod rząd to „Przesunięto
       o +50 s”, a nie pięć razy „o +10 s”. Skok w tę samą stronę dolicza się,
       dopóki poprzedni wpis jest jeszcze na pasku (czyli przez SEEK_GRACE od
       ostatniego skoku); zmiana kierunku albo przerwa zaczyna liczenie od nowa. */
    var now = Date.now();
    var same = state.seekAt && state.seekDirection === direction &&
      now - state.seekAt <= SEEK_GRACE;
    state.seekSize = (same ? state.seekSize : 0) + seconds;
    state.seekAt = now;
    state.seekDirection = direction;
    refreshSeekNotice();
    /* ten sam wpis pokazujemy na środku obrazu: pasek po chwili sam znika,
       a przy przewijaniu pilotem informacja „Cofnięto o 10 s” ma zostać na
       oczach, także gdy menu jest zamknięte (patrz showPlayerToast) */
    showPlayerToast(seekNotice());
  }

  /* nowe okno obrazu (kanał, program, „na żywo”) nie jest przewijaniem — wpis
     o poprzednim skoku nie może zostać na pasku */
  function clearSeekMark() {
    state.seekAt = 0;
    state.seekDirection = 0;
    state.seekSize = 0;
    hidePlayerToast();
  }

  /* tekst skoku dla paska; pusty, gdy od przewinięcia minęło już SEEK_GRACE */
  function seekNotice() {
    if (!state.seekAt || Date.now() - state.seekAt > SEEK_GRACE) return "";
    return t(state.seekDirection < 0 ? "seek_back" : "seek_forward", { s: state.seekSize });
  }

  function refreshSeekNotice() {
    var el = $("playerSeek");
    if (!el) return;
    var text = seekNotice();
    el.textContent = text;
    if (text) el.classList.remove("hidden");
    else el.classList.add("hidden");
  }

  /* -------------------  KOMUNIKAT NA ŚRODKU OBRAZU  -------------------
     Przewinięcie widać na samym wideo („Cofnięto o 10 s”), a nie tylko w pasku
     na dole: pasek chowa się sam po OSD_AUTOHIDE i przy oglądaniu zostawał sam
     obraz, bez śladu tego, co się właśnie stało. Komunikat jest niezależny od
     paska, więc widać go również przy zamkniętym menu odtwarzacza. */

  var TOAST_MS = 2000;
  var toastTimer = null;

  function showPlayerToast(text, ms) {
    var el = $("playerToast");
    if (!el) return;
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (!text) {
      el.textContent = "";
      el.classList.add("hidden");
      return;
    }
    el.textContent = text;
    el.classList.remove("hidden");
    toastTimer = setTimeout(function () {
      toastTimer = null;
      el.classList.add("hidden");
    }, ms > 0 ? ms : TOAST_MS);
  }

  function hidePlayerToast() {
    showPlayerToast("");
  }

  /* ---------------------  ZEGAR W ROGU OBRAZU  ---------------------
     Włączany w Ustawieniach („Zegar w rogu obrazu”): pokazuje godzinę HH:MM
     w lewym górnym rogu i tylko wtedy, gdy naprawdę leci program — na liście
     kanałów, w programie TV i w ustawieniach go nie ma. Budzik nastawiamy na
     pełną minutę, więc przez resztę czasu nic nie chodzi. */

  var clockTimer = null;

  function cornerClockText(ts) {
    var date = new Date(ts === undefined ? Date.now() : ts);
    return pad2(date.getHours()) + ":" + pad2(date.getMinutes());
  }

  /* Zegar pokazuje się wyłącznie na widocznym ekranie odtwarzacza z kanałem —
     inaczej byłby ozdobnikiem na liście kanałów. */
  function cornerClockWanted() {
    if (settings.clockEnabled !== true) return false;
    var screen = $("playerScreen");
    if (!screen || screen.classList.contains("hidden")) return false;
    return !!state.watchChannel;
  }

  function renderCornerClock() {
    var el = $("cornerClock");
    if (!el) return;
    if (!cornerClockWanted()) {
      el.classList.add("hidden");
      return;
    }
    el.textContent = cornerClockText();
    el.classList.remove("hidden");
  }

  /* Pierwsze tyknięcie wypada równo z pełną minutą, a gdy zegar nie jest
     potrzebny (brak oglądania), budzik w ogóle nie zostaje nastawiony. */
  function syncCornerClock() {
    if (clockTimer) {
      clearTimeout(clockTimer);
      clockTimer = null;
    }
    renderCornerClock();
    if (!cornerClockWanted()) return;
    var now = new Date();
    clockTimer = setTimeout(syncCornerClock, (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 120);
  }

  /* Czy odtwarzane okno archiwum kończy się na „teraz”? Tak jest w timeshicie
     (patrz timeshiftBack) i wtedy, gdy otworzyliśmy program, który wciąż leci —
     w obu wypadkach „do przodu” na końcu okna znaczy „na żywo”. */
  function atLiveEdge() {
    var program = state.watchProgram;
    if (!program) return false;
    return !!program.timeshift || program.end > Date.now();
  }

  /* Ile sekund materiału naprawdę wybrał użytkownik. Serwer timeshiftu potrafi
     oddać dłuższe okno niż zamówione (np. dwie godziny nagrania dla programu
     godzinnego), a wtedy pasek postępu, licznik „x / y” i kroki ⏪/⏩ opisywały
     coś innego, niż widać na liście EPG. Okno przycinamy więc do granic programu;
     program, który wciąż leci, kończy się chwilą obecną (patrz playChannel). */
  function archiveProgramSeconds() {
    var program = state.watchProgram;
    if (!program) return 0;
    return Math.max(0, (Math.min(program.end, Date.now()) - program.start) / 1000);
  }

  /* Przewijanie pilota (⏪/⏩): po nagraniu skaczemy o krok z ustawień, a gdy
     w oknie kończącym się na „teraz” nie ma już czego przewijać — ⏩ wraca na
     żywo, a ⏪ wczytuje dłuższe okno catch-up. Na samym kanale na żywo ⏪
     wchodzi w catch-up, a ⏩ tylko przywołuje pasek z informacją. */
  function seekBy(direction) {
    var video = $("video");
    if (!video) return;

    var step = seekStep();

    /* kanał na żywo: ◀ wchodzi w catch-up o krok, ▶ na zatrzymanym obrazie
       po prostu wznawia (od miejsca pauzy), a na lecącym nie ma czego
       przewijać — zostaje pasek z informacją */
    if (!state.isArchive) {
      if (direction < 0) timeshiftBack();
      else if (video.paused) resumePlayback();
      else showOsd();
      return;
    }

    /* Nagranie, którego obraz rysuje silnik odbiornika (VLC albo odtwarzacz
       systemowy): element <video> nie zna tu ani pozycji, ani długości okna,
       więc skok idzie zegarem silnika (patrz seekArchiveHardware). */
    if (nativeLayerActive()) {
      seekArchiveHardware(direction, step);
      return;
    }

    /* nagranie, którego długości odtwarzacz nie zna — nie ma po czym skakać,
       zostaje tylko zmiana okna: dłużej wstecz albo powrót na żywo */
    if (!isFinite(video.duration)) {
      if (atLiveEdge()) {
        if (direction < 0) timeshiftBack();
        else goLive();
      } else {
        showOsd();
      }
      return;
    }

    /* koniec okna programu, który wciąż leci = powrót na żywo */
    if (direction > 0 && atLiveEdge() && video.currentTime + step >= video.duration - 0.5) {
      goLive();
      return;
    }

    /* za mało miejsca na pełny krok w tył = sięgnij po dłuższe okno catch-up */
    if (direction < 0 && atLiveEdge() && video.currentTime < step) {
      timeshiftBack();
      return;
    }

    /* Krok kończy się na granicy programu, a nie na końcu nagrania oddanego przez
       serwer (patrz archiveProgramSeconds): ⏩ na końcu programu nie wchodzi
       w materiał, którego użytkownik nie wybrał — od tego jest „następny program”. */
    var windowSeconds = archiveProgramSeconds();
    var limit = windowSeconds > 0 ? Math.min(video.duration, windowSeconds) : video.duration;
    var before = video.currentTime;
    video.currentTime = Math.max(0, Math.min(limit, before + direction * step));
    $("playerProgress").style.width = (Math.min(video.currentTime, limit) / limit) * 100 + "%";
    $("playerTime").textContent = formatTime(video.currentTime) + " / " + formatTime(limit);
    /* ile obrazu naprawdę przybyło: na krawędzi nagrania skok bywa mniejszy od
       kroku (albo zerowy) — wtedy pasek nie pisze o ruchu, którego nie było */
    var moved = Math.round(video.currentTime) - Math.round(before);
    if (moved) markSeek(moved < 0 ? -1 : 1, Math.abs(moved));
    showSeekOverlay();
  }

  /* Skok o krok w nagraniu, którego obraz rysuje silnik odbiornika (VLC albo
     odtwarzacz systemowy). Elementu <video> tu nie ma, więc pozycję i długość
     okna bierze się z mostu (patrz vlcEvent), a skok oddajemy silnikowi jego
     własnym zegarem (patrz vlcSeek) — VLC przewija po odebranych danych, więc
     krok w nagraniu jest natychmiastowy, a nie nowym wczytaniem strumienia.

     Silnik bez zegara (odtwarzacz systemowy, okno o nieznanej długości) nie ma
     po czym skakać — zostaje zmiana okna catch-up, dokładnie tak, jak dla
     elementu <video> bez długości: ⏪ bierze dłuższe okno, ⏩ wraca na żywo. */
  function seekArchiveHardware(direction, step) {
    var stepMs = step * 1000;
    if (!vlcActive() || state.vlcLength <= 0) {
      if (atLiveEdge()) {
        if (direction < 0) timeshiftBack();
        else goLive();
      } else {
        showOsd();
      }
      return;
    }

    var at = state.vlcTime | 0;
    /* koniec okna programu, który wciąż leci = powrót na żywo */
    if (direction > 0 && atLiveEdge() && at + stepMs >= state.vlcLength - 500) {
      goLive();
      return;
    }
    /* za mało miejsca na pełny krok w tył = sięgnij po dłuższe okno catch-up */
    if (direction < 0 && atLiveEdge() && at < stepMs) {
      timeshiftBack();
      return;
    }

    /* krok kończy się na granicy programu, nie na końcu nagrania od serwera
       (patrz archiveProgramSeconds) */
    var programSeconds = archiveProgramSeconds();
    var limitMs = programSeconds > 0 ? Math.min(state.vlcLength, programSeconds * 1000) : state.vlcLength;
    var target = Math.max(0, Math.min(limitMs, at + direction * stepMs));
    if (!vlcSeek(target)) {
      /* most milczy (np. most zniknął w trakcie) — zostaje pasek z informacją */
      showOsd();
      return;
    }
    /* ile obrazu naprawdę przybyło: na krawędzi nagrania skok bywa mniejszy od
       kroku (albo zerowy) — wtedy pasek nie pisze o ruchu, którego nie było */
    var moved = Math.round(target / 1000) - Math.round(at / 1000);
    if (moved) markSeek(moved < 0 ? -1 : 1, Math.abs(moved));
    updateOsdProgress();
    showSeekOverlay();
  }

  /* pasek z czasem na chwilę po skoku — jak przy przewijaniu nagrania.
     Pasek pokazany przy skoku jest tylko informacją (chowa się po 1,8 s), więc
     ▲ ▼ dalej przełączają kanały — inaczej po skoku nie dałoby się zmienić
     kanału, dopóki pasek zdążyłby zniknąć sam. */
  function showSeekOverlay() {
    $("playerOverlay").classList.remove("hidden");
    state.osdMenu = false;
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(function () {
      $("playerOverlay").classList.add("hidden");
    }, 1800);
  }

  /* ⏪ na kanale na żywo (i cofanie dalej w tył): strumienia na żywo nie da się
     przewinąć, więc wchodzimy w catch-up okna kończącego się TERAZ — odtwarzanie
     startuje w punkcie „teraz − krok”. Okno kończy się na chwili włączenia, więc
     jego długość to nasze opóźnienie; kolejne ⏪ na początku okna wydłużają je
     wstecz, dzięki czemu cofać można się dowolnie daleko — na miarę archiwum
     dostawcy. ⏩ na końcu takiego okna wraca na żywo (patrz atLiveEdge). */
  function timeshiftBack() {
    var channel = state.watchChannel;
    if (!channel) return;

    if (!hasArchive(channel)) {
      showPlayerError(t("err_catchup"));
      scheduleOsdHide();
      return;
    }

    var video = $("video");
    /* Jak długie okno już oglądamy: element <video> zna swoją długość, a obraz
       silnika (VLC) donosi ją z mostu (patrz vlcEvent). Bez tego cofanie na drodze
       silnika zaczynałoby nowe okno od „teraz”, czyli skakało do przodu zamiast
       sięgać w tył — a to jest cała różnica między ◀ a „na żywo”. */
    var behind = 0;
    if (state.isArchive) {
      if (vlcActive() && state.vlcLength > 0) behind = Math.ceil(state.vlcLength / 1000);
      else if (video && isFinite(video.duration)) behind = Math.ceil(video.duration);
    }
    var now = Date.now();
    /* wstrzymany kanał na żywo: cofamy się od miejsca zatrzymania, a nie od
       „teraz” — inaczej ◀ po pauzie przeniosłoby obraz do przodu */
    if (state.livePauseAt) {
      behind = Math.max(behind, Math.round((now - state.livePauseAt) / 1000));
    }
    var program = currentProgram(channel);

    playChannel(channel, {
      start: now - (behind + seekStep()) * 1000,
      end: now,
      title: program ? program.title : channel.name,
      timeshift: true
    }, "playerScreen");
    /* świeżo wczytane okno też donosi obraz — pasek mówi wprost, że to cofnięcie,
       a nie wczytywanie strumienia od zera */
    markSeek(-1, seekStep());
  }

  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    var rest = seconds % 60;
    return (hours ? hours + ":" : "") +
      (minutes < 10 ? "0" : "") + minutes + ":" +
      (rest < 10 ? "0" : "") + rest;
  }

  /* -------------------------  PRZEWIJANIE EKRANU  --------------------------
     Fokus ma zostać na ekranie, ale nie przy samej krawędzi. Wcześniej
     `scrollIntoView(false)` wyrównywał sfokusowany element do dolnej krawędzi,
     więc każdy krok pilota robił duży, nierówny skok („po schodkach”), a
     wszystko pod przyciskiem — opis zmian, „Zapisz i pobierz” — zostawało poza
     ekranem. Tutaj dosuwamy ekran tylko wtedy, gdy element nie mieści się w
     marginesie, i tylko o tyle, ile trzeba, żeby widać było sąsiednie wiersze. */

  /* Najbliższy przodek, który naprawdę się przewija. Bez tego scrollIntoView
     przesuwa dokument, a ten jest przyklejony do ekranu (html, body — hidden). */
  function scrollParent(element) {
    var node = element && element.parentNode;
    while (node && node.nodeType === 1) {
      var style = (typeof window !== "undefined" && window.getComputedStyle)
        ? window.getComputedStyle(node) : null;
      var overflow = style ? style.overflowY : "";
      if ((overflow === "auto" || overflow === "scroll") &&
          node.scrollHeight > node.clientHeight + 1) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  function keepInView(element) {
    if (!element || !element.getBoundingClientRect) return;
    var parent = scrollParent(element);
    if (!parent) return;

    /* Zapas wokół sfokusowanego elementu (mniejszy na wąskim ekranie). */
    var view = parent.getBoundingClientRect();
    var marginY = Math.max(80, Math.min(200, Math.round(view.height * 0.25)));
    var marginX = Math.max(40, Math.min(120, Math.round(view.width * 0.08)));
    var box = element.getBoundingClientRect();
    var down = 0;
    var across = 0;

    if (box.bottom + marginY > view.bottom) down = box.bottom + marginY - view.bottom;
    else if (box.top - marginY < view.top) down = box.top - marginY - view.top;

    if (box.right + marginX > view.right) across = box.right + marginX - view.right;
    else if (box.left - marginX < view.left) across = box.left - marginX - view.left;

    /* Przeglądarka sama przycina przewijanie do zakresu, więc ostatni element
       formularza nadal da się pokazać — tyle że nie przy samej krawędzi. */
    if (down) parent.scrollTop += down;
    if (across) parent.scrollLeft += across;

    /* Zapamiętane miejsce fokusu musi być aktualne po dosunięciu ekranu. */
    if ((down || across) && focusAnchor && focusAnchor.el === element) {
      focusAnchor = { el: element, box: element.getBoundingClientRect() };
    }
  }

  /* nawigacja pilotem: wybiera najbliższy element w kierunku strzałki */
  function focusNearest(keyCode) {
    var current = document.activeElement;
    var all = document.querySelectorAll('button,input,select,[tabindex="0"]');
    var candidates = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].offsetParent !== null && !all[i].disabled) candidates.push(all[i]);
    }
    if (!candidates.length) return false;

    /* Punkt odniesienia: sfokusowany element. Gdy fokus zniknął, bo przycisk
       został wyłączony albo ukryty (tak działo się z „Pobierz i zainstaluj”
       po ruszeniu pobierania), liczymy od jego ostatniego miejsca na ekranie —
       inaczej nawigacja wracała na sam początek ustawień i nie było jak
       zjechać do opisu zmian ani do „Zapisz i pobierz”. */
    var box = null;
    if (current && candidates.indexOf(current) >= 0) {
      box = current.getBoundingClientRect();
    } else if (focusAnchor && focusAnchor.el && focusAnchor.el.parentNode &&
               (focusAnchor.el.disabled || focusAnchor.el.offsetParent === null)) {
      box = focusAnchor.box;
    }

    if (!box || (!box.width && !box.height)) {
      candidates[0].focus();
      keepInView(candidates[0]);
      return true;
    }

    var cx = box.left + box.width / 2;
    var cy = box.top + box.height / 2;
    var best = null;
    var bestScore = Infinity;

    for (var j = 0; j < candidates.length; j++) {
      if (candidates[j] === current) continue;
      var rect = candidates[j].getBoundingClientRect();
      var rx = rect.left + rect.width / 2;
      var ry = rect.top + rect.height / 2;
      var forward, lateral;
      if (keyCode === 37) {
        forward = cx - rx;
        lateral = Math.abs(cy - ry);
      } else if (keyCode === 39) {
        forward = rx - cx;
        lateral = Math.abs(cy - ry);
      } else if (keyCode === 38) {
        forward = cy - ry;
        lateral = Math.abs(cx - rx);
      } else {
        forward = ry - cy;
        lateral = Math.abs(cx - rx);
      }
      if (forward <= 2) continue;
      var score = forward + 2.5 * lateral;
      if (score < bestScore) {
        bestScore = score;
        best = candidates[j];
      }
    }

    if (best) {
      best.focus();
      keepInView(best);
      return true;
    }
    /* brak kandydata w tym kierunku — wywołujący wie, że fokus stoi w miejscu
       (w odtwarzaczu: ▲ ▼ z paska wychodzą wtedy z menu na obraz) */
    return false;
  }

  /* ---------------------  STRZAŁKI W POLU SZUKANIA  ---------------------
     Pole tekstowe zjada strzałki (przesuwa w nim kursor), a pilot nie ma
     Tab — bez tego z szukania nie dało się wyjść: ani do listy grup, ani do
     kanałów. Dlatego: ▼ prowadzi do listy kanałów, ◀ zabiera tekst dopiero
     wtedy, gdy kursor stoi na jego początku (inaczej nie dałoby się poprawić
     zapytania), a ▶ przy końcu tekstu przechodzi do następnego pola paska. */
  function searchArrowTarget(keyCode, caretAtStart, caretAtEnd) {
    if (keyCode === 40) return "channels";
    if (keyCode === 37 && caretAtStart) return "categories";
    if (keyCode === 39 && caretAtEnd) return "bar";
    return "";
  }

  /* po wybraniu grupy (OK / klik) w trybie TV wchodzimy od razu w jej kanały */
  function nextFocusAfterGroup(tvMode) {
    return tvMode ? "channels" : "";
  }

  function focusActiveCategory() {
    var target = document.querySelector(".category.active") || document.querySelector(".category");
    if (target && target.focus) {
      try { target.focus(); } catch (error) { /* bez fokusu też da się kliknąć */ }
    }
  }

  function focusChannelEntry() {
    var container = $("channels");
    var card = container && container.querySelector
      ? (container.querySelector(".channel-main") || container.querySelector(".channel"))
      : null;
    if (card && card.focus) {
      try { card.focus(); } catch (error) { /* bez fokusu też da się kliknąć */ }
      return true;
    }
    focusNearest(40);
    return false;
  }

  /* Pola tekstowe nie dostają fokusu przy wejściu na ekran: na telewizorze
     wyskakiwałaby z nich klawiatura ekranowa (po zapisaniu ustawień lista
     kanałów od razu wpadała w tryb szukania), a na telefonie zasłaniałaby
     połowę listy. */
  function isTextField(element) {
    if (!element || element.tagName !== "INPUT") return false;
    var type = String(element.getAttribute("type") || "text").toLowerCase();
    return type !== "checkbox" && type !== "radio" && type !== "button" &&
      type !== "submit" && type !== "range";
  }

  /* na co ma stanąć fokus po pokazaniu ekranu: lista kanałów zaczyna na
     kategorii (z niej ▼ / ▶ prowadzą do kanałów), inne ekrany — jak dotąd,
     z pominięciem pól tekstowych */
  function entryFocusTarget(screen) {
    if (!screen) return null;
    if (screen.id === "browserScreen" && screen.querySelector) {
      var active = screen.querySelector(".category.active") || screen.querySelector(".category");
      if (active) return active;
    }
    if (!screen.querySelectorAll) return null;
    var all = screen.querySelectorAll('[tabindex="0"],button,input,select');
    for (var i = 0; i < all.length; i++) {
      if (all[i].offsetParent === null) continue;
      /* Wyłączony przycisk nie przyjmie fokusu, więc wybranie go na cel
         zostawiłoby ekran bez podświetlenia (tak lista programów kanału
         otwierała się na zablokowanym wpisie z przyszłości — patrz
         openArchive). */
      if (all[i].disabled) continue;
      if (isTextField(all[i])) continue;
      return all[i];
    }
    return null;
  }

  /* Ruch pilotem po siatce EPG — sterujemy wyłącznie podświetleniem:
     ▲ ▼ przenoszą je o jeden kanał (wiersz) w górę albo w dół, na program
     z tego samego momentu, a ◀ ▶ o jeden program w bok (patrz guideStepProgram).
     Oś czasu rusza się tylko wtedy, gdy podświetlony program nie mieści się już
     w widocznym zakresie, więc to podświetlenie prowadzi przesuwanie godzin.
     Z górnego wiersza ▲ wraca do przycisków dnia, żeby pilotem dało się dojść
     do „Dziś”. */
  function focusGuide(keyCode) {
    var grid = $("guideGrid");
    if (!grid) return;

    var current = document.activeElement;
    var inGrid = !!(current && current.classList && current.classList.contains("guide-program"));

    if (!inGrid) {
      /* wejście w siatkę z nagłówka: tam, gdzie EPG już stoi (oglądany kanał
         albo wiersz przy górnej krawędzi), zamiast skakać na początek listy */
      var entry = guideEntryBlock();
      if (entry) {
        focusKeepScroll(entry);
        revealGuideBlock(entry);
      }
      return;
    }

    var index = guideFocusRowIndex();
    if (index < 0) return;
    var moved = guideStepRow(index, keyCode === 38 ? -1 : 1, guideFocusTime());
    if (moved) {
      /* Fokus kładziemy z preventScroll (przewijanie siatki robimy sami, żeby
         silnik nie uciekał z widokiem w poziomie), dlatego nowy wiersz trzeba
         dosunąć do widoku — inaczej podświetlenie schowałoby się pod
         przyklejoną osią czasu albo za dolną krawędzią. */
      revealGuideBlock(moved);
      return;
    }
    /* nad górnym wierszem nie ma już programu: ▲ wraca do nagłówka */
    if (keyCode === 38) focusGuideHeader();
  }

  /* Wiersz (kanał) o jedno miejsce wyżej albo niżej — na program z tego samego
     momentu, żeby podświetlenie nie uciekało w bok po osi czasu. Kanały bez
     programu w tym momencie przeskakujemy (pusty wiersz zatrzymałby pilota),
     a wiersze poniżej widoku dorysowujemy (patrz guideEnsureRow). Zwraca kafelek
     z podświetleniem (albo null, gdy nie było na czym stanąć). */
  function guideStepRow(index, dir, time) {
    for (var i = index + dir; i >= 0 && i < guide.items.length; i += dir) {
      if (!guideEnsureRow(i)) break;
      var block = focusGuideRowBlock(i, time, 0);
      if (block) return block;
    }
    return null;
  }

  /* Czy wiersz o tym numerze jest już w DOM? Lista kanałów rysowana jest
     porcjami (patrz renderGuide), więc wiersze poniżej widoku trzeba najpierw
     dorysować — inaczej nie byłoby na czym położyć fokusu. */
  function guideEnsureRow(index) {
    var wrap = $("guideRows");
    if (!wrap) return false;
    var need = index - (guide.winStart + guide.rendered - 1);
    if (need > 0) guideFill(need);
    return index >= guide.winStart && index < guide.winStart + guide.rendered;
  }

  /* wyjście z siatki do nagłówka programu TV (▲ z górnego wiersza) */
  function focusGuideHeader() {
    var target = $("guideToday") || $("guideClose");
    if (target && target.focus) {
      try { target.focus(); } catch (error) { /* bez fokusu też da się kliknąć */ }
    }
  }

  /* ==============================  PROGRAM TV  ============================== */

  /* Program TV pokazuje wszystkie kanały — EPG z nagłówka ma być pełne, bez
     względu na to, jaka grupa jest wybrana na liście kanałów. Kanał, na którym
     ma stanąć fokus, wybiera się kluczem (guide.focusKey), a nie filtrowaniem
     listy: inaczej w „Ulubionych” EPG pokazywałoby kilka wierszy i nie byłoby
     po czym chodzić pilotem. */
  function guideChannels() {
    return state.channels;
  }

  /* Program TV. Bez kanału otwiera się na początku listy; z kanałem (opcje
     kanału na liście i w pasku odtwarzacza) staje na tym, co leci teraz, i
     wraca potem tam, skąd przyszedł. */
  function openGuide(options) {
    var opts = options || {};
    var now = Date.now();
    guide.windowStart = now - (now % 3600000) - 3600000;
    guide.focusKey = opts.channel ? keyOf(opts.channel) : "";
    guide.returnTo = opts.returnTo || "browserScreen";
    guide.anchor = -1;
    /* Najpierw pokazujemy ekran, a dopiero potem rysujemy siatkę: program TV ma
       wypełnić ekran, więc liczba godzin bierze się z realnej szerokości siatki
       — w ukrytym ekranie byłaby zerowa i zostałoby okno na pół ekranu. */
    showScreen("guideScreen");
    renderGuide();
    focusGuideWatched();
    /* linia bieżącej godziny rysuje się na widocznej siatce (wtedy da się
       zmierzyć kolumnę z nazwami kanałów) i sama idzie dalej */
    updateGuideNowLine();
    startGuideNowLine();
  }

  /* powrót z programu TV tam, skąd przyszedł: do odtwarzacza albo do listy */
  function closeGuide() {
    var target = guide.returnTo === "playerScreen" ? "playerScreen" : "browserScreen";
    guide.focusKey = "";
    guide.returnTo = "browserScreen";
    stopGuideNowLine();
    showScreen(target);
  }

  /* Każda zmiana dnia albo godziny przerysowuje siatkę, ale wiersz z fokusem
     zostaje na swoim miejscu — po przewinięciu godzin nadal widać ten sam
     kanał, tylko w innym czasie. */
  function guideRedraw(shift) {
    var rowIndex = guideFocusRowIndex();
    var inGrid = rowIndex >= 0;
    /* Moment programu i miejsce wiersza pod fokusem zapamiętujemy PRZED
       przerysowaniem — po nim lista kafelków jest już nowa i nie ma czego
       spytać. Bez tego „Dzień ›” i ◀ ▶ zostawiały wiersz na miejscu, ale
       przeskakiwały na pierwszy program w kanale. */
    var focusTime = guideFocusTime();
    var keepOffset = guideRowViewportOffset();
    /* Przeskok okna („Wczoraj”, „Dzień ›”) mija się z momentem programu o całą
       dobę, więc ten sam moment bezwzględny nie trafi już w żaden kafelek.
       Drugi cel to ta sama godzina nowego dnia — po przeskoku o dobę fokus
       zostaje na tym samym programie i w tej samej kolumnie ekranu. */
    var focusSame = focusTime && shift ? focusTime + shift : 0;
    if (!inGrid) {
      /* fokus jest poza siatką (np. na przyciskach dnia) — nie zabieramy go
         z nagłówka, tylko zostawiamy widok na tym kanale, który był na ekranie;
         inaczej „Dzień ›” wracałoby na początek listy */
      var grid = $("guideGrid");
      if (grid && grid.clientHeight && guide.rendered) {
        var top = Math.max(0, grid.scrollTop - guideRowsOffset());
        rowIndex = guide.winStart + Math.floor(top / guide.rowHeight);
      }
    }
    /* widok startuje wiersz przed fokusem — wtedy wybrany kanał nie chowa się
       pod przyklejoną osią czasu */
    if (rowIndex > 0) guide.anchor = rowIndex - 1;
    else if (rowIndex === 0) guide.anchor = 0;
    renderGuide();
    guide.anchor = -1;
    if (inGrid) focusGuideRowBlock(rowIndex, focusTime, focusSame);
    /* wiersz z fokusem wraca w to samo miejsce na ekranie — bez tego siatka
       drgała przy każdej zmianie dnia albo godziny */
    guideRestoreRowOffset(keepOffset);
  }

  /* Zmiana okna czasu (◀ ▶, „Dzień ›”, „Wczoraj”, data, godzina). O tym, gdzie
     wyląduje fokus, decyduje sam przeskok, więc przekazujemy go dalej: przy
     ◀ ▶ o godzinę program zostaje pod palcem dzięki temu samemu momentowi,
     a przy przeskoku o dobę trzeba tej samej godziny nowego dnia. */
  function guideSetWindow(start) {
    var shift = start - guide.windowStart;
    guide.windowStart = start;
    guideRedraw(shift);
  }

  /* przewijanie o cały dzień — zachowuje wybraną godzinę */
  function guideShiftDays(dir) {
    guideSetWindow(guide.windowStart + dir * 24 * 3600000);
  }

  /* Przewijanie osi czasu o godzinę (◀ ▶) — działa w obie strony bez żadnego
     ograniczenia. Wcześniej strzałki tylko przenosiły fokus między programami
     i „zatykały się” na skraju widocznego zakresu, więc nie dało się cofnąć
     dalej niż jedno okno (3 godziny). Fokus zostaje na tym samym kanale. */
  function guidePan(hours) {
    var next = guide.windowStart + hours * 3600000;
    guideSetWindow(next - (next % 3600000));
  }

  /* Sąsiedni program tego samego kanału z danych EPG: dir > 0 w przód, inaczej
     w tył. Programy trzymamy posortowane od najnowszego (parseXmltv), więc
     kolejności tej listy nie zakładamy — szukamy najbliższego na osi. Programu,
     którego nie da się włączyć (przyszłość albo miniony bez archiwum), nie
     bierzemy, bo pilot nie miałby na czym stanąć (patrz buildGuideProgram). */
  function guideNeighbourProgram(channel, time, dir) {
    var list = programsFor(channel);
    var now = Date.now();
    var canCatchup = hasArchive(channel);
    var found = null;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!isFinite(p.start) || !isFinite(p.end) || p.end <= p.start) continue;
      if (p.start > now) continue;                  /* jeszcze nie było */
      if (p.end <= now && !canCatchup) continue;    /* minęło, a archiwum nie ma */
      if (dir > 0) {
        if (p.start < time) continue;
        if (!found || p.start < found.start) found = p;
      } else {
        if (p.end > time) continue;
        if (!found || p.end > found.end) found = p;
      }
    }
    return found;
  }

  /* Kafelki jednego wiersza po kolei na osi czasu (od najstarszego). Programy
     trzymamy posortowane od najnowszego (parseXmltv), więc kafelek „obok”
     w DOM leży na osi po przeciwnej stronie, niż wskazuje strzałka: ◀ szło
     w prawo, a ▶ w lewo i dopiero na skraju okna pilot „znajdował się” po
     drugiej stronie. Dlatego sąsiada bierzemy po czasie (data-start), a nie po
     numerze w DOM. */
  function guideRowBlocks(row) {
    var found = row && row.querySelectorAll ? row.querySelectorAll(".guide-program") : [];
    var blocks = Array.prototype.slice.call(found);
    blocks.sort(function (a, b) {
      return (parseInt(a.getAttribute("data-start"), 10) || 0) -
        (parseInt(b.getAttribute("data-start"), 10) || 0);
    });
    return blocks;
  }

  /* ◀ ▶ chodzą po programach tego samego kanału — także po tych, które dopiero
     będą (nie da się ich włączyć, ale można je obejrzeć na osi). Gdy program
     wychodzi za skraj widocznego zakresu, oś czasu dosuwa się razem z nim
     (guideFitWindow), więc to podświetlenie prowadzi przesuwanie godzin,
     a nie odwrotnie. ▲ ▼ nadal chodzą po kanałach. */
  function guideStepProgram(dir) {
    var active = document.activeElement;
    var inBlock = !!(active && active.classList && active.classList.contains("guide-program"));
    var row = inBlock && active.closest ? active.closest(".guide-row") : null;
    if (!row) {
      /* fokus jest w nagłówku albo na polu daty — strzałka przesuwa całą oś */
      guidePan(dir);
      return;
    }
    var blocks = guideRowBlocks(row);
    var index = Array.prototype.indexOf.call(blocks, active);
    if (index < 0) {
      guidePan(dir);
      return;
    }
    var next = blocks[index + dir] || null;
    if (next) {
      focusKeepScroll(next);
      revealGuideBlock(next);
      /* sąsiedni program jest na skraju widocznego zakresu — dosuwamy oś tak,
         żeby było go widać w całości (podświetlenie prowadzi godziny) */
      guideFitWindow(parseInt(next.getAttribute("data-start"), 10),
        parseInt(next.getAttribute("data-end"), 10));
      return;
    }
    /* Skraj widocznego zakresu: sąsiedni program bierzemy z danych kanału, bo
       kafelek poza oknem nie istnieje. Oś ustawiamy tak, żeby ten program było
       widać w całości, a fokus stawiamy na jego początku — tak samo jak robi to
       guideRedraw po przeskoku dnia albo godzin. */
    var rowIndex = guideFocusRowIndex();
    var channel = rowIndex >= 0 ? guide.items[rowIndex] : null;
    var edge = parseInt(active.getAttribute(dir > 0 ? "data-end" : "data-start"), 10);
    var target = channel && isFinite(edge) ? guideNeighbourProgram(channel, edge, dir) : null;
    if (!target) {
      /* dalej nie ma już nawet programu do pokazania — zostaje oś o godzinę */
      guidePan(dir);
      return;
    }
    var fit = guideFittedStart(target.start, target.end);
    guideSetWindow(isFinite(fit) ? fit : target.start - (target.start % 3600000));
    focusGuideRowBlock(rowIndex, target.start + 1, 0);
  }

  /* Początek okna, w którym program [start, end) zmieści się w całości.
     null = program już mieści się w widocznym zakresie, osi nie ruszamy.
     Okno wyrównujemy do pełnej godziny, tak samo jak każdy inny przeskok osi
     (◀ ▶ o godzinę, dzień, data i godzina — patrz guideSetWindow), bo podpisy
     godzin na osi liczą się od początku okna. */
  function guideFittedStart(start, end) {
    if (!isFinite(start) || !isFinite(end) || end <= start) return null;
    var span = guide.hours * 3600000;
    var margin = Math.min(1800000, span / 4);
    var from = guide.windowStart;
    if (start >= from + margin && end <= from + span - margin) return null;
    if (start < from + margin) return start - (start % 3600000);
    var next = end - span + margin;
    return next - (next % 3600000);
  }

  /* Dosunięcie osi do programu (patrz guideFittedStart). Fokus zostaje na tym
     samym momencie, bo guideRedraw odtwarza go po przerysowaniu siatki. */
  function guideFitWindow(start, end) {
    var next = guideFittedStart(start, end);
    if (next === null || next === guide.windowStart) return false;
    guideSetWindow(next);
    return true;
  }

  /* skok do dnia względem dziś (0 = dziś, -1 = wczoraj, -2 = przedwczoraj)
     z zachowaniem aktualnie ustawionej godziny */
  function guideGoToDayOffset(offset) {
    var now = new Date();
    var hour = new Date(guide.windowStart).getHours();
    var target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour, 0, 0, 0);
    guideSetWindow(target.getTime());
  }

  function guideGoToday() {
    var now = Date.now();
    guideSetWindow(now - (now % 3600000) - 3600000);
  }

  function guideGoToDate(dateStr) {
    var m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return;
    var d = new Date(guide.windowStart);
    d.setFullYear(+m[1], +m[2] - 1, +m[3]);
    guideSetWindow(d.getTime() - (d.getTime() % 3600000));
  }

  function guideGoToTime(timeStr) {
    var m = String(timeStr || "").match(/^(\d{2}):(\d{2})/);
    if (!m) return;
    var d = new Date(guide.windowStart);
    d.setHours(+m[1], +m[2] || 0, 0, 0);
    guideSetWindow(d.getTime());
  }

  /* Rysuje siatkę programu TV: oś czasu, widoczne wiersze z zapasem i linię
     bieżącej godziny. Szerokość i liczba godzin zależą od ekranu, więc najpierw
     powstaje sama kolumna z nazwami kanałów — z niej liczy się resztę. */
  function renderGuide() {
    var container = $("guideGrid");
    if (!container) return;

    guide.items = guideChannels();

    container.textContent = "";
    var axis = document.createElement("div");
    axis.className = "guide-axis";
    var corner = document.createElement("div");
    corner.className = "guide-corner";
    axis.appendChild(corner);
    container.appendChild(axis);

    /* Program TV ma wypełnić szerokość ekranu: kolumna z godzinami dzieli to,
       co zostało po nazwach kanałów (3–6 godzin, patrz guideFitHours). */
    var columnWidth = corner.offsetWidth || GUIDE_CHANNEL_WIDTH;
    var inner = guideInnerWidth();
    guide.hours = guideFitHours(inner, columnWidth);
    guide.hourWidth = guideHourWidth(inner - columnWidth, guide.hours);
    container.style.setProperty("--guide-hour", guide.hourWidth + "px");

    for (var h = 0; h < guide.hours; h++) {
      var cell = document.createElement("div");
      cell.className = "guide-hour";
      cell.style.width = guide.hourWidth + "px";
      var hourDate = new Date(guide.windowStart + h * 3600000);
      cell.textContent = pad2(hourDate.getHours()) + ":00";
      axis.appendChild(cell);
    }

    /* Od którego kanału zaczynamy: po przewinięciu dnia albo godzin zostajemy
       na tym samym wierszu, a EPG otwarte z odtwarzacza — na oglądanym kanale
       (nawet gdy leży daleko na liście, bo teraz wszystkie kanały są dostępne). */
    var first = guide.anchor;
    if (first < 0) {
      first = 0;
      if (guide.focusKey) {
        for (var f = 0; f < guide.items.length; f++) {
          if (keyOf(guide.items[f]) === guide.focusKey) { first = Math.max(0, f - 3); break; }
        }
      }
    }
    first = Math.max(0, Math.min(first, Math.max(0, guide.items.length - 1)));

    /* Wiersze siedzą we wspólnym pudełku: tylko wtedy da się poprowadzić przez
       wszystkie kanały jedną pionową linię bieżącej godziny. */
    var rowsWrap = document.createElement("div");
    rowsWrap.className = "guide-rows";
    rowsWrap.id = "guideRows";
    container.appendChild(rowsWrap);
    rowsWrap.appendChild(buildGuideNowLine());

    /* Rysujemy tylko widok z zapasem (GUIDE_OVERSCAN wierszy nad i pod ekranem),
       a brakujące kanały udają odstępy — w DOM jest zawsze kilkadziesiąt wierszy,
       więc siatka pokazuje wszystkie kanały i nie zacina się przy 5000. */
    guide.rowHeight = guideRowHeight();
    guide.winStart = Math.max(0, first - GUIDE_OVERSCAN);
    guide.rendered = 0;
    guideFill(guideRowsOnScreen() + GUIDE_OVERSCAN + Math.min(GUIDE_OVERSCAN, first));
    /* wysokość wiersza mierzymy na gotowym wierszu — odstępy muszą trafić w piksel */
    guide.rowHeight = guideRowHeight();
    guideUpdateSpacers();
    updateGuideNowLine();

    ensureGuideScrollBound();
    guideScrollToRow(first);
    /* Oś czasu jest oknem, a nie przewijanym widokiem: gdyby silnik przewinął
       siatkę w poziomie (np. dosuwając sfokusowany kafelek), widoczny zakres
       rozjechałby się z oknem czasu i program pod podświetleniem byłby ucięty. */
    if (container.scrollLeft) container.scrollLeft = 0;
    /* podpis programu pod podświetleniem należy do poprzedniego rysunku siatki */
    guideFocusNote(null);

    var from = new Date(guide.windowStart);
    var to = new Date(guide.windowStart + guide.hours * 3600000);
    $("guideRange").textContent =
      pad2(from.getDate()) + "." + pad2(from.getMonth() + 1) + "  " +
      pad2(from.getHours()) + ":00 – " + pad2(to.getHours()) + ":00" +
      " • " + t("guide_count", { count: guide.items.length });

    var dateEl = $("guideDate");
    var ds = from.getFullYear() + "-" + pad2(from.getMonth() + 1) + "-" + pad2(from.getDate());
    if (dateEl && dateEl.value !== ds) dateEl.value = ds;
    var timeEl = $("guideTime");
    var ts = pad2(from.getHours()) + ":" + pad2(from.getMinutes());
    if (timeEl && timeEl.value !== ts) timeEl.value = ts;
  }

  /* -------------------- siatka programu TV rysowana „okienkowo” -------------
     W DOM trzymamy tylko widok z zapasem: GUIDE_OVERSCAN wierszy nad i pod
     ekranem. Resztę kanałów udają odstępy o wysokości wiersza, więc siatka
     wygląda i przewija się jak cała (wszystkie kanały!), a czas rysowania
     i pamięć są stałe — dlatego EPG nie zacina telewizora. */

  /* szerokość wnętrza siatki bez marginesów — tyle miejsca mają nazwy kanałów
     i oś czasu; gdy siatka jest jeszcze niewidoczna, bierzemy szerokość ekranu */
  function guideInnerWidth() {
    var grid = $("guideGrid");
    var width = grid && grid.clientWidth ? grid.clientWidth : 0;
    if (!width) return Math.max(640, (document.documentElement.clientWidth || 1280) - 48);
    if (window.getComputedStyle) {
      var style = window.getComputedStyle(grid);
      width -= (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    }
    return width;
  }

  /* Ile godzin zmieścić na ekranie: program TV ma wypełnić szerokość, a nie
     kończyć się w połowie (na 1080p wychodzi 4–5 godzin, na mniejszym 3). */
  function guideFitHours(innerWidth, channelWidth) {
    var room = Math.max(GUIDE_HOUR_MIN_W, innerWidth - channelWidth);
    var hours = Math.floor(room / GUIDE_HOUR_MIN_W);
    if (hours < GUIDE_MIN_HOURS) hours = GUIDE_MIN_HOURS;
    if (hours > GUIDE_MAX_HOURS) hours = GUIDE_MAX_HOURS;
    return hours;
  }

  /* Szerokość jednej godziny na osi: tyle, ile zostaje po podziale miejsca, i ani
     piksela więcej — cała oś (guide.hours godzin) musi zmieścić się w szerokości
     siatki. Przy godzinach dociągniętych do GUIDE_MIN_HOURS (wąski ekran) dzielenie
     wypada poniżej GUIDE_HOUR_MIN_W i wcześniej szerokość była podnoszona do tego
     minimum: oś wystawała za prawą krawędź, a że siatka przewija się tylko
     w pionie, program na końcu zakresu — razem z nazwą — znikał z ekranu (było go
     widać tyle, co nic). Teraz godzina zwęża się razem z ekranem, a
     GUIDE_HOUR_FIT_W pilnuje tylko, żeby kafelek dał się jeszcze trafić. */
  function guideHourWidth(room, hours) {
    var fit = Math.floor(Math.max(1, room) / Math.max(1, hours));
    return Math.max(GUIDE_HOUR_FIT_W, fit);
  }

  /* wysokość wiersza z CSS — odstępy muszą trafić w piksel */
  function guideRowHeight() {
    var row = $("guideRows") ? $("guideRows").querySelector(".guide-row") : null;
    var height = row && row.offsetHeight ? row.offsetHeight : 0;
    return height > 20 ? height : 96;
  }

  /* ile wierszy mieści się na ekranie (z zapasem, gdy siatka jest ukryta) */
  function guideRowsOnScreen() {
    var grid = $("guideGrid");
    var height = grid && grid.clientHeight ? grid.clientHeight : 0;
    if (!height) return 8;
    return Math.ceil(height / guide.rowHeight) + 1;
  }

  /* Od którego miejsca w siatce zaczyna się lista wierszy: oś czasu jest
     przyklejona u góry, więc wiersze widoczne pod nią trzeba liczyć z prostokątów
     elementów (siatka nie musi być pozycjonowana). */
  function guideRowsOffset() {
    var grid = $("guideGrid");
    var wrap = $("guideRows");
    if (!grid || !wrap) return 0;
    return wrap.getBoundingClientRect().top - grid.getBoundingClientRect().top + grid.scrollTop;
  }

  /* odstępy zamiast wierszy, których nie ma w DOM */
  function guideUpdateSpacers() {
    var wrap = $("guideRows");
    if (!wrap) return;
    var total = guide.items.length;
    wrap.style.paddingTop = (guide.winStart * guide.rowHeight) + "px";
    wrap.style.paddingBottom =
      (Math.max(0, total - guide.winStart - guide.rendered) * guide.rowHeight) + "px";
  }

  /* dokłada wiersze na końcu widoku (jedna porcja = jeden kanał na wiersz) */
  function guideFill(count) {
    var wrap = $("guideRows");
    if (!wrap) return;
    var now = Date.now();
    for (var i = 0; i < count && guide.winStart + guide.rendered < guide.items.length; i++) {
      wrap.appendChild(buildGuideRow(guide.items[guide.winStart + guide.rendered], now));
      guide.rendered++;
    }
    guideUpdateSpacers();
  }

  /* usuwa wiersze, które zostały daleko nad widokiem — pamięć i płynność;
     fokusu nie ruszamy, bo bez niego pilot zgubiłby się po przewinięciu */
  function guidePruneTop(limit) {
    var wrap = $("guideRows");
    if (!wrap) return;
    var keep = Math.max(0, limit);
    while (guide.winStart < keep && guide.rendered > 0) {
      var row = wrap.querySelector(".guide-row");
      if (!row || row.contains(document.activeElement)) break;
      wrap.removeChild(row);
      guide.winStart++;
      guide.rendered--;
    }
    guideUpdateSpacers();
  }

  /* który wiersz (kanał) ma fokus — liczony w całej liście kanałów, nie w widoku */
  function guideFocusRowIndex() {
    var active = document.activeElement;
    var row = active && active.closest ? active.closest(".guide-row") : null;
    if (!row || !row.parentNode) return -1;
    var rows = row.parentNode.querySelectorAll(".guide-row");
    var index = Array.prototype.indexOf.call(rows, row);
    return index < 0 ? -1 : index + guide.winStart;
  }

  /* Siatka domyka się do tego, co widać: dokłada wiersze pod widokiem i usuwa
     te, które zostały daleko nad nim. Fokus zostaje w DOM, więc ▲ ▼ nigdy nie
     „zatyka się” na końcu pomyślanej porcji. */
  function guideFollowScroll() {
    var grid = $("guideGrid");
    var wrap = $("guideRows");
    if (!grid || !wrap || !guide.rendered || !grid.clientHeight) return;
    var top = Math.max(0, grid.scrollTop - guideRowsOffset());
    var first = Math.floor(top / guide.rowHeight);
    var last = first + guideRowsOnScreen() + 1;
    var focusIndex = guideFocusRowIndex();
    guidePruneTop((focusIndex >= 0 ? Math.min(first, focusIndex) : first) - GUIDE_OVERSCAN);
    var need = last + GUIDE_OVERSCAN - (guide.winStart + guide.rendered);
    /* porcja na raz: przy skoku na koniec listy dorysowujemy tyle, ile widać */
    if (need > 0) guideFill(Math.min(need, guideRowsOnScreen() + GUIDE_OVERSCAN * 3));
  }

  /* ▲ ▼ na krawędzi widoku: dorysowujemy kolejne wiersze, zanim w DOM zabraknie
     programu — inaczej fokus stanąłby na ostatnim widocznym kanale */
  function guideEnsureAhead() {
    var index = guideFocusRowIndex();
    if (index < 0) return;
    var ahead = guide.winStart + guide.rendered - 1 - index;
    if (ahead < GUIDE_AHEAD) guideFill(GUIDE_AHEAD - ahead + GUIDE_CHUNK);
  }

  /* ustawia widok na wskazanym wierszu (EPG otwarte z odtwarzacza) */
  function guideScrollToRow(index) {
    var grid = $("guideGrid");
    var wrap = $("guideRows");
    if (!grid || !wrap || index <= 0) return;
    grid.scrollTop = Math.max(0, guideRowsOffset() + index * guide.rowHeight);
  }

  /* Przewijanie siatki woła guideFollowScroll() — dopiero wtedy dokładamy
     i usuwamy wiersze, więc samo otwarcie EPG nic nie kosztuje. */
  function ensureGuideScrollBound() {
    var grid = $("guideGrid");
    if (!grid || grid.getAttribute("data-guide-scroll") === "1") return;
    grid.setAttribute("data-guide-scroll", "1");
    grid.addEventListener("scroll", function () {
      if (guide.scrollLock) return;
      guide.scrollLock = true;
      window.setTimeout(function () {
        guide.scrollLock = false;
        guideFollowScroll();
      }, 80);
    });
  }

  /* linia bieżącej godziny — nad wierszami, więc przechodzi przez całą wysokość
     siatki, a podpis u góry pokazuje aktualną godzinę */
  function buildGuideNowLine() {
    var line = document.createElement("div");
    line.className = "guide-nowline";
    line.id = "guideNowLine";
    var chip = document.createElement("b");
    chip.className = "guide-nowline-label";
    line.appendChild(chip);
    return line;
  }

  /* godzina w formacie HH:MM na osi czasu programu TV */
  function guideClock(ms) {
    var d = new Date(ms);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  /* jeden kanał: nazwa i oś czasu z programami */
  function buildGuideRow(channel, now) {
    var start = guide.windowStart;
    var end = start + guide.hours * 3600000;
    var row = document.createElement("div");
    row.className = "guide-row";
    row.setAttribute("data-key", keyOf(channel));
    if (guide.focusKey && keyOf(channel) === guide.focusKey) row.classList.add("watching");

    var name = document.createElement("div");
    name.className = "guide-channel";
    var nm = document.createElement("span");
    nm.textContent = channel.name;
    name.appendChild(nm);
    row.appendChild(name);

    var lane = document.createElement("div");
    lane.className = "guide-lane";
    lane.style.width = (guide.hours * guide.hourWidth) + "px";

    var canCatchup = hasArchive(channel);
    programsFor(channel).filter(function (p) {
      return p.end > start && p.start < end;
    }).forEach(function (p) {
      lane.appendChild(buildGuideProgram(channel, p, now, canCatchup));
    });
    row.appendChild(lane);
    return row;
  }

  /* jeden program na osi: godzina, tytuł (do dwóch linii), podpis „LIVE”
     i pasek postępu tego, co leci teraz */
  function buildGuideProgram(channel, p, now, canCatchup) {
    var start = guide.windowStart;
    var end = start + guide.hours * 3600000;
    var block = document.createElement("button");
    block.className = "guide-program";
    var s = Math.max(p.start, start);
    var e = Math.min(p.end, end);
    /* Kafelek nie może wystawać za koniec osi. Wystający kawałek (krótki
       program na skraju okna) robił siatce poziomy pasek przewijania, a wtedy
       przeglądarka dosuwała widok do kafelka z fokusem: cała siatka uciekała
       w lewo, a fokus lądował na uciętej kolumnie. Skrajny kafelek jest więc
       dociągany do końca osi, zachowując najmniejszą czytelną szerokość. */
    var laneWidth = guide.hours * guide.hourWidth;
    var left = (s - start) / 3600000 * guide.hourWidth;
    var width = Math.max(44, ((e - s) / 3600000 * guide.hourWidth) - 6);
    if (left + width > laneWidth) {
      width = Math.max(44, laneWidth - left);
      left = Math.max(0, laneWidth - width);
    }
    block.style.left = left + "px";
    block.style.width = width + "px";
    /* Czas trwania programu bez przycięcia do okna: po przewinięciu godzin
       fokus wraca na ten sam moment programu, a nie na pierwszy kafelek. */
    block.setAttribute("data-start", String(p.start));
    block.setAttribute("data-end", String(p.end));

    var isPast = p.end <= now;
    var isNow = p.start <= now && now < p.end;
    /* materiał, który leci teraz w odtwarzaczu (także nagranie z archiwum) */
    var watching = isWatchedProgram(p);
    block.classList.toggle("past", isPast);
    block.classList.toggle("now", isNow);
    block.classList.toggle("playing", watching);
    /* Krótki program na osi: kafelek jest za wąski na nazwę i plakietkę naraz
       (patrz niżej). Wariant „narrow” daje nazwie więcej miejsca — mniejszy
       oddech i czcionka (styles.css), a plakietkę pomijamy. */
    var wide = width >= GUIDE_PILL_MIN_W;
    if (!wide) block.classList.add("narrow");
    /* Programu z przyszłości (i tego bez archiwum) nie da się włączyć, ale ma
       zostać na osi: pilot staje na nim i czyta, co będzie — inaczej ◀ ▶ nie
       dałoby się przesuwać podświetlenia w przód po programach (patrz
       guideStepProgram). Zablokowany kafelek jest więc zwykłym przyciskiem,
       który po naciśnięciu nic nie robi (patrz onclick niżej). */
    if (p.start > now || (isPast && !canCatchup)) {
      block.classList.add("blocked");
      block.setAttribute("aria-disabled", "true");
    }
    /* na wąskim kafelku tytuł bywa ucięty — pełny pokazuje podpowiedź */
    block.title = guideClock(p.start) + "–" + guideClock(p.end) + "  " + p.title;

    var tm = document.createElement("time");
    tm.textContent = guideClock(p.start);
    block.appendChild(tm);
    var titleRow = document.createElement("div");
    titleRow.className = "guide-title-row";
    var lab = document.createElement("span");
    lab.textContent = p.title;
    titleRow.appendChild(lab);
    /* program, który leci teraz, dostaje podpis „LIVE”; materiał odtwarzany
       z archiwum — własny podpis („odtwarzane”), żeby na siatce było widać, co
       leci, także wtedy, gdy to nie jest program bieżący */
    /* Wąski kafelek (krótki program na osi) nie pomieści naraz nazwy i
       plakietki: pill brał całą szerokość, a tytuł uciekał do samego
       wielokropka. Poniżej GUIDE_PILL_MIN_W plakietkę pomijamy — nazwa jest
       ważniejsza, a że to program bieżący (albo odtwarzany), zdradza już
       obwódka akcentu (patrz .guide-program.now / .playing). */
    if (watching) {
      if (wide) {
        var playing = document.createElement("em");
        playing.className = "program-playing";
        playing.textContent = t("program_playing");
        titleRow.appendChild(playing);
      }
    } else if (isNow) {
      if (wide) {
        var live = document.createElement("em");
        live.className = "guide-live";
        live.textContent = t("live");
        titleRow.appendChild(live);
      }
    }
    block.appendChild(titleRow);

    /* pasek postępu programu, który leci teraz — od razu widać, ile zostało */
    if (isNow && p.end > p.start) {
      var bar = document.createElement("i");
      bar.className = "guide-progress";
      bar.style.width = Math.max(2, Math.min(100, (now - p.start) / (p.end - p.start) * 100)) + "%";
      block.appendChild(bar);
    }

    block.onclick = function () {
      if (isNow) playChannel(channel, null, "guideScreen");
      else if (isPast && canCatchup) playChannel(channel, p, "guideScreen");
    };
    return block;
  }

  /* Wskakując w siatkę z nagłówka, wchodzimy na to, co widać: najpierw oglądany
     kanał (EPG otwarte z odtwarzacza), potem program przy górnej krawędzi. */
  function guideEntryBlock() {
    var grid = $("guideGrid");
    if (!grid) return null;
    if (guide.focusKey) {
      var rows = grid.querySelectorAll(".guide-row");
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].getAttribute("data-key") !== guide.focusKey) continue;
        var watched = rows[i].querySelector(".guide-program.now") ||
          rows[i].querySelector(".guide-program");
        if (watched) return watched;
      }
    }
    var blocks = grid.querySelectorAll(".guide-program");
    if (!blocks.length) return null;
    var edge = grid.getBoundingClientRect().top + 8;
    var best = null;
    var bestTop = Infinity;
    for (var b = 0; b < blocks.length; b++) {
      var rect = blocks[b].getBoundingClientRect();
      if (rect.bottom < edge) continue;
      if (rect.top < bestTop) { bestTop = rect.top; best = blocks[b]; }
    }
    return best || blocks[0];
  }

  /* ---------------- kafelek pod fokusem a oś czasu ----------------
     Siatka przewija się tylko w pionie, a w poziomie widok przesuwa się
     wyłącznie ◀ ▶ (o godzinę). Fokus pilnujemy sami, po współrzędnych:
     silnik po sfokusowaniu kafelka dosuwa go do widoku także w poziomie
     i wtedy cała siatka — razem z nazwami kanałów — uciekała w lewo. */

  /* Fokus bez przewijania: przewijanie siatki robimy sami (patrz
     revealGuideBlock), więc silnik nie może nas w tym wyręczyć */
  function focusKeepScroll(element) {
    if (!element || !element.focus) return;
    try { element.focus({ preventScroll: true }); }
    catch (error) { try { element.focus(); } catch (error2) { /* bez fokusu też da się kliknąć */ } }
  }

  /* Dosuwa siatkę o brakujący kawałek: kafelek ma być widoczny nad
     przyklejoną osią czasu i nad dolną krawędzią — ani piksela więcej.
     scrollIntoView() wyrównywał kafelek do samego dołu (duże, nierówne skoki
     co ▲ ▼) i w dodatku ruszał widok w poziomie. */
  function revealGuideBlock(block) {
    var grid = $("guideGrid");
    if (!grid || !block || !grid.clientHeight) return;
    /* Widok w poziomie zostaje na początku osi: tylko wtedy widoczny zakres
       równa się oknu czasu i podświetlony kafelek nie ucieka za krawędź
       (guideHourWidth pilnuje, żeby oś w ogóle się mieściła). */
    if (grid.scrollLeft) grid.scrollLeft = 0;
    var head = guideRowsOffset();                       /* wysokość przyklejonej osi czasu */
    var box = grid.getBoundingClientRect();
    var rect = block.getBoundingClientRect();
    var top = rect.top - box.top;
    var bottom = rect.bottom - box.top;
    var view = grid.clientHeight;
    var up = head + 2 - top;                            /* ile brakuje u góry */
    var down = bottom - (view - 2);                     /* ile wystaje dołem */
    if (up > 0 && down > 0) grid.scrollTop += (up <= down ? -up : down);
    else if (up > 0) grid.scrollTop -= up;
    else if (down > 0) grid.scrollTop += down;
    guideEnsureAhead();
    guideFocusNote(block);
  }

  /* Nazwa programu pod podświetleniem, nad siatką. Kafelek bywa wąski (krótki
     program na osi), a wtedy tytuł w nim jest ucinany wielokropkiem — podpis
     podaje więc pełną nazwę i godziny tego, na czym stoi pilot, zawsze w tym
     samym miejscu ekranu. Bez podświetlenia (null) podpis znika. */
  function guideFocusNote(block) {
    var note = $("guideFocusName");
    if (!note) return;
    var label = block && block.querySelector ? block.querySelector(".guide-title-row span") : null;
    var start = block && block.getAttribute ? parseInt(block.getAttribute("data-start"), 10) : NaN;
    var end = block && block.getAttribute ? parseInt(block.getAttribute("data-end"), 10) : NaN;
    var title = label ? (label.textContent || "") : "";
    if (!title || !isFinite(start) || !isFinite(end)) {
      note.textContent = "";
      return;
    }
    note.textContent = t("guide_focus_name", {
      from: guideClock(start),
      to: guideClock(end),
      title: title
    });
  }

  /* Moment programu pod fokusem (środek kafelka) — po przewinięciu osi
     wracamy z fokusem na ten sam moment, a nie na początek wiersza */
  function guideFocusTime() {
    var active = document.activeElement;
    if (!active || !active.getAttribute) return 0;
    var start = parseInt(active.getAttribute("data-start"), 10);
    if (!isFinite(start)) return 0;
    var end = parseInt(active.getAttribute("data-end"), 10);
    if (!isFinite(end) || end <= start) return start;
    return start + (end - start) / 2;
  }

  /* Program, w którym mieści się podany moment (null, gdy w tym kanale nie ma
     takiego programu — wtedy o fokusie decyduje wołający) */
  function guideBlockContaining(row, time) {
    if (!time) return null;
    var blocks = row.querySelectorAll(".guide-program");
    for (var i = 0; i < blocks.length; i++) {
      var start = parseInt(blocks[i].getAttribute("data-start"), 10);
      var end = parseInt(blocks[i].getAttribute("data-end"), 10);
      if (!isFinite(start) || !isFinite(end)) continue;
      if (time >= start && time < end) return blocks[i];
    }
    return null;
  }

  /* Program obejmujący podany moment; przy przerwie w EPG — najbliższy.
     Bez zapamiętanego momentu zostaje dotychczasowe zachowanie: to, co leci
     teraz, a gdy takiego nie ma — pierwszy program w kanale. */
  function guideBlockAtTime(row, time) {
    var blocks = row.querySelectorAll(".guide-program");
    if (!blocks.length) return null;
    if (!time) {
      var live = row.querySelector(".guide-program.now");
      return live || blocks[0];
    }
    var containing = guideBlockContaining(row, time);
    if (containing) return containing;
    var best = blocks[0];
    var bestGap = Infinity;
    for (var i = 0; i < blocks.length; i++) {
      var start = parseInt(blocks[i].getAttribute("data-start"), 10);
      var end = parseInt(blocks[i].getAttribute("data-end"), 10);
      if (!isFinite(start) || !isFinite(end)) continue;
      var gap = time < start ? start - time : (time >= end ? time - end : 0);
      if (gap < bestGap) { bestGap = gap; best = blocks[i]; }
    }
    return best;
  }

  /* fokus na programie wskazanego wiersza — po przewinięciu dnia albo godzin
     ten sam kanał i ten sam moment programu zostają pod palcem */
  function focusGuideRowBlock(index, time, sameTime) {
    var wrap = $("guideRows");
    var rows = wrap ? wrap.querySelectorAll(".guide-row") : [];
    var local = index - guide.winStart;
    if (local < 0 || local >= rows.length) return null;
    var row = rows[local];
    /* Najpierw ten sam moment (◀ ▶ o godzinę: program jedzie z osią i zostaje
       pod palcem), potem ta sama godzina nowego dnia („Wczoraj”, „Dzień ›” —
       po przeskoku o dobę moment bezwzględny jest już poza oknem), a na końcu
       najbliższy program: po przerwie w EPG lepiej trafić w sąsiedztwo niż
       nie trafić wcale. */
    var block = guideBlockContaining(row, time) || guideBlockContaining(row, sameTime) ||
      guideBlockAtTime(row, time || sameTime);
    if (!block) return null;
    focusKeepScroll(block);
    guideEnsureAhead();
    guideFocusNote(block);
    /* zwracamy kafelek: wołający (▲ ▼) wie dzięki temu, że w tym wierszu było
       na czym stanąć, i nie idzie dalej po liście kanałów */
    return block;
  }

  /* Jak daleko od górnej krawędzi siatki leży wiersz z fokusem (w pikselach
     ekranu) — tyle wystarczy, żeby po przerysowaniu odtworzyć to samo miejsce */
  function guideRowViewportOffset() {
    var grid = $("guideGrid");
    var active = document.activeElement;
    var row = active && active.closest ? active.closest(".guide-row") : null;
    if (!grid || !row) return null;
    return row.getBoundingClientRect().top - grid.getBoundingClientRect().top;
  }

  /* przywraca wiersz z fokusem w to samo miejsce na ekranie (o ile przerysowanie
     przesunęło go o więcej niż piksel) */
  function guideRestoreRowOffset(offset) {
    var grid = $("guideGrid");
    if (!grid || offset === null || offset === undefined) return;
    var now = guideRowViewportOffset();
    if (now === null || !isFinite(now)) return;
    var delta = now - offset;
    if (Math.abs(delta) < 1.5) return;
    grid.scrollTop = Math.max(0, grid.scrollTop + delta);
  }

  /* Fokus (i przewinięcie siatki) na oglądanym kanale — EPG otwarte z paska
     odtwarzacza od razu pokazuje, co leci teraz na tym kanale. */
  function focusGuideWatched() {
    var grid = $("guideGrid");
    if (!grid || !guide.focusKey) return;
    var rows = grid.querySelectorAll(".guide-row");
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute("data-key") !== guide.focusKey) continue;
      var block = rows[i].querySelector(".guide-program.now") ||
        rows[i].querySelector(".guide-program");
      if (block) {
        focusKeepScroll(block);
        revealGuideBlock(block);
      }
      return;
    }
  }

  /* =====================  LINIA BIEŻĄCEJ GODZINY (EPG)  =====================
     Pionowa linia przez całą siatkę pokazuje, gdzie na osi czasu jesteśmy
     teraz — jednym rzutem oka widać, co leci, a co da się jeszcze cofnąć
     z archiwum. Podpis u góry osi to aktualna godzina. Linia odświeża się
     sama, dopóki program TV jest otwarty (patrz startGuideNowLine). */

  function updateGuideNowLine() {
    var line = $("guideNowLine");
    if (!line) return;

    var start = guide.windowStart;
    var now = Date.now();
    /* inny dzień niż dzisiejszy: bieżącej godziny nie ma na osi, linia znika */
    if (now < start || now > start + guide.hours * 3600000) {
      line.classList.add("hidden");
      return;
    }
    line.classList.remove("hidden");

    /* kolumnę z nazwami kanałów mierzymy w siatce, a nie przepisujemy z CSS —
       linia ma wypaść dokładnie na początku osi czasu */
    var wrap = line.parentNode;
    var lane = wrap && wrap.querySelector ? wrap.querySelector(".guide-lane") : null;
    var base = lane && lane.offsetLeft ? lane.offsetLeft : GUIDE_CHANNEL_WIDTH;
    line.style.left = (base + (now - start) / 3600000 * guide.hourWidth) + "px";

    var label = line.querySelector ? line.querySelector(".guide-nowline-label") : null;
    if (label) {
      var clock = new Date(now);
      label.textContent = pad2(clock.getHours()) + ":" + pad2(clock.getMinutes());
    }
  }

  function stopGuideNowLine() {
    if (!guide.lineTimer) return;
    clearInterval(guide.lineTimer);
    guide.lineTimer = null;
  }

  function startGuideNowLine() {
    stopGuideNowLine();
    guide.lineTimer = setInterval(updateGuideNowLine, GUIDE_NOWLINE_MS);
  }

  /* =========================  OSD ODTWARZACZA (MINI-EPG)  =========================
     Pasek odtwarzacza pokazuje, co leci teraz i co będzie następne na oglądanym
     kanale — mini-EPG bez opuszczania obrazu. Znika sam po OSD_AUTOHIDE ms, ale
     zostaje na ekranie, gdy obraz jest zatrzymany (klasyczne zachowanie TV). */

  function osdVisible() {
    var overlay = $("playerOverlay");
    return !!overlay && !overlay.classList.contains("hidden");
  }

  /* options.menu = true, gdy pasek otwiera użytkownik (OK / dotknięcie): wtedy
     ▲ ▼ chodzą po jego przyciskach. Pasek pokazany przy zmianie kanału, skoku
     albo pauzie to tylko informacja — ▲ ▼ z obrazu dalej przełączają kanały. */
  function showOsd(options) {
    if (settings.osdEnabled === false) return;
    var overlay = $("playerOverlay");
    if (!overlay) return;
    state.osdMenu = !!(options && options.menu);
    overlay.classList.remove("hidden");
    updateOsd();
    scheduleOsdHide();
    if (!state.osdTicker) {
      /* zegar odświeża EPG co sekundę, żeby pasek nie „zamarzł” na kanale */
      state.osdTicker = setInterval(updateOsd, 1000);
    }
  }

  function hideOsd() {
    var overlay = $("playerOverlay");
    if (overlay) {
      overlay.classList.add("hidden");
      /* fokus nie może zostać na ukrytym przycisku — inaczej pilot „gubi się” */
      suspendFocusInside(overlay);
    }
    state.osdMenu = false;
    clearTimeout(state.osdTimer);
    state.osdTimer = null;
    if (state.osdTicker) {
      clearInterval(state.osdTicker);
      state.osdTicker = null;
    }
  }

  function toggleOsd() {
    if (osdVisible()) hideOsd();
    /* OK otwiera pasek jako menu — patrz ▲ ▼ w obsłudze klawiszy odtwarzacza */
    else showOsd({ menu: true });
  }

  /* ------------------  ▲ ▼ W ODTWARZACZU: KANAŁ CZY MENU?  ------------------
     Pasek otwarty klawiszem OK jest menu: pierwsze ▲ ▼ wchodzi w jego przyciski
     („Pauza”, „EPG”…), a nie przełącza kanału. Bez tego ▼ po otwarciu paska
     zmieniało kanał i do przycisków nie dało się dojść. Pasek pokazany przy
     zmianie kanału jest tylko informacją, więc ▲ ▼ dalej przełączają kanały —
     dlatego CH+ działa naciśnięcie po naciśnięciu, bez wchodzenia w menu. */

  /* wejście z obrazu na pierwszy przycisk paska; false = nie ma na czym stanąć */
  function enterOsdBar() {
    var bar = $("playerActions");
    var buttons = bar ? bar.querySelectorAll("button") : [];
    if (!buttons.length) return false;
    state.osdMenu = true;
    try {
      buttons[0].focus();
    } catch (error) {
      return false;
    }
    keepInView(buttons[0]);
    scheduleOsdHide();
    return true;
  }

  /* wyjście z paska z powrotem na obraz: bez fokusu na przycisku ▲ ▼ znowu
     przełączają kanały, a pasek zgaśnie sam (albo zostanie jako informacja) */
  function leaveOsdBar() {
    var bar = $("playerActions");
    suspendFocusInside(bar || document.body);
    state.osdMenu = false;
    scheduleOsdHide();
  }

  /* pasek znika sam — chyba że obraz jest zatrzymany albo użytkownik właśnie
     nawiguje po jego przyciskach (wtedy licznik startuje od nowa) */
  function scheduleOsdHide() {
    clearTimeout(state.osdTimer);
    var video = $("video");
    if (!osdVisible() || (video && video.paused)) {
      state.osdTimer = null;
      return;
    }
    state.osdTimer = setTimeout(function () {
      state.osdTimer = null;
      hideOsd();
    }, OSD_AUTOHIDE);
  }

  function suspendFocusInside(element) {
    var active = document.activeElement;
    if (active && element.contains(active) && active.blur) active.blur();
  }

  function osdTime(ms) {
    var date = new Date(ms);
    return pad2(date.getHours()) + ":" + pad2(date.getMinutes());
  }

  /* przyciski paska budowane raz na kanał; etykiety odświeża updateOsd() */
  function osdButton(id, label, action) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "osd-button";
    button.tabIndex = 0;
    setIconLabel(button, label);
    button.setAttribute("data-osd", id);
    button.onclick = function (event) {
      if (event) event.stopPropagation();
      action();
      scheduleOsdHide();
    };
    /* fokus na przycisku paska (mysz, dotyk) = pasek jest menu: ▲ ▼ chodzą
       po przyciskach, tak samo jak po otwarciu paska klawiszem OK */
    button.onfocus = function () {
      state.osdMenu = true;
      scheduleOsdHide();
    };
    return button;
  }

  /* Pasek odtwarzacza. Kolejność jest stała, a przyciski zmieniają się razem
     z tym, co naprawdę da się zrobić: „Od początku” jest wtedy, gdy znamy
     program, „Na żywo” tylko wtedy, gdy obraz nie jest na żywo, a „EPG”
     otwiera listę programów oglądanego kanału. Menu opcji kanału zostaje pod
     klawiszem MENU / trzymanym OK — nie dublujemy go na pasku. */
  function buildOsdActions() {
    var bar = $("playerActions");
    if (!bar) return;
    bar.textContent = "";
    var channel = state.watchChannel;
    if (!channel) return;

    bar.appendChild(osdButton("play", t("osd_pause"), togglePlayPause));

    if (state.isArchive || currentProgram(channel)) {
      bar.appendChild(osdButton("restart", t("osd_restart"), restartWatching));
    }

    if (state.isArchive) {
      /* nagranie: skok po archiwum i powrót do bieżącego programu */
      bar.appendChild(osdButton("prev", t("osd_prev_program"), function () { watchProgramStep(-1); }));
      bar.appendChild(osdButton("next", t("osd_next_program"), function () { watchProgramStep(1); }));
    }

    /* EPG oglądanego kanału: lista programów (poprzednie, bieżący i następne),
       z której wybiera się materiał do odtworzenia z archiwum */
    bar.appendChild(osdButton("epg", t("osd_epg"), openPlayerGuide));

    if (state.isArchive) bar.appendChild(osdButton("live", t("osd_live"), goLive));

    bar.appendChild(osdButton("mute", t("osd_mute"), toggleMute));

    /* Diagnostyka obrazu: pokazuje, na czym stoi odbiornik i co robi element
       <video> — otwiera się też sama, gdy dźwięk gra, a klatek nie ma
       (patrz maybeAutoDiagnose). Dlatego jest także na pilocie, nie tylko na
       ekranie dotykowym. */
    bar.appendChild(osdButton("diag", t("osd_diag"), toggleDiagnostics));

    /* Na telewizorze te dwie akcje są na pilocie (MENU / trzymane OK oraz
       Wstecz), więc przyciski na pasku byłyby tylko duplikatem — dlatego
       pokazują się wyłącznie w trybie dotykowym (CSS: .osd-touch-only).
       Na telefonie to jedyna droga do menu opcji kanału i do wyjścia. */
    bar.appendChild(osdButton("options", t("ctx_menu"), function () {
      openContextMenu(state.watchChannel);
    })).classList.add("osd-touch-only");
    bar.appendChild(osdButton("back", t("osd_back"), stopPlayback)).classList.add("osd-touch-only");
  }

  /* „EPG” na pasku odtwarzacza: lista programów oglądanego kanału. Wybranie
     pozycji odtwarza ją z archiwum, „Na żywo” wraca do bieżącej chwili. */
  function openPlayerGuide() {
    if (!state.watchChannel) return;
    openArchive(state.watchChannel, { fromPlayer: true });
  }

  /* ⏵‖ (przycisk na pasku i klawisz play/pauza na pilocie). */
  function togglePlayPause() {
    if (nativeLayerActive()) {
      if (nativePlaying()) pausePlayback();
      else resumePlayback();
      return;
    }
    var video = $("video");
    if (!video) return;
    if (video.paused) resumePlayback();
    else pausePlayback();
  }

  /* Pauza na kanale na żywo zapamiętuje chwilę zatrzymania — obraz leci dalej,
     więc wznowienie musi wrócić dokładnie tam (patrz resumePlayback). */
  function pausePlayback() {
    if (nativeLayerActive()) {
      if (!state.isArchive && state.watchChannel) state.livePauseAt = Date.now();
      nativeSetPlaying(false);
      showOsd();
      updateOsd();
      return;
    }
    var video = $("video");
    if (!video) return;
    if (!state.isArchive && state.watchChannel) state.livePauseAt = Date.now();
    video.pause();
    showOsd();
    updateOsd();
  }

  /* Wznowienie po pauzie. Kanał na żywo po dłuższej pauzie zdążył uciec do
     przodu, więc wracamy do momentu zatrzymania przez archiwum (okno catch-up
     kończące się teraz). Bez archiwum — albo przy krótkiej pauzie — zwykłe
     wznowienie odtwarzacza. */
  function resumePlayback() {
    var channel = state.watchChannel;
    var pausedAt = state.livePauseAt;
    state.livePauseAt = 0;

    if (!state.isArchive && channel && pausedAt &&
        Date.now() - pausedAt > RESUME_AFTER_PAUSE && hasArchive(channel)) {
      var program = currentProgram(channel);
      playChannel(channel, {
        start: pausedAt,
        end: Date.now(),
        title: program ? program.title : channel.name,
        timeshift: true
      }, "playerScreen");
      return;
    }

    /* obraz systemowy i VLC wznawiają się przez most — elementu <video> tam nie ma */
    if (nativeLayerActive()) {
      nativeSetPlaying(true);
      updateOsd();
      scheduleOsdHide();
      return;
    }

    var video = $("video");
    if (!video) return;
    var promise = video.play();
    if (promise && promise.catch) promise.catch(function () {});
    updateOsd();
    scheduleOsdHide();
  }

  /* 🔇 na pilocie (i przycisk na pasku): wyciszenie dźwięku strumienia.
     Głośność samego telewizora należy do sprzętu — tu wyciszamy odtwarzacz. */
  function toggleMute() {
    if (nativeLayerActive()) {
      nativeSetMuted(!nativeMuted());
      showOsd();
      updateOsd();
      return;
    }
    var video = $("video");
    if (!video) return;
    video.muted = !video.muted;
    showOsd();
    updateOsd();
  }

  function isMuted() {
    if (nativeLayerActive()) return nativeMuted();
    var video = $("video");
    return !!(video && video.muted);
  }

  function muteLabel() {
    return t(isMuted() ? "osd_unmute" : "osd_mute");
  }

  /* „Od początku”: w archiwum powtarza bieżące nagranie, na kanale na żywo
     przechodzi do catch-up początku programu, który leci w tej chwili */
  function restartWatching() {
    var channel = state.watchChannel;
    if (!channel) return;

    if (state.isArchive && state.watchProgram) {
      var program = state.watchProgram;
      playChannel(channel, { start: program.start, end: program.end, title: program.title }, "playerScreen");
      return;
    }

    var now = currentProgram(channel);
    if (now && hasArchive(channel)) {
      playChannel(channel, now, "playerScreen");
      return;
    }
    showPlayerError(t("err_catchup"));
    scheduleOsdHide();
  }

  function goLive() {
    if (!state.watchChannel) return;
    playChannel(state.watchChannel, null, "playerScreen");
  }

  /* ◀/▶ na pasku archiwum: poprzednie / następne nagranie tego samego kanału */
  function watchProgramStep(direction) {
    var channel = state.watchChannel;
    var current = state.watchProgram;
    if (!channel || !current) return;

    var now = Date.now();
    var playable = programsFor(channel).filter(function (program) {
      return program.end > program.start && program.end <= now;
    });
    playable.sort(function (a, b) { return a.start - b.start; });
    if (!playable.length) return;

    var index = -1;
    for (var i = 0; i < playable.length; i++) {
      if (playable[i].start <= current.start) index = i;
      else break;
    }
    var target = playable[index + direction];
    if (!target) return;
    playChannel(channel, target, "playerScreen");
  }

  /* ---------------------  TREŚĆ PASKA: MINI-EPG KANAŁU  --------------------- */

  function updateOsd() {
    var channel = state.watchChannel;
    if (!channel) return;

    var video = $("video");
    var program = state.watchProgram;
    var titleEl = $("playerTitle");
    var nowRow = $("playerNow");
    var nextRow = $("playerNext");
    var timeEl = $("playerTime");
    var hintEl = $("playerHint");

    if (titleEl) titleEl.textContent = channel.name;

    if (program) {
      /* odtwarzamy archiwum — pokazujemy nagranie i jego własny postęp */
      if (nowRow) {
        nowRow.textContent = "";
        var label = document.createElement("span");
        label.className = "osd-time";
        label.textContent = t("catchup") + ":";
        nowRow.appendChild(label);
        nowRow.appendChild(document.createTextNode(program.title));
      }
      if (nextRow) nextRow.textContent = formatRange(program.start, program.end);
      if (hintEl) hintEl.textContent = t("osd_hint_archive");
    } else {
      var now = currentProgram(channel);
      var next = nextProgram(channel);

      if (nowRow) {
        nowRow.textContent = "";
        if (now) {
          var nowTime = document.createElement("span");
          nowTime.className = "osd-time";
          nowTime.textContent = osdTime(now.start) + "–" + osdTime(now.end);
          nowRow.appendChild(nowTime);
          nowRow.appendChild(document.createTextNode(now.title));
        } else {
          nowRow.textContent = t("epg_none");
        }
      }
      if (nextRow) {
        nextRow.textContent = next
          ? t("osd_next_label") + " " + osdTime(next.start) + "–" + osdTime(next.end) + "  " + next.title
          : "";
      }
      if (timeEl) {
        timeEl.textContent = engineLabel(state.engine) +
          (video && video.paused && !nativeLayerActive() ? " • " + t("osd_paused") : "") +
          (isMuted() ? " • " + t("osd_muted") : "");
      }
      if (hintEl) hintEl.textContent = t("osd_hint_live");
    }

    updateOsdProgress();
    refreshSeekNotice();

    var bar = $("playerActions");
    var playButton = bar ? bar.querySelector('[data-osd="play"]') : null;
    /* Obraz systemowy i VLC nie mają elementu <video> — czy obraz jest zatrzymany,
       mówi most (patrz state.exoPlaying / state.vlcPlaying), a nie video.paused. */
    var paused = nativeLayerActive() ? !nativePlaying() : !!(video && video.paused);
    if (playButton) setIconLabel(playButton, t(paused ? "osd_play" : "osd_pause"));
    var muteButton = bar ? bar.querySelector('[data-osd="mute"]') : null;
    if (muteButton) setIconLabel(muteButton, muteLabel());
  }

  /* tanie odświeżanie (timeupdate / zegar): tylko pasek postępu i czas */
  function updateOsdProgress() {
    var channel = state.watchChannel;
    if (!channel || !osdVisible()) return;

    var video = $("video");
    var bar = $("playerProgress");
    if (!bar) return;

    var programSeconds = state.isArchive ? archiveProgramSeconds() : 0;

    /* Nagranie z obrazem silnika odbiornika (VLC): pozycję i długość okna zna
       tylko silnik (patrz vlcEvent), a element <video> ich nie ma — dlatego ten
       wiersz idzie pierwszy. Okno o nieznanej długości (kanał na żywo) nie ma
       czego pokazywać i zostaje przy pasku programu z EPG. */
    if (state.isArchive && vlcActive() && state.vlcLength > 0) {
      var total = state.vlcLength / 1000;
      if (programSeconds > 0) total = Math.min(total, programSeconds);
      var at = Math.min(state.vlcTime | 0, total * 1000);
      bar.style.width = Math.min(100, Math.max(0, (at / (total * 1000)) * 100)) + "%";
      var vlcTimeEl = $("playerTime");
      if (vlcTimeEl) {
        vlcTimeEl.textContent = formatTime(at / 1000) + " / " + formatTime(total) +
          (isMuted() ? " • " + t("osd_muted") : "");
      }
      return;
    }

    if (state.isArchive && video && isFinite(video.duration) && video.duration > 0) {
      var windowSeconds = video.duration;
      if (programSeconds > 0) windowSeconds = Math.min(windowSeconds, programSeconds);
      var where = Math.min(video.currentTime, windowSeconds);
      bar.style.width = (where / windowSeconds) * 100 + "%";
      var timeEl = $("playerTime");
      if (timeEl) {
        timeEl.textContent = formatTime(where) + " / " + formatTime(windowSeconds) +
          (isMuted() ? " • " + t("osd_muted") : "");
      }
      return;
    }

    /* kanał na żywo: pasek pokazuje, jak daleko jesteśmy w bieżącym programie */
    var now = currentProgram(channel);
    bar.style.width = now
      ? Math.max(0, Math.min(100, (Date.now() - now.start) / (now.end - now.start) * 100)) + "%"
      : "0%";
  }

  /* ------------------------  MENU OPCJI KANAŁU (pilot)  ------------------------ */

  function currentScreenId() {
    for (var i = 0; i < SCREENS.length; i++) {
      var el = $(SCREENS[i]);
      if (el && !el.classList.contains("hidden")) return SCREENS[i];
    }
    return "browserScreen";
  }

  function hideContextMenu() {
    var menu = $("contextMenu");
    if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
  }

  function ctxButton(label, action) {
    var button = document.createElement("button");
    button.type = "button";
    button.tabIndex = 0;
    setIconLabel(button, label);
    button.onclick = function (event) {
      if (event) event.stopPropagation();
      action();
    };
    return button;
  }

  /* Menu opcji kanału: otwierane trzymanym OK na kafelku (albo klawiszem MENU
     w odtwarzaczu). Wszystkie pozycje to zwykłe przyciski, więc pilot obsługuje
     je bez dodatkowego kodu. */
  function openContextMenu(channel) {
    hideContextMenu();
    var target = channel || state.watchChannel || state.selectedChannel;
    if (!target) return;
    /* z odtwarzacza (MENU / trzymane OK) menu dostaje dodatkowo akcje obrazu */
    var inPlayer = currentScreenId() === "playerScreen" && !!state.watchChannel;

    var menu = document.createElement("section");
    menu.id = "contextMenu";
    menu.className = "ctx-menu";

    var card = document.createElement("div");
    card.className = "ctx-card";

    var title = document.createElement("h2");
    title.className = "ctx-title";
    title.textContent = t("ctx_menu");
    card.appendChild(title);

    var subtitle = document.createElement("p");
    subtitle.className = "ctx-sub";
    subtitle.textContent = target.name;
    card.appendChild(subtitle);

    var actions = document.createElement("div");
    actions.className = "ctx-actions";

    actions.appendChild(ctxButton(t("ctx_play"), function () {
      hideContextMenu();
      playChannel(target, null, currentScreenId() === "playerScreen" ? "playerScreen" : currentScreenId());
    }));

    actions.appendChild(ctxButton(isFavorite(target) ? t("ctx_fav_del") : t("ctx_fav_add"), function () {
      hideContextMenu();
      toggleFavorite(target);
    }));

    if (hasArchive(target)) {
      actions.appendChild(ctxButton(t("ctx_archive"), function () {
        hideContextMenu();
        openArchive(target);
      }));
    }

    actions.appendChild(ctxButton(t("ctx_epg"), function () {
      hideContextMenu();
      /* Program TV staje na tym kanale — także poza odtwarzaczem, żeby od razu
         było widać, co leci teraz, bez szukania wiersza na liście */
      if (inPlayer) openGuide({ channel: target, returnTo: "playerScreen" });
      else openGuide({ channel: target });
    }));

    if (inPlayer) {
      /* Odtwarzacz: te same akcje co na pasku. Pilotem ▲▼ zmieniają kanał, więc
         do opcji obrazu dochodzi się przez MENU albo trzymane OK. */
      if (state.watchProgram) {
        actions.appendChild(ctxButton(t("osd_restart"), function () {
          hideContextMenu();
          restartWatching();
        }));
        actions.appendChild(ctxButton(t("osd_prev_program"), function () {
          hideContextMenu();
          watchProgramStep(-1);
        }));
        actions.appendChild(ctxButton(t("osd_next_program"), function () {
          hideContextMenu();
          watchProgramStep(1);
        }));
        actions.appendChild(ctxButton(t("osd_live"), function () {
          hideContextMenu();
          goLive();
        }));
      } else if (currentProgram(target)) {
        actions.appendChild(ctxButton(t("osd_restart"), function () {
          hideContextMenu();
          restartWatching();
        }));
      }
      actions.appendChild(ctxButton(muteLabel(), function () {
        hideContextMenu();
        toggleMute();
      }));
    }

    actions.appendChild(ctxButton(t("ctx_close"), hideContextMenu));

    card.appendChild(actions);
    menu.appendChild(card);
    document.body.appendChild(menu);

    /* fokus na pierwszej pozycji — pilot może działać od razu */
    var first = actions.querySelector("button");
    if (first) {
      try { first.focus(); } catch (error) { /* bez fokusu też da się kliknąć */ }
    }
  }

  /* -------------------------  OK: krótko vs. trzymane  ------------------------- */

  /* kafelek kanału, na którym stoi fokus (potrzebny przy trzymanym OK) */
  function focusedChannelCard() {
    var active = document.activeElement;
    if (!active || !active.closest) return null;
    var card = active.closest(".channel");
    var container = $("channels");
    if (!card || !container) return null;
    var index = Array.prototype.indexOf.call(container.children, card);
    if (index < 0 || index >= state.listItems.length) return null;
    return state.listItems[index];
  }

  /* Krótkie OK uruchamia onShort, trzymane OK (OK_HOLD_MS) otwiera menu opcji.
     Jedno naciśnięcie = jedna akcja, dlatego rozstrzygamy to na zwolnieniu. */
  function startOkHold(onShort) {
    clearTimeout(state.okHoldTimer);
    state.okAction = onShort || null;
    state.okFired = false;
    state.okHoldTimer = setTimeout(function () {
      state.okHoldTimer = null;
      state.okFired = true;
      state.okAction = null;
      openContextMenu(focusedChannelCard() || state.watchChannel || state.selectedChannel);
    }, OK_HOLD_MS);
  }

  function releaseOk() {
    var fired = state.okFired;
    var action = state.okAction;
    clearTimeout(state.okHoldTimer);
    state.okHoldTimer = null;
    state.okAction = null;
    state.okFired = false;
    if (fired) return;               /* menu zdążyło się otworzyć */
    if (action) action();
    else if (currentScreenId() === "playerScreen") toggleOsd();
  }

  /* OK rozstrzygnięte, zanim pilot zdążył zwolnić klawisz: ▲ albo ▼ przyszło
     w trakcie trzymania OK. Pilot wysyła strzałkę szybciej, niż odbiornik
     donosi o puszczeniu klawisza — bez tego ▼ zmieniało kanał, choć użytkownik
     właśnie chciał wejść w przyciski paska. Zwolnienie klawisza nie robi już
     wtedy nic (state.okFired), więc jedno naciśnięcie to nadal jedna akcja. */
  function flushOkShort() {
    var action = state.okAction;
    clearTimeout(state.okHoldTimer);
    state.okHoldTimer = null;
    state.okAction = null;
    state.okFired = true;
    if (action) action();
    else if (currentScreenId() === "playerScreen") toggleOsd();
  }

  /* Jedna wspólna obsługa „Wstecz” — dla klawisza pilota (webOS 461, Android 4)
     i dla sprzętowego Back na Android TV / Fire TV (MainActivity pyta o nią
     przez window.__openiptvBack). Zwraca true, gdy zdarzenie zostało zużyte. */
  function handleBack() {
    /* Otwarty panel diagnostyki zamyka się pierwszy: leży nad obrazem i ma
       własne klawisze (patrz diagKeydown). Ta droga jest dla pilota natywnego,
       który woła handleBack bez zdarzenia klawiatury (window.__openiptvBack). */
    if (diagVisible()) {
      closeDiagnostics();
      return true;
    }
    if ($("exitDialog")) {
      hideExitDialog();          /* Wstecz na pytaniu o wyjście = zostaję */
      return true;
    }
    if ($("contextMenu")) {
      hideContextMenu();
      return true;
    }
    if (document.body && document.body.classList &&
        document.body.classList.contains("player-epg")) {
      /* tryb dzielony obraz + EPG: Wstecz zamyka panel po prawej, a obraz
         wraca na cały ekran (patrz showPlayerEpg) */
      closeArchive();
      return true;
    }
    if (!$("playerScreen").classList.contains("hidden")) {
      /* Wstecz najpierw zamyka pasek otwarty jako menu — tak samo jak nakładki
         na innych ekranach; samo wyjście z kanału zostaje na drugie naciśnięcie */
      if (state.osdMenu && osdVisible()) {
        hideOsd();
        return true;
      }
      stopPlayback();
      return true;
    }
    if (!$("archiveScreen").classList.contains("hidden")) {
      /* archiwum wraca tam, skąd przyszło: do obrazu, jeśli coś tam jeszcze
         leci, a inaczej do listy kanałów (patrz closeArchive) */
      closeArchive();
      return true;
    }
    if (!$("guideScreen").classList.contains("hidden")) {
      /* program TV wraca tam, skąd został otwarty (obraz albo lista) */
      closeGuide();
      return true;
    }
    if (!$("settingsScreen").classList.contains("hidden") && state.channels.length) {
      showScreen("browserScreen");
      return true;
    }
    /* Główna lista (albo ustawienia bez wczytanej playlisty): Wstecz najpierw
       pyta, czy na pewno wyjść — jedno naciśnięcie pilota nie może kończyć
       oglądania. Samo zamknięcie aplikacji robi requestExit(). */
    showExitConfirm();
    return true;
  }

  /* ------------------------  WYJŚCIE Z APLIKACJI  ------------------------
     Zamknięcie okna zależy od platformy: w WebView na Androidzie i Fire TV
     window.close() jest ignorowane, więc pytanie o wyjście woła most
     OpenIptvNative.quit() z MainActivity (patrz bindExitBridge). Na webOS
     i Tizenie wystarczy zamknięcie okna aplikacji. W zwykłej przeglądarce
     kartę może zamknąć tylko użytkownik — wtedy zostaje podpowiedź, żeby użyć
     przycisku wyjścia na pilocie. */
  function requestExit() {
    var bridge = window.OpenIptvNative;
    if (bridge && typeof bridge.quit === "function") {
      try {
        bridge.quit();
        return true;
      } catch (error) { /* brak mostu — próbujemy dalej */ }
    }
    var tizen = window.tizen;
    if (tizen && tizen.application && tizen.application.getCurrentApplication) {
      try {
        tizen.application.getCurrentApplication().exit();
        return true;
      } catch (error2) { /* starsze wersje Tizena — próbujemy dalej */ }
    }
    try {
      window.close();
    } catch (error3) { /* okno zostaje otwarte — niżej podpowiedź */ }
    return false;
  }

  /* Pytanie „wyjść z aplikacji?” — jak menu kontekstowe, więc pilot obsługuje
     je bez dodatkowego kodu (▲ ▼ / OK, Wstecz zamyka). */
  function showExitConfirm() {
    hideExitDialog();

    var dialog = document.createElement("section");
    dialog.id = "exitDialog";
    dialog.className = "ctx-menu";

    var card = document.createElement("div");
    card.className = "ctx-card";

    var title = document.createElement("h2");
    title.className = "ctx-title";
    title.textContent = t("exit_title");
    card.appendChild(title);

    var hint = document.createElement("p");
    hint.className = "ctx-sub";
    hint.id = "exitHint";
    hint.textContent = t("exit_hint");
    card.appendChild(hint);

    var actions = document.createElement("div");
    actions.className = "ctx-actions";

    actions.appendChild(ctxButton(t("exit_confirm"), function () {
      /* gdy platforma nie pozwala zamknąć okna, okno zostaje z podpowiedzią */
      if (!requestExit()) $("exitHint").textContent = t("exit_manual");
    }));
    actions.appendChild(ctxButton(t("exit_cancel"), hideExitDialog));
    card.appendChild(actions);
    dialog.appendChild(card);
    document.body.appendChild(dialog);

    if (actions.firstChild && actions.firstChild.focus) actions.firstChild.focus();
  }

  function hideExitDialog() {
    var dialog = $("exitDialog");
    if (dialog && dialog.parentNode) dialog.parentNode.removeChild(dialog);
  }

  /* Most dla natywnej obsługi Back (Fire TV / Android TV):
     „handled” = zajęliśmy się klawiszem, puste = oddaj kontrolę systemowi. */
  window.__openiptvBack = function () {
    try {
      return handleBack() ? "handled" : "";
    } catch (error) {
      return "";
    }
  };

  /* ==============================  ZDARZENIA  ============================== */

  /* ==========================  OBSŁUGA PILOTA / KLAWIATURY  ==========================
     Kody klawiszy obsługujemy wg standardowego mapowania przeglądarki (strzałki
     37–40, OK 13, okno DPAD_CENTER 23), a dodatkowo kody specyficzne dla webOS
     (Wstecz 461, pauza 19, play 415, przewijanie 412/417) — i tylko tam, gdzie
     faktycznie występują, żeby nie kolidowały ze strzałkami Fire TV. */

  /* Ostatnie miejsce fokusu. Gdy przycisk zniknie albo przestanie być dostępny
     (tak jest z „Pobierz i zainstaluj” w trakcie pobierania paczki), system
     oddaje fokus ciału strony — bez zapamiętanego miejsca nawigacja pilotem nie
     wiedziała, gdzie była, i wracała na sam początek ustawień. */
  var focusAnchor = null;

  document.addEventListener("focusin", function (event) {
    var element = event.target;
    if (!element || !element.getBoundingClientRect) return;
    var box = element.getBoundingClientRect();
    if (!box.width && !box.height) return;
    focusAnchor = { el: element, box: box };
  });

  var WEBOS_KEYS = platformInfo.os === "webos";

  /* -------------------  PILOT: PLAY/PAUZA I KLAWISZE MEDIALNE  -------------------
     Jeden przycisk ⏵‖ (albo ⏹) na pilocie, a tyle różnych kodów klawiszy między
     dekoderami: 85 / 126 / 127 / 86 na Androidzie i Fire TV, 415 / 19 na webOS.
     Część pilotów wysyła przy tym samą nazwę klawisza („MediaPlayPause”) i kod 0,
     więc bierzemy pod uwagę jedno i drugie. WEBOS_KEYS pilnuje tylko kodów,
     które na innych platformach znaczą coś innego (19 to na Androidzie ▲). */

  var MEDIA_KEY_TOGGLE = [85, 126, 179, 415];   // ⏵‖ oraz samo ⏵
  var MEDIA_KEY_PAUSE = [86, 93, 127, 178];     // ⏹ oraz samo ⏸ (178 = Chromium)

  function mediaKeyAction(keyCode, keyName) {
    var name = String(keyName || "");
    if (name === "MediaPlayPause" || name === "MediaPlay") return "toggle";
    if (name === "MediaPause" || name === "MediaStop") return "pause";
    if (MEDIA_KEY_TOGGLE.indexOf(keyCode) >= 0) return "toggle";
    if (MEDIA_KEY_PAUSE.indexOf(keyCode) >= 0) return "pause";
    if (keyCode === 19 && WEBOS_KEYS) return "toggle";
    return "";
  }

  function runMediaKey(action) {
    if (action === "toggle") togglePlayPause();
    else if (action === "pause") pausePlayback();
  }

  /* -----------------  PILOT: PRZEWIJANIE (⏪ ⏩ I ICH WARIANTY)  -----------------
     Jeden przycisk ⏪ / ⏩, a znowu kilka kodów między dekoderami: webOS 412/417,
     Android TV i Fire TV 89/90 (KEYCODE_MEDIA_REWIND / FAST_FORWARD), a część
     pilotów wysyła zamiast przewijania klawisze „poprzedni / następny” (88/87,
     w Chromium 177/176). Część pilotów podaje przy tym samą nazwę klawisza
     („MediaRewind”) albo kod 0, więc bierzemy pod uwagę jedno i drugie.
     Strzałki ◀ ▶ przewijają tylko przy włączonym ustawieniu „◀ ▶ przewija”. */

  var SEEK_BACK_KEYS = [412, 89, 88, 177];      // ⏪ oraz ⏮ (webOS / Android / Chromium)
  var SEEK_FORWARD_KEYS = [417, 90, 87, 176];   // ⏩ oraz ⏭

  /* kierunek skoku dla klawisza pilota; 0 = to nie jest klawisz przewijania */
  function seekKeyDirection(keyCode, keyName, arrowsSeek) {
    var name = String(keyName || "");
    if (name === "MediaRewind" || name === "MediaTrackPrevious") return -1;
    if (name === "MediaFastForward" || name === "MediaTrackNext") return 1;
    if (SEEK_BACK_KEYS.indexOf(keyCode) >= 0) return -1;
    if (SEEK_FORWARD_KEYS.indexOf(keyCode) >= 0) return 1;
    if (arrowsSeek && keyCode === 37) return -1;
    if (arrowsSeek && keyCode === 39) return 1;
    return 0;
  }

  /* Klawisze przewijania, które przyszły na keydown. Część pilotów wysyła
     przewijanie dopiero na zwolnieniu klawisza — wtedy skok robi keyup, ale gdy
     keydown już go zrobił, zwolnienie nie może dodać drugiego kroku. */
  var seekKeyDown = {};

  /* Część dekoderów oddaje klawisze multimedialne dopiero na zwolnieniu
     klawisza, a część nie oddaje ich wcale — wtedy trafiają do nas mostem
     natywnym (patrz window.__openiptvKey i MainActivity). */
  function mediaKeyHandledRecently() {
    return !!state.mediaKeyAt && Date.now() - state.mediaKeyAt < 1200;
  }

  document.addEventListener("keydown", function (event) {
    var key = event.keyCode;
    /* W trybie dzielonym (obraz + EPG) klawisze obsługują listę programów po
       prawej, a nie sterowanie obrazem — dlatego taki obraz nie liczy się tu
       jako „w odtwarzaczu”. Wstecz osobno zamyka panel (patrz handleBack). */
    var inPlayerEpg = !!(document.body && document.body.classList &&
      document.body.classList.contains("player-epg"));
    var inPlayer = !inPlayerEpg && !$("playerScreen").classList.contains("hidden");
    var inGuide = !$("guideScreen").classList.contains("hidden");

    /* Wstecz (webOS 461, Android 4): najpierw zamyka nakładki */
    if (key === 461 || key === 4) {
      event.preventDefault();
      handleBack();
      return;
    }

    /* ------------------------------  ODTWARZACZ  ------------------------------ */
    if (inPlayer) {
      /* Fokus na przycisku paska (mysz, dotyk): strzałki chodzą po pasku.
         Z pilota fokus siedzi na obrazie, więc strzałki sterują transmisją —
         dlatego kanału nie przełącza „przypadkowe” wejście w pasek. Pasek
         otwarty klawiszem OK jest jednak zaproszeniem do swoich przycisków —
         patrz niżej. */
      var osdFocus = document.activeElement;
      var onOsdButton = !!(osdFocus && osdFocus.getAttribute && osdFocus.getAttribute("data-osd"));

      /* Nakładka nad obrazem (menu opcji kanału, pytanie o wyjście) ma własne
         przyciski: strzałki chodzą po niej, a OK wybiera podświetloną pozycję —
         tak samo jak na innych ekranach. Bez tego w obrazie ▲ ▼ zmieniały
         kanał, a OK otwierało pasek zamiast wybrać pozycję z menu. */
      if ($("contextMenu") || $("exitDialog")) {
        if (key >= 37 && key <= 40) {
          event.preventDefault();
          focusNearest(key);
          return;
        }
        if (key === 13 || key === 23 || key === 66) {
          event.preventDefault();
          if (event.repeat) return;
          var overlay = $("contextMenu") || $("exitDialog");
          if (overlay && overlay.contains(osdFocus) && osdFocus.click) osdFocus.click();
          return;
        }
      }

      /* ▲ ▼ potrafi przyjść w trakcie trzymania OK (pilot nie zdążył donieść
         o puszczeniu klawisza). Wtedy OK rozstrzygamy od razu jako krótkie,
         żeby pasek zdążył się otworzyć, a ▼ weszło w jego przyciski — inaczej
         szybkie „OK, ▼” zmieniało kanał zamiast pokazać menu. */
      if (!onOsdButton && state.okHoldTimer && (key === 38 || key === 40)) flushOkShort();

      /* Pasek otwarty klawiszem OK (albo dotknięciem) jest menu: ▲ ▼ wchodzą
         w jego przyciski — „Pauza”, „EPG”… — a nie przełączają kanału. Pasek
         pokazany przy zmianie kanału to tylko informacja, więc ▲ ▼ z obrazu
         dalej zmieniają kanały i CH+ działa naciśnięcie po naciśnięciu. */
      if (!onOsdButton && state.osdMenu && osdVisible() && (key === 38 || key === 40)) {
        event.preventDefault();
        if (event.repeat) return;
        enterOsdBar();
        return;
      }

      if (onOsdButton && key >= 37 && key <= 40) {
        event.preventDefault();
        /* ▲ ▼ z paska wychodzą z menu z powrotem na obraz (i znowu zmieniają
           kanały) — z otwartego menu musi być droga do oglądania bez
           zatrzymywania kanału; ◀ ▶ chodzą po samych przyciskach paska */
        if (key === 38 || key === 40) {
          if (!focusNearest(key)) leaveOsdBar();
        } else {
          focusNearest(key);
        }
        scheduleOsdHide();
        return;
      }

      /* ▲ ▼ (CH+ / CH−): następny / poprzedni kanał z listy, jak na pilocie
         telewizora. Trzymana strzałka nie przełącza kanałów seriami. */
      if (key === 38 || key === 40) {
        event.preventDefault();
        if (event.repeat) return;
        zapChannel(key === 38 ? -1 : 1);
        return;
      }

      /* ◀ ▶ — przewijanie obrazu (na kanale na żywo ◀ wchodzi w catch-up o krok,
         a ▶ na zatrzymanym obrazie wznawia od miejsca pauzy). ⏪ ⏩ pilota
         (webOS 412/417, Android 89/90, „poprzedni / następny” 88/87) przewijają
         zawsze, a strzałki tylko przy włączonym ustawieniu „◀ ▶ przewija” —
         inaczej wracają do nawigacji (patrz seekKeyDirection). */
      var seekDirection = seekKeyDirection(key, event.key, settings.dpadSeek);
      if (seekDirection) {
        event.preventDefault();
        seekKeyDown[key] = true;
        seekBy(seekDirection);
        return;
      }
      if (key === 37 || key === 39) {
        event.preventDefault();
        focusNearest(key);
        scheduleOsdHide();
        return;
      }

      /* OK: krótko = panel odtwarzacza (albo kliknięcie przycisku paska, gdy
         fokus już na nim jest), trzymane = menu opcji kanału */
      if (key === 13 || key === 23 || key === 66) {
        event.preventDefault();
        if (event.repeat) return;
        startOkHold(onOsdButton ? function () { osdFocus.click(); } : null);
        return;
      }

      /* 🔇 na pilocie (449 = webOS / Tizen, 173 = klawiatura) — cisza w obrazie */
      if (key === 449 || key === 173) {
        event.preventDefault();
        if (event.repeat) return;
        toggleMute();
        return;
      }

      /* ⏵‖ / ⏹ / pauza: klawisze multimedialne obu platform (patrz
         mediaKeyAction — kody różnią się między dekoderami) */
      var media = mediaKeyAction(key, event.key);
      if (media) {
        event.preventDefault();
        /* jedno naciśnięcie = jedna akcja, także gdy klawisz jest trzymany */
        state.mediaKeyAt = Date.now();
        if (event.repeat) return;
        runMediaKey(media);
        return;
      }
      /* MENU (webOS/Tizen 18, Android 82) — opcje kanału; tutaj są też wszystkie
         akcje panelu, więc pilot nie musi wchodzić fokusem w pasek */
      if (key === 82 || key === 18) {
        event.preventDefault();
        openContextMenu(state.watchChannel);
        return;
      }
      return;
    }

    /* Program TV — pasek dnia w nagłówku („‹ Dzień”, „Wczoraj”, „Dziś”, data
       i godzina): gdy fokus stoi na nim, ◀ ▶ chodzą po jego przyciskach
       i polach, a ▼ schodzi do siatki. Wcześniej ◀ ▶ zawsze przesuwały oś
       czasu, więc fokus tkwił na „Dziś” i ani „Wczoraj”, ani pól daty i
       godziny nie dało się dosięgnąć pilotem (patrz focusGuideHeader). */
    if (inGuide && (key === 37 || key === 39 || key === 38 || key === 40 ||
                    key === 412 || key === 417)) {
      var guideHead = $("guideScreen").querySelector("header");
      if (guideHead && guideHead.contains(document.activeElement)) {
        event.preventDefault();
        if (key === 40) { focusGuide(40); return; }
        if (key === 38) return;
        focusNearest(key === 37 || key === 412 ? 37 : 39);
        return;
      }
    }

    /* Pola formularza obsługuje sam WebView: klawisz OK musi na nich zostać
       „przepuszczony” do przeglądarki, bo tylko wtedy rozwinie się lista wyboru
       (select), otworzy się kalendarz albo zegar (date, time) i klawiatura.
       Wcześniej preventDefault z sekcji OK poniżej zjadał ten klawisz i np. na
       Fire TV nie dało się rozwinąć pola „Typ źródła”. Zaznaczenia przełączamy
       sami, bo Enter na polu wyboru nie działa jednakowo na wszystkich
       platformach, a strzałki zostawiamy polu (lista, kursor). */
    var field = document.activeElement;
    var fieldTag = (field && field.tagName) || "";

    if (fieldTag === "SELECT" || fieldTag === "TEXTAREA") return;

    if (fieldTag === "INPUT") {
      var fieldType = (field.getAttribute("type") || "text").toLowerCase();
      if ((fieldType === "checkbox" || fieldType === "radio") &&
          (key === 13 || key === 23 || key === 66)) {
        event.preventDefault();
        if (!event.repeat && field.click) field.click();
      }

      /* Pole szukania: strzałki mają z niego wyprowadzać fokus (pilot nie ma
         Tab, a klawiatura ekranowa zasłania listę). ◀ i ▶ zostają w polu,
         dopóki jest w nim co poprawiać — decyduje searchArrowTarget. */
      if (field === $("searchInput")) {
        var caret = field.selectionStart === null ? field.value.length : field.selectionStart;
        var caretEnd = field.selectionEnd === null ? field.value.length : field.selectionEnd;
        var arrow = searchArrowTarget(key, caret === 0, caretEnd === field.value.length);
        if (arrow === "channels") {
          event.preventDefault();
          focusChannelEntry();
          return;
        }
        if (arrow === "categories") {
          event.preventDefault();
          focusActiveCategory();
          return;
        }
        if (arrow === "bar") {
          event.preventDefault();
          focusNearest(39);
          return;
        }
      }
      return;
    }

    /* Ustawienia: na pasku zakładek ◀ ▶ zmieniają zakładkę, a ▼ wchodzi w jej
       treść (pilot nie ma Tab, więc bez tego z paska nie dałoby się zejść) */
    var focused = document.activeElement;
    var onTab = !!(focused && focused.getAttribute && focused.getAttribute("data-tab"));
    if (onTab && (key === 37 || key === 39 || key === 412 || key === 417)) {
      event.preventDefault();
      stepSettingsTab(key === 37 || key === 412 ? -1 : 1);
      return;
    }
    if (onTab && key === 40) {
      event.preventDefault();
      focusSettingsPanel();
      return;
    }

    /* Program TV: ◀ ▶ chodzą po programach tego samego kanału, a oś czasu
       dosuwa się za podświetleniem (patrz guideStepProgram). Fokus w pasku
       dnia obsługuje gałąź wyżej, więc tutaj zostaje sama siatka. */
    if (inGuide && (key === 37 || key === 39 || key === 412 || key === 417)) {
      event.preventDefault();
      guideStepProgram(key === 37 || key === 412 ? -1 : 1);
      return;
    }

    /* Program TV: ▲ ▼ przenoszą podświetlenie o kanał wyżej albo niżej, na
       program z tego samego momentu (OK odtwarza — patrz focusGuide) */
    if (inGuide && (key === 38 || key === 40)) {
      event.preventDefault();
      focusGuide(key);
      return;
    }

    if (key >= 37 && key <= 40) {
      event.preventDefault();
      focusNearest(key);
      ensureListAhead();
      return;
    }

    /* OK: krótko = odtwórz kanał, trzymane = menu opcji kanału. Gwiazdka
       ulubionych jest jednak osobnym przyciskiem w kafelku: krótkie OK ma
       przełączyć ulubione, a nie włączyć kanał. focusedChannelCard() obejmuje
       cały kafelek (closest(".channel")), więc bez tego wyjątku OK na gwieździe
       odtwarzało kanał i gwiazdki nie dało się użyć pilotem (patrz
       buildChannelCard). Trzymane OK nadal otwiera menu opcji kanału. */
    if (key === 13 || key === 23 || key === 66) {
      event.preventDefault();
      if (event.repeat) return;
      var okFocus = document.activeElement;
      var okOnFavorite = !!(okFocus && okFocus.classList &&
        okFocus.classList.contains("favorite-button"));
      if (okOnFavorite) {
        startOkHold(function () { okFocus.click(); });
      } else {
        var card = focusedChannelCard();
        if (card) {
          startOkHold(function () { playChannel(card, null, "browserScreen"); });
        } else if (document.activeElement && document.activeElement.click) {
          document.activeElement.click();
        }
      }
    }
  });

  /* Akcję przypisujemy dopiero na zwolnieniu OK — dzięki temu jedno naciśnięcie
     wykonuje dokładnie jedną rzecz (krótkie OK albo menu przy trzymaniu).
     Tutaj też domykamy klawisze multimedialne: jeśli dekoder wysłał je tylko
     na zwolnieniu (bez keydown, którego nie obsłużyliśmy chwilę wcześniej),
     obraz zatrzyma się albo ruszy mimo wszystko. */
  document.addEventListener("keyup", function (event) {
    if (event.keyCode === 13 || event.keyCode === 23 || event.keyCode === 66) releaseOk();
    if ($("playerScreen").classList.contains("hidden")) return;
    var media = mediaKeyAction(event.keyCode, event.key);
    if (media && !mediaKeyHandledRecently()) {
      state.mediaKeyAt = Date.now();
      runMediaKey(media);
      return;
    }
    /* przewijanie wysłane tylko na zwolnieniu klawisza (bez keydown): gdy
       naciśnięcie już zrobiło skok, zwolnienie tylko je kończy */
    var seekCode = event.keyCode;
    if (seekKeyDown[seekCode]) { delete seekKeyDown[seekCode]; return; }
    var seekDirection = seekKeyDirection(seekCode, event.key, false);
    if (seekDirection) seekBy(seekDirection);
  });

  /* Zmiana rozmiaru okna albo obrót ekranu: program TV liczy liczbę godzin
     i szerokość kolumny z realnej szerokości siatki, więc po zmianie trzeba go
     przerysować. Przeglądarka wysyła zdarzenia seriami — dlatego czekamy chwilę
     (guide.resizeTimer), a widok zostaje na tym samym kanale i godzinie. */
  window.addEventListener("resize", function () {
    if ($("guideScreen").classList.contains("hidden")) return;
    window.clearTimeout(guide.resizeTimer);
    guide.resizeTimer = window.setTimeout(function () {
      guide.resizeTimer = null;
      if ($("guideScreen").classList.contains("hidden")) return;
      guideRedraw();
    }, 220);
  });

  /* Most dla natywnej obsługi klawiszy multimedialnych (Android TV / Fire TV).
     MainActivity oddaje je tutaj, gdy na ekranie jest odtwarzacz — inaczej
     WebView zjada część z nich dla własnej sesji multimediów i strona nie wie
     o naciśnięciu przycisku ⏵‖. */
  window.__openiptvKey = function (code, name) {
    if ($("playerScreen").classList.contains("hidden")) return "";
    /* ⏪ / ⏩ pilota (KEYCODE_MEDIA_REWIND / FAST_FORWARD): przewijanie o krok */
    var seekDirection = seekKeyDirection(code, name, settings.dpadSeek);
    if (seekDirection) {
      seekKeyDown[code] = true;
      seekBy(seekDirection);
      return "handled";
    }
    var media = mediaKeyAction(code, name);
    if (!media) return "";
    state.mediaKeyAt = Date.now();
    runMediaKey(media);
    return "handled";
  };

  $("saveSettings").onclick = function () {
    var sourceType = $("sourceType").value;
    var profile = {
      id: draft.editingId || newProfileId(),
      name: $("profileName").value.trim() || "Playlista",
      sourceType: sourceType,
      playlistUrl: $("playlistUrl").value.trim(),
      playlistFileText: draft.playlistText,
      playlistFileName: draft.playlistName,
      xtreamServer: normalizeServer($("xtreamServer").value),
      xtreamUser: $("xtreamUser").value.trim(),
      xtreamPass: $("xtreamPass").value,
      epgUrl: $("epgUrl").value.trim(),
      epgFileText: draft.epgText,
      epgFileName: draft.epgName
    };

    if (sourceType === "xtream") {
      if (!profile.xtreamServer || !profile.xtreamUser || !profile.xtreamPass) {
        $("settingsError").textContent = "Xtream: podaj adres serwera, użytkownika i hasło.";
        return;
      }
    } else if (sourceType === "m3u-file") {
      if (!draft.playlistText) {
        $("settingsError").textContent = "Wybierz lokalny plik M3U.";
        return;
      }
    } else if (!/^https?:\/\//i.test(profile.playlistUrl)) {
      $("settingsError").textContent = "Podaj pełny adres http:// lub https:// do playlisty M3U.";
      return;
    }

    if (!draft.epgText && profile.epgUrl && !/^https?:\/\//i.test(profile.epgUrl)) {
      $("settingsError").textContent = "Adres EPG musi zaczynać się od http:// lub https://";
      return;
    }

    var index = -1;
    for (var i = 0; i < settings.profiles.length; i++) {
      if (settings.profiles[i].id === profile.id) index = i;
    }
    if (index >= 0) settings.profiles[index] = profile;
    else settings.profiles.push(profile);

    settings.activeProfileId = profile.id;
    settings.archiveDays = parseInt($("archiveDays").value, 10) || 7;
    settings.seekSeconds = parseInt($("seekSeconds").value, 10) || 10;
    settings.retryAttempts = parseInt($("retryAttempts").value, 10) || 0;
    settings.dpadSeek = $("dpadSeek").checked;
    settings.catchupTemplate = $("catchupTemplate").value.trim();
    settings.catchupAll = $("catchupAll").checked;
    settings.epgRefreshMinutes = parseInt($("epgRefreshMinutes").value, 10) || 0;
    settings.epgReloadOnStart = $("epgReloadOnStart").checked;
    settings.epgShiftHours = normalizeEpgShift($("epgShiftHours").value);
    settings.language = $("language").value === "en" ? "en" : "pl";
    settings.theme = $("theme").value === "light" ? "light" : "dark";
    settings.uiMode = $("uiMode").value === "tv" || $("uiMode").value === "touch" ? $("uiMode").value : "auto";
    settings.uiScale = normalizeUiScale($("uiScale").value);
    settings.osdEnabled = $("osdEnabled").checked;
    settings.clockEnabled = $("clockEnabled").checked;
    settings.nativePlayer = $("nativePlayer").checked;
    settings.vlcPlayer = $("vlcPlayer").checked;
    settings.vlcTexture = $("vlcTexture").checked;

    /* Wielkie teksty (playlista/EPG wybrane z pliku) trzymamy w osobnym kluczu,
       a w głównym zapisujemy tylko lekkie ustawienia — w przeciwnym razie zapis
       profilu blokuje interfejs na kilka sekund. */
    var bucket = settings.__blobs[profile.id] || (settings.__blobs[profile.id] = {});
    bucket.playlistFileText = profile.playlistFileText || "";
    bucket.playlistFileName = profile.playlistFileName || "";
    bucket.epgFileText = profile.epgFileText || "";
    bucket.epgFileName = profile.epgFileName || "";

    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(compactSettings()));
      localStorage.setItem(BLOBS_KEY, JSON.stringify(settings.__blobs || {}));
    } catch (error) {
      $("settingsError").textContent = "Dane są zbyt duże, aby zapisać je w pamięci aplikacji (zbyt duży plik M3U/EPG).";
      return;
    }

    applyTheme();
    applyTranslations();
    applyUiMode();
    loadCatalog();
  };

  $("sourceType").onchange = function () {
    updateSourceSections();
    var type = $("sourceType").value;
    if (type === "xtream") $("xtreamServer").focus();
    else if (type === "m3u-url") $("playlistUrl").focus();
  };

  $("language").onchange = function () {
    settings.language = this.value === "en" ? "en" : "pl";
    applyTranslations();
    /* informacja o wykrytym ekranie ma liczby, więc tłumaczymy ją osobno */
    applyUiScale();
  };

  $("theme").onchange = function () {
    settings.theme = this.value === "light" ? "light" : "dark";
    applyTheme();
  };

  /* Tryb interfejsu działa od razu — na telewizorze widać różnicę bez
     zapisywania ustawień. Mini-EPG można wyłączyć w locie. */
  $("uiMode").onchange = function () {
    settings.uiMode = this.value === "tv" || this.value === "touch" ? this.value : "auto";
    applyUiMode();
  };

  /* Rozmiar interfejsu też działa od razu. Szerokość układu zmieniamy w „meta
     viewport”, a gdy przeglądarka nie przeliczy jej w locie (starsze WebView na
     telewizorach), wczytujemy stronę raz jeszcze — index.html ustawia wtedy
     szerokość przed pierwszym rysowaniem, więc nic nie mruga. */
  $("uiScale").onchange = function () {
    var value = normalizeUiScale(this.value);
    settings.uiScale = value;
    flushSettings();
    applyUiScale();
    var api = scaleApi();
    if (!api) return;
    var ctx = scaleContext();
    var factor = uiScaleFactor(ctx);
    window.setTimeout(function () {
      if (!api.canvasMismatch(window, factor, ctx)) return;
      try {
        if (sessionStorage.getItem("openiptvScaleReload") === value) return;
        sessionStorage.setItem("openiptvScaleReload", value);
      } catch (e) {
        return;
      }
      window.location.reload();
    }, 500);
  };

  /* Zegar w rogu obrazu: przełącznik działa od razu, bez zapisywania ustawień
     (zegar i tak pokazuje się tylko przy włączonym odtwarzaniu) */
  $("clockEnabled").onchange = function () {
    settings.clockEnabled = this.checked;
    syncCornerClock();
  };

  $("osdEnabled").onchange = function () {
    settings.osdEnabled = this.checked;
    if (!settings.osdEnabled) hideOsd();
  };

  /* Przesunięcie czasu EPG działa od razu na tym, co już wczytane: programy
     trzymamy bez przesunięcia (patrz applyEpgShift), więc nic nie trzeba
     pobierać od nowa — lista kanałów i lista programów przeliczają się w miejscu */
  $("epgShiftHours").onchange = function () {
    settings.epgShiftHours = normalizeEpgShift(this.value);
    flushSettings();
    if (!state.epgRaw) return;
    applyEpgShift();
    if (state.channels.length) {
      selectGroup(state.selectedGroup, document.querySelector(".category.active"));
    }
  };

  /* „Pobierz EPG teraz”: ręczne odświeżenie programu TV, bez czekania na kolejny
     cykl ustawienia „Odświeżanie EPG” (patrz refreshEpg). Zapis ustawień sam
     z siebie EPG nie pobiera — patrz epgKey. */
  $("epgRefreshNow").onclick = function () {
    if (!state.channels.length) {
      setSettingsError(t("epg_refresh_wait"));
      return;
    }
    setSettingsError("");
    refreshEpg();
  };

  /* Odtwarzacz systemowy jest beta: włącza się go ręcznie i działa od następnego
     kanału (kolejka prób buduje się na nowo przy każdym wejściu w obraz). */
  $("nativePlayer").onchange = function () {
    settings.nativePlayer = this.checked;
  };

  /* Silnik VLC jest beta tak samo: włącza się go ręcznie, a droga działa od
     następnego kanału (kolejka prób buduje się przy każdym wejściu w obraz). */
  $("vlcPlayer").onchange = function () {
    settings.vlcPlayer = this.checked;
  };

  /* Droga obrazu VLC działa od następnego kanału: silnik powstaje od nowa
     z nowymi opcjami (patrz VlcEngine -> ensureLib). */
  $("vlcTexture").onchange = function () {
    settings.vlcTexture = this.checked;
  };

  /* aktualizacja: sprawdzenie wydania na GitHubie i — na Androidzie / Fire TV —
     pobranie paczki i przekazanie jej systemowemu instalatorowi */
  $("checkUpdates").onclick = function () { checkForUpdates(); };
  $("installUpdate").onclick = installAvailableUpdate;

  /* Przyciski „Wybierz plik M3U / EPG”. Na telewizorze wybór prowadzi plugin
     natywny (własna lista katalogów), w przeglądarce — ukryte pole pliku;
     decyduje o tym startFilePick(). */
  $("pickPlaylistFile").onclick = function () { startFilePick("m3u"); };
  $("pickEpgFile").onclick = function () { startFilePick("epg"); };

  /* Ścieżka zapasowa: plik wskazany w systemowym oknie wyboru plików */
  $("playlistFile").onchange = function () {
    var file = this.files && this.files[0];
    if (!file) return;
    readFile(file, false).then(function (text) {
      applyPlaylistFile(file.name, text);
    }, function () {
      setSettingsError(t("pick_m3u_error"));
    });
  };

  $("epgFile").onchange = function () {
    var file = this.files && this.files[0];
    if (!file) return;
    /* plik EPG czytamy binarnie — GZIP rozpoznajemy po nagłówku, więc
       spakowany plik o nazwie .xml też się rozpakuje */
    readFile(file, true).then(function (result) {
      try {
        applyEpgFile(file.name, result);
      } catch (error) {
        setSettingsError(t("pick_epg_unzip", { error: error.message }));
      }
    }, function () {
      setSettingsError(t("pick_epg_error"));
    });
  };

  $("useEpgLink").onclick = function () {
    draft.epgText = "";
    draft.epgName = "";
    $("epgFile").value = "";
    updateEpgPicker();
    $("epgUrl").focus();
  };

  $("settingsProfile").onchange = function () {
    if (suppressProfileSelect) return;
    for (var i = 0; i < settings.profiles.length; i++) {
      if (settings.profiles[i].id === this.value) loadProfileIntoForm(settings.profiles[i]);
    }
  };

  $("newProfile").onclick = function () {
    loadProfileIntoForm(null);
    $("profileName").focus();
  };

  $("deleteProfile").onclick = function () {
    var index = -1;
    for (var i = 0; i < settings.profiles.length; i++) {
      if (settings.profiles[i].id === draft.editingId) index = i;
    }
    if (index < 0) return;
    if (!window.confirm("Usunąć ten profil (playlistę, login Xtream i EPG)?")) return;

    settings.profiles.splice(index, 1);
    settings.activeProfileId = settings.profiles.length ? settings.profiles[0].id : "";
    /* usuwamy też pliki (playlista/EPG) tego profilu z osobnego klucza */
    if (settings.__blobs && settings.__blobs[draft.editingId]) delete settings.__blobs[draft.editingId];
    saveSettingsFull();
    refreshProfileSelect();
    loadProfileIntoForm(activeProfile());
  };

  $("profileSwitcher").onchange = function () {
    if (suppressProfileSwitcher) return;
    if (!this.value || this.value === settings.activeProfileId) return;
    settings.activeProfileId = this.value;
    saveSettings();
    loadCatalog();
  };

  $("openSettings").onclick = openSettings;
  /* Pasek zakładek ustawień (Ogólne / Aktualizacja / Instrukcja) — kliknięcie
     i OK na pilocie robią to samo; strzałki obsługuje keydown */
  bindSettingsTabs();
  /* „Wstecz” w ustawieniach: wyjście bez zapisu. Formularz wczytuje wartości
     z ustawień przy każdym otwarciu, więc porzucone zmiany nie zostają w pliku
     (nic nie jest zapisywane, dopóki nie naciśniemy „Zapisz i pobierz”). */
  $("settingsBack").onclick = function () { showScreen("browserScreen"); };
  $("openGuide").onclick = function () { openGuide(); };
  var archiveClose = $("archiveClose");
  if (archiveClose) archiveClose.onclick = closeArchive;
  /* „Na żywo” nad listą programów kanału: powrót do bieżącej chwili */
  var archiveLive = $("archiveLive");
  if (archiveLive) archiveLive.onclick = playArchiveLive;
  $("guidePrevDay").onclick = function () { guideShiftDays(-1); };
  $("guideNextDay").onclick = function () { guideShiftDays(1); };
  $("guideYesterday").onclick = function () { guideGoToDayOffset(-1); };
  $("guideDayBefore").onclick = function () { guideGoToDayOffset(-2); };
  $("guideToday").onclick = guideGoToday;
  $("guideDate").onchange = function () { guideGoToDate(this.value); };
  $("guideTime").onchange = function () { guideGoToTime(this.value); };
  /* Wstecz z programu TV wraca do obrazu, gdy program otwarto z paska
     odtwarzacza — a do listy kanałów, gdy wszedł z niej (patrz closeGuide) */
  $("guideClose").onclick = closeGuide;
  $("reload").onclick = loadCatalog;
  /* narzędzia kolejności grup — gdyby HTML ich nie miał, ensureCategoryLayout()
     tworzy je razem z obsługą kliknięcia */
  var orderToggle = $("groupOrderToggle");
  if (orderToggle) orderToggle.onclick = function () { setGroupOrderEdit(!state.orderEdit); };
  var orderReset = $("groupOrderReset");
  if (orderReset) orderReset.onclick = function () { resetGroupOrder(); };
  $("searchInput").oninput = function () {
    selectGroup(state.selectedGroup, document.querySelector(".category.active"));
  };

  bindVideoEvents($("video"));

  /* ================================  START  ================================ */

  /* profile ze starej wersji (1.4.x) dostają sourceType = "m3u" */
  (function initProfiles() {
    if (!Array.isArray(settings.profiles)) settings.profiles = [];
    if (!settings.profilesInitialized) {
      settings.profiles = [];
      if (settings.playlistUrl || settings.playlistFileText) {
        settings.profiles.push({
          id: newProfileId(),
          name: "Moja telewizja",
          sourceType: "m3u",
          playlistUrl: settings.playlistUrl || "",
          playlistFileText: settings.playlistFileText || "",
          playlistFileName: settings.playlistFileName || "",
          epgUrl: settings.epgUrl || "",
          epgFileText: "",
          epgFileName: ""
        });
        settings.activeProfileId = settings.profiles[0].id;
      }
      settings.profilesInitialized = true;
    }
    settings.profiles = settings.profiles.map(normalizeProfile);
    /* przenosimy ewentualne teksty plików ze starej instalacji do osobnego klucza */
    settings.profiles.forEach(function (item) {
      var bucket = settings.__blobs[item.id] || (settings.__blobs[item.id] = {});
      if (item.playlistFileText) bucket.playlistFileText = item.playlistFileText;
      if (item.playlistFileName) bucket.playlistFileName = item.playlistFileName;
      if (item.epgFileText) bucket.epgFileText = item.epgFileText;
      if (item.epgFileName) bucket.epgFileName = item.epgFileName;
    });
    saveSettingsFull();
  })();

  /* przy chowaniu aplikacji dopisujemy ustawienia czekające jeszcze w kolejce,
     a po powrocie do aplikacji zegar w rogu od razu pokazuje właściwą godzinę
     (telefon, Fire TV) zamiast czekać na pełną minutę */
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) syncCornerClock();
  });

  /* przy chowaniu aplikacji dopisujemy ustawienia czekające jeszcze w kolejce */
  window.addEventListener("pagehide", function () {
    if (settingsWriteTimer) flushSettings();
  });

  applyTheme();
  applyTranslations();
  buildChoiceRows();
  applyUiMode();
  /* Naprawa warstwy obrazu (patrz applyVideoLayerFix) włącza się u tych, którym
     naprawdę pomogła — u pozostałych klasa nie pojawia się wcale. */
  applyVideoLayerFix(settings.videoLayerFix);

  var versionEl = $("appVersion");
  if (versionEl) versionEl.textContent = "v" + APP_VERSION;
  var settingsVersionEl = $("settingsVersion");
  if (settingsVersionEl) settingsVersionEl.textContent = "TeleIPTV v" + APP_VERSION;

  if (settings.profiles.length) {
    loadCatalog();
    /* ciche sprawdzenie po włączeniu: pokaże tylko numer nowszej wersji */
    checkForUpdates(true);
  } else {
    openSettings();
  }
})();












