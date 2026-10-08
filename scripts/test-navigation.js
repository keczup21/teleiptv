/* Test sterowania w menu glownym (lista kanalow) — bez telewizora.
   Wyciaga z www/app.js logike (nie kopiuje jej) i sprawdza rzeczy, ktore na
   pilocie wychodzily zle:
     • samo dojechanie fokusem na grupe nie moze przelaczac listy kanalow,
     • z pola szukania trzeba umiec wyjsc: ▼ do kanalow, ◀ do grup,
     • wejscie na ekran nie moze stawiac fokusu w polu tekstowym (po zapisaniu
       ustawien „samo” wlaczalo sie szukanie kanalow),
     • ikony przyciskow sa SVG (emoji na dekoderach TV zostawialo kropke),
     • podpowiedz pilota pod lista ma czytelny pasek.
   Uruchomienie: npm run test:nav */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "www", "app.js"), "utf8").replace(/\r\n/g, "\n");
const html = fs.readFileSync(path.join(ROOT, "www", "index.html"), "utf8").replace(/\r\n/g, "\n");
const css = fs.readFileSync(path.join(ROOT, "www", "styles.css"), "utf8").replace(/\r\n/g, "\n");
/* natywna obsługa pilota (klawisze multimedialne) — patrz sekcja 19 */
const java = fs.readFileSync(path.join(ROOT, "android", "app", "src", "main", "java",
  "pl", "openiptv", "player", "MainActivity.java"), "utf8").replace(/\r\n/g, "\n");
/* silnik VLC — osobny plik, tak samo czytany ze źródeł (patrz sekcja 27b) */
const javaVlc = fs.readFileSync(path.join(ROOT, "android", "app", "src", "main", "java",
  "pl", "openiptv", "player", "VlcEngine.java"), "utf8").replace(/\r\n/g, "\n");
/* paczka Androida i jej wersje (patrz sekcja 27: odtwarzacz systemowy) */
const gradle = fs.readFileSync(path.join(ROOT, "android", "app", "build.gradle"), "utf8").replace(/\r\n/g, "\n");
const gradleVars = fs.readFileSync(path.join(ROOT, "android", "variables.gradle"), "utf8").replace(/\r\n/g, "\n");

let fails = 0;
function check(name, cond, extra) {
  if (cond) { console.log("  OK   " + name); }
  else { fails++; console.log("  FAIL " + name + (extra ? "   -> " + extra : "")); }
}

/* blok ikon: ICON_PATHS, ICON_BY_LEAD, iconEdge(), iconForLabel(),
   labelWithoutIcon() — do funkcji iconHtml() (ta dotyka juz DOM) */
const iconStart = src.indexOf("var ICON_PATHS = {");
const iconEnd = src.indexOf("function iconHtml(");
if (iconStart < 0 || iconEnd < 0) throw new Error("Nie znalazlem bloku ikon w app.js");
const codeIcons = src.slice(iconStart, src.lastIndexOf("\n\n", iconEnd) + 2);
if (codeIcons.indexOf("function iconForLabel") < 0 || codeIcons.indexOf("function labelWithoutIcon") < 0) {
  throw new Error("Wyciety blok ikon nie ma iconForLabel/labelWithoutIcon");
}

/* blok nawigacji: searchArrowTarget(), nextFocusAfterGroup(),
   focusActiveCategory(), focusChannelEntry(), isTextField(), entryFocusTarget() */
const navStart = src.indexOf("function searchArrowTarget(");
const navEnd = src.indexOf("function focusGuide(");
if (navStart < 0 || navEnd < 0) throw new Error("Nie znalazlem bloku nawigacji w app.js");
const codeNav = src.slice(src.lastIndexOf("\n\n", navStart) + 2, src.lastIndexOf("\n\n", navEnd) + 2);
["nextFocusAfterGroup", "focusActiveCategory", "focusChannelEntry", "isTextField", "entryFocusTarget"]
  .forEach(function (fn) {
    if (codeNav.indexOf("function " + fn) < 0) throw new Error("Wyciety blok nawigacji nie ma " + fn);
  });

function run(code, sandbox) {
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

const icons = run(codeIcons, {});

/* --- 1. napis przycisku -> ikona ---------------------------------------- */
check("📅 Program TV -> ikona kalendarza (EPG na pasku i w menu)",
  icons.iconForLabel("📅 Program TV") === "calendar", String(icons.iconForLabel("📅 Program TV")));
check("🔇 / 🔊 -> ikona dzwieku",
  icons.iconForLabel("🔇 Wycisz") === "mute" && icons.iconForLabel("🔊 Dźwięk") === "volume");
check("⏪ / ⏵ / ⏸ / ✕ / ⏻ / ★ / ☆ -> wlasne ikony",
  icons.iconForLabel("⏪ Od początku") === "rewind" &&
  icons.iconForLabel("⏵ Wznów") === "play" &&
  icons.iconForLabel("⏸ Pauza") === "pause" &&
  icons.iconForLabel("✕ Wstecz") === "close" &&
  icons.iconForLabel("⏻ Wyjdź z aplikacji") === "power" &&
  icons.iconForLabel("★ Ulubione") === "star-filled" &&
  icons.iconForLabel("☆ Dodaj do ulubionych") === "star");
check("znak po napisie tez jest ikona („Następny ▶”)",
  icons.iconForLabel("Następny ▶") === "next" && icons.iconForLabel("◀ Poprzedni") === "prev");
/* --- 2. napis na przycisku bez znaku ikony ------------------------------ */
check("napis bez znaku nie dostaje ikony („Kanał”, „Wstecz”, „Wszystkie”)",
  icons.iconForLabel("Kanał") === null && icons.iconForLabel("Wstecz") === null &&
  icons.iconForLabel("Wszystkie") === null &&
  icons.labelWithoutIcon("Kanał") === "Kanał");
check("znak ikony nie zostaje w napisie (bez podwojnej ikony)",
  icons.labelWithoutIcon("📅 Program TV") === "Program TV" &&
  icons.labelWithoutIcon("✕ Wstecz") === "Wstecz" &&
  icons.labelWithoutIcon("★ Ulubione") === "Ulubione" &&
  icons.labelWithoutIcon("🔇 Wycisz") === "Wycisz",
  [icons.labelWithoutIcon("📅 Program TV"), icons.labelWithoutIcon("✕ Wstecz")].join(" | "));
check("znak z konca napisu tez znika („Następny ▶” -> „Następny”)",
  icons.labelWithoutIcon("Następny ▶") === "Następny", icons.labelWithoutIcon("Następny ▶"));
check("napisy bez znaku zostaja bez zmian",
  icons.labelWithoutIcon("Kanał") === "Kanał" &&
  icons.labelWithoutIcon("Ostatnio oglądane") === "Ostatnio oglądane");

/* --- 3. kazda ikona ma rysunek ------------------------------------------ */
const leads = Object.keys(icons.ICON_BY_LEAD);
const noPath = leads.filter(function (k) { return !icons.ICON_PATHS[icons.ICON_BY_LEAD[k]]; });
check("kazdy znak z listy ma rysunek SVG (" + leads.length + " znakow)",
  noPath.length === 0, noPath.join(", "));
const usedIcons = leads.map(function (k) { return icons.ICON_BY_LEAD[k]; });
const unreachable = Object.keys(icons.ICON_PATHS).filter(function (name) {
  return usedIcons.indexOf(name) < 0;
});
check("nie ma rysunkow bez znaku, ktory je wybiera", unreachable.length === 0, unreachable.join(", "));

/* --- 3b. napis z ikona na przycisku (setIconLabel -> SVG + napis) ------- */
const htmlStart = src.indexOf("function iconHtml(");
const htmlEnd = src.indexOf("function applyTranslations(");
if (htmlStart < 0 || htmlEnd < 0) throw new Error("Nie znalazlem iconHtml/setIconLabel w app.js");
const codeLabel = src.slice(htmlStart, src.lastIndexOf("\n\n", htmlEnd) + 2);
if (codeLabel.indexOf("function setIconLabel") < 0) throw new Error("Wyciety blok nie ma setIconLabel");

function fakeButton() {
  const classes = [];
  const button = {
    children: [],
    classes: classes,
    classList: {
      add: function (c) { if (classes.indexOf(c) < 0) classes.push(c); },
      remove: function (c) { const i = classes.indexOf(c); if (i >= 0) classes.splice(i, 1); }
    },
    appendChild: function (child) { this.children.push(child); }
  };
  /* w przegladarce ustawienie innerHTML kasuje dotychczasowe dzieci — atrapa
     musi robic to samo, inaczej licznik dzieci klamie */
  let markup = "";
  Object.defineProperty(button, "innerHTML", {
    get: function () { return markup; },
    set: function (value) { markup = value; button.children.length = 0; }
  });
  return button;
}

const labelBox = {
  document: {
    createElement: function (tag) {
      return { tagName: tag, className: "", textContent: "" };
    }
  }
};
run(codeIcons, labelBox);
run(codeLabel, labelBox);

(function () {
  const button = fakeButton();
  const text = labelBox.setIconLabel(button, "📅 Program TV");
  check("przycisk dostaje ikone SVG (viewBox 24, klasa .icon) i napis bez znaku",
    button.innerHTML.indexOf("<svg") === 0 &&
    button.innerHTML.indexOf('class="icon"') > 0 &&
    button.innerHTML.indexOf('viewBox="0 0 24 24"') > 0 &&
    button.innerHTML.indexOf("calendar") < 0 &&
    button.children.length === 1 &&
    button.children[0].className === "icon-label" &&
    button.children[0].textContent === "Program TV" &&
    text === "Program TV",
    button.innerHTML.slice(0, 90));
  check("przycisk z ikona dostaje klase do ukladu w jednej linii",
    button.classes.join(",") === "has-icon", button.classes.join(","));
  check("rysunek ikony pochodzi z listy (kalendarz ma <rect> i <path>)",
    button.innerHTML.indexOf("<rect") > 0 && button.innerHTML.indexOf("<path") > 0);
})();

(function () {
  const button = fakeButton();
  const text = labelBox.setIconLabel(button, "Kanał");
  check("napis bez znaku nie dostaje ikony ani klasy has-icon",
    button.innerHTML === "" && text === "Kanał" &&
    button.classes.length === 0 && button.children.length === 1 &&
    button.children[0].textContent === "Kanał");
})();

(function () {
  const button = fakeButton();
  labelBox.setIconLabel(button, "⏸ Pauza");
  labelBox.setIconLabel(button, "Kanał");
  check("po zmianie napisu ikona znika razem z klasa has-icon",
    button.innerHTML === "" && button.classes.length === 0 &&
    button.children.length === 1 && button.children[0].textContent === "Kanał");
})();

/* --- 4. napisy z aplikacji naprawde znajduja ikone ----------------------
   Kazdy przycisk, ktory ma dzialac jak ikona (pasek odtwarzacza, menu opcji,
   pytanie o wyjscie, narzedzia grup), bierzemy ze slownika i sprawdzamy, ze
   jego napis daje ikone — literowka w ICON_BY_LEAD wyjdzie od razu. */
const ICON_LABEL_KEYS = [
  "osd_pause", "osd_play", "osd_restart", "osd_prev_program", "osd_next_program",
  "osd_live", "osd_epg", "osd_mute", "osd_unmute", "osd_back",
  "ctx_play", "ctx_fav_add", "ctx_fav_del", "ctx_archive", "ctx_epg", "ctx_close",
  "exit_confirm", "exit_cancel", "group_order", "group_order_done"
];
function plLabel(key) {
  /* napisy stoja czasem po kilka w jednej linii (group_order i group_order_done),
     dlatego szukamy klucza, a nie jego poczatku linii */
  const m = src.match(new RegExp("\\b" + key + ": \"([^\"]*)\""));
  return m ? m[1] : null;
}
const labelProblems = [];
ICON_LABEL_KEYS.forEach(function (key) {
  const label = plLabel(key);
  if (label === null) labelProblems.push(key + " (brak napisu)");
  else if (!icons.iconForLabel(label)) labelProblems.push(key + " = „" + label + "”");
});
check("kazdy napis z ikona daje ikone (" + ICON_LABEL_KEYS.length + " kluczy)",
  labelProblems.length === 0, labelProblems.join(", "));

/* --- 5. strzalki w polu szukania ---------------------------------------- */
function navHarness(o) {
  o = o || {};
  const calls = { nearest: [], focused: [] };
  const sandbox = {
    document: { querySelector: function () { return o.category === undefined ? null : o.category; } },
    $: function (id) { return (o.containers && o.containers[id]) || null; },
    focusNearest: function (key) { calls.nearest.push(key); }
  };
  run(codeNav, sandbox);
  return { api: sandbox, calls: calls };
}

const search = navHarness().api;
check("▼ z pola szukania prowadzi do listy kanalow",
  search.searchArrowTarget(40, false, false) === "channels" &&
  search.searchArrowTarget(40, true, true) === "channels");
check("◀ zabiera tekst do listy grup tylko z poczatku zapytania",
  search.searchArrowTarget(37, true, false) === "categories" &&
  search.searchArrowTarget(37, false, false) === "");
check("▶ przy koncu tekstu przechodzi do nastepnego pola paska",
  search.searchArrowTarget(39, false, true) === "bar" &&
  search.searchArrowTarget(39, false, false) === "");
check("▲ i pozostale klawisze zostaja w polu",
  search.searchArrowTarget(38, false, false) === "" &&
  search.searchArrowTarget(13, false, false) === "");

/* --- 6. po wybraniu grupy wchodzimy w jej kanaly (tylko TV) ------------- */
check("OK na grupie w trybie TV ustawia fokus na kanalach",
  search.nextFocusAfterGroup(true) === "channels" &&
  search.nextFocusAfterGroup(false) === "");

/* --- 7. fokus na kanaly / na grupe -------------------------------------- */
function fakeElement(tag, type) {
  const attrs = type ? { type: type } : {};
  return {
    tagName: tag,
    offsetParent: {},
    getAttribute: function (k) { return attrs[k] === undefined ? null : attrs[k]; },
    focused: false,
    focus: function () { this.focused = true; }
  };
}

(function () {
  const card = fakeElement("BUTTON");
  const container = { querySelector: function (sel) { return sel === ".channel-main" ? card : null; } };
  const h = navHarness({ containers: { channels: container } });
  check("▼ z szukania stawia fokus na pierwszym kanale",
    h.api.focusChannelEntry() === true && card.focused === true && h.calls.nearest.length === 0);
})();

(function () {
  const container = { querySelector: function () { return null; } };
  const h = navHarness({ containers: { channels: container } });
  check("pusta lista kanalow: fokus szuka najblizszego elementu w dol",
    h.api.focusChannelEntry() === false && h.calls.nearest.join(",") === "40");
})();

(function () {
  const active = fakeElement("BUTTON");
  const h = navHarness({ category: active });
  h.api.focusActiveCategory();
  check("◀ z szukania stawia fokus na wybranej grupie", active.focused === true);
})();

/* --- 8. pola tekstowe nie lapia fokusu na start ------------------------- */
check("pole tekstowe jest rozpoznawane (takze type=url, date, time)",
  search.isTextField(fakeElement("INPUT", "text")) === true &&
  search.isTextField(fakeElement("INPUT", null)) === true &&
  search.isTextField(fakeElement("INPUT", "url")) === true &&
  search.isTextField(fakeElement("INPUT", "date")) === true);
check("przelacznik i przycisk to nie pole tekstowe",
  search.isTextField(fakeElement("INPUT", "checkbox")) === false &&
  search.isTextField(fakeElement("INPUT", "radio")) === false &&
  search.isTextField(fakeElement("BUTTON")) === false);

(function () {
  const category = fakeElement("BUTTON");
  const screen = {
    id: "browserScreen",
    querySelector: function (sel) { return sel === ".category.active" ? category : null; },
    querySelectorAll: function () { return []; }
  };
  check("wejscie na liste kanalow staje na grupie (nie w polu szukania)",
    search.entryFocusTarget(screen) === category);
})();

(function () {
  const searchField = fakeElement("INPUT", "text");
  const select = fakeElement("SELECT");
  const screen = {
    id: "settingsScreen",
    querySelector: function () { return null; },
    querySelectorAll: function () { return [searchField, select]; }
  };
  check("w ustawieniach fokus omija pola tekstowe, a staje na liscie wyboru",
    search.entryFocusTarget(screen) === select);
})();

(function () {
  const hidden = fakeElement("BUTTON");
  hidden.offsetParent = null;
  const screen = {
    id: "settingsScreen",
    querySelector: function () { return null; },
    querySelectorAll: function () { return [hidden]; }
  };
  check("ukryte elementy nie dostaja fokusu", search.entryFocusTarget(screen) === null);
})();

/* --- 9. app.js naprawde tego uzywa ------------------------------------- */
check("samo dojechanie fokusem na grupe nie przelacza juz listy kanalow",
  src.indexOf("button.onfocus = function () {\n        selectGroup") < 0 &&
  src.indexOf("selectGroup(item.key, button);") > 0);
check("renderCategories() uzywa nextFocusAfterGroup()",
  src.indexOf('if (nextFocusAfterGroup(isTvMode()) === "channels") focusChannelEntry();') > 0);
check("showScreen() stawia fokus przez entryFocusTarget(), nie na pierwszym polu",
  src.indexOf("var first = entryFocusTarget(screen);") > 0 &&
  src.indexOf("var screen = $(id);") > 0 &&
  src.indexOf("$(id).querySelector('[tabindex=\"0\"],button,input,select')") < 0);
check("po wczytaniu playlisty fokus wchodzi w liste kanalow (nie w pole szukania)",
  src.indexOf('if (isTvMode() && document.activeElement !== $("searchInput")) focusChannelEntry();') > 0);
check("obsluga klawiszy rozpoznaje pole szukania",
  src.indexOf('if (field === $("searchInput")) {') > 0 &&
  src.indexOf("searchArrowTarget(key, caret === 0, caretEnd === field.value.length)") > 0);
check("pasek odtwarzacza i menu opcji wstawiaja napisy z ikona",
  (src.match(/setIconLabel\(button, label\);/g) || []).length >= 2 &&
  src.indexOf("var paused = nativeLayerActive() ? !nativePlaying() : !!(video && video.paused);") > 0 &&
  src.indexOf("setIconLabel(playButton, t(paused ? \"osd_play\" : \"osd_pause\"));") > 0 &&
  src.indexOf("setIconLabel(muteButton, muteLabel())") > 0);
check("kafelek kanalu ma sama gwiazdke ulubionych (bez przycisku „<<” na archiwum)",
  src.indexOf('setIconLabel(favorite, isFavorite(channel) ? "★" : "☆")') > 0 &&
  src.indexOf("archive-button") < 0 && src.indexOf("setIconLabel(archive") < 0);
check("nagrania zostaja pod reka: menu opcji kanalu nadal ma archiwum",
  src.indexOf('ctxButton(t("ctx_archive")') > 0 && css.indexOf(".archive-button") < 0);
check("filtrowanie listy przy wpisywaniu zapytania zostaje bez zmian",
  src.indexOf('$("searchInput").oninput') > 0);

/* --- 10. index.html: przyciski naglowka z ikona ------------------------- */
function tag(id) {
  const at = html.indexOf('id="' + id + '"');
  if (at < 0) return "";
  return html.slice(at, html.indexOf("</button>", at) + 9);
}
const guideBtn = tag("openGuide");
check("przycisk programu TV to sam napis „EPG” (bez ikony kalendarza)",
  guideBtn.indexOf("<svg") < 0 && guideBtn.indexOf(">EPG<") > 0 &&
  guideBtn.indexOf('class="labeled-button"') > 0, guideBtn.slice(0, 60));
check("przycisk ustawien to sama zebatka (napis zostal w podpowiedzi)",
  tag("openSettings").indexOf('class="icon-button"') > 0 &&
  tag("openSettings").indexOf("<svg") > 0 &&
  tag("openSettings").indexOf('data-i18n-title="settings"') > 0 &&
  tag("openSettings").indexOf("<span") < 0);
check("napis „Ustawienia” zostaje tam, gdzie jest potrzebny (naglowek ekranu)",
  html.indexOf('<h1 data-i18n="settings">') > 0);
check("odswiezanie zostaje przyciskiem z sama ikona",
  tag("reload").indexOf('class="icon-button"') > 0 && tag("reload").indexOf("<svg") > 0);
check("ikony naglowka nie sa emoji (zadnego znaku emoji w przyciskach)",
  /[\uD83C-\uDBFF][\uDC00-\uDFFF]/.test(guideBtn + tag("openSettings") + tag("reload")) === false);
check("podpowiedz pilota nadal jest w naglowku listy",
  html.indexOf('id="tvHint"') > 0 && src.indexOf('hint.textContent = t("tv_hint")') > 0);
check("napisy z ikona z index.html przechodza przez setIconLabel",
  src.indexOf("setIconLabel(els[i], v);") > 0);
/* Ikona SVG rozmiar bierze z regul przycisku („button .icon”), wiec napis
   z ikona w innym kontenerze rozszedlby sie na caly naglowek: tak wlasnie
   legenda pilota („◀ ▶ — przewijanie godzin”) robila wielki znak w programie
   TV. Dlatego ikony dostaja wylacznie przyciski, a legenda zostaje tekstem. */
check("napis z ikona poza przyciskiem zostaje tekstem (legenda pilota)",
  src.indexOf('if (els[i].tagName === "BUTTON" && iconForLabel(v)) setIconLabel(els[i], v);') > 0 &&
  html.indexOf('<span id="guidePanHint"') > 0 &&
  icons.iconForLabel("◀ ▶ — programy • ▲ ▼ — kanały") === "prev");

/* Naglowek listy mial jeszcze dawny znaczek (monitor z antenka), mimo ze od
   2.0.1 obowiazuje nowe logo, a od 2.0.4 ma byc takze tutaj. Logo w naglowku
   to ten sam plik, z ktorego powstaje ikona w launcherze (www/icon.svg), wiec
   znak nie rozjedzie sie znowu z tym, co widac na telewizorze. */
const brandAt = html.indexOf('<div class="brand">');
const brand = html.slice(brandAt, html.indexOf("<nav>", brandAt));
check("naglowek listy ma logo aplikacji (www/icon.svg), a nie dawny znaczek z antenka",
  brand.indexOf('<img class="brand-logo" src="icon.svg"') > 0 && brand.indexOf("<svg") < 0,
  brand.slice(0, 80));
check("dawny znaczek z antenka zniknal z index.html",
  html.indexOf("m17 2-5 5-5-5") < 0);
check("logo w naglowku bierze rozmiar z arkusza, wiec nie rozciaga sie na naglowek",
  css.indexOf(".brand-logo { flex: none; width: 40px; height: 40px; }") > 0);

/* <option> nie moze dostac elementu potomnego, wiec zaden napis z ikona nie
   moze byc uzyty w liscie wyboru — inaczej pozycja zostalaby pusta */
const optionKeys = (html.match(/<option[^>]*data-i18n="([a-z_0-9]+)"/g) || [])
  .map(function (s) { return s.replace(/.*="/, "").replace(/"$/, ""); });
const optionWithIcon = optionKeys.filter(function (k) { return icons.iconForLabel(plLabel(k)); });
check("zadna opcja listy wyboru nie ma napisu z ikona (" + optionKeys.length + " opcji)",
  optionWithIcon.length === 0, optionWithIcon.join(", "));

/* --- 11. styles.css: ikony i pasek podpowiedzi -------------------------- */
check("przycisk bez napisu nie dziedziczy paddingu reguly TV (ikona nie jest sciskana)",
  css.indexOf("body.uimode-tv .icon-button { padding: 0; }") > 0 &&
  /\.icon-button svg \{[^}]*flex: none[^}]*\}/.test(css));
check("przycisk z ikona uklada ikone i napis w jednej linii",
  css.indexOf("button.has-icon {") > 0 && css.indexOf("button .icon {") > 0 &&
  css.indexOf("body.uimode-tv button .icon {") > 0);
check("przyciski naglowka z napisem maja wlasny padding takze na TV",
  css.indexOf(".labeled-button {") > 0 && css.indexOf("body.uimode-tv .labeled-button") > 0);
check("ikony kafelkow i menu opcji maja swoj rozmiar",
  css.indexOf(".favorite-button .icon {") > 0 && css.indexOf(".ctx-actions button.has-icon .icon {") > 0);

const hintAt = css.indexOf("body.uimode-tv .tv-keys-hint {");
const hintRule = css.slice(hintAt, css.indexOf("}", hintAt));
check("podpowiedz pilota to czytelny pasek (tlo, jasny tekst, wieksza czcionka)",
  hintRule.indexOf("background: var(--surface)") > 0 &&
  hintRule.indexOf("color: var(--text)") > 0 &&
  /font-size: 2\dpx/.test(hintRule), hintRule.replace(/\s+/g, " ").slice(0, 120));
check("podpowiedz nie jest juz polozona na wierzchu listy kanalow",
  css.slice(css.indexOf(".tv-keys-hint {"), hintAt).indexOf("position: absolute") < 0);

/* --- 11. przewijanie ekranu przy nawigacji pilotem ----------------------
   `scrollIntoView(false)` wyrownywal sfokusowany element do samej dolnej
   krawedzi: kazdy krok pilota robil duzy, nierowny skok („po schodkach”), a
   to, co bylo pod przyciskiem (opis zmian, „Zapisz i pobierz”), zostawalo
   poza ekranem. keepInView() dosuwa ekran tylko o brakujacy kawalek i z
   zapasem, zeby widac bylo takze sasiednie wiersze. */
const scrollStart = src.indexOf("function scrollParent(");
const scrollEnd = src.indexOf("function focusNearest(");
if (scrollStart < 0 || scrollEnd < 0 || scrollEnd <= scrollStart) {
  throw new Error("Nie znalazlem bloku przewijania w app.js");
}
const codeScroll = src.slice(scrollStart, scrollEnd);
if (codeScroll.indexOf("function keepInView") < 0) {
  throw new Error("Wyciety blok przewijania nie ma keepInView");
}

/* atrapa kontenera: wiersze licza swoje polozenie od biezacego scrollTop */
function fakeScrollBox(height) {
  return {
    nodeType: 1,
    parentNode: null,
    style: { overflowY: "auto" },
    scrollTop: 0,
    scrollLeft: 0,
    clientHeight: height,
    clientWidth: 1000,
    scrollHeight: 5000,
    getBoundingClientRect: function () {
      return { top: 0, left: 0, bottom: height, right: 1000, width: 1000, height: height };
    }
  };
}
function fakeRow(box, top, height) {
  return {
    nodeType: 1,
    parentNode: box,
    getBoundingClientRect: function () {
      const t = top - box.scrollTop;
      return { top: t, left: 0, bottom: t + height, right: 800, width: 800, height: height };
    }
  };
}
function scrollHarness() {
  return run(codeScroll, {
    window: { getComputedStyle: function (node) { return node.style; } },
    focusAnchor: null
  });
}

(function () {
  const api = scrollHarness();
  const box = fakeScrollBox(1000);
  const row = fakeRow(box, 900, 60);
  api.keepInView(row);
  check("wiersz przy dolnej krawedzi zjezdza z zapasem, a nie staje na krawedzi",
    box.scrollTop === 160, "scrollTop = " + box.scrollTop);
  check("po dosunieciu pod wierszem zostaje miejsce na to, co jest nizej",
    box.getBoundingClientRect().bottom - row.getBoundingClientRect().bottom === 200,
    String(box.getBoundingClientRect().bottom - row.getBoundingClientRect().bottom));
})();

(function () {
  const api = scrollHarness();
  const box = fakeScrollBox(1000);
  api.keepInView(fakeRow(box, 300, 60));
  check("wiersz widoczny z zapasem nie rusza ekranu (bez skokow)", box.scrollTop === 0, String(box.scrollTop));
})();

(function () {
  const api = scrollHarness();
  const box = fakeScrollBox(1000);
  box.scrollTop = 500;
  api.keepInView(fakeRow(box, 500, 60));
  check("wiersz nad ekranem wraca z zapasem od gornej krawedzi", box.scrollTop === 300, String(box.scrollTop));
})();

(function () {
  const api = scrollHarness();
  const box = fakeScrollBox(1000);
  box.scrollHeight = 900; /* tresc miesci sie w oknie — nie ma czego przewijac */
  api.keepInView(fakeRow(box, 2000, 60));
  check("kontener bez przewijania nie jest ruszany", box.scrollTop === 0, String(box.scrollTop));

  let threw = "";
  try { api.keepInView(null); api.keepInView({}); } catch (error) { threw = String(error && error.message); }
  check("keepInView nie wywraca sie na atrapie elementu", threw === "", threw);
})();

const focusStart = src.indexOf("function focusNearest(");
const focusEnd = src.indexOf("function searchArrowTarget(");
if (focusStart < 0 || focusEnd < 0) throw new Error("Nie znalazlem focusNearest w app.js");
const codeFocus = src.slice(focusStart, focusEnd);
check("nawigacja pilotem dosuwa ekran z zapasem, a nie do samej krawedzi",
  codeFocus.indexOf("keepInView(best)") > 0 && codeFocus.indexOf("scrollIntoView") < 0);
check("zgubiony fokus liczy od ostatniego miejsca, a nie od poczatku ekranu",
  codeFocus.indexOf("focusAnchor") > 0 && codeFocus.indexOf("focusAnchor.box") > 0);

/* --- 12. przyciski aktualizacji w trakcie pobierania --------------------
   `disabled` na przycisku „Pobierz i zainstaluj” zabieralo fokus w trakcie
   pobierania paczki — nawigacja pilotem wracala wtedy na poczatek ustawien
   i nie dalo sie zjechac do opisu zmian ani do „Zapisz”. */
check("przyciski aktualizacji nie traca fokusu w trakcie pobierania (bez disabled)",
  src.indexOf("check.disabled") < 0 && src.indexOf("install.disabled") < 0 &&
  src.indexOf('button.classList.add("busy")') > 0);
check("app.js pamieta ostatnie miejsce fokusu (focusin)",
  src.indexOf('document.addEventListener("focusin"') > 0);
check("CSS przygasza przycisk w trakcie pobierania",
  /\.update-row button\.busy\s*\{[^}]*opacity/.test(css));

/* --- 13. pole z listą wyboru („Typ źródła”) ------------------------------
   Rozwinięte menu systemowe (<select>) na telewizorze bywa ciemne na ciemnym
   i nie było widać, która pozycja jest podświetlona. Pole jest teraz rzędem
   przycisków — wszystkie pozycje widoczne naraz, wybrana w kolorze akcentu —
   a ukryty <select> trzyma wartość, którą czytają pozostałe funkcje. */
const choiceStart = src.indexOf("function fireChange(");
const choiceEnd = src.indexOf("function loadProfileIntoForm(");
if (choiceStart < 0 || choiceEnd < 0 || choiceEnd <= choiceStart) {
  throw new Error("Nie znalazlem bloku list wyboru w app.js");
}
const codeChoice = src.slice(choiceStart, choiceEnd);
["fireChange", "syncChoiceRow", "syncChoiceRows", "pickChoice", "buildChoiceRow", "buildChoiceRows"]
  .forEach(function (fn) {
    if (codeChoice.indexOf("function " + fn) < 0) {
      throw new Error("Wyciety blok list wyboru nie ma " + fn);
    }
  });

/* atrapa pola: wiersz z przyciskami + <select>, ktory trzyma wartosc */
function choiceHarness(withoutEvent) {
  const buttons = [];
  const row = {
    attrs: { "data-choice-for": "sourceType" },
    getAttribute: function (name) { return this.attrs[name] === undefined ? null : this.attrs[name]; },
    querySelectorAll: function () { return buttons; },
    appendChild: function (child) { child.parentNode = this; buttons.push(child); }
  };
  /* w przegladarce ustawienie textContent kasuje dotychczasowe dzieci */
  Object.defineProperty(row, "textContent", { set: function () { buttons.length = 0; } });

  function option(value, key, text) {
    const attrs = { "data-i18n": key };
    return {
      value: value,
      textContent: text,
      getAttribute: function (name) { return attrs[name] === undefined ? null : attrs[name]; }
    };
  }

  const select = {
    value: "m3u-url",
    options: [option("m3u-url", "m3u_url", "Link do M3U"),
      option("m3u-file", "m3u_file", "Plik M3U"),
      option("xtream", "xtream", "Xtream (login)")],
    events: [],
    onchange: null,
    dispatchEvent: function (event) {
      this.events.push(event);
      if (this.onchange) this.onchange(event);
    }
  };

  const sandbox = {
    document: {
      createElement: function () {
        const attrs = {};
        return {
          tabIndex: -1,
          className: "",
          textContent: "",
          parentNode: null,
          setAttribute: function (name, value) { attrs[name] = String(value); },
          getAttribute: function (name) { return attrs[name] === undefined ? null : attrs[name]; }
        };
      },
      /* droga zapasowa dla starszych WebView (bez konstruktora Event) */
      createEvent: function (kind) {
        return { kind: kind, initEvent: function (type) { this.type = type; } };
      },
      querySelectorAll: function () { return [row]; }
    },
    $: function (id) { return id === "sourceType" ? select : null; }
  };
  if (!withoutEvent) sandbox.Event = function (type) { this.type = type; };

  run(codeChoice, sandbox);
  return { api: sandbox, row: row, select: select, buttons: buttons };
}

(function () {
  const h = choiceHarness();
  h.api.buildChoiceRows();
  const texts = h.buttons.map(function (b) { return b.textContent; });
  check("kazda pozycja listy ma swoj przycisk — wszystkie widoczne naraz",
    h.buttons.length === 3 && texts.join(" | ") === "Link do M3U | Plik M3U | Xtream (login)",
    texts.join(" | "));
  check("wybor widac niezaleznie od fokusu (aria-checked, rola radio, tabindex)",
    h.buttons[0].getAttribute("aria-checked") === "true" &&
    h.buttons[1].getAttribute("aria-checked") === "false" &&
    h.buttons[2].getAttribute("aria-checked") === "false" &&
    h.buttons[0].getAttribute("role") === "radio" && h.buttons[0].tabIndex === 0);
  check("napisy pozycji nadal ida przez tlumaczenia (data-i18n z <option>)",
    h.buttons[0].getAttribute("data-i18n") === "m3u_url" &&
    h.buttons[1].getAttribute("data-i18n") === "m3u_file" &&
    h.buttons[2].getAttribute("data-i18n") === "xtream");
})();

(function () {
  const h = choiceHarness();
  h.api.buildChoiceRows();
  let changes = 0;
  h.select.onchange = function () { changes++; };

  h.buttons[1].onclick.call(h.buttons[1]);
  check("wybor z listy zapisuje wartosc w <select> (czytaja ja pozostale funkcje)",
    h.select.value === "m3u-file", h.select.value);
  check("wybor z listy wysyla zdarzenie „change” (pola Xtream sie przelaczaja)",
    changes === 1 && h.select.events.length === 1 && h.select.events[0].type === "change",
    "zmian: " + changes + ", zdarzen: " + h.select.events.length);
  check("zaznaczenie idzie za wyborem",
    h.buttons[1].getAttribute("aria-checked") === "true" &&
    h.buttons[0].getAttribute("aria-checked") === "false");

  h.buttons[1].onclick.call(h.buttons[1]);
  check("wybranie tej samej pozycji nic nie zmienia (bez zdarzenia, bez skoku fokusu)",
    changes === 1, "zmian: " + changes);

  h.select.value = "xtream"; /* tak wartosc z profilu ustawia loadProfileIntoForm */
  h.api.syncChoiceRows();
  check("wartosc wczytana z profilu tez jest zaznaczona",
    h.buttons[2].getAttribute("aria-checked") === "true" &&
    h.buttons[0].getAttribute("aria-checked") === "false");
})();

(function () {
  const h = choiceHarness(true); /* starszy WebView: bez konstruktora Event */
  h.api.buildChoiceRows();
  let changes = 0;
  h.select.onchange = function () { changes++; };
  h.buttons[2].onclick.call(h.buttons[2]);
  check("na starszym WebView zdarzenie „change” idzie droga zapasowa (createEvent)",
    changes === 1 && h.select.events[0].type === "change", "zmian: " + changes);
})();

check("pole z lista wyboru nie rozwija systemowego menu (ukryty <select> + rzad przyciskow)",
  html.indexOf('id="sourceType" class="choice-value"') > 0 &&
  html.indexOf('data-choice-for="sourceType"') > 0 &&
  /\.settings-card select\.choice-value\s*\{\s*display:\s*none/.test(css));
check("wybrana pozycja jest widoczna od razu (tlo akcentu, nie tylko obwodka fokusu)",
  /\.choice-row button\[aria-checked="true"\]\s*\{[^}]*background:\s*var\(--grad\)/.test(css));
check("lista wyboru jest wieksza na telewizorze", css.indexOf("body.uimode-tv .choice-row button") > 0);
check("pozostale listy (<option>) maja wlasne tlo, a nie systemowe",
  /select option\s*\{[^}]*background/.test(css));
check("lista wyboru powstaje przy starcie, a wartosc z profilu ja odswieza",
  src.indexOf("\n  buildChoiceRows();") > 0 && src.indexOf("\n    syncChoiceRows();") > 0);

/* Fokus na liście rozwijanej w ustawieniach: podświetla się cały wiersz (nazwa
   zmiennej świeci razem z polem), a lista dostaje akcentowe tło i grubszą
   obwódkę. Sama cienka ramka wokół 240-pikselowego pola gubiła się w kolumnie
   ustawień — na telewizorze nie było widać, czy zmienia się „Dni EPG”, krok
   przewijania, próby ponownego uruchomienia, odświeżanie EPG czy przesunięcie
   czasu EPG. */
const rowSelectIds = ["archiveDays", "seekSeconds", "retryAttempts", "epgRefreshMinutes", "epgShiftHours"];
const notInRow = rowSelectIds.filter(function (id) {
  const at = html.indexOf('id="' + id + '"');
  const open = html.lastIndexOf('<label class="row-label">', at);
  return at < 0 || open < 0 || html.lastIndexOf("</label>", at) > open;
});
check("listy rozwijane z EPG siedza w wierszach ustawien (" + rowSelectIds.length + " pol)",
  notInRow.length === 0, notInRow.join(", "));
check("fokus na liscie rozwijanej widac razem z nazwa wiersza",
  css.indexOf("body.uimode-tv .settings-card label:focus-within > span") > 0 &&
  /body\.uimode-tv \.settings-card \.row-label select:focus\s*\{[^}]*background: rgba\(91, 140, 255, \.22\)[^}]*outline: 4px solid var\(--accent\)/.test(css));

/* --- 14. program TV: podpis „LIVE”, podświetlenie do catch-up, linia godziny --
   Program, który leci teraz, dostaje podpis „LIVE” i samą obwódkę akcentu,
   a mocne podświetlenie (gradient) należy do programu wybieranego pilotem —
   tym samym wskazuje się materiał do catch-up. Przez całą siatkę, przez
   wszystkie kanały, biegnie pionowa linia bieżącej godziny z podpisem. */
check("program „teraz” jest podpisany „LIVE” przy tytule",
  src.indexOf('titleRow.className = "guide-title-row"') > 0 &&
  src.indexOf('live.className = "guide-live"') > 0 &&
  src.indexOf('live.textContent = t("live")') > 0 &&
  css.indexOf(".guide-live {") > 0);
check("mocne podswietlenie nalezy do wybieranego programu, nie do „teraz”",
  /\.guide-program:focus[\s\S]{0,140}background: var\(--grad\)/.test(css) &&
  /\.guide-program\.now\s*\{\s*border-color: var\(--accent\)/.test(css));
check("zaznaczony program do catch-up nie jest przygaszony",
  css.indexOf(".guide-program.past:focus") > 0);
check("linia biezacej godziny: pionowa kreska przez cala siatke i podpis z godzina",
  src.indexOf('line.className = "guide-nowline"') > 0 &&
  src.indexOf('line.id = "guideNowLine"') > 0 &&
  /\.guide-nowline\s*\{[^}]*top: 0[^}]*bottom: 0/.test(css) &&
  css.indexOf(".guide-nowline-label {") > 0);
check("linia liczy sie od poczatku osi czasu (kolumna kanalow + godzina)",
  src.indexOf("lane.offsetLeft") > 0 && src.indexOf("GUIDE_CHANNEL_WIDTH") > 0);
check("linia odswieza sie sama, a zegar chodzi tylko na widocznym programie TV",
  src.indexOf("setInterval(updateGuideNowLine, GUIDE_NOWLINE_MS)") > 0 &&
  src.indexOf('if (id !== "guideScreen") stopGuideNowLine();') > 0 &&
  src.indexOf("stopGuideNowLine();\n    showScreen(target);") > 0);
check("wiersze siedza we wspolnym pudelku (inaczej linia nie przejdzie przez wszystkie)",
  src.indexOf('rowsWrap.className = "guide-rows"') > 0 &&
  css.indexOf(".guide-rows { position: relative; }") > 0);
check("nazwy kanalow przykrywaja linie przy przewijaniu osi czasu",
  /\.guide-channel\s*\{[^}]*z-index: 4/.test(css) && /\.guide-axis\s*\{[^}]*z-index: 5/.test(css));
check("fokus kafelka kanalu to jedna obwodka wokol calego wiersza",
  css.indexOf("body.uimode-tv .channel .channel-main:focus") > 0);

/* Pasek postępu programu na liście kanałów: tor + podpis „jeszcze X min”, żeby
   było widać, że to postęp bieżącego programu, a nie sama kolorowa kreska. */
check("pasek postepu programu na kafelku ma tor i podpis",
  src.indexOf('progRow.className = "channel-progress-row"') > 0 &&
  src.indexOf('track.className = "channel-progress-track"') > 0 &&
  src.indexOf('timeLeft.className = "channel-progress-left"') > 0 &&
  src.indexOf('t("program_left", { m: minutesLeft })') > 0 &&
  src.indexOf('t("program_ending")') > 0 &&
  css.indexOf(".channel-progress-row") > 0 &&
  css.indexOf(".channel-progress-track") > 0);

/* Pasek postępu dotyczy programu, który leci teraz, więc stoi w kafelku zaraz
   pod jego wierszem, a przed wierszem „Następnie…”. Był dokładany na końcu
   i wyglądał, jakby opisywał następną audycję. */
check("pasek postepu stoi miedzy biezacym programem a wierszem nastepnym",
  src.indexOf("main.appendChild(nowRow)") < src.indexOf("main.appendChild(progRow)") &&
  src.indexOf("main.appendChild(progRow)") < src.indexOf("main.appendChild(nextRow)"));

/* --- 15. zakładki ustawień (Ogólne / Aktualizacja / Instrukcja) ----------
   Ustawienia rosły w jedną długą kartę, w której instrukcja pilota stała
   pomiędzy polami formularza. Teraz są trzy zakładki: „Ogólne” (sama
   aplikacja: profil, źródła, EPG, odtwarzanie, wygląd), „Aktualizacja” (tylko
   wydania) i „Instrukcja” (poradnik obsługi pilota). */
function settingsPanel(id) {
  const at = html.indexOf('id="' + id + '"');
  if (at < 0) return "";
  const next = html.indexOf('id="settingsPanel', at + 12);
  return next < 0 ? html.slice(at) : html.slice(at, next);
}

const tabsAt = html.indexOf('id="settingsTabs"');
const tabsHtml = tabsAt < 0 ? "" : html.slice(tabsAt, html.indexOf("</nav>", tabsAt));
const tabNames = (tabsHtml.match(/data-tab="[a-z]+"/g) || [])
  .map(function (s) { return s.replace(/.*="/, "").replace(/"$/, ""); });
check("ustawienia maja trzy zakladki (Ogolne / Aktualizacja / Instrukcja)",
  tabNames.join(",") === "general,update,help", tabNames.join(",") || "brak paska zakladek");
check("kazda zakladka ma napis z tlumaczen i swoja sekcje z trescia",
  html.indexOf('data-i18n="tab_general"') > 0 && html.indexOf('data-i18n="tab_update"') > 0 &&
  html.indexOf('data-i18n="tab_help"') > 0 &&
  html.indexOf('id="settingsPanelGeneral"') > 0 && html.indexOf('id="settingsPanelUpdate"') > 0 &&
  html.indexOf('id="settingsPanelHelp"') > 0);
check("zakladki przelacza app.js — widoczna jest jedna sekcja naraz",
  src.indexOf('var SETTINGS_TABS = ["general", "update", "help"];') > 0 &&
  src.indexOf("function showSettingsTab(name)") > 0 &&
  src.indexOf('panel.classList.toggle("hidden", !on)') > 0);
check("pilot zmienia zakladke (◀ ▶), a ▼ wchodzi w jej tresc",
  src.indexOf("stepSettingsTab(key === 37 || key === 412 ? -1 : 1)") > 0 &&
  src.indexOf("focusSettingsPanel();") > 0 &&
  src.indexOf('focused.getAttribute("data-tab")') > 0);
check("pasek zakladek wyglada jak przelacznik (aktywna w kolorze akcentu)",
  css.indexOf(".settings-tabs {") > 0 && css.indexOf(".settings-tab.active {") > 0 &&
  css.indexOf("body.uimode-tv .settings-tab") > 0);

const generalPanel = settingsPanel("settingsPanelGeneral");
const updatePanel = settingsPanel("settingsPanelUpdate");
const helpPanel = settingsPanel("settingsPanelHelp");
check("zakladka Ogolne trzyma sama aplikacje (zrodla, wyglad), a nie aktualizacje",
  generalPanel.indexOf('data-i18n="sources"') > 0 && generalPanel.indexOf('data-i18n="appearance"') > 0 &&
  generalPanel.indexOf('id="checkUpdates"') < 0);
check("zakladka Aktualizacja trzyma tylko wydania",
  updatePanel.indexOf('id="checkUpdates"') > 0 && updatePanel.indexOf('id="installUpdate"') > 0 &&
  updatePanel.indexOf('data-i18n="sources"') < 0);
check("zakladka Instrukcja to poradnik (nawigacja, odtwarzacz, EPG, archiwum)",
  helpPanel.indexOf('data-i18n="help_nav_move"') > 0 &&
  helpPanel.indexOf('data-i18n="player_keys"') > 0 &&
  helpPanel.indexOf('data-i18n="help_epg_grid"') > 0 &&
  helpPanel.indexOf('data-i18n="help_catchup_list"') > 0);
check("przyciski aktualizacji wygladaja jak przyciski (tlo, obwodka, hover)",
  /\.update-row button\s*\{[^}]*background: var\(--surface-2\)[^}]*border: 2px solid var\(--border\)/.test(css) &&
  css.indexOf(".update-row button:hover") > 0 &&
  /\.update-row #installUpdate\s*\{[^}]*background: var\(--grad\)/.test(css));
/* --- 16. pasek odtwarzacza bez duplikatow --------------------------------
   Na pasku stały przyciski „Kanał” (to samo, co MENU / trzymane OK) i
   „Wstecz” (to samo, co klawisz Wstecz na pilocie), a „Program TV” otwierał
   siatkę wszystkich kanałów zamiast programów oglądanego kanału. */
const osdStart = src.indexOf("function buildOsdActions()");
const osdEnd = src.indexOf("function openPlayerGuide()");
if (osdStart < 0 || osdEnd <= osdStart) throw new Error("Nie znalazlem paska odtwarzacza w app.js");
const codeOsd = src.slice(osdStart, osdEnd);
check("menu opcji kanalu i Wstecz na pasku pokazuja sie tylko na dotykowym ekranie",
  codeOsd.indexOf('classList.add("osd-touch-only")') > 0 &&
  codeOsd.indexOf('osdButton("options", t("ctx_menu")') > 0 &&
  css.indexOf("body.uimode-tv .osd-touch-only { display: none; }") > 0);
check("„EPG” na pasku otwiera liste programow ogladanego kanalu",
  codeOsd.indexOf('osdButton("epg", t("osd_epg"), openPlayerGuide)') > 0 &&
  src.indexOf("openArchive(state.watchChannel, { fromPlayer: true });") > 0 &&
  src.indexOf('osd_epg: "📅 EPG"') > 0);
check("„Na zywo” jest na pasku wtedy, gdy obraz nie jest na zywo",
  codeOsd.indexOf('if (state.isArchive) bar.appendChild(osdButton("live", t("osd_live"), goLive));') > 0);
check("„Od poczatku” zostaje takze na kanale na zywo z EPG",
  codeOsd.indexOf("if (state.isArchive || currentProgram(channel))") > 0);

/* --- 17. „Wstecz” w odtwarzaczu nie wraca na pusty odtwarzacz -------------
   Akcje wewnątrz obrazu (następny program, „od początku”, „na żywo”,
   wznowienie po pauzie) podawały playerScreen jako ekran powrotu. Po wyjściu
   z kanału „Wstecz” pokazywał więc czarny prostokąt: odtwarzacz bez obrazu,
   bez paska i bez listy kanałów. */
check("cel powrotu odtwarzacza nigdy nie jest samym odtwarzaczem",
  src.indexOf('if (returnScreen && returnScreen !== "playerScreen") state.playerReturn = returnScreen;') > 0);
check("stopPlayback pilnuje, ze nie wraca na odtwarzacz bez kanalu",
  src.indexOf("var target = state.playerReturn && state.playerReturn !== \"playerScreen\"") > 0 &&
  src.indexOf("showScreen(target);") > 0);
check("lista programow wraca do obrazu tylko wtedy, gdy cos tam jeszcze leci",
  src.indexOf('archive.returnTo === "playerScreen" && state.watchChannel ? "playerScreen" : "browserScreen"') > 0);
check("Wstecz z archiwum idzie wspolna droga (closeArchive)",
  src.indexOf("if (archiveClose) archiveClose.onclick = closeArchive;") > 0 &&
  src.indexOf("closeArchive();\n      return true;") > 0);

/* --- 18. lista programow kanalu (EPG w odtwarzaczu) ---------------------- */
check("lista pokazuje takze to, co dopiero bedzie (12 godzin w przod)",
  src.indexOf("var ARCHIVE_AHEAD = 12 * 3600000;") > 0 &&
  src.indexOf("var until = fromPlayer ? now + ARCHIVE_AHEAD : now;") > 0);
check("program, ktory leci teraz, ma podpis LIVE",
  src.indexOf('live.className = "guide-live"') > 0 && src.indexOf('live.textContent = t("live")') > 0);
check("program, ktory dopiero bedzie, widac, ale nie da sie go wybrac",
  src.indexOf('note.textContent = t("epg_list_future")') > 0 &&
  src.indexOf("button.disabled = true;") > 0 && css.indexOf(".program.future {") > 0);
check("„Na zywo” nad lista wraca do biezacej chwili",
  html.indexOf('id="archiveLive"') > 0 && src.indexOf("function playArchiveLive()") > 0 &&
  src.indexOf("if (archiveLive) archiveLive.onclick = playArchiveLive;") > 0);
/* „Wstecz” obok „Na żywo” musi mieć ten sam napis — obie niosą klasę
   .labeled-button, bo bez niej „Wstecz” zostawał przy domyślnym rozmiarze
   i na telewizorze był mniejszy niż „Na żywo”. */
check("„Wstecz” nad lista programow ma ten sam napis co „Na zywo”",
  /id="archiveLive"[^>]*class="labeled-button"/.test(html) &&
  /id="archiveClose"[^>]*class="labeled-button"/.test(html) &&
  css.indexOf("body.uimode-tv .labeled-button { padding: 15px 24px; font-size: 21px; }") > 0);
check("lista otwarta z odtwarzacza wraca potem do listy kanalow",
  src.indexOf('playChannel(channel, program, fromPlayer ? "browserScreen" : "archiveScreen");') > 0);
/* „Na żywo” z listy otwartej w odtwarzaczu też wraca do listy kanałów. Wcześniej
   wołało archiveScreen, więc po wyjściu z obrazu lista programów wyskakiwała na
   całym ekranie — to był błąd „EPG na pełnym ekranie po wyjściu z odtwarzacza”. */
check("„Na zywo” z listy otwartej w odtwarzaczu wraca do listy kanalow",
  src.indexOf('playChannel(archive.channel, null, archive.fromPlayer ? "browserScreen" : "archiveScreen");') > 0);
/* Podpis „Program EPG - nazwa kanału” i przyciski „Na żywo”/„Wstecz” stoją razem
   w nagłówku listy, jeden pod drugim, a nie trzeba ich szukać pilotem po ekranie. */
check("podpis Program EPG - nazwa kanalu nad przyciskami listy",
  html.indexOf('class="archive-header"') > 0 &&
  html.indexOf('id="archiveHeading"') > 0 &&
  html.indexOf('class="archive-nav"') > 0 &&
  src.indexOf('heading.textContent = t("epg_panel_title") + " - " + channel.name;') > 0 &&
  css.indexOf("#archiveScreen header.archive-header") > 0);
/* Lista programów przewija się sama, a nagłówek z przyciskami zostaje na górze,
   więc „Na żywo”/„Wstecz” widać od razu po otwarciu — bez szukania przyciskiem ▲. */
check("naglowek listy programow zostaje na gorze (lista przewija sie sama)",
  css.indexOf("#archiveScreen { display: flex; flex-direction: column; }") > 0 &&
  css.indexOf("#archiveScreen .programs { flex: 1; min-height: 0; }") > 0);
/* Na liście programów mocne podświetlenie (obwódka) należy tylko do wpisu
   wybieranego pilotem — program LIVE i odtwarzany znaczy sama akcentowa godzina
   i podpis, więc nie świecą się dwa miejsca naraz. */
check("lista programow bez drugiego podswietlenia na programie LIVE",
  css.indexOf(".program.now { border-color: var(--accent); }") < 0 &&
  css.indexOf(".program.playing { border-color: var(--accent); }") < 0 &&
  css.indexOf(".program.now time { color: var(--accent); }") > 0);
/* Lista otwarta z paska „EPG” ma od razu stać na tym, co leci teraz. Wcześniej
   fokus dostawał pierwszy wpis z góry, a tam są programy z przyszłości
   (najnowszy start jest pierwszy) — wyłączony przycisk nie przyjmuje jednak
   fokusu, więc podświetlenie wchodziło w program LIVE dopiero po ▼. */
check("lista programow z odtwarzacza staje na programie, ktory leci teraz",
  src.indexOf("archive.liveButton = button;") > 0 &&
  src.indexOf("var live = archive.playingButton || archive.liveButton;") > 0 &&
  src.indexOf("if (fromPlayer && live) {") > 0);
check("wylaczony wpis nie przejmuje fokusu przy wejsciu na ekran",
  src.indexOf("if (all[i].disabled) continue;") > 0);
/* Wpis listy czyta sie teraz w trzech liniach: dzien z rokiem, godzina od–do
   i dopiero pod nimi nazwa z podpisem LIVE / ODTWARZANE. Wczesniej data i godzina
   staly sklejone („07.10 11:00–12:00”) i wygladaly jak jedna liczba. */
check("wpis listy programow: data z rokiem nad godzina od-do",
  src.indexOf("function formatDay(ms)") > 0 &&
  src.indexOf("function formatClock(start, end)") > 0 &&
  src.indexOf('day.className = "program-date";') > 0 &&
  src.indexOf("time.appendChild(document.createTextNode(formatClock(program.start, program.end)));") > 0 &&
  css.indexOf(".program-date { display: block;") > 0);
const padAt = src.indexOf("function pad2(n)");
const dayAt = src.indexOf("function formatDay(ms)");
const clockAt = src.indexOf("function formatClock(start, end)");
if (padAt < 0 || dayAt < 0 || clockAt < 0) throw new Error("Nie znalazlem formatDay/formatClock w app.js");
const dateBox = run(
  src.slice(padAt, src.indexOf("\n  }", padAt) + 4) +
  src.slice(dayAt, src.indexOf("\n  }", clockAt) + 4),
  {});
const dayMoment = new Date(2026, 9, 7, 11, 0).getTime();
const dayMomentEnd = new Date(2026, 9, 7, 12, 0).getTime();
check("data to pelny dzien z rokiem, a godzina sama (07.10.2026 / 11:00–12:00)",
  dateBox.formatDay(dayMoment) === "07.10.2026" &&
  dateBox.formatClock(dayMoment, dayMomentEnd) === "11:00–12:00");

/* --- 19. play/pauza z pilota (klawisze multimedialne) --------------------
   Przycisk ⏵‖ na pilocie nie robił nic: dekodery wysyłają różne kody
   (85 / 126 / 127 / 86 / 415 / 179), a część z nich WebView zjadał dla
   własnej sesji multimediów. Teraz obsługujemy kody i nazwy klawiszy, stan
   sesji multimediów, zwolnienie klawisza i most natywny. */
check("kody klawiszy multimedialnych obu platform",
  src.indexOf("var MEDIA_KEY_TOGGLE = [85, 126, 179, 415];") > 0 &&
  src.indexOf("var MEDIA_KEY_PAUSE = [86, 93, 127, 178];") > 0 &&
  src.indexOf('if (name === "MediaPlayPause" || name === "MediaPlay") return "toggle";') > 0);
check("play/pauza dziala takze bez keydown (keyup) i przez most natywny",
  src.indexOf("if (media && !mediaKeyHandledRecently()) {") > 0 &&
  src.indexOf("window.__openiptvKey = function (code, name)") > 0 &&
  src.indexOf("runMediaKey(media);") > 0);
check("sesja multimediow rejestruje akcje pilota (Android TV / Fire TV)",
  src.indexOf("function bindMediaSession()") > 0 &&
  src.indexOf("seekbackward: function () { seekBy(-1); }") > 0 &&
  src.indexOf("session.playbackState = inPlayer") > 0);
check("natywny odbiornik wie, ze leci obraz (most setPlayerMode)",
  src.indexOf("function notifyNativePlayer(on)") > 0 && src.indexOf("bridge.setPlayerMode(!!on);") > 0 &&
  src.indexOf('notifyNativePlayer(id === "playerScreen");') > 0);
check("MainActivity oddaje klawisze multimedialne stronie tylko w odtwarzaczu",
  java.indexOf("public boolean onKeyDown(int keyCode, KeyEvent event)") > 0 &&
  java.indexOf("window.__openiptvKey") > 0 &&
  java.indexOf("public void setPlayerMode(final boolean on)") > 0 &&
  java.indexOf("if (playerMode && isMediaKey(keyCode))") > 0);

/* --- 20. pasek przewijania archiwum („cofnieto / przesunieto o N s”) ----
   Po skoku w catch-upie dekoder donosi obraz na nowa pozycje i pasek mowil
   wtedy „Ladowanie strumienia… (LIVE)”, choc obraz byl tylko przesuwany.
   Teraz pasek opisuje skok, a komunikat o wczytywaniu nazywa silnik. */
check("pasek ma osobne miejsce na wpis o przewinieciu",
  html.indexOf('id="playerSeek"') > 0 && html.indexOf('class="player-seek hidden"') > 0 &&
  css.indexOf(".player-seek {") > 0);
check("skok w archiwum opisuje krok w sekundach, w obu jezykach",
  src.indexOf("function markSeek(direction, seconds)") > 0 &&
  src.indexOf('seek_back: "Cofnięto o {s} s"') > 0 &&
  src.indexOf('seek_forward: "Przesunięto o +{s} s"') > 0 &&
  src.indexOf('seek_back: "Back {s} s"') > 0 &&
  src.indexOf('seek_forward: "Forward +{s} s"') > 0);
check("opis skoku bierze sie z tego, co sie naprawde przesunelo",
  src.indexOf("if (moved) markSeek(moved < 0 ? -1 : 1, Math.abs(moved));") > 0 &&
  src.indexOf("var moved = Math.round(video.currentTime) - Math.round(before);") > 0);
check("nowe okno catch-up i powrot na zywo nie zostawiaja starego wpisu",
  src.indexOf("markSeek(-1, seekStep());") > 0 && src.indexOf("clearSeekMark();") > 0 &&
  src.indexOf("function clearSeekMark()") > 0);
check("po skoku waiting pokazuje skok, a nie wczytywanie strumienia",
  src.indexOf("if (seekNotice()) { showOsd(); return; }") > 0 &&
  src.indexOf("function seekNotice()") > 0 && src.indexOf("var SEEK_GRACE = 6000;") > 0);
check("komunikat o wczytywaniu nazywa silnik, a nie stan obrazu (LIVE)",
  src.indexOf("function engineName(engine)") > 0 &&
  src.indexOf('engine_native: "natywnie"') > 0 &&
  src.indexOf('showPlayerError(t("osd_buffering") + " (" + engineName(state.engine) + ")");') > 0);
check("kolejne nacisniecia pilota sumuja sie w jednym wpisie",
  src.indexOf("var same = state.seekAt && state.seekDirection === direction &&") > 0 &&
  src.indexOf("state.seekSize = (same ? state.seekSize : 0) + seconds;") > 0 &&
  src.indexOf("now - state.seekAt <= SEEK_GRACE;") > 0);
check("pasek odtwarzacza odswieza wpis razem z reszta wskazan",
  src.indexOf("updateOsdProgress();\n    refreshSeekNotice();") > 0);

/* --- 20a. czas pozostały po prawej stronie paska (hh:mm) -------------------
   Pasek odtwarzacza dopisuje, ile pozostało do końca programu albo nagrania —
   z podpisem „do końca”, bo samo hh:mm czytało się niejasno. Ma siedzieć po
   prawej stronie samego paska i liczyć się razem z jego odświeżaniem, a sposób
   odtwarzania („odtwarzacz VLC”) opowiada panel diagnostyki (patrz
   formatRemaining / setOsdRemain w app.js). */
check("pasek pokazuje po prawej stronie ile zostało do końca, z podpisem",
  html.indexOf('id="playerRemain"') > 0 && html.indexOf('class="player-remain"') > 0 &&
  css.indexOf(".osd-progress {") > 0 && css.indexOf(".player-remain {") > 0 &&
  src.indexOf("function formatRemaining(seconds)") > 0 &&
  src.indexOf("function setOsdRemain(seconds)") > 0 &&
  src.indexOf('t("osd_until") + " " + formatRemaining(seconds)') > 0 &&
  src.indexOf('osd_until: "do końca"') > 0 && src.indexOf('osd_until: "left"') > 0);
check("sposob odtwarzania zdjety z paska, a pokazuje go diagnostyka",
  src.indexOf("timeEl.textContent = engineLabel(state.engine)") < 0 &&
  src.indexOf('t("diag_engine")') > 0);
check("czas pozostały liczy sie na zywo, w archiwum i przez silnik odbiornika",
  src.indexOf("setOsdRemain(total - at / 1000);") > 0 &&
  src.indexOf("setOsdRemain(windowSeconds - where);") > 0 &&
  src.indexOf("setOsdRemain(now ? (now.end - Date.now()) / 1000 : null);") > 0);

/* --- 21. przewijanie z pilota: warianty klawiszy ⏪ ⏩ ----------------------
   Jeden przycisk ⏪ / ⏩, a dekodery wysylaja go roznymi kodami: webOS
   412/417, Android TV i Fire TV 89/90, a czesc pilotow klawisze „poprzedni /
   nastepny” (88/87, w Chromium 177/176). Bierzemy tez nazwy klawiszy, bo
   niektore piloty podaja kod 0, oraz zwolnienie klawisza, bo czesc pilotow
   wysyla przewijanie dopiero na keyup. */
check("przewijanie zna kody wszystkich pilotow",
  src.indexOf("var SEEK_BACK_KEYS = [412, 89, 88, 177];") > 0 &&
  src.indexOf("var SEEK_FORWARD_KEYS = [417, 90, 87, 176];") > 0);
check("przewijanie zna tez nazwy klawiszy (kod 0 na czesci dekoderow)",
  src.indexOf("function seekKeyDirection(keyCode, keyName, arrowsSeek)") > 0 &&
  src.indexOf('if (name === "MediaRewind" || name === "MediaTrackPrevious") return -1;') > 0 &&
  src.indexOf('if (name === "MediaFastForward" || name === "MediaTrackNext") return 1;') > 0);
check("strzalki przewijaja tylko przy wlaczonym ustawieniu",
  src.indexOf("if (arrowsSeek && keyCode === 37) return -1;") > 0 &&
  src.indexOf("if (arrowsSeek && keyCode === 39) return 1;") > 0 &&
  src.indexOf("var seekDirection = seekKeyDirection(key, event.key, settings.dpadSeek);") > 0);
check("most natywny przewija ta sama droga co klawiatura",
  src.indexOf("var seekDirection = seekKeyDirection(code, name, settings.dpadSeek);") > 0);
check("klawisz wyslany dopiero na zwolnieniu tez przewija - i tylko raz",
  src.indexOf("var seekKeyDown = {};") > 0 &&
  src.indexOf("seekKeyDown[key] = true;") > 0 &&
  src.indexOf("seekKeyDown[code] = true;") > 0 &&
  src.indexOf("if (seekKeyDown[seekCode]) { delete seekKeyDown[seekCode]; return; }") > 0 &&
  src.indexOf("var seekDirection = seekKeyDirection(seekCode, event.key, false);") > 0);

/* --- 22. program TV: siatka okienkowa (wszystkie kanały), większe okno -------
   Program TV rysował wiersze tylko dla 60 kanałów, a przy 5000 kanałów zaciąłby
   telewizor. Teraz w DOM jest tylko widok z zapasem (GUIDE_CHUNK / GUIDE_OVERSCAN),
   a brakujące kanały udają odstępy — dzięki temu siatka pokazuje wszystkie kanały
   listy, a rysowanie jednej porcji jest zawsze tak samo tanie. Okno jest
   większe (godziny liczą się z realnej szerokości ekranu, nagłówek jest mniejszy),
   a kafelki czytelniejsze (wyższy wiersz, tytuł w dwóch liniach, pasek postępu).
   Start EPG jest odroczony, żeby pobieranie nie zamroziło uruchomienia. */
check("siatka pokazuje wszystkie kanaly (bez ucinania listy)",
  src.indexOf("var GUIDE_CHUNK = 16;") > 0 &&
  src.indexOf("var GUIDE_OVERSCAN = 24;") > 0 &&
  src.indexOf("var GUIDE_AHEAD = 8;") > 0 &&
  src.indexOf("GUIDE_ROWS") < 0 && src.indexOf("guide_limited") < 0 &&
  src.indexOf("guide.items = guideChannels();") > 0);
check("brakujace kanaly udaja odstepy o wysokosci wiersza (padding siatki)",
  src.indexOf("function guideUpdateSpacers()") > 0 &&
  src.indexOf("wrap.style.paddingTop = (guide.winStart * guide.rowHeight)") > 0 &&
  src.indexOf("wrap.style.paddingBottom =") > 0 &&
  src.indexOf("guideUpdateSpacers();") > 0);
check("wiersze daleko nad widokiem sa usuwane, ale nie ten z fokusem",
  src.indexOf("function guidePruneTop(limit)") > 0 &&
  src.indexOf("if (!row || row.contains(document.activeElement)) break;") > 0);
check("przewijanie dokłada wiersze jedna porcja na raz (siatka sie nie zacina)",
  src.indexOf("function guideFollowScroll()") > 0 &&
  src.indexOf("if (guide.scrollLock) return;") > 0 &&
  src.indexOf("guideFill(Math.min(need, guideRowsOnScreen() + GUIDE_OVERSCAN * 3))") > 0 &&
  src.indexOf('grid.setAttribute("data-guide-scroll", "1");') > 0);
check("fokus na krawedzi widoku dokłada wiersze, zanim zabraknie programu",
  src.indexOf("function guideEnsureAhead()") > 0 &&
  src.indexOf("if (ahead < GUIDE_AHEAD) guideFill(GUIDE_AHEAD - ahead + GUIDE_CHUNK);") > 0 &&
  src.indexOf("guideEnsureAhead();") > 0);
check("okno wypelnia ekran: liczba godzin liczy sie z szerokosci siatki",
  src.indexOf("function guideFitHours(innerWidth, channelWidth)") > 0 &&
  src.indexOf("var GUIDE_MIN_HOURS = 3;") > 0 &&
  src.indexOf("var GUIDE_MAX_HOURS = 6;") > 0 &&
  src.indexOf("var GUIDE_HOUR_MIN_W = 300;") > 0 &&
  src.indexOf('container.style.setProperty("--guide-hour", guide.hourWidth + "px");') > 0);
check("szerokosc godziny idzie z app.js do CSS (linie godzin na kazdym wierszu)",
  css.indexOf("var(--guide-hour, 300px)") > 0 &&
  /\.guide-lane\s*\{[^}]*repeating-linear-gradient/.test(css));
check("ekran jest pokazywany przed rysowaniem (godziny z realnej szerokosci)",
  src.indexOf('showScreen("guideScreen");\n    renderGuide();') > 0 &&
  src.indexOf("var inner = guideInnerWidth();") > 0);
check("zmiana dnia albo godzin zostawia ten sam kanal pod fokusem",
  src.indexOf("function guideRedraw(shift)") > 0 &&
  src.indexOf("guideSetWindow(guide.windowStart + dir * 24 * 3600000);") > 0 &&
  src.indexOf("guideSetWindow(next - (next % 3600000));") > 0 &&
  src.indexOf("if (rowIndex > 0) guide.anchor = rowIndex - 1;") > 0 &&
  src.indexOf("if (inGrid) focusGuideRowBlock(rowIndex, focusTime, focusSame);") > 0);
check("po zmianie dnia albo godzin wracamy na ten sam program i to samo miejsce wiersza",
  src.indexOf("var focusTime = guideFocusTime();") > 0 &&
  src.indexOf("var keepOffset = guideRowViewportOffset();") > 0 &&
  src.indexOf("guideRestoreRowOffset(keepOffset);") > 0 &&
  src.indexOf("function guideBlockAtTime(row, time)") > 0);
check("przeskok o dobe szuka tej samej godziny, a nie ostatniego programu w kanale",
  src.indexOf("var focusSame = focusTime && shift ? focusTime + shift : 0;") > 0 &&
  src.indexOf("function guideBlockContaining(row, time)") > 0 &&
  src.indexOf("var block = guideBlockContaining(row, time) || guideBlockContaining(row, sameTime) ||") > 0 &&
  src.indexOf("function focusGuideRowBlock(index, time, sameTime)") > 0 &&
  /* okno zmienia sie wylacznie przez guideSetWindow: gdy ktos znowu ustawi
     guide.windowStart z pominieciem przeskoku, fokus przy „Wczoraj” wroci na
     ostatni program w kanale (dzien bez towarzyszacego guideRedraw) */
  (src.match(/guide\.windowStart = (?!start;)/g) || []).length === 1);
check("przycisk dnia nie cofa widoku siatki na poczatek listy",
  src.indexOf("var inGrid = rowIndex >= 0;") > 0 &&
  src.indexOf("var top = Math.max(0, grid.scrollTop - guideRowsOffset());") > 0 &&
  src.indexOf("rowIndex = guide.winStart + Math.floor(top / guide.rowHeight);") > 0);

check("obrot ekranu przerysowuje siatke (godziny licza sie na nowo)",
  /window\.addEventListener\("resize", function \(\) \{[\s\S]{0,400}guideRedraw\(\);/.test(src) &&
  src.indexOf("guide.resizeTimer = window.setTimeout(function () {") > 0);
check("naglowek programu TV jest mniejszy (przyciski dnia w jednej linii)",
  /#guideScreen header nav button\s*\{[^}]*padding: 10px 16px[^}]*font-size: 18px/.test(css) &&
  /#guideScreen > header > div\s*\{[^}]*display: flex/.test(css) &&
  css.indexOf("body.uimode-tv #guideScreen header nav button") > 0 &&
  css.indexOf("body.uimode-tv #guideScreen header nav input") > 0);
check("wiersz jest wyzszy, a tytul lamie sie na dwie linie",
  /\.guide-row \{[^}]*height: 96px/.test(css) &&
  css.indexOf("-webkit-line-clamp: 2") > 0 &&
  src.indexOf("return height > 20 ? height : 96;") > 0 &&
  src.indexOf("rowHeight: 96,") > 0);
check("program, ktory leci teraz, ma pasek postepu",
  src.indexOf('bar.className = "guide-progress"') > 0 &&
  src.indexOf("block.appendChild(bar);") > 0 &&
  src.indexOf("(now - p.start) / (p.end - p.start) * 100") > 0 &&
  css.indexOf(".guide-progress {") > 0);
check("programy z archiwum nie sa przygaszone tak samo jak te bez archiwum",
  css.indexOf(".guide-program.past:not([disabled])") > 0 &&
  css.indexOf(".guide-program.past:focus") > 0);
check("napis zakresu podaje liczbe kanalow (bez „pokazano 60 z …”)",
  src.indexOf('t("guide_count", { count: guide.items.length })') > 0 &&
  src.indexOf('guide_count: "kanałów: {count}"') > 0 &&
  src.indexOf('guide_count: "channels: {count}"') > 0 &&
  src.indexOf("guide_limited") < 0);
check("podpowiedz pilota pod siatka mowi o programach, kanalach i powrocie do dni",
  src.indexOf('guide_pan_hint: "◀ ▶ — programy • ▲ ▼ — kanały"') > 0 &&
  src.indexOf("help_epg_pan:") > 0 &&
  src.indexOf("▲ ▼ przechodzą na kanał wyżej albo niżej") > 0 &&
  src.indexOf("◀ ▶ chodzą po programach tego samego kanału") > 0 &&
  src.indexOf("Oś czasu dosuwa się razem z podświetleniem") > 0 &&
  html.indexOf("◀ ▶ chodzą po programach tego samego kanału") > 0 &&
  html.indexOf("Oś czasu dosuwa się razem z podświetleniem") > 0);
check("z gornego wiersza ▲ wraca do przyciskow dnia",
  src.indexOf("if (keyCode === 38) focusGuideHeader();") > 0 &&
  src.indexOf('var target = $("guideToday") || $("guideClose");') > 0);
/* Pasek dnia w nagłówku Program TV: gdy fokus na nim stoi, ◀ ▶ chodzą po jego
   przyciskach i polach, a ▼ wraca do siatki. Wcześniej strzałki zawsze
   przesuwały oś czasu, więc fokus tkwił na „Dziś” i „Wczoraj”, daty ani godziny
   nie dało się dosięgnąć pilotem. Długa nazwa programu jest ucinana, żeby nie
   spychała paska dnia do drugiego rzędu. */
check("strzalki w pasku dnia chodza po jego przyciskach, a nie po osi czasu",
  src.indexOf('var guideHead = $("guideScreen").querySelector("header");') > 0 &&
  src.indexOf("if (guideHead && guideHead.contains(document.activeElement)) {") > 0 &&
  src.indexOf("if (key === 40) { focusGuide(40); return; }") > 0 &&
  src.indexOf("focusNearest(key === 37 || key === 412 ? 37 : 39);") > 0);
check("dluga nazwa programu jest ucinana, a nie spycha paska dnia",
  css.indexOf("min-width: 0; max-width: 42vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;") > 0);
/* ▲ ▼ przenoszą podświetlenie o jeden kanał (wiersz), na program z tego samego
   momentu (guideFocusTime) — wcześniej szukały najbliższego kafelka po
   współrzędnych, więc podświetlenie uciekało w bok po osi czasu. Kanały bez
   programu w tym momencie są przeskakiwane, a wiersze poniżej widoku
   dorysowywane porcją (guideEnsureRow), bo lista jest rysowana okienkowo. */
check("▲ ▼ chodza o jeden kanal, na program z tego samego momentu",
  src.indexOf("function guideStepRow(index, dir, time)") > 0 &&
  src.indexOf("var moved = guideStepRow(index, keyCode === 38 ? -1 : 1, guideFocusTime());") > 0 &&
  src.indexOf("revealGuideBlock(moved);") > 0 &&
  src.indexOf("function guideEnsureRow(index)") > 0 &&
  src.indexOf("if (need > 0) guideFill(need);") > 0 &&
  src.indexOf("var block = focusGuideRowBlock(i, time, 0);") > 0 &&
  src.indexOf("if (!block) return null;") > 0);

/* Program TV z nagłówka ma pokazywać wszystkie kanały, a nie tylko wybraną
   grupę. W „Ulubionych” albo w małej grupie siatka miała kilka wierszy, więc
   nie było po czym chodzić pilotem i EPG wyglądało na puste. Kanał, na którym
   ma stanąć fokus, wybiera się kluczem (guide.focusKey), a nie filtrowaniem. */
const guideChannelsAt = src.indexOf("function guideChannels()");
const guideChannelsBody = guideChannelsAt < 0 ? "" :
  src.slice(guideChannelsAt, src.indexOf("\n  }", guideChannelsAt));
check("program TV pokazuje wszystkie kanaly (nie tylko wybrana grupe)",
  guideChannelsBody.indexOf("return state.channels;") > 0 &&
  guideChannelsBody.indexOf("selectedGroup") < 0);

/* EPG otwarte z kanału ma od razu stać na tym, co leci teraz (także z opcji
   kanału na liście). Fokus ustawia focusGuideWatched(), a odroczony fokus
   ekranu (showScreen) nie może mu go zabrać — po tym zabraniu podświetlenie
   lądowało na przycisku dnia i dopiero ▼ wchodziło w program, który i tak był
   wybrany, więc wyglądało to jak brak „live”. */
check("EPG z kanalu staje na tym, co leci teraz, i nie gubi fokusu",
  src.indexOf("function focusGuideWatched()") > 0 &&
  src.indexOf("if (active && screen && active !== document.body && screen.contains(active)) return;") > 0 &&
  src.indexOf('if (inPlayer) openGuide({ channel: target, returnTo: "playerScreen" });') > 0 &&
  src.indexOf("else openGuide({ channel: target });") > 0);

/* Ekran otwarty PRZED końcem parsowania EPG sam się odświeża, gdy programy
   dojdą: wcześniej Program TV i lista programów kanału zostawały puste i EPG
   pojawiało się dopiero po wyjściu i ponownym wejściu. loadEpgInBackground
   woła refreshOpenEpgViews, które przerysowuje widoczny ekran. */
check("EPG dosyla sie do otwartego ekranu po zakonczeniu parsowania",
  src.indexOf("function refreshOpenEpgViews()") > 0 &&
  src.indexOf("refreshOpenEpgViews();\n        setStatus") > 0 &&
  src.indexOf('if (guideScreen && !guideScreen.classList.contains("hidden")) {') > 0 &&
  src.indexOf("renderGuide();\n      focusGuideWatched();\n      updateGuideNowLine();") > 0 &&
  src.indexOf("openArchive(archive.channel, { fromPlayer: archive.fromPlayer });") > 0);

/* ◀ ▶ chodzą po programach tego samego kanału — także po tych, które dopiero
   będą (nie da się ich włączyć, ale pilot staje na nich i czyta, co będzie).
   Oś czasu dosuwa się dopiero wtedy, gdy podświetlonego programu nie widać
   w całości, a gdy w danych kanału nie ma już sąsiada — o godzinę. */
check("◀ ▶ chodza po programach tego samego kanalu",
  src.indexOf("function guideStepProgram(dir)") > 0 &&
  src.indexOf("guideStepProgram(key === 37 || key === 412 ? -1 : 1);") > 0 &&
  src.indexOf("guidePan(key === 37 || key === 412 ? -1 : 1);") < 0 &&
  src.indexOf("var blocks = guideRowBlocks(row);") > 0 &&
  src.indexOf("focusKeepScroll(next);\n      revealGuideBlock(next);") > 0);
/* Programy trzymamy posortowane od najnowszego (parseXmltv), wiec kafelek obok
   w DOM lezy na osi po przeciwnej stronie, niz wskazuje strzalka: ◀ szlo w prawo,
   a ▶ w lewo i dopiero na skraju okna podswietlenie „odnajdywalo sie” po drugiej
   stronie. Sasiada bierzemy po czasie (data-start), a nie po numerze w DOM. */
check("◀ ▶ ida po osi czasu, a nie po kolejnosci kafelkow w DOM",
  src.indexOf("function guideRowBlocks(row)") > 0 &&
  /blocks\.sort\(function \(a, b\) \{\s*return \(parseInt\(a\.getAttribute\("data-start"\), 10\) \|\| 0\) -/.test(src));
/* Nazwa podswietlonego programu jest zawsze widoczna: waski kafelek (krotki
   program) ucina ja wielokropkiem, a wtedy czyta sie ja z podpisu nad siatka
   (guideFocusNote), ktory pokazuje tez godziny tego programu. */
check("nazwa podswietlonego programu jest nad siatka (takze przy waskim kafelku)",
  html.indexOf('<span id="guideFocusName" class="guide-focus-name"></span>') > 0 &&
  src.indexOf("function guideFocusNote(block)") > 0 &&
  src.indexOf("guideFocusNote(block);") > 0 &&
  src.indexOf("guideFocusNote(null);") > 0 &&
  src.indexOf('t("guide_focus_name", {') > 0 &&
  css.indexOf(".guide-focus-name { color: var(--accent);") > 0);
/* Os czasu jest oknem, a nie przewijanym widokiem: przewinieta w poziomie siatka
   rozjezdzala widoczny zakres z oknem czasu i podswietlony program uciekal za
   krawedz (bylo go widac tyle, co nic). */
check("podswietlony kafelek nie ucieka w poziomie",
  src.indexOf("if (grid.scrollLeft) grid.scrollLeft = 0;") > 0 &&
  src.indexOf("if (container.scrollLeft) container.scrollLeft = 0;") > 0);
/* Szerokosc godziny musi zmiescic cala os w widoku: na ekranie, ktory nie ma
   trzech godzin po GUIDE_HOUR_MIN_W, stara wersja podnosila szerokosc do minimum
   i os wystawala za prawa krawedz — program na koncu zakresu znikal z ekranu. */
const hourWidthAt = src.indexOf("function guideHourWidth(room, hours)");
if (hourWidthAt < 0) throw new Error("Nie znalazlem guideHourWidth w app.js");
const hourWidthBox = run(src.slice(hourWidthAt, src.indexOf("\n  }", hourWidthAt) + 4),
  { GUIDE_HOUR_FIT_W: 120 });
check("wasciutki ekran: os czasu nie wystaje za prawa krawedz",
  hourWidthBox.guideHourWidth(652, 3) === Math.floor(652 / 3) &&
  3 * hourWidthBox.guideHourWidth(652, 3) <= 652);
check("telewizor 1080p: godzina dzieli miejsce tak jak dotad (300+ px)",
  hourWidthBox.guideHourWidth(1564, 5) === Math.floor(1564 / 5) &&
  5 * hourWidthBox.guideHourWidth(1564, 5) <= 1564);
check("bardzo waski ekran: kafelek zostaje na tyle szeroki, zeby go trafic",
  hourWidthBox.guideHourWidth(200, 3) === 120);
check("szerokosc godziny bierze sie z guideHourWidth, nie z samego minimum",
  src.indexOf("guide.hourWidth = guideHourWidth(inner - columnWidth, guide.hours);") > 0 &&
  src.indexOf("guide.hourWidth = Math.max(GUIDE_HOUR_MIN_W,") < 0);
check("os czasu dosuwa sie razem z podswietleniem, a nie samo z siebie",
  src.indexOf("function guideNeighbourProgram(channel, time, dir)") > 0 &&
  src.indexOf("target.start - (target.start % 3600000)") > 0 &&
  src.indexOf("focusGuideRowBlock(rowIndex, target.start + 1, 0);") > 0 &&
  src.indexOf("function guideFittedStart(start, end)") > 0 &&
  src.indexOf("function guideFitWindow(start, end)") > 0 &&
  src.indexOf('guideFitWindow(parseInt(next.getAttribute("data-start"), 10),') > 0 &&
  src.indexOf("if (next === null || next === guide.windowStart) return false;") > 0);
/* Program, którego nie da się włączyć (przyszłość, brak archiwum), zostaje na
   osi jako zwykły przycisk: `disabled` zabierało fokus, więc ◀ ▶ nie miały
   po czym chodzić i podświetlenie zatrzymywało się na programie LIVE. */
check("program bez mozliwosci wlaczenia zostaje zaznaczalny pilotem",
  src.indexOf('block.classList.add("blocked");') > 0 &&
  src.indexOf('block.setAttribute("aria-disabled", "true");') > 0 &&
  src.indexOf("block.disabled = true;") < 0 &&
  css.indexOf(".guide-program.blocked { cursor: default; }") > 0 &&
  css.indexOf(".guide-program.blocked:focus") > 0);

/* --- sąsiedni program z danych EPG (to, czego nie ma na osi) ---------------
   Kafelki z przyszłości i te bez archiwum są zablokowane, więc ◀ ▶ nie mogą
   się na nich zatrzymać — inaczej pilot stanąłby na czymś, czego nie da się
   włączyć. Funkcja chodzi po danych kanału, bo kafelek poza oknem nie istnieje. */
const neighbourAt = src.indexOf("function guideNeighbourProgram(channel, time, dir)");
const neighbourEnd = src.indexOf("\n  }", neighbourAt) + 4;
if (neighbourAt < 0) throw new Error("Nie znalazlem guideNeighbourProgram w app.js");
/* szukanie programów kanału bierzemy z app.js (tvgId, nazwa, alias), żeby test
   nie powtarzał tej logiki */
const programsAt = src.indexOf("function programsFor(channel)");
const programsEnd = src.indexOf("\n  }", programsAt) + 4;
const NOW_EPG = 1700000000000;
const EPG_LIST = [
  { start: NOW_EPG - 7200000, end: NOW_EPG - 5400000, title: "dawny" },
  { start: NOW_EPG - 5400000, end: NOW_EPG - 3600000, title: "poprzedni" },
  { start: NOW_EPG - 1800000, end: NOW_EPG + 1800000, title: "teraz" },
  { start: NOW_EPG + 1800000, end: NOW_EPG + 5400000, title: "nastepny" }
];
const neighbourBox = run(src.slice(programsAt, programsEnd) + src.slice(neighbourAt, neighbourEnd), {
  Date: { now: function () { return NOW_EPG; } },
  state: { programs: { c1: EPG_LIST, c2: EPG_LIST } },
  epgAliases: {},
  /* kanał bez archiwum: wszystko, co minęło, jest zablokowane */
  hasArchive: function (channel) { return !!channel.catchupSource; }
});
const plainChannel = { name: "C1", tvgId: "c1" };
const archChannel = { name: "C2", tvgId: "c2", catchupSource: "?utc={utc}" };
check("bez archiwum ◀ nie cofa sie na program, ktorego nie da sie wlaczyc",
  neighbourBox.guideNeighbourProgram(plainChannel, NOW_EPG - 1800000, -1) === null &&
  neighbourBox.guideNeighbourProgram(plainChannel, NOW_EPG + 1800000, 1) === null);
check("z archiwum ◀ znajduje poprzedni program, a ▶ nigdy nie wchodzi w przyszlosc",
  neighbourBox.guideNeighbourProgram(archChannel, NOW_EPG - 1800000, -1).title === "poprzedni" &&
  neighbourBox.guideNeighbourProgram(archChannel, NOW_EPG + 1800000, -1).title === "teraz" &&
  neighbourBox.guideNeighbourProgram(archChannel, NOW_EPG + 1800000, 1) === null);
/* Ta sama lista w kolejnosci, w jakiej trzyma ja aplikacja (parseXmltv sortuje od
   najnowszego). Stara wersja przerywala petle na pierwszym przyszlym programie,
   wiec na danych z serwera ◀ ▶ nie znajdowaly nikogo i os czasu jechala sama. */
const neighbourDescBox = run(src.slice(programsAt, programsEnd) + src.slice(neighbourAt, neighbourEnd), {
  Date: { now: function () { return NOW_EPG; } },
  state: { programs: { c2: EPG_LIST.slice().reverse() } },
  epgAliases: {},
  hasArchive: function (channel) { return !!channel.catchupSource; }
});
check("na danych z serwera (od najnowszego) ◀ ▶ tez znajduja sasiada po osi",
  neighbourDescBox.guideNeighbourProgram(archChannel, NOW_EPG - 1800000, -1).title === "poprzedni" &&
  neighbourDescBox.guideNeighbourProgram(archChannel, NOW_EPG - 5400000, 1).title === "poprzedni" &&
  neighbourDescBox.guideNeighbourProgram(archChannel, NOW_EPG + 1800000, -1).title === "teraz" &&
  neighbourDescBox.guideNeighbourProgram(archChannel, NOW_EPG - 1800000, 1).title === "teraz" &&
  neighbourDescBox.guideNeighbourProgram(archChannel, NOW_EPG + 1800000, 1) === null);

/* --- ◀ ▶ chodzą po programach: co dokładnie robi guideStepProgram ----------
   Wiersz obsługujemy przez podmienione funkcje siatki (fokus, dosunięcie,
   przeskok osi), dzięki czemu widać, kiedy idzie program, a kiedy oś czasu. */
const stepAt = src.indexOf("function guideStepProgram(dir)");
const stepEnd = src.indexOf("\n  }", stepAt) + 4;
if (stepAt < 0) throw new Error("Nie znalazlem guideStepProgram w app.js");
/* sasiada w wierszu wybiera guideRowBlocks — kafelki po kolei na osi czasu
   (w DOM sa od najnowszego, wiec sam numer w DOM nie wystarcza) */
const rowBlocksAt = src.indexOf("function guideRowBlocks(row)");
const rowBlocksEnd = src.indexOf("\n  }", rowBlocksAt) + 4;
if (rowBlocksAt < 0) throw new Error("Nie znalazlem guideRowBlocks w app.js");
function stepHarness(o) {
  const calls = { focused: [], revealed: [], panned: [], windows: [], rowBlocks: [], fitted: [] };
  const blocks = o.blocks || [];
  const row = { querySelectorAll: function () { return blocks; } };
  const active = o.active;
  /* kafelek wie, w którym wierszu siedzi — w DOM robi to closest(".guide-row") */
  if (active && active.classList && active.classList.contains("guide-program")) {
    active.closest = function () { return row; };
  }
  const sandbox = {
    document: { activeElement: active },
    guide: { items: o.items || [], windowStart: o.windowStart || 0, hours: o.hours || 3 },
    focusKeepScroll: function (el) { calls.focused.push(el); },
    revealGuideBlock: function (el) { calls.revealed.push(el); },
    guidePan: function (dir) { calls.panned.push(dir); },
    guideFocusRowIndex: function () { return o.rowIndex === undefined ? 0 : o.rowIndex; },
    guideNeighbourProgram: function (channel, time, dir) {
      calls.neighbour = [channel, time, dir];
      return o.target || null;
    },
    guideSetWindow: function (start) { calls.windows.push(start); },
    /* Skraj zakresu rysujemy jak w app.js: guideFittedStart podaje początek
       nowego okna (z zaokrągleniem do pełnej godziny), a guideFitWindow dosuwa
       oś tylko wtedy, gdy programu nie widać w całości. */
    guideFittedStart: function (start) {
      calls.fitted.push(start);
      return start - (start % 3600000);
    },
    guideFitWindow: function (start, end) {
      calls.fitted.push([start, end]);
      const from = sandbox.guide.windowStart;
      const span = sandbox.guide.hours * 3600000;
      const margin = Math.min(1800000, span / 4);
      if (start >= from + margin && end <= from + span - margin) return false;
      sandbox.guideSetWindow(start - (start % 3600000));
      return true;
    },
    focusGuideRowBlock: function (index, time, sameTime) { calls.rowBlocks.push([index, time, sameTime]); }
  };
  run(src.slice(rowBlocksAt, rowBlocksEnd) + src.slice(stepAt, stepEnd), sandbox);
  return { calls: calls, step: sandbox.guideStepProgram };
}
function fakeBlock(id, attrs) {
  const map = attrs || {};
  return {
    id: id,
    classList: { contains: function (c) { return c === "guide-program"; } },
    closest: function () { return {}; },
    getAttribute: function (name) { return name in map ? String(map[name]) : null; }
  };
}
function headerButton() {
  return { classList: { contains: function () { return false; } }, closest: function () { return null; } };
}
(function () {
  const a = fakeBlock("a", { "data-start": 2000000, "data-end": 3000000 });
  const b = fakeBlock("b", { "data-start": 3000000, "data-end": 4000000 });
  const h = stepHarness({ blocks: [a, b], active: b });
  h.step(-1);
  check("◀ idzie na poprzedni program tego samego kanalu (bez ruszania osi)",
    h.calls.focused[0] === a && h.calls.revealed[0] === a && h.calls.panned.length === 0 &&
    h.calls.windows.length === 0 &&
    h.calls.fitted[0][0] === 2000000 && h.calls.fitted[0][1] === 3000000);
})();
(function () {
  const a = fakeBlock("a", { "data-start": 2000000, "data-end": 3000000 });
  const b = fakeBlock("b", { "data-start": 9000000, "data-end": 11000000 });
  const h = stepHarness({ blocks: [a, b], active: a });
  h.step(1);
  check("program na skraju zakresu dosuwa os czasu (podswietlenie prowadzi godziny)",
    h.calls.focused[0] === b && h.calls.revealed[0] === b && h.calls.panned.length === 0 &&
    h.calls.windows[0] === 9000000 - (9000000 % 3600000));
})();
(function () {
  const first = fakeBlock("first", { "data-start": 5000000, "data-end": 6000000 });
  const channel = { name: "Kanal" };
  const target = { start: 5000000 + 1234000, end: 5000000 + 3000000 };
  const h = stepHarness({
    blocks: [first], active: first, rowIndex: 3, items: [{}, {}, {}, channel], target: target
  });
  h.step(-1);
  const win = target.start - (target.start % 3600000);
  check("na skraju osi widok dosuwa sie do poprzedniego programu (godzina z zaokragleniem)",
    h.calls.panned.length === 0 && h.calls.neighbour[0] === channel &&
    h.calls.neighbour[1] === 5000000 && h.calls.neighbour[2] === -1 &&
    h.calls.windows[0] === win && win % 3600000 === 0 &&
    h.calls.rowBlocks[0][0] === 3 && h.calls.rowBlocks[0][1] === target.start + 1 &&
    h.calls.rowBlocks[0][2] === 0);
})();
(function () {
  const last = fakeBlock("last", { "data-start": 8000000, "data-end": 9000000 });
  const h = stepHarness({ blocks: [last], active: last, items: [{ name: "Kanal" }], target: null });
  h.step(1);
  check("gdy danych EPG nie ma juz dalej, ▶ przesuwa os czasu o godzine",
    h.calls.panned[0] === 1 && h.calls.windows.length === 0 &&
    h.calls.neighbour[1] === 9000000 && h.calls.neighbour[2] === 1);
})();
(function () {
  const h = stepHarness({ active: headerButton() });
  h.step(-1);
  check("fokus w naglowku: ◀ nadal przesuwa os czasu",
    h.calls.panned[0] === -1 && h.calls.focused.length === 0 && h.calls.windows.length === 0);
})();
/* Kafelki w DOM ida od najnowszego (parseXmltv), wiec ◀ ▶ musza brac sasiada
   z osi czasu, a nie z numeru w DOM — inaczej pilot szedl w druga strone. */
(function () {
  const early = fakeBlock("early", { "data-start": 2000000, "data-end": 3000000 });
  const middle = fakeBlock("middle", { "data-start": 3000000, "data-end": 4000000 });
  const late = fakeBlock("late", { "data-start": 4000000, "data-end": 5000000 });
  const h = stepHarness({ blocks: [late, middle, early], active: middle });
  h.step(-1);
  check("◀ na danych z serwera idzie na wczesniejszy program (kafelek z lewej)",
    h.calls.focused[0] === early && h.calls.revealed[0] === early &&
    h.calls.panned.length === 0);
})();
(function () {
  const early = fakeBlock("early", { "data-start": 2000000, "data-end": 3000000 });
  const middle = fakeBlock("middle", { "data-start": 3000000, "data-end": 4000000 });
  const late = fakeBlock("late", { "data-start": 4000000, "data-end": 5000000 });
  const h = stepHarness({ blocks: [late, middle, early], active: middle });
  h.step(1);
  check("▶ na danych z serwera idzie na pozniejszy program (kafelek z prawej)",
    h.calls.focused[0] === late && h.calls.revealed[0] === late &&
    h.calls.panned.length === 0);
})();

/* --- ▲ ▼ chodzą o kanał: co dokładnie robi guideStepRow -------------------- */
const rowStepAt = src.indexOf("function guideStepRow(index, dir, time)");
const rowStepEnd = src.indexOf("\n  }", rowStepAt) + 4;
if (rowStepAt < 0) throw new Error("Nie znalazlem guideStepRow w app.js");
function rowHarness(o) {
  const calls = { ensured: [], rowBlocks: [] };
  const sandbox = {
    guide: { items: o.items || [] },
    guideEnsureRow: function (index) {
      calls.ensured.push(index);
      return index < (o.items || []).length;
    },
    focusGuideRowBlock: function (index, time, sameTime) {
      calls.rowBlocks.push([index, time, sameTime]);
      return (o.withProgram || []).indexOf(index) >= 0 ? { index: index } : null;
    }
  };
  run(src.slice(rowStepAt, rowStepEnd), sandbox);
  return { calls: calls, step: sandbox.guideStepRow };
}
(function () {
  const h = rowHarness({ items: [{}, {}, {}], withProgram: [1] });
  const block = h.step(0, 1, 5000);
  check("▼ idzie o jeden kanal w dol, na program z tego samego momentu",
    !!block && block.index === 1 && h.calls.ensured[0] === 1 &&
    h.calls.rowBlocks.length === 1 && h.calls.rowBlocks[0][0] === 1 &&
    h.calls.rowBlocks[0][1] === 5000 && h.calls.rowBlocks[0][2] === 0);
})();
(function () {
  const h = rowHarness({ items: [{}, {}, {}, {}], withProgram: [3] });
  const block = h.step(0, 1, 5000);
  check("kanal bez programu w tym momencie jest przeskakiwany",
    !!block && block.index === 3 && h.calls.ensured.join(",") === "1,2,3");
})();
(function () {
  const h = rowHarness({ items: [{}, {}], withProgram: [0, 1] });
  const block = h.step(0, -1, 5000);
  check("▲ nad pierwszym wierszem nie ma juz kanalu (fokus wraca do naglowka)",
    block === null && h.calls.rowBlocks.length === 0);
})();
check("start EPG jest odroczony (lista kanalow rysuje sie od razu)",
  src.indexOf("function scheduleEpgStart(profile, epgUrl)") > 0 &&
  src.indexOf("window.requestIdleCallback(run, { timeout: 4000 })") > 0 &&
  src.indexOf("scheduleEpgStart(profile, state.epgUrl);") > 0 &&
  !/if \(settings\.epgReloadOnStart\) \{\s*loadEpgInBackground/.test(src));
check("odroczony start nie ruszy bez listy kanalow ani po zmianie profilu",
  src.indexOf("var EPG_START_DELAY_MS = 1500;") > 0 &&
  src.indexOf("window.setTimeout(run, EPG_START_DELAY_MS)") > 0 &&
  src.indexOf("if (!state.channels.length) return;") > 0 &&
  src.indexOf("if (!current || current.id !== profile.id) return;") > 0 &&
  src.indexOf("cancelEpgStart();\n    loadEpgInBackground(profile, state.epgUrl);") > 0);

/* --- 23. komunikat na środku obrazu i ▲ ▼ w pasku odtwarzacza ---------------
   Dwie rzeczy z pilota:
     • wpis o skoku („Cofnięto o 10 s”) był tylko w pasku, a pasek chowa się sam
       po OSD_AUTOHIDE — teraz ten sam komunikat widać na środku obrazu,
     • ▼ po otwarciu paska klawiszem OK zmieniało kanał, więc do przycisków
       („Pauza”, „EPG”…) nie dało się dojść. Pasek otwarty przez użytkownika jest
       teraz menu: ▲ ▼ wchodzą w jego przyciski, a pasek pokazany przy zmianie
       kanału zostaje informacją — ▲ ▼ dalej przełączają kanały. */
check("komunikat o skoku jest na srodku obrazu, nie tylko w pasku",
  html.indexOf('id="playerToast"') > 0 && html.indexOf('class="player-toast hidden"') > 0 &&
  src.indexOf("function showPlayerToast(text, ms)") > 0 &&
  src.indexOf("showPlayerToast(seekNotice());") > 0 &&
  src.indexOf("var TOAST_MS = 2000;") > 0);
check("komunikat jest wysrodkowany na wideo i nie lapie klikniec",
  /\.player-toast\s*\{[^}]*left: 50%; top: 50%[^}]*translate\(-50%, -50%\)[^}]*pointer-events: none/.test(css) &&
  css.indexOf("body.uimode-tv .player-toast {") > 0 &&
  css.indexOf("body.uimode-touch .player-toast {") > 0);
const clearMarkStart = src.indexOf("function clearSeekMark()");
const clearMarkBody = src.slice(clearMarkStart, src.indexOf("\n  }", clearMarkStart));
check("nowy obraz gasi komunikat razem z wpisem o skoku",
  clearMarkStart > 0 && clearMarkBody.indexOf("hidePlayerToast();") > 0);

check("pasek otwarty klawiszem OK jest menu, a nie tylko informacja",
  src.indexOf("osdMenu: false,") > 0 &&
  src.indexOf("function showOsd(options)") > 0 &&
  src.indexOf("state.osdMenu = !!(options && options.menu);") > 0 &&
  src.indexOf("else showOsd({ menu: true });") > 0 &&
  src.indexOf("state.osdMenu = false;\n    clearTimeout(state.osdTimer);") > 0 &&
  src.indexOf("state.osdMenu = false;\n    clearTimeout(overlayTimer);") > 0);
check("fokus na przycisku paska (mysz, dotyk) tez znaczy menu",
  src.indexOf("button.onfocus = function () {\n      state.osdMenu = true;") > 0);
check("▲ ▼ po otwarciu paska wchodza w jego przyciski",
  /if \(!onOsdButton && state\.osdMenu && osdVisible\(\) && \(key === 38 \|\| key === 40\)\) \{[\s\S]{0,120}enterOsdBar\(\);/.test(src) &&
  src.indexOf("function enterOsdBar()") > 0 &&
  src.indexOf("buttons[0].focus();") > 0);
const menuBranch = src.indexOf("if (!onOsdButton && state.osdMenu && osdVisible()");
const zapBranch = src.indexOf("zapChannel(key === 38 ? -1 : 1);");
check("wejscie w menu stoi przed przelaczaniem kanalu",
  menuBranch > 0 && zapBranch > menuBranch);
check("krotkie OK rozstrzygane, gdy pilot wysle ▲ ▼ przed zwolnieniem klawisza",
  src.indexOf("if (!onOsdButton && state.okHoldTimer && (key === 38 || key === 40)) flushOkShort();") > 0 &&
  src.indexOf("function flushOkShort()") > 0 &&
  src.indexOf("state.okFired = true;\n    if (action) action();") > 0);
check("▲ ▼ z paska wychodza z menu na obraz (kanal znowu dziala)",
  src.indexOf("if (key === 38 || key === 40) {\n          if (!focusNearest(key)) leaveOsdBar();\n        } else {\n          focusNearest(key);\n        }") > 0 &&
  src.indexOf("function leaveOsdBar()") > 0);
const focusBlock = src.slice(src.indexOf("function focusNearest(keyCode)"),
  src.indexOf("function searchArrowTarget("));
check("nawigacja mowi, czy fokus sie ruszyl (koniec menu na krawedzi paska)",
  focusBlock.indexOf("if (!candidates.length) return false;") > 0 &&
  focusBlock.indexOf("return true;") > 0 && focusBlock.indexOf("return false;") > 0);
check("Wstecz najpierw zamyka otwarty pasek, a potem wychodzi z kanalu",
  src.indexOf("if (state.osdMenu && osdVisible()) {\n        hideOsd();\n        return true;\n      }") > 0);
check("nakladka nad obrazem (menu opcji) ma swoje strzalki i OK",
  src.indexOf('if ($("contextMenu") || $("exitDialog")) {') > 0 &&
  src.indexOf("if (overlay && overlay.contains(osdFocus) && osdFocus.click) osdFocus.click();") > 0);
check("podpowiedzi pilota i instrukcja opisuja pauze, ▲ ▼ i komunikat",
  src.indexOf("osd_hint_live: \"OK – pasek • pauza – play/pause na pilocie") > 0 &&
  src.indexOf("osd_hint_archive: \"OK – pasek • pauza – play/pause na pilocie") > 0 &&
  src.indexOf("osd_hint_live: \"OK – info bar • pause – play/pause on the remote") > 0 &&
  src.indexOf("osd_hint_archive: \"OK – info bar • pause – play/pause on the remote") > 0 &&
  src.indexOf("widać na środku obrazu") > 0 &&
  src.indexOf("shows in the middle of the picture") > 0 &&
  html.indexOf("Po skoku komunikat („Cofnięto o 10 s”) widać na środku obrazu.") > 0 &&
  html.indexOf("Gdy pasek jest otwarty, ▲ ▼ wchodzą najpierw w jego przyciski") > 0);

/* Podpowiedź na pasku była długa i zawierała znak ⏵‖, którego czcionka dekodera
   (Fire TV, webOS) nie ma — zamiast logo przycisku pauzy zostawał prostokąt
   z krzyżykiem. Podpowiedź mówi więc słowami, a znaki ikon mają tylko przyciski
   (SVG — patrz ICON_PATHS). */
const hintLines = src.split("\n").filter(function (line) {
  return line.indexOf("osd_hint_live:") >= 0 || line.indexOf("osd_hint_archive:") >= 0;
});
check("podpowiedz pilota nie uzywa znakow, ktorych dekodery nie maja (⏵‖)",
  hintLines.length === 4 && hintLines.every(function (line) {
    return line.indexOf("⏵") < 0 && line.indexOf("‖") < 0;
  }), hintLines.join(" | "));
check("podpowiedz na pasku odtwarzacza jest wieksza i z wieksza interlinią",
  /\.osd-hint \{[^}]*font-size: 16px[^}]*line-height: 1\.4/.test(css) &&
  /body\.uimode-tv \.osd-hint \{[^}]*font-size: 19px[^}]*line-height: 1\.45/.test(css),
  css.slice(css.indexOf(".osd-hint {"), css.indexOf("}", css.indexOf(".osd-hint {"))));

/* Zachowanie, nie napisy: uruchamiamy prawdziwą obsługę klawiszy z app.js na
   atrapie ekranu odtwarzacza i patrzymy, co zrobi ▼ po otwarciu paska (OK),
   a co przy pasku pokazanym tylko jako informacja. */
const keyStart = src.indexOf('document.addEventListener("keydown", function (event) {');
const keyEnd = src.indexOf("/* Akcję przypisujemy dopiero na zwolnieniu OK", keyStart);
if (keyStart < 0 || keyEnd <= keyStart) throw new Error("Nie znalazlem obslugi klawiszy w app.js");
/* Wycięty blok kończy się rejestracją listy („});”) — zamykamy ciało funkcji
   i samo wywołanie, żeby całość była poprawnym fragmentem kodu. */
const codeKeys = src.slice(keyStart, keyEnd).replace(/\n\s*\}\);\s*$/, "\n  })");

function fakeClass(hidden) {
  return {
    hidden: !!hidden,
    contains: function (c) { return c === "hidden" ? !!this.hidden : false; },
    add: function (c) { if (c === "hidden") this.hidden = true; },
    remove: function (c) { if (c === "hidden") this.hidden = false; }
  };
}
function fakeEl(hidden) {
  const el = { classList: fakeClass(hidden), clicks: 0 };
  el.contains = function () { return false; };
  el.focus = function () {};
  el.click = function () { el.clicks++; };
  el.getAttribute = function () { return null; };
  return el;
}
function keyHarness(o) {
  o = o || {};
  const calls = { zap: [], focus: [], enter: 0, leave: 0, clicks: 0, shortOk: 0 };
  const player = fakeEl(false);            /* ekran odtwarzacza widoczny */
  const overlay = fakeEl(!o.overlayVisible); /* pasek widoczny albo schowany */
  const ctxMenu = fakeEl(false);            /* menu opcji nad obrazem */
  /* w prawdziwej nakładce fokus siedzi w środku, więc OK trafia w jej przycisk */
  ctxMenu.contains = function () { return true; };
  const active = fakeEl(false);
  if (o.onOsdButton) active.getAttribute = function () { return "play"; };
  active.click = function () { calls.clicks++; };
  let handler = null;
  const sandbox = {
    state: {
      osdMenu: !!o.osdMenu,
      watchChannel: { name: "TVN" },
      mediaKeyAt: 0,
      /* OK wciśnięte i jeszcze nie puszczone (pilot nie doniósł o zwolnieniu) */
      okHoldTimer: o.okPending ? 11 : null
    },
    settings: { dpadSeek: false, osdEnabled: true },
    $: function (id) {
      if (id === "playerScreen") return player;
      if (id === "playerOverlay") return overlay;
      if (id === "contextMenu") return o.contextMenu ? ctxMenu : null;
      if (id === "exitDialog") return null;
      if (id === "guideScreen") return fakeEl(true);
      return fakeEl(true);
    },
    document: {
      activeElement: active,
      addEventListener: function (type, fn) { if (type === "keydown") handler = fn; }
    },
    osdVisible: function () { return !!o.overlayVisible; },
    enterOsdBar: function () { calls.enter++; return true; },
    leaveOsdBar: function () { calls.leave++; },
    /* krótkie OK rozstrzygnięte, zanim pilot zwolnił klawisz: w aplikacji to
       przełącznik paska — otwiera go jako menu, a przy otwartym pasku zamyka
       (wtedy ▼ znowu zmienia kanał). Atrapa robi to samo na swojej nakładce,
       żeby dalsza część obsługi klawisza działała jak w aplikacji. */
    flushOkShort: function () {
      calls.shortOk++;
      if (o.okShortOpensBar === false) return;   /* pasek wyłączony w ustawieniach */
      const open = !!o.overlayVisible;
      o.overlayVisible = !open;
      sandbox.state.osdMenu = !open;
    },
    zapChannel: function (direction) { calls.zap.push(direction); },
    focusNearest: function (key) { calls.focus.push(key); return o.focusMoves !== false; },
    scheduleOsdHide: function () {},
    seekKeyDirection: function () { return 0; },
    mediaKeyAction: function () { return ""; },
    t: function (k) { return k; }
  };
  run(codeKeys, sandbox);
  return {
    calls: calls,
    press: function (key) {
      if (handler) handler({ keyCode: key, repeat: false, preventDefault: function () {} });
    }
  };
}

let kh = keyHarness({ osdMenu: true, overlayVisible: true });
kh.press(40);
check("uruchomione: ▼ po otwarciu paska wchodzi w przyciski, a nie zmienia kanalu",
  kh.calls.enter === 1 && kh.calls.zap.length === 0,
  JSON.stringify(kh.calls));

kh = keyHarness({ osdMenu: true, overlayVisible: true });
kh.press(38);
check("uruchomione: ▲ przy otwartym pasku tez wchodzi w przyciski",
  kh.calls.enter === 1 && kh.calls.zap.length === 0, JSON.stringify(kh.calls));

kh = keyHarness({ osdMenu: false, overlayVisible: true });
kh.press(40);
kh.press(40);
check("uruchomione: pasek-informacja zostawia ▼ przy kanalach (dwa razy = dwa kanaly)",
  kh.calls.zap.length === 2 && kh.calls.zap[0] === 1 && kh.calls.zap[1] === 1 && kh.calls.enter === 0,
  JSON.stringify(kh.calls));

kh = keyHarness({});
kh.press(38);
check("uruchomione: bez paska ▲ zmienia kanal w gore",
  kh.calls.zap.length === 1 && kh.calls.zap[0] === -1 && kh.calls.enter === 0, JSON.stringify(kh.calls));

/* OK i szybkie ▼: pilot wysyła strzałkę, zanim dotrze zwolnienie klawisza —
   pasek ma się wtedy otworzyć, a ▼ wejść w jego przyciski, a nie zmienić
   kanału (właśnie to „OK, ▼” po naciśnięciu środkowego przycisku). */
kh = keyHarness({ osdMenu: false, overlayVisible: false, okPending: true, okShortOpensBar: true });
kh.press(40);
check("uruchomione: ▼ w trakcie trzymania OK otwiera pasek, a nie zmienia kanalu",
  kh.calls.shortOk === 1 && kh.calls.enter === 1 && kh.calls.zap.length === 0,
  JSON.stringify(kh.calls));

kh = keyHarness({ osdMenu: false, overlayVisible: false, okPending: true, okShortOpensBar: true });
kh.press(38);
check("uruchomione: ▲ w trakcie trzymania OK tak samo wchodzi w pasek",
  kh.calls.shortOk === 1 && kh.calls.enter === 1 && kh.calls.zap.length === 0,
  JSON.stringify(kh.calls));

kh = keyHarness({ osdMenu: false, overlayVisible: false, okPending: true, okShortOpensBar: false });
kh.press(40);
check("uruchomione: gdy pasek sie nie otworzy, ▼ dalej przełącza kanał (CH+ bez zmian)",
  kh.calls.shortOk === 1 && kh.calls.zap.length === 1 && kh.calls.enter === 0,
  JSON.stringify(kh.calls));

kh = keyHarness({ osdMenu: true, overlayVisible: true, okPending: true });
kh.press(40);
check("uruchomione: OK przy otwartym pasku zamyka go, wiec ▼ znowu zmienia kanal",
  kh.calls.shortOk === 1 && kh.calls.zap.length === 1 && kh.calls.enter === 0,
  JSON.stringify(kh.calls));

kh = keyHarness({ osdMenu: true, overlayVisible: true, onOsdButton: true });
kh.press(39);
check("uruchomione: ◀ ▶ na przycisku paska chodza po pasku (bez zmiany kanalu)",
  kh.calls.focus.length === 1 && kh.calls.zap.length === 0 && kh.calls.leave === 0,
  JSON.stringify(kh.calls));

kh = keyHarness({ osdMenu: true, overlayVisible: true, onOsdButton: true, focusMoves: false });
kh.press(38);
check("uruchomione: ▲ z paska bez pozycji wyzej wychodzi z menu na obraz",
  kh.calls.leave === 1 && kh.calls.zap.length === 0 && kh.calls.enter === 0,
  JSON.stringify(kh.calls));

kh = keyHarness({ osdMenu: true, overlayVisible: true, contextMenu: true });
kh.press(38);
check("uruchomione: w menu opcji nad obrazem ▲ nie zmienia kanalu",
  kh.calls.zap.length === 0 && kh.calls.enter === 0 && kh.calls.focus.length === 1,
  JSON.stringify(kh.calls));

kh = keyHarness({ osdMenu: true, overlayVisible: true, contextMenu: true });
kh.press(13);
check("uruchomione: OK w menu opcji nad obrazem wybiera podswietlona pozycje",
  kh.calls.clicks === 1 && kh.calls.enter === 0, JSON.stringify(kh.calls));

/* --- 24. zegar w rogu obrazu ------------------------------------------------ 
   Nowe ustawienie „Zegar w rogu obrazu”: pokazuje HH:MM w lewym górnym rogu,
   ale wyłącznie podczas oglądania programu. Sprawdzamy jedno i drugie — że
   przełącznik oraz sam zegar są w aplikacji, i że naprawdę pokazuje właściwą
   godzinę (wyciągamy funkcje z app.js i uruchamiamy je na atrapie ekranu). */
check("ustawienia maja przelacznik zegara w rogu",
  html.indexOf('id="clockEnabled"') > 0 &&
  html.indexOf('data-i18n="clock_enabled"') > 0 &&
  src.indexOf("clockEnabled: false,") > 0 &&
  src.indexOf('$("clockEnabled").onchange = function () {') > 0 &&
  src.indexOf("settings.clockEnabled = $(\"clockEnabled\").checked;") > 0 &&
  src.indexOf('$("clockEnabled").checked = settings.clockEnabled === true;') > 0);
check("zegar jest elementem ekranu odtwarzacza, nie listy kanalow",
  html.indexOf('id="cornerClock" class="corner-clock hidden"') > 0 &&
  src.indexOf("function syncCornerClock()") > 0);
check("zegar rusza i gasnie razem ze zmiana ekranu",
  src.indexOf("/* zegar w rogu obrazu ma sens tylko na widocznym ekranie odtwarzacza */\n    syncCornerClock();") > 0);
check("zegar siedzi w lewym gornym rogu i nie lapie klikniec",
  /\.corner-clock\s*\{[^}]*left: 34px; top: 26px[^}]*pointer-events: none/.test(css) &&
  css.indexOf("body.uimode-tv .corner-clock {") > 0 &&
  css.indexOf("body.uimode-touch .corner-clock {") > 0);
check("zegar wraca do wlasciwej godziny po powrocie do aplikacji",
  src.indexOf("document.addEventListener(\"visibilitychange\", function () {") > 0 &&
  src.indexOf("if (!document.hidden) syncCornerClock();") > 0);

const clockStart = src.indexOf("var clockTimer = null;");
const clockEnd = src.indexOf("function atLiveEdge()");
if (clockStart < 0 || clockEnd <= clockStart) throw new Error("Nie znalazlem zegara w rogu w app.js");
const codeClock = src.slice(clockStart, clockEnd);
if (codeClock.indexOf("function syncCornerClock") < 0 || codeClock.indexOf("function cornerClockText") < 0) {
  throw new Error("Wyciety blok nie ma zegara w rogu");
}

function clockHarness(o) {
  o = o || {};
  const calls = { shown: 0, hidden: 0, timers: [] };
  const clock = {
    textContent: "",
    classList: {
      add: function (c) { if (c === "hidden") calls.hidden++; },
      remove: function (c) { if (c === "hidden") calls.shown++; }
    }
  };
  const screen = {
    classList: { contains: function (c) { return c === "hidden" ? !!o.screenHidden : false; } }
  };
  /* Czas zamrozony: `new Date()` w app.js musi zwracac stala godzine, wiec
     podstawiamy wlasna klase, a odczyty godzin delegujemy do prawdziwego Date. */
  const RealDate = Date;
  const FIXED = typeof o.nowMs === "number" ? o.nowMs : 0;
  function FakeDate(ts) {
    this.real = new RealDate(ts === undefined ? FIXED : ts);
  }
  FakeDate.now = function () { return FIXED; };
  ["getHours", "getMinutes", "getSeconds", "getMilliseconds", "getTime"].forEach(function (method) {
    FakeDate.prototype[method] = function () { return this.real[method](); };
  });

  const sandbox = {
    settings: { clockEnabled: o.enabled === true },
    state: { watchChannel: o.watching === false ? null : { name: "TVN" } },
    $: function (id) {
      if (id === "cornerClock") return clock;
      if (id === "playerScreen") return screen;
      return null;
    },
    pad2: function (n) { return n < 10 ? "0" + n : String(n); },
    Date: FakeDate,
    setTimeout: function (fn, ms) { calls.timers.push(ms); return calls.timers.length; },
    clearTimeout: function () {}
  };
  run(codeClock, sandbox);
  return { api: sandbox, calls: calls, clock: clock };
}

/* 21:07:20 — do pelnej minuty zostaje 39,88 s plus zapas 120 ms */
const CLOCK_NOW = new Date(2026, 9, 3, 21, 7, 20).getTime();
let ck = clockHarness({ enabled: true, nowMs: CLOCK_NOW });
ck.api.syncCornerClock();
check("uruchomione: zegar pokazuje godzine HH:MM podczas ogladania",
  ck.clock.textContent === "21:07" && ck.calls.shown === 1 && ck.calls.hidden === 0,
  ck.clock.textContent + " " + JSON.stringify(ck.calls));
check("uruchomione: tykniecie wypada rowno z pelna minuta",
  ck.calls.timers.length === 1 && ck.calls.timers[0] === 40120,
  JSON.stringify(ck.calls.timers));

ck = clockHarness({ enabled: true });
check("godzina jest zawsze dwucyfrowa (09:05, nie 9:5)",
  ck.api.cornerClockText(new Date(2026, 9, 3, 9, 5).getTime()) === "09:05" &&
  ck.api.cornerClockText(new Date(2026, 9, 3, 0, 0).getTime()) === "00:00",
  ck.api.cornerClockText(new Date(2026, 9, 3, 9, 5).getTime()));

ck = clockHarness({ enabled: false, nowMs: CLOCK_NOW });
ck.api.syncCornerClock();
check("wylaczony w ustawieniach: zegar sie nie pokazuje i nic nie chodzi",
  ck.clock.textContent === "" && ck.calls.shown === 0 && ck.calls.hidden === 1 && ck.calls.timers.length === 0,
  JSON.stringify(ck.calls));

ck = clockHarness({ enabled: true, watching: false, nowMs: CLOCK_NOW });
ck.api.syncCornerClock();
check("bez ogladania kanalu zegar zostaje schowany (lista, EPG, ustawienia)",
  ck.calls.shown === 0 && ck.calls.hidden === 1 && ck.calls.timers.length === 0,
  JSON.stringify(ck.calls));

ck = clockHarness({ enabled: true, screenHidden: true, nowMs: CLOCK_NOW });
ck.api.syncCornerClock();
check("po wyjsciu z odtwarzacza zegar gasnie",
  ck.calls.shown === 0 && ck.calls.hidden === 1 && ck.calls.timers.length === 0,
  JSON.stringify(ck.calls));

ck = clockHarness({ enabled: true, nowMs: CLOCK_NOW });
ck.api.syncCornerClock();
ck.api.syncCornerClock();
check("kolejne ustawienie budzika nie mnozy zegarow (jeden na raz)",
  ck.calls.timers.length === 2 && ck.calls.shown === 2, JSON.stringify(ck.calls));


/* --- 25. brak obrazu: dzwiek gra, ekran czarny ------------------------------
   Na czesci dekoderow Android/Fire TV <video> odtwarza sam dzwiek — stan
   odtwarzania jest poprawny, wiec zwykly budzik uznawal kanal za uruchomiony
   i czarny ekran zostawal na zawsze. Sprawdzamy, ze aplikacja: (1) wykrywa brak
   obrazu po wymiarach klatki, (2) probuje naprawic warstwe obrazu i powtarza ten
   sam strumien, (3) dopiero potem zmienia sposob odtwarzania, (4) pamieta ten,
   ktory naprawde dal obraz. */
check("brak obrazu wykrywany po wymiarach klatki, nie po stanie odtwarzania",
  src.indexOf("function videoHasPicture(video)") > 0 &&
  src.indexOf("return !!video && (video.videoWidth | 0) > 0 && (video.videoHeight | 0) > 0;") > 0 &&
  src.indexOf("var PICTURE_TIMEOUT = 6000;") > 0);
check("budziki obrazu uzbrajane PO starcie silnika (token MSE/HLS inaczej je uniewaznial)",
  src.indexOf("if (entry.engine !== \"exo\" && entry.engine !== \"vlc\") {\n      armStartWatchdog(token);\n      armPictureWatchdog(token);\n    }") > 0 &&
  src.indexOf("if (typeof token !== \"number\") token = state.engineToken;") > 0);
check("pierwsza klatka zdejmuje budzik i zapamietuje sposob odtwarzania",
  src.indexOf("function notePicture()") > 0 &&
  src.indexOf("clearPictureWatchdog();\n    rememberEngine(state.engine);") > 0 &&
  src.indexOf("notePicture();\n      updateOsdProgress();") > 0 &&
  src.indexOf("video.addEventListener(\"canplay\", function () {") > 0);
check("naprawa warstwy obrazu jest w CSS i tylko na zadanie aplikacji",
  css.indexOf("body.video-layer-fix .player-screen video") > 0 &&
  css.indexOf("transform: translateZ(0);") > 0 &&
  src.indexOf("document.body.classList.toggle(\"video-layer-fix\", want)") > 0 &&
  src.indexOf("if (document.body) document.body.classList.toggle(\"video-layer-fix\", want);") > 0);
check("brak obrazu: jedna runda po sposobach odtwarzania i komunikat, co sie stalo",
  src.indexOf("nextSourceEntry(t(\"err_no_picture\"), 0, false, 0, t(\"err_no_picture_hint\"));") > 0 &&
  src.indexOf("err_no_picture_hint:") > 0 &&
  src.indexOf("if (!custom || limit > 0) {") > 0);
check("kanal 4K nie jest restartowany w polowie wczytywania (budziki patrza na ruch strumienia)",
  src.indexOf("var CONNECT_WAIT = 45000;") > 0 &&
  src.indexOf("var UHD_WAIT = 30000;") > 0 &&
  src.indexOf("var STREAM_STALL = 6000;") > 0 &&
  src.indexOf("function streamStillComing()") > 0 &&
  src.indexOf("if (!state.entryWaitStart) return false;") > 0 &&
  src.indexOf("var stall = state.engineFeeder ? FEEDER_STREAM_STALL : STREAM_STALL;") > 0 &&
  src.indexOf("if (Date.now() - state.lastActivityAt >= stall) return false;") > 0 &&
  src.indexOf("video.addEventListener(\"progress\", noteStreamActivity);") > 0 &&
  src.indexOf("if (streamStillComing()) { armStartWatchdog(token); return; }") > 0 &&
  src.indexOf("if (streamStillComing()) { armPictureWatchdogIn(token, pictureTimeout()); return; }") > 0 &&
  src.indexOf("if (!state.pictureRetried && !videoIsUhd() && !state.uhdSeen && applyVideoLayerFix(true)) {") > 0 &&
  src.indexOf("state.entryWaitStart = Date.now();\n    state.lastActivityAt = Date.now();") > 0);

const picStart = src.indexOf("var PICTURE_TIMEOUT = 6000;");
const picEnd = src.indexOf("function nextSourceEntry(");
if (picStart < 0 || picEnd <= picStart) throw new Error("Nie znalazlem budzika obrazu w app.js");
const codePicture = src.slice(picStart, src.lastIndexOf("\n\n", picEnd) + 2);
["videoHasPicture", "armPictureWatchdog", "retryCurrentEntry", "clearPictureWatchdog",
  "notePicture", "applyVideoLayerFix", "rememberEngine", "noteUhd", "manifestIsUhd",
  "pictureTimeout", "audioOnlyTimeout",
  "channelNameIsUhd", "markUhdChannel"].forEach(function (fn) {
  if (codePicture.indexOf("function " + fn) < 0) throw new Error("Wyciety blok nie ma " + fn);
});

/* atrapa odtwarzacza: jedno <video> (z obrazem albo bez), licznik zapisow
   ustawien, kolejka budzikow wywolywana recznie (tak jakby plynal czas) */
function pictureHarness(o) {
  o = o || {};
  const calls = { errors: [], started: [], next: [], saves: 0, pending: [], destroyed: 0, notes: [] };
  /* obraz: 720p (jest / nie ma), 4K, albo kanał bez metadanych (dopiero się łączy) */
  const video = {
    videoWidth: o.uhd ? 3840 : (o.picture ? 1280 : 0),
    videoHeight: o.uhd ? 2160 : (o.picture ? 720 : 0),
    readyState: o.readyState === undefined ? 2 : o.readyState,
    /* .m3u8 gra sprzętowo tylko tam, gdzie odbiornik ma własny HLS (webOS, Safari) */
    canPlayType: function () { return o.canPlayType || ""; }
  };
  const classes = [];
  let timerId = 0;
  /* Zegar atrapy: budziki patrzą na to, czy strumień coś dociąga, więc czas
     musi być w rękach testu (patrz streamStillComing w app.js). */
  let clock = typeof o.nowMs === "number" ? o.nowMs : Date.now();
  const sandbox = {
    settings: { videoLayerFix: o.layerFix === true, engineHint: "" },
    state: {
      watchChannel: { name: "TVN" },
      engineToken: 7,
      engine: o.engine || "native",
      /* czy tę próbę prowadzi własny czytnik playlisty (patrz createHlsTsLoader) —
         jego budżety są dłuższe, bo odcinki dopiero się pobierają */
      engineFeeder: o.engineFeeder === true,
      pictureTimer: null,
      pictureRetried: false,
      /* rozpoznanie 4K przy kanale (metadane klatki albo manifest HLS) */
      uhdSeen: o.uhdSeen === true,
      retryTimer: null,
      /* jedna próba: od kiedy trwa i kiedy strumień ostatnio naprawdę coś dociągnął */
      entryWaitStart: o.waitStart === undefined ? 0 : o.waitStart,
      lastActivityAt: o.activity === undefined ? 0 : o.activity,
      /* od kiedy gra sam dźwięk w tej próbie (zdarzenie „playing”) — od tego
         liczy się twardy budżet „dźwięk bez obrazu” (AUDIO_ONLY_TIMEOUT) */
      audioStartedAt: o.audioStartedAt === undefined ? 0 : o.audioStartedAt,
      sources: o.sources || [{ engine: "native", url: "http://s/x.ts" }, { engine: "mse", url: "http://s/x.ts" }],
      sourceIndex: o.sourceIndex === undefined ? 0 : o.sourceIndex
    },
    t: function (key) { return "<" + key + ">"; },
    $: function (id) { return id === "video" ? video : null; },
    Date: { now: function () { return clock; } },
    document: {
      body: {
        classList: {
          toggle: function (name, on) {
            const i = classes.indexOf(name);
            if (on && i < 0) classes.push(name);
            if (!on && i >= 0) classes.splice(i, 1);
          }
        }
      }
    },
    saveSettings: function () { calls.saves++; },
    showPlayerError: function (message) { calls.errors.push(message); },
    diagNote: function (note) { calls.notes.push(note); },
    startSourceEntry: function (entry) { calls.started.push(entry); },
    nextSourceEntry: function (message, delay, silent, maxCycles, finalHint) {
      calls.next.push({ message: message, maxCycles: maxCycles, finalHint: finalHint });
    },
    destroyEngine: function () { calls.destroyed++; },
    setTimeout: function (fn) { timerId++; calls.pending.push(fn); return timerId; },
    clearTimeout: function () {}
  };
  run(codePicture, sandbox);
  return {
    api: sandbox,
    calls: calls,
    video: video,
    classes: classes,
    /* przesuwa zegar atrapy (czas plynie tylko wtedy, gdy test tak powie) */
    setNow: function (value) { clock = value; return clock; },
    /* wywoluje budziki czekajace w kolejce */
    fire: function () {
      const queue = calls.pending.splice(0);
      queue.forEach(function (fn) { fn(); });
      return queue.length;
    }
  };
}
/* dzwiek bez obrazu: budzik obrazu najpierw naprawia warstwe, potem powtarza wpis */
let ph = pictureHarness({});
ph.api.armPictureWatchdog(7);
ph.fire();
check("uruchomione: czarny obraz uruchamia naprawe warstwy obrazu",
  ph.classes.indexOf("video-layer-fix") >= 0 && ph.api.settings.videoLayerFix === true &&
  ph.calls.saves === 1 && ph.calls.next.length === 0 && ph.calls.started.length === 0,
  JSON.stringify({ classes: ph.classes, next: ph.calls.next, started: ph.calls.started }));
check("uruchomione: komunikat mowi, ze to dzwiek bez obrazu",
  ph.calls.errors.length === 1 && ph.calls.errors[0] === "<err_no_picture>",
  JSON.stringify(ph.calls.errors));
check("uruchomione: powtorka startuje chwile pozniej, a nie od razu",
  ph.calls.pending.length === 1 && ph.calls.started.length === 0,
  "budzikow w kolejce: " + ph.calls.pending.length);
ph.fire();
check("uruchomione: ten sam strumien jest probowany jeszcze raz (bez zmiany sposobu)",
  ph.calls.started.length === 1 && ph.calls.started[0].engine === "native" &&
  ph.calls.started[0].url === "http://s/x.ts" && ph.api.state.pictureRetried === true &&
  ph.calls.next.length === 0,
  JSON.stringify(ph.calls.started));
ph.api.armPictureWatchdog(7);
ph.fire();
check("uruchomione: gdy naprawa nie pomogla, kolejka idzie dalej i konczy po jednej rundzie",
  ph.calls.next.length === 1 && ph.calls.next[0].maxCycles === 0 &&
  ph.calls.next[0].finalHint === "<err_no_picture_hint>" &&
  ph.calls.next[0].message === "<err_no_picture>",
  JSON.stringify(ph.calls.next));

/* zmiana kanalu w miedzyczasie: stary budzik obrazu nie moze nic zrobic */
ph = pictureHarness({});
ph.api.armPictureWatchdog(7);
ph.api.state.engineToken = 8;
ph.fire();
check("uruchomione: budzik obrazu z porzuconej proby nic nie zmienia",
  ph.classes.length === 0 && ph.calls.errors.length === 0 && ph.calls.next.length === 0 &&
  ph.calls.started.length === 0,
  JSON.stringify({ classes: ph.classes, next: ph.calls.next }));
/* obraz jest: budzik obrazu nic nie zmienia, a tryb pracy idzie do pamieci */
ph = pictureHarness({ picture: true, engine: "mse" });
ph.api.armPictureWatchdog(7);
ph.fire();
check("uruchomione: obraz jest, wiec budzik obrazu nic nie zmienia",
  ph.classes.length === 0 && ph.calls.errors.length === 0 && ph.calls.next.length === 0 &&
  ph.calls.started.length === 0,
  JSON.stringify({ classes: ph.classes, next: ph.calls.next }));
ph.api.notePicture();
check("uruchomione: udany sposob odtwarzania jest zapamietany (MSE dal obraz)",
  ph.api.settings.engineHint === "mse" && ph.calls.saves === 1 &&
  ph.api.state.pictureTimer === null,
  JSON.stringify({ hint: ph.api.settings.engineHint, saves: ph.calls.saves }));

ph = pictureHarness({ engine: "mse" });
check("uruchomione: bez obrazu tryb nie trafia do pamieci (MSE sam nie dostaje pochwaly)",
  ph.api.notePicture() === false && ph.api.settings.engineHint === "" && ph.calls.saves === 0,
  JSON.stringify({ hint: ph.api.settings.engineHint, saves: ph.calls.saves }));

/* 4K: pierwsze klatki potrzebuja wiecej czasu, wiec dopoki strumien naprawde
   cos dociaga, proba jest przedluzana — restart co 6 s nie dawal obrazu nigdy */
const NOW4K = 900000000;
ph = pictureHarness({ uhd: true, nowMs: NOW4K });
check("uruchomione: 4K (metadane juz sa) dostaje na probe 30 s zamiast 6",
  ph.api.videoIsUhd() === true && ph.api.waitBudget() === 30000, String(ph.api.waitBudget()));
ph = pictureHarness({ nowMs: NOW4K, readyState: 0 });
check("uruchomione: kanal, ktory dopiero sie laczy, dostaje na probe 45 s",
  ph.api.videoIsUhd() === false && ph.api.waitBudget() === 45000, String(ph.api.waitBudget()));
ph = pictureHarness({ nowMs: NOW4K, readyState: 2 });
check("uruchomione: SD/HD dostaje jak dotad 6 s (naprawa warstwy bez zwloki)",
  ph.api.waitBudget() === 6000, String(ph.api.waitBudget()));

/* ruch w strumieniu przedluza probe, cisza konczy ja od razu */
ph = pictureHarness({ uhd: true, nowMs: NOW4K, waitStart: NOW4K - 20000, activity: NOW4K - 500 });
check("uruchomione: 4K dostaje wiecej czasu, dopoki strumien cos dociaga",
  ph.api.streamStillComing() === true, String(ph.api.streamStillComing()));
ph = pictureHarness({ uhd: true, nowMs: NOW4K, waitStart: NOW4K - 31000, activity: NOW4K - 500 });
check("uruchomione: po swoim czasie 4K nie jest juz przedluzany",
  ph.api.streamStillComing() === false, String(ph.api.streamStillComing()));
ph = pictureHarness({ uhd: true, nowMs: NOW4K, waitStart: NOW4K - 5000, activity: NOW4K - 10000 });
check("uruchomione: cisza w strumieniu konczy probe, nawet gdy czasu zostalo duzo",
  ph.api.streamStillComing() === false, String(ph.api.streamStillComing()));

/* kanal, ktory dopiero sie laczy (brak metadanych), nie jest ucinany po 6 s */
ph = pictureHarness({ nowMs: NOW4K, waitStart: NOW4K - 20000, activity: NOW4K - 500, readyState: 0 });
ph.api.armPictureWatchdog(7);
ph.fire();
check("uruchomione: kanal, ktory dopiero sie laczy, nie jest przerywany po 6 s",
  ph.classes.length === 0 && ph.calls.next.length === 0 && ph.api.state.pictureTimer !== null,
  JSON.stringify({ classes: ph.classes, next: ph.calls.next }));

/* ale gdy czas proby sie skonczyl, budzik przestaje czekac (idzie do naprawy,
   a potem do kolejnego sposobu) — zamiast przedluzac probe w nieskonczonosc */
ph = pictureHarness({ nowMs: NOW4K, waitStart: NOW4K - 50000, activity: NOW4K - 500, readyState: 0 });
ph.api.armPictureWatchdog(7);
ph.fire();
check("uruchomione: po wykorzystanym czasie proby budzik nie czeka juz dalej",
  ph.api.state.pictureTimer === null && ph.calls.pending.length === 1 &&
  ph.calls.started.length === 0,
  JSON.stringify({ timer: ph.api.state.pictureTimer, pending: ph.calls.pending.length }));

/* martwy kanal nie zajmuje kolejki: cisza w strumieniu konczy sprawe od razu,
   choc czasu proby zostalo jeszcze duzo */
ph = pictureHarness({ nowMs: NOW4K, waitStart: NOW4K - 20000, activity: NOW4K - 10000, readyState: 0 });
ph.api.armPictureWatchdog(7);
ph.fire();
check("uruchomione: cisza w strumieniu konczy probe od razu (bez czekania do konca czasu)",
  ph.api.state.pictureTimer === null && ph.calls.pending.length === 1 &&
  ph.calls.started.length === 0 && ph.classes.length <= 1,
  JSON.stringify({ timer: ph.api.state.pictureTimer, pending: ph.calls.pending.length }));

/* SD/HD bez obrazu: naprawa warstwy obrazu dziala jak dotad, bez zwloki */
ph = pictureHarness({ nowMs: NOW4K, waitStart: NOW4K - 7000, activity: NOW4K - 500, readyState: 2 });
ph.api.armPictureWatchdog(7);
ph.fire();
check("uruchomione: SD/HD bez obrazu idzie do naprawy warstwy bez zwloki (jak w 2.0.2)",
  ph.classes.indexOf("video-layer-fix") >= 0 && ph.calls.started.length === 0 &&
  ph.calls.next.length === 0,
  JSON.stringify({ classes: ph.classes, next: ph.calls.next }));

/* 4K z wymiarami klatki to dla budzika obraz (nic nie zmienia), a każde 4K —
   rozpoznane także bez wymiarów (manifest HLS, patrz noteUhd) — nie dostaje
   wymuszonej warstwy obrazu: to ona potrafiła zostawić czarny ekran, a przy 4K
   obraz rozbiera praktycznie tylko dekoder sprzętowy. */
ph = pictureHarness({ uhd: true, nowMs: NOW4K, waitStart: NOW4K - 40000, activity: NOW4K - 500 });
ph.api.armPictureWatchdog(7);
ph.fire();
check("uruchomione: 4K z wymiarami klatki jest dla budzika obrazem (nic nie zmienia)",
  ph.classes.length === 0 && ph.calls.next.length === 0 && ph.calls.started.length === 0,
  JSON.stringify({ classes: ph.classes, next: ph.calls.next }));

/* Dźwięk bez ANI JEDNEJ klatki ma twardy budżet (AUDIO_ONLY_TIMEOUT), liczony od
   zdarzenia „playing”. Kanał 4K HEVC grał tak bez końca (80 s nic nie zmieniło),
   a dociąganie danych przy czarnym ekranie nic tu nie naprawi — dlatego ruch
   w strumieniu tego czasu NIE przedłuża. */
check("dzwiek bez obrazu: budzet liczy sie od zdarzenia „playing”, a ruch w strumieniu go nie przedluza",
  src.indexOf("var AUDIO_ONLY_TIMEOUT = 8000;") > 0 &&
  src.indexOf("state.audioStartedAt = state.audioStartedAt || Date.now();") > 0 &&
  src.indexOf("if (!notePicture()) armPictureWatchdog();") > 0 &&
  src.indexOf("var audioSince = state.audioStartedAt || state.entryWaitStart || 0;") > 0 &&
  src.indexOf("if (audioPlaying && audioFor >= audioOnlyTimeout()) {") > 0 &&
  src.indexOf("armPictureWatchdogIn(token, audioOnlyTimeout() - audioFor);") > 0 &&
  src.indexOf("state.audioStartedAt = 0;") > 0);

const AUDIO_ONLY_MS = 8000;
ph = pictureHarness({ nowMs: NOW4K, waitStart: NOW4K - 2000, activity: NOW4K - 500,
  readyState: 2, audioStartedAt: NOW4K - 8100 });
check("uruchomione: twardy budzet dzwieku bez obrazu to 8 s",
  ph.api.AUDIO_ONLY_TIMEOUT === AUDIO_ONLY_MS, String(ph.api.AUDIO_ONLY_TIMEOUT));
ph.api.armPictureWatchdog(7);
ph.fire();
check("uruchomione: dzwiek bez obrazu po 8 s oddaje kanal nastepnemu sposobowi odtwarzania",
  ph.calls.next.length === 1 && ph.calls.next[0].maxCycles === 0 &&
  ph.calls.next[0].finalHint === "<err_no_picture_hint>" &&
  ph.calls.next[0].message === "<err_no_picture>" &&
  ph.classes.length === 0,
  JSON.stringify({ next: ph.calls.next, classes: ph.classes }));
check("uruchomione: dziennik panelu notuje, przez ile sekund gral sam dzwiek",
  ph.calls.notes.length === 1 && ph.calls.notes[0] === "<diag_no_picture_advance>",
  JSON.stringify(ph.calls.notes));

/* przed upływem budżetu próba jest nadal pilnowana (i przedłużana, dopóki coś
   przychodzi) — twardy budżet nie może ucinać kanału, który dopiero ruszył */
ph = pictureHarness({ nowMs: NOW4K, waitStart: NOW4K - 2000, activity: NOW4K - 500,
  readyState: 2, audioStartedAt: NOW4K - 7900, layerFix: true });
ph.api.armPictureWatchdog(7);
ph.fire();
check("uruchomione: przed uplywem 8 s sam dzwiek jest jeszcze pilnowany",
  ph.calls.next.length === 0 && ph.calls.started.length === 0 &&
  ph.calls.errors.length === 0 && ph.api.state.pictureTimer !== null,
  JSON.stringify({ next: ph.calls.next, timer: ph.api.state.pictureTimer }));

/* dźwięk, który ruszył dawno temu, ale próba dopiero się wczytuje: liczy się czas
   dźwięku, nie wiek próby — inaczej kanał byłby ucinany w połowie wczytywania */
ph = pictureHarness({ nowMs: NOW4K, waitStart: NOW4K - 500, activity: NOW4K - 100,
  readyState: 2, audioStartedAt: NOW4K - 8100 });
ph.api.armPictureWatchdog(7);
ph.fire();
check("uruchomione: liczy sie czas dzwieku, a nie wiek proby (8 s dzwieku konczy probe)",
  ph.calls.next.length === 1 && ph.calls.started.length === 0,
  JSON.stringify(ph.calls.next));

/* Kanał z playlisty (4K HEVC) ma dłuższe budżety: jego obraz dopiero się pobiera
   (czytnik skleja odcinki w jeden strumień TS), a to ostatnia droga do obrazu —
   ucięta jak zwykłe HD, kończyła kanał komunikatem, że nie da się go odtworzyć. */
check("kanal z playlisty: budzety obrazu sa dluzsze (obraz sie jeszcze pobiera)",
  src.indexOf("var FEEDER_PICTURE_TIMEOUT = 20000;") > 0 &&
  src.indexOf("var FEEDER_AUDIO_ONLY_TIMEOUT = 20000;") > 0 &&
  src.indexOf("var FEEDER_STREAM_STALL = 15000;") > 0 &&
  src.indexOf("function pictureTimeout() {") > 0 &&
  src.indexOf("return state.engineFeeder ? FEEDER_PICTURE_TIMEOUT : PICTURE_TIMEOUT;") > 0 &&
  src.indexOf("function audioOnlyTimeout() {") > 0 &&
  src.indexOf("return state.engineFeeder ? FEEDER_AUDIO_ONLY_TIMEOUT : AUDIO_ONLY_TIMEOUT;") > 0 &&
  src.indexOf("armPictureWatchdogIn(token, pictureTimeout());") > 0);
ph = pictureHarness({ engineFeeder: true, nowMs: NOW4K, waitStart: NOW4K - 2000,
  activity: NOW4K - 500, readyState: 2, audioStartedAt: NOW4K - 9000 });
check("uruchomione: czytnik playlisty ma 20 s na pierwsze klatki (HD jak dotad 6 s)",
  ph.api.pictureTimeout() === 20000 && ph.api.audioOnlyTimeout() === 20000 &&
  pictureHarness({ nowMs: NOW4K }).api.pictureTimeout() === 6000 &&
  pictureHarness({ nowMs: NOW4K }).api.audioOnlyTimeout() === 8000,
  ph.api.pictureTimeout() + "/" + ph.api.audioOnlyTimeout());
ph.api.armPictureWatchdog(7);
ph.fire();
check("uruchomione: 9 s samego dzwieku na czytniku playlisty nie ucina jeszcze proby",
  ph.calls.next.length === 0 && ph.calls.started.length === 0 &&
  ph.api.state.pictureTimer !== null, JSON.stringify(ph.calls.next));
ph = pictureHarness({ nowMs: NOW4K, waitStart: NOW4K - 2000, activity: NOW4K - 500,
  readyState: 2, audioStartedAt: NOW4K - 9000 });
ph.api.armPictureWatchdog(7);
ph.fire();
check("uruchomione: poza czytnikiem playlisty 9 s samego dzwieku konczy probe (8 s jak dotad)",
  ph.calls.next.length === 1, JSON.stringify(ph.calls.next));

/* Cisza w <video> nie ucina próby czytnika: o odcinkach mówi sam czytnik
   (patrz noteStreamActivity), więc liczy się jego własny, dłuższy czas ciszy. */
ph = pictureHarness({ engineFeeder: true, nowMs: NOW4K, waitStart: NOW4K - 12000,
  activity: NOW4K - 10000, readyState: 0 });
check("uruchomione: 10 s ciszy nie ucina proby czytnika playlisty",
  ph.api.streamStillComing() === true, String(ph.api.streamStillComing()));
ph = pictureHarness({ engineFeeder: true, nowMs: NOW4K, waitStart: NOW4K - 20000,
  activity: NOW4K - 16000, readyState: 0 });
check("uruchomione: cisza dluzsza niz czas czytnika konczy probe",
  ph.api.streamStillComing() === false, String(ph.api.streamStillComing()));
ph = pictureHarness({ nowMs: NOW4K, waitStart: NOW4K - 31000, activity: NOW4K - 500,
  readyState: 0, uhdSeen: true });
check("uruchomione: 4K rozpoznane z nazwy kanalu ma budzet 4K, nawet bez metadanych klatki",
  ph.api.waitBudget() === 30000 && ph.api.streamStillComing() === false,
  String(ph.api.waitBudget()));

/* Wyczerpanie kolejki prob: dzwiek nie moze grac dalej pod komunikatem „kanal nie
   dziala”. Sprawdzamy ostatni krok kolejki na wycietej funkcji nextSourceEntry. */
const nextStart = src.indexOf("function nextSourceEntry(message, delay, silent, maxCycles, finalHint) {");
const nextMarker = src.indexOf("/* ================  „OSTATNIO OGLĄDANE”");
if (nextStart < 0 || nextMarker <= nextStart) throw new Error("Nie znalazlem nextSourceEntry w app.js");
const codeNext = src.slice(nextStart, src.lastIndexOf("\n\n", nextMarker));

function nextHarness(o) {
  o = o || {};
  const calls = { errors: [], notes: [], destroyed: 0, paused: 0, timers: [], started: [] };
  const video = { paused: false, pause: function () { calls.paused++; this.paused = true; } };
  const sandbox = {
    settings: { retryAttempts: "2" },
    state: {
      watchChannel: { name: "TVN" },
      sources: o.sources || [
        { engine: "native", url: "http://s/x.m3u8" },
        { engine: "hls", url: "http://s/x.m3u8" },
        { engine: "mse", url: "http://s/x.m3u8", hls: true }
      ],
      sourceIndex: o.sourceIndex === undefined ? 2 : o.sourceIndex,
      cycle: o.cycle === undefined ? 0 : o.cycle,
      retryTimer: null
    },
    t: function (key) { return "<" + key + ">"; },
    $: function (id) { return id === "video" ? video : null; },
    maybeAutoDiagnose: function () {},
    diagNote: function (note) { calls.notes.push(note); },
    showPlayerError: function (message) { calls.errors.push(message); },
    startSourceEntry: function (entry) { calls.started.push(entry); },
    destroyEngine: function () { calls.destroyed++; },
    setTimeout: function (fn) { calls.timers.push(fn); return 1; },
    clearTimeout: function () {}
  };
  run(codeNext, sandbox);
  return {
    api: sandbox, calls: calls, video: video,
    fire: function () { calls.timers.splice(0).forEach(function (fn) { fn(); }); }
  };
}

/* ostatni wpis kolejki padl: obraz gasnie, a komunikat mowi, co zrobic */
let nh = nextHarness({});
nh.api.nextSourceEntry("<err_no_picture>", 0, false, 0, "<err_no_picture_hint>");
check("wyczerpana kolejka: obraz gasnie zamiast grac sam dzwiek pod komunikatem",
  nh.calls.destroyed === 1 && nh.calls.paused === 1 && nh.video.paused === true &&
  nh.calls.timers.length === 0 && nh.calls.started.length === 0,
  JSON.stringify({ destroyed: nh.calls.destroyed, paused: nh.calls.paused, timers: nh.calls.timers.length }));
check("wyczerpana kolejka: komunikat podaje powod, rade i nie liczy „prob ponowienia”",
  nh.calls.errors.length === 1 &&
  nh.calls.errors[0] === "<err_no_picture>\n<err_no_picture_hint>\n<back_hint>",
  JSON.stringify(nh.calls.errors));
check("wyczerpana kolejka: dziennik panelu notuje oddanie kanalu",
  nh.calls.notes.join(",") === "<diag_engine_fail>,<diag_giveup_audio>",
  JSON.stringify(nh.calls.notes));

/* zanim kolejka sie wyczerpie, nastepny sposob odtwarzania (czytnik HLS→TS) ma isc
   jako pierwszy i od razu poinformowac, ze probujemy wlasnie jego */
nh = nextHarness({ sourceIndex: 1, cycle: 0 });
nh.api.nextSourceEntry("<err_no_picture>", 900, false, 0, "<err_no_picture_hint>");
check("wyczerpana proba: kolejka idzie do czytnika HLS→TS z wlasnym komunikatem",
  nh.calls.errors.length === 1 &&
  nh.calls.errors[0] === "<err_no_picture>\n<retry_engine_mse_hls>" &&
  nh.calls.timers.length === 1 && nh.calls.destroyed === 0 && nh.calls.paused === 0,
  JSON.stringify(nh.calls.errors));
nh.fire();
check("wyczerpana proba: nastepny sposob odtwarzania startuje bez czekania na pilota",
  nh.calls.started.length === 1 && nh.calls.started[0].engine === "mse" &&
  nh.calls.started[0].hls === true,
  JSON.stringify(nh.calls.started));

check("kanal 4K: rozpoznany z metadanych i z manifestu HLS, a warstwa obrazu go nie dotyczy",
  src.indexOf("if (videoIsUhd() && noteUhd()) return;") > 0 &&
  src.indexOf("if (manifestIsUhd(data) && noteUhd()) return;") > 0 &&
  src.indexOf("function noteUhd()") > 0 &&
  src.indexOf("state.uhdSeen = false;\n    /* Kondycja obrazu") > 0);
check("kanal 4K: kolejka nie przestawia sie w locie (drogi sprzetowe stoja na czele)",
  src.indexOf("hardwareEntryIndex") < 0 &&
  src.indexOf("nativeEntryIndex") < 0 &&
  src.indexOf("uhdNativeTried") < 0);

ph = pictureHarness({});
check("uruchomione: 4K z manifestu HLS poznajemy po wysokosci poziomu, nie po obrazie",
  ph.api.manifestIsUhd({ levels: [{ height: 2160 }] }) === true &&
  ph.api.manifestIsUhd({ levels: [{ width: 3840 }] }) === true &&
  ph.api.manifestIsUhd({ levels: [{ height: 1080 }, { height: 720 }] }) === false &&
  ph.api.manifestIsUhd({}) === false && ph.api.manifestIsUhd(null) === false,
  String(ph.api.manifestIsUhd({ levels: [{ height: 2160 }] })));

/* Droga natywna z .m3u8: podajemy ją <video> tylko tam, gdzie odbiornik ma
   własną obsługę HLS (webOS, Safari) — w Androidzie taka próba kończy się
   błędem i kanał idzie dalej kolejką (patrz startHlsSource) */
check("uruchomione: .m3u8 do <video> idzie tylko z wlasnym HLS odbiornika",
  src.indexOf('var nativeHls = video.canPlayType("application/vnd.apple.mpegurl");') > 0 &&
  src.indexOf('if (nativeHls) {\n          state.engine = "native";') > 0);

/* 4K z wymuszoną warstwą obrazu: warstwa schodzi, a po nią kanał startuje jeszcze
   raz świeżym elementem — ale sposób odtwarzania, który już coś pokazywał, zostaje */
ph = pictureHarness({
  uhd: true, engine: "hls", layerFix: true, sourceIndex: 1,
  sources: [{ engine: "native", url: "http://s/x.m3u8" }, { engine: "hls", url: "http://s/x.m3u8" }]
});
check("uruchomione: 4K z wymuszona warstwa obrazu startuje od nowa bez tej warstwy",
  ph.api.noteUhd() === true && ph.api.settings.videoLayerFix === false &&
  ph.api.state.uhdSeen === true && ph.calls.destroyed === 1 && ph.calls.saves === 1 &&
  ph.calls.pending.length === 1 && ph.calls.started.length === 0,
  JSON.stringify({ started: ph.calls.started, saves: ph.calls.saves }));
ph.fire();
check("uruchomione: 4K, ktory juz cos pokazywal, zostaje przy swoim odtwarzaczu",
  ph.calls.started.length === 1 && ph.calls.started[0].engine === "hls" &&
  ph.calls.started[0].url === "http://s/x.m3u8", JSON.stringify(ph.calls.started));

/* obraz gra i warstwy nie było czego zdejmować — działającego 4K nie ruszamy */
ph = pictureHarness({ uhd: true, engine: "hls" });
const running = ph.api.noteUhd();
check("uruchomione: 4K bez wymuszonej warstwy obrazu nie jest niepotrzebnie przeladowywany",
  running === false && ph.api.state.uhdSeen === true && ph.calls.destroyed === 0 &&
  ph.calls.started.length === 0 && ph.calls.pending.length === 0,
  JSON.stringify(ph.calls.started));

ph = pictureHarness({ uhd: true, engine: "native", layerFix: true });
check("uruchomione: 4K na dekoderze sprzetowym startuje od nowa swiezym elementem",
  ph.api.noteUhd() === true && ph.calls.started.length === 0 && ph.calls.pending.length === 1 &&
  ph.calls.destroyed === 1, JSON.stringify({ pending: ph.calls.pending.length }));
ph.fire();
check("uruchomione: powtorka wraca do tego samego wpisu kolejki (natywnie)",
  ph.calls.started.length === 1 && ph.calls.started[0].engine === "native" &&
  ph.api.state.sourceIndex === 0, JSON.stringify(ph.calls.started));

ph = pictureHarness({ uhd: true, engine: "native" });
check("uruchomione: 4K na dekoderze sprzetowym bez warstwy obrazu gra dalej",
  ph.api.noteUhd() === false && ph.calls.started.length === 0 && ph.calls.pending.length === 0,
  JSON.stringify(ph.calls.started));

/* Kanał 4K, który nie daje obrazu, nie przestawia już kolejki: drogi sprzętowe
   stoją na jej czele (patrz buildSourceQueue), a noteUhd() zdejmuje tylko
   wymuszoną warstwę obrazu. Gdy nie ma i tego, nie ma czego naprawiać — kanał
   idzie dalej kolejką prób (patrz nextSourceEntry). */
ph = pictureHarness({
  engine: "mse", sourceIndex: 0, canPlayType: "maybe",
  sources: [
    { engine: "mse", url: "http://s/x.m3u8", hls: true },
    { engine: "native", url: "http://s/x.m3u8" },
    { engine: "hls", url: "http://s/x.m3u8" }
  ]
});
check("uruchomione: 4K bez obrazu nie przestawia kolejki w locie",
  ph.api.noteUhd() === false && ph.api.state.sourceIndex === 0 &&
  ph.calls.destroyed === 0 && ph.calls.started.length === 0 && ph.calls.pending.length === 0,
  JSON.stringify({ index: ph.api.state.sourceIndex, started: ph.calls.started }));

/* Eleven Sports 1 4K: nazwa mówi wprost, że to 4K, więc warstwa obrazu jest zdjęta
   od startu, a gdy 4K wychodzi z metadanych klatki na czytniku playlisty, kanał
   zostaje na tym czytniku — na świeżym elemencie, ale bez powrotu do sprzętu */
ph = pictureHarness({
  uhd: true, engine: "mse", sourceIndex: 2, layerFix: true,
  sources: [
    { engine: "native", url: "http://s/x.m3u8" },
    { engine: "hls", url: "http://s/x.m3u8" },
    { engine: "mse", url: "http://s/x.m3u8", hls: true }
  ]
});
check("uruchomione: 4K z playlisty zostaje na czytniku playlisty, a warstwa obrazu schodzi",
  ph.api.noteUhd() === true && ph.api.state.sourceIndex === 2 &&
  ph.calls.destroyed === 1 && ph.calls.pending.length === 1 && ph.calls.started.length === 0,
  JSON.stringify({ index: ph.api.state.sourceIndex }));
ph.fire();
check("uruchomione: powtorka idzie do czytnika playlisty (nie do dekodera sprzetowego)",
  ph.calls.started.length === 1 && ph.calls.started[0].engine === "mse" &&
  ph.calls.started[0].hls === true, JSON.stringify(ph.calls.started));

/* Nazwa kanału to jedyna informacja o rozdzielczości, jaką mamy przed startem
   odtwarzania — po niej zdejmujemy wymuszoną warstwę obrazu, zanim wejdzie
   kanałowi w drogę (przy 4K to ona zostawia czarny ekran). */
check("kanal 4K z nazwy jest rozpoznany przed pierwszym sposobem odtwarzania",
  src.indexOf("function channelNameIsUhd(name)") > 0 &&
  src.indexOf("if (channelNameIsUhd(channel.name)) markUhdChannel();") > 0 &&
  src.indexOf("state.uhdSeen = true;\n    if (applyVideoLayerFix(false)) diagNote(t(\"diag_uhd_note\"));") > 0);
ph = pictureHarness({});
check("uruchomione: nazwa kanalu wprost mowi, kiedy to 4K",
  ph.api.channelNameIsUhd("Eleven Sports 1 4K") === true &&
  ph.api.channelNameIsUhd("Love Nature UHD") === true &&
  ph.api.channelNameIsUhd("TVP 2160p") === true &&
  ph.api.channelNameIsUhd("TVN HD") === false &&
  ph.api.channelNameIsUhd("Canal+ Sport") === false &&
  ph.api.channelNameIsUhd(null) === false,
  String(ph.api.channelNameIsUhd("Eleven Sports 1 4K")));
ph = pictureHarness({ layerFix: true });
ph.api.markUhdChannel();
check("uruchomione: 4K z nazwy kanalu zdejmuje wymuszona warstwe obrazu od razu",
  ph.api.state.uhdSeen === true && ph.api.settings.videoLayerFix === false &&
  ph.classes.indexOf("video-layer-fix") < 0 && ph.calls.saves === 1 &&
  ph.calls.notes.join(",") === "<diag_uhd_note>",
  JSON.stringify({ classes: ph.classes, notes: ph.calls.notes }));

/* 4K rozpoznane z manifestu nie ma wymiarow klatki (dekoder oddaje sam dzwiek),
   a mimo to nie dostaje wymuszonej warstwy obrazu — budzik idzie dalej */
ph = pictureHarness({ nowMs: NOW4K, waitStart: NOW4K - 50000, activity: NOW4K - 500,
  readyState: 2, uhdSeen: true });
ph.api.armPictureWatchdog(7);
ph.fire();
check("uruchomione: 4K z manifestu nie dostaje warstwy obrazu, tylko nastepny sposob odtwarzania",
  ph.classes.indexOf("video-layer-fix") < 0 && ph.api.settings.videoLayerFix === false &&
  ph.calls.next.length === 1 && ph.calls.started.length === 0,
  JSON.stringify({ classes: ph.classes, next: ph.calls.next }));

/* zapamietany tryb idzie na poczatek kolejki nastepnego kanalu */
const queueStart = src.indexOf("function buildSourceQueue(primaryUrl)");
const queueEnd = src.indexOf("function startSourceEntry(");
if (queueStart < 0 || queueEnd <= queueStart) throw new Error("Nie znalazlem kolejki prob w app.js");
const codeQueue = src.slice(queueStart, queueEnd);
if (codeQueue.indexOf("function preferEngine(queue, hint)") < 0) {
  throw new Error("Wyciety blok nie ma preferEngine");
}
const queueBox = {
  settings: { engineHint: "" },
  /* Kolejka pyta most odtwarzacza systemowego, czy jest dostępny (patrz exoBridge
     w app.js): w atrapie most jest zawsze (Android), a o tym, czy kanał nim idzie,
     decyduje ustawienie „nativePlayer”. „watchProgram” mówi, że to archiwum. */
  state: { watchProgram: null },
  exoBridge: function () {
    return { playNative: function () { return "ok"; } };
  },
  /* tak samo pytanie do silnika VLC (patrz vlcBridge w app.js): o tym, czy kanał
     nim idzie, decyduje przełącznik „vlcPlayer” */
  vlcBridge: function () {
    return { playVlc: function () { return "ok"; } };
  }
};
run(codeQueue, queueBox);
function engines(url) {
  return queueBox.buildSourceQueue(url).map(function (e) { return e.engine; });
}
const qPlain = engines("http://s/x.ts");
check("uruchomione: bez pamieci kolejnosc prob zostaje jak byla (natywny, MSE, HLS)",
  qPlain.join(",") === "native,mse,native,hls", JSON.stringify(qPlain));
queueBox.settings.engineHint = "mse";
const qMse = queueBox.buildSourceQueue("http://s/x.ts");
check("uruchomione: zapamietany MSE idzie na poczatek kolejki nastepnego kanalu",
  qMse[0].engine === "mse" && qMse[0].url === "http://s/x.ts" && qMse.length === qPlain.length &&
  qMse.map(function (e) { return e.engine; }).indexOf("native") === 1,
  JSON.stringify(qMse.map(function (e) { return e.engine; })));
queueBox.settings.engineHint = "hls";
const qHls = engines("http://s/x.m3u8");
check("uruchomione: zapamietany HLS idzie na poczatek tylko dla wlasnego adresu (.m3u8)",
  qHls[0] === "hls" && qHls.length === 3, JSON.stringify(qHls));
/* Kanał z playlisty ma jeszcze jedną próbę na końcu: playlistę czyta własny
   czytnik, a strumień rozbiera mpegts.js (patrz createHlsTsLoader). Bez tego
   wpisu kanał 4K HEVC kończył kolejkę z samym dźwiękiem. */
check("uruchomione: .m3u8 konczy kolejke wlasnym czytnikiem HLS→TS (mpegts.js + hls:true)",
  qHls[2] === "mse" && queueBox.buildSourceQueue("http://s/x.m3u8")[2].hls === true &&
  queueBox.buildSourceQueue("http://s/x.m3u8")[2].url === "http://s/x.m3u8",
  JSON.stringify(queueBox.buildSourceQueue("http://s/x.m3u8")));
queueBox.settings.engineHint = "mse";
const qMsHls = queueBox.buildSourceQueue("http://s/x.m3u8");
/* Zapamiętany MSE nie może wybierać czytnika playlisty: dla kanału z playlisty
   to ostatnia próba (wolna, z zapasem obrazu przed odtwarzaniem), a wybierana
   dla każdego kanału z playlisty kazała nią iść także kanałom HD, które mają
   zwykły strumień (patrz preferEngine). */
check("uruchomione: zapamietany MSE nie wybiera czytnika playlisty (zostaje ostatnia proba)",
  qMsHls.map(function (e) { return e.engine; }).join(",") === "native,hls,mse" &&
  qMsHls[0].hls !== true && qMsHls[2].hls === true,
  JSON.stringify(qMsHls.map(function (e) { return e.engine; })));
check("uruchomione: kanal .ts nie dostaje wpisu z czytnikiem playlisty (nie ma czego czytac)",
  qPlain.join(",") === "native,mse,native,hls" &&
  qMsHls.length === 3 && qMsHls.every(function (e) { return e.hls !== true || e.engine === "mse"; }));
queueBox.settings.engineHint = "bogus";
check("uruchomione: zapasowy .m3u8 nie wypycha sprawdzonego adresu .ts (kanal 4K szedl na HLS)",
  engines("http://s/x.ts").join(",") === "native,mse,native,hls",
  JSON.stringify(engines("http://s/x.ts")));
queueBox.settings.engineHint = "bogus";
check("uruchomione: nieznana pamiec nic nie psuje",
  engines("http://s/x.ts").join(",") === qPlain.join(","), JSON.stringify(engines("http://s/x.ts")));
queueBox.settings.engineHint = "";
/* Kanał na żywo w aplikacji na Androidzie idzie najpierw do odtwarzacza odbiornika
   (ExoPlayer) — to on rozbiera TS i HLS sprzętowo, więc tylko on daje 4K bez
   zrywania (patrz startExoSource). Gdy zawiedzie, kolejka idzie dalej jak dotąd. */
queueBox.settings.nativePlayer = true;
const qExo = engines("http://s/x.ts");
check("uruchomione: kanal na zywo idzie najpierw do odtwarzacza systemowego",
  qExo.join(",") === "exo,native,mse,native,hls" &&
  queueBox.buildSourceQueue("http://s/x.ts")[0].url === "http://s/x.ts",
  JSON.stringify(qExo));
queueBox.settings.engineHint = "mse";
const qExoHint = queueBox.buildSourceQueue("http://s/x.ts");
check("uruchomione: zapamietany silnik nie omija odtwarzacza systemowego",
  qExoHint.map(function (e) { return e.engine; }).join(",") === "exo,native,mse,native,hls" &&
  qExoHint.length === 5,
  JSON.stringify(qExoHint.map(function (e) { return e.engine; })));
/* Archiwum (catch-up) idzie tą samą drogą co kanał na żywo: drogi sprzętowe stoją
   na czele, bo przewijanie nagrania idzie ich własnym zegarem, a nie nowym
   wczytaniem strumienia (patrz seekBy, seekArchiveHardware w app.js). */
queueBox.state.watchProgram = { title: "Wiadomosci", start: 1, end: 2 };
queueBox.settings.engineHint = "";
const qExoArchive = engines("http://s/x.ts");
check("uruchomione: archiwum tez idzie najpierw silnikiem (VLC wylaczony — systemowy)",
  qExoArchive.join(",") === "exo,native,mse,native,hls",
  JSON.stringify(qExoArchive));
queueBox.state.watchProgram = null;
queueBox.settings.nativePlayer = false;
check("uruchomione: odtwarzacz systemowy jest domyslnie wylaczony (kolejka jak dotad)",
  engines("http://s/x.ts").join(",") === qPlain.join(","), JSON.stringify(engines("http://s/x.ts")));
/* Silnik VLC: stoi na CZELE kolejki — i na kanale na żywo, i w nagraniu
   z archiwum. To on radzi sobie ze strumieniami, na których dekoder odbiornika
   nie wyrabia, a jego własny zegar przewija nagranie (patrz buildSourceQueue,
   seekArchiveHardware). Reszta zostaje w kolejce jako automatyczne zapasy. */
queueBox.settings.vlcPlayer = true;
const qVlc = engines("http://s/x.ts");
check("uruchomione: kanal na zywo idzie silnikiem VLC (droga sprzetowa pierwsza)",
  qVlc.join(",") === "vlc,native,mse,native,hls" &&
  queueBox.buildSourceQueue("http://s/x.ts")[0].url === "http://s/x.ts",
  JSON.stringify(qVlc));
queueBox.settings.engineHint = "mse";
check("uruchomione: zapamietany silnik nie omija VLC (droga sprzetowa zostaje pierwsza)",
  engines("http://s/x.ts").join(",") === "vlc,native,mse,native,hls",
  JSON.stringify(engines("http://s/x.ts")));
queueBox.settings.engineHint = "";
queueBox.settings.nativePlayer = true;
check("uruchomione: przy obu przelacznikach kanal dostaje VLC",
  engines("http://s/x.ts").join(",") === "vlc,exo,native,mse,native,hls",
  JSON.stringify(engines("http://s/x.ts")));
queueBox.state.watchProgram = { title: "Wiadomosci", start: 1, end: 2 };
check("uruchomione: nagranie z archiwum idzie tak samo silnikiem (obraz i wlasny zegar)",
  engines("http://s/x.ts").join(",") === "vlc,exo,native,mse,native,hls",
  JSON.stringify(engines("http://s/x.ts")));
check("uruchomione: nagranie bez VLC dostaje odtwarzacz systemowy",
  (function () {
    queueBox.settings.vlcPlayer = false;
    const only = engines("http://s/x.ts").join(",");
    queueBox.settings.vlcPlayer = true;
    return only === "exo,native,mse,native,hls";
  })(), JSON.stringify(engines("http://s/x.ts")));
queueBox.state.watchProgram = null;
queueBox.settings.nativePlayer = false;
queueBox.settings.vlcPlayer = false;
check("uruchomione: bez silnikow zostaje droga przegladarki (zapasy w kolejce)",
  engines("http://s/x.ts").join(",") === qPlain.join(","), JSON.stringify(engines("http://s/x.ts")));


/* --- 26. hls.js: strumien, ktorego nie rozbierze (4K HEVC w M2TS) ------------
   hls.js zglasza taki fragment jako zwykle ostrzezenie (bez „fatal”) i gra dalej
   sam dzwiek, powtarzajac je przy kazdym fragmencie — na ekranie zostaje
   „mediaError/fragParsingError”, a obrazu nie ma i nie bedzie. Aplikacja musi
   rozpoznac taka probe i oddac kanal innemu silnikowi, zamiast czekac z samym
   dzwiekiem. */
check("hls.js: fragmentow, ktorych nie rozbierze, nie czekamy do konca (dzwiek bez obrazu)",
  src.indexOf("var unplayable = data.details === \"fragParsingError\" && hlsCannotPlay(data) &&") > 0 &&
  src.indexOf("!videoHasPicture(video);") > 0 &&
  src.indexOf("if (!data.fatal && !unplayable) return;") > 0 &&
  src.indexOf("function hlsCannotPlay(data)") > 0);

const cannotStart = src.indexOf("function hlsCannotPlay(data)");
const cannotEnd = src.indexOf("\n  }\n", cannotStart);
if (cannotStart < 0 || cannotEnd < 0) throw new Error("Nie znalazlem hlsCannotPlay w app.js");
const cannotBox = {};
run(src.slice(cannotStart, cannotEnd + 5), cannotBox);
check("hls.js: „Unsupported HEVC in M2TS found” to koniec proby (tak wyglada 4K HEVC)",
  cannotBox.hlsCannotPlay({ details: "fragParsingError", reason: "Unsupported HEVC in M2TS found" }) === true &&
  cannotBox.hlsCannotPlay({ error: { message: "no support for video codec: hvc1" } }) === true,
  String(cannotBox.hlsCannotPlay({ reason: "Unsupported HEVC in M2TS found" })));
check("hls.js: pojedynczy zepsuty fragment nie konczy proby (strumien moze sie podniesc)",
  cannotBox.hlsCannotPlay({ details: "fragParsingError", reason: "AAC PES did not start with ADTS header,offset:2" }) === false &&
  cannotBox.hlsCannotPlay({ details: "fragParsingError", reason: "Found no media in msn 12 of level \"x\"" }) === false &&
  cannotBox.hlsCannotPlay({}) === false,
  String(cannotBox.hlsCannotPlay({ reason: "Found no media in msn 12" })));

/* --- 26. kanal z playlisty (4K HEVC): wlasny czytnik HLS→TS ------------------
   Kanaly 4K bywaja nadawane tylko jako .m3u8 z HEVC w TS. Na Androidzie nie ma
   tego czym odtworzyc: hls.js nie rozbiera HEVC, a <video> nie czyta playlisty,
   wiec zostawal sam dzwiek na czarnym ekranie. Aplikacja musi sama przeczytac
   playliste, pobrac odcinki i podac je mpegts.js jako jeden ciagly strumien TS
   (config.customLoader wg umowy z mpegts.js 1.7.3). Sprawdzamy te umowe, rozbior
   playlisty, brak dublowania odcinkow i polaczenie z kolejka prob. */
check("kanal z playlisty: mpegts.js dostaje wlasny czytnik (customLoader + BaseLoader)",
  src.indexOf("function createHlsTsLoader(lib, videoRef)") > 0 &&
  src.indexOf("var self = lib.BaseLoader.call(this, \"hls-ts-loader\") || this;") > 0 &&
  src.indexOf("FeederLoader.prototype = Object.create(lib.BaseLoader.prototype);") > 0 &&
  src.indexOf("FeederLoader.prototype.open = function (dataSource, range) {") > 0 &&
  src.indexOf("FeederLoader.prototype.abort = function () {") > 0 &&
  src.indexOf("config.customLoader = createHlsTsLoader(window.mpegts, function () { return $(\"video\"); });") > 0 &&
  src.indexOf("if (entry.hls) {") > 0);
check("kanal z playlisty: odcinki ida do odtwarzacza jako rosnacy ciagly strumien TS",
  src.indexOf("self._onDataArrival(chunk, self._offset, self._offset + chunk.byteLength);") > 0 &&
  src.indexOf("self._offset += chunk.byteLength;") > 0 &&
  src.indexOf("self._status = lib.LoaderStatus.kBuffering;") > 0 &&
  src.indexOf("this._status = lib.LoaderStatus.kComplete;") > 0 &&
  src.indexOf("if (this._onComplete) this._onComplete(0, this._offset);") > 0);
/* Doganianie „na żywo” w mpegts.js przeskakuje currentTime na koniec buforu
   (buffered.end - 0.5 s) po każdym dołożonym odcinku — na 4K odpala się to bez
   przerwy (zapas rośnie skokowo po każdym odcinku), a obraz skacze wtedy do przodu
   jak „strumień, który nagle przyspieszył”. Zapasu pilnuje sama aplikacja: czytnik
   trzyma FEEDER_BUFFER_AHEAD_UHD, a start czeka na zapas (playWhenBuffered), więc
   doganianie musi być wyłączone na KAŻDEJ drodze przez mpegts.js — nie tylko dla
   kanału z playlisty. Tak samo pamięć wstecz: domyślne 180 s w MSE to przy 4K
   setki megabajtów i przeglądarka zaczyna przycinać bufor. */
const mseConfigStart = src.indexOf("var config = {\n        enableWorker: true");
const mseConfigEnd = src.indexOf("\n      };", mseConfigStart);
const mseConfig = mseConfigStart > 0 && mseConfigEnd > mseConfigStart
  ? src.slice(mseConfigStart, mseConfigEnd) : "";
check("nie gonimy obrazu na zywo (mpegts.js przeskakiwalby na koniec buforu)",
  mseConfig.indexOf("liveBufferLatencyChasing: false") > 0 &&
  src.indexOf("liveBufferLatencyChasing: true") < 0 &&
  src.indexOf("liveBufferLatencyMaxLatency") < 0,
  mseConfig.replace(/\n/g, " | "));
check("4K: bufor wstecz w MSE ograniczony (domyslne 180 s to przy 4K setki MB)",
  mseConfig.indexOf("autoCleanupMaxBackwardDuration: 30") > 0 &&
  mseConfig.indexOf("autoCleanupMinBackwardDuration: 15") > 0);
check("kanal z playlisty: nieudany odcinek wraca na poczatek kolejki (dziura w TS rozsypuje obraz)",
  src.indexOf("FeederLoader.prototype._segmentFailed = function (url, reason) {") > 0 &&
  src.indexOf("this._pending.unshift(url);") > 0 &&
  src.indexOf("this._segmentFails <= FEEDER_SEGMENT_RETRIES") > 0 &&
  src.indexOf("this._fail(t(\"err_feeder_segment\", { reason: reason }))") > 0);
check("kanal z playlisty: porazka czytnika konczy te probe, a nie cala aplikacje",
  src.indexOf("FeederLoader.prototype._fail = function (message) {") > 0 &&
  src.indexOf("this._status = lib.LoaderStatus.kError;") > 0 &&
  src.indexOf("this._onError(lib.LoaderErrors.EXCEPTION, { code: -1, msg: String(message) });") > 0 &&
  src.indexOf("diagNote(t(\"diag_feeder_failed\", { reason: String(message) }));") > 0);
check("kanal z playlisty: playlista czytana na nowo, a wyslane odcinki nie dubluja sie",
  src.indexOf("FeederLoader.prototype._scheduleRefresh = function () {") > 0 &&
  src.indexOf("if (this._seen[url]) continue;") > 0 &&
  src.indexOf("Math.max(0, list.segments.length - feederLiveSegments())") > 0 &&
  src.indexOf("if (this._seenCount > FEEDER_SEEN_MAX) { this._seen = {}; this._seenCount = 0; }") > 0);
check("kanal z playlisty: obrazu nie wyprzedzamy (bufor na zywo) i znamy powody odmowy",
  src.indexOf("FeederLoader.prototype._pump = function () {") > 0 &&
  src.indexOf("if (video && ahead > feederBufferAheadLimit()) {") > 0 &&
  src.indexOf("var FEEDER_BUFFER_AHEAD_UHD = 24;") > 0 &&
  src.indexOf("err_feeder_fmp4:") > 0 && src.indexOf("err_feeder_encrypted:") > 0 &&
  src.indexOf("err_feeder_variants:") > 0 && src.indexOf("err_feeder_empty:") > 0);
/* Zaleglosc wobec transmisji rosnie tylko wtedy, gdy lacze nie wyrabia za kanalem.
   Bez tego meldunku obraz zrywajacy sie na wolnym laczu wyglada tak samo jak obraz
   zrywajacy sie przez kodek, a to dwie zupelnie rozne naprawy. */
check("kanal z playlisty: zaleglosc wobec transmisji melduje sie w panelu diagnostyki",
  src.indexOf("FeederLoader.prototype._noteLag = function (ahead) {") > 0 &&
  src.indexOf("var lag = ahead + this._pending.length * (this._target || 4);") > 0 &&
  src.indexOf("if (lag < FEEDER_LAG_NOTE) { this._lagNoted = false; return; }") > 0 &&
  src.indexOf("diagNote(t(\"diag_feeder_lag\", { s: Math.round(lag) }));") > 0 &&
  src.indexOf("this._noteLag(ahead);") > 0);

/* Czytnik wyciagniety z app.js (nie skopiowany): caly blok z parserem playlisty.
   Atrapy `t`/`diagNote`/`httpGet` sa potrzebne tylko tym metodom, ktore wolamy
   nizej pojedynczo — bez nich siegnełyby do nieistniejacych nazw. */
const feederStart = src.indexOf("var FEEDER_LIVE_SEGMENTS");
const feederEnd = src.indexOf("function startMseSource(");
if (feederStart < 0 || feederEnd <= feederStart) throw new Error("Nie znalazlem czytnika HLS→TS w app.js");
/* Czytnik sam melduje, co odebrał (patrz noteStreamActivity): odebrana playlista
   i odebrany odcinek to ruch w strumieniu. Odpowiedzi httpGet są „natychmiastowe”
   (własny then), żeby dało się to sprawdzić bez czekania na mikrozadania. */
const feederCalls = { activity: 0 };
let feederText = "";
/* Bajty muszą powstać w tym samym kontekście co czytnik: _asChunk sprawdza
   `instanceof ArrayBuffer`, które nie działa między realmami (patrz niżej) */
let feederBinary = null;
const feederStubs = {
  t: function (key) { return "<" + key + ">"; },
  diagNote: function () {},
  noteStreamActivity: function () { feederCalls.activity++; },
  videoRef: null,
  lib: {
    LoaderStatus: { kIdle: 0, kConnecting: 1, kBuffering: 2, kComplete: 3, kError: 4 },
    LoaderErrors: { EXCEPTION: 1 }
  },
  httpGet: function (url, asArrayBuffer) {
    return { then: function (ok) { ok(asArrayBuffer ? feederBinary : feederText); } };
  },
  setTimeout: function () { return 1; },
  clearTimeout: function () {}
};
const feederBox = run(src.slice(feederStart, feederEnd), feederStubs);
feederBinary = vm.runInContext("new ArrayBuffer(8)", feederBox);
/* Czytnik melduje własny ruch (patrz noteStreamActivity) — bez tego budziki widzą
   tylko ciszę w <video> (odcinki się jeszcze pobierają) i ucinają próbę. */
check("kanal z playlisty: odebrana playlista i odcinek licza sie jako ruch w strumieniu",
  (src.slice(feederStart, feederEnd).match(/noteStreamActivity\(\);/g) || []).length === 2);

const masterList = feederBox.parseHlsPlaylist([
  "#EXTM3U",
  "#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080,CODECS=\"avc1.640029,mp4a.40.2\"",
  "hd/index.m3u8",
  "#EXT-X-STREAM-INF:BANDWIDTH=32000000,RESOLUTION=3840x2160,CODECS=\"hvc1.2.4.L153,mp4a.40.2\"",
  "uhd/index.m3u8"
].join("\n"));
check("czytnik HLS: playlista wariantow rozpoznana (4K to osobny poziom, nie odcinek)",
  masterList.variants.length === 2 && masterList.variants[1].bandwidth === 32000000 &&
  masterList.variants[1].height === 2160 && masterList.segments.length === 0,
  JSON.stringify(masterList));
check("czytnik HLS: atrybuty wiersza wariantu czytane takze w cudzyslowie",
  feederBox.feederAttributes("BANDWIDTH=32000000,RESOLUTION=3840x2160,CODECS=\"hvc1.2.4.L153,mp4a.40.2\"").CODECS ===
  "hvc1.2.4.L153,mp4a.40.2");

const mediaList = feederBox.parseHlsPlaylist([
  "#EXTM3U",
  "#EXT-X-VERSION:3",
  "#EXT-X-TARGETDURATION:4",
  "#EXT-X-MEDIA-SEQUENCE:118",
  "#EXTINF:4.000,",
  "od118.ts",
  "#EXTINF:4.000,",
  "od119.ts",
  "#EXTINF:3.960,",
  "od120.ts"
].join("\n"));
check("czytnik HLS: odcinki, dlugosc odcinka i brak konca playlisty (kanal na zywo)",
  mediaList.segments.join(",") === "od118.ts,od119.ts,od120.ts" &&
  mediaList.targetDuration === 4 && mediaList.endList === false &&
  mediaList.fmp4 === false && mediaList.encrypted === false && mediaList.variants.length === 0,
  JSON.stringify(mediaList));
check("czytnik HLS: koniec playlisty (film) i zaszyfrowany strumien sa rozpoznawane",
  feederBox.parseHlsPlaylist("#EXTM3U\n#EXTINF:4,\nod1.ts\n#EXT-X-ENDLIST").endList === true &&
  feederBox.parseHlsPlaylist("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"k\"\n#EXTINF:4,\nod1.ts").encrypted === true &&
  feederBox.parseHlsPlaylist("#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:4,\nod1.ts").encrypted === false);
check("czytnik HLS: kawalki MP4 (fMP4) sa wykrywane — mpegts.js TS ich nie rozbierze",
  feederBox.parseHlsPlaylist("#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:4,\nod1.m4s").fmp4 === true);
check("czytnik HLS: adresy wzgledne trafiaja do katalogu playlisty",
  feederBox.feederResolveUrl("http://s:8080/live/kanal/index.m3u8?token=1", "od1.ts") === "http://s:8080/live/kanal/od1.ts" &&
  feederBox.feederResolveUrl("http://s/live/a/index.m3u8", "/live/b/od1.ts") === "http://s/live/b/od1.ts" &&
  feederBox.feederResolveUrl("http://s/live/a/index.m3u8", "http://c/d/od1.ts") === "http://c/d/od1.ts" &&
  feederBox.feederResolveUrl("http://s/live/a/index.m3u8", "od1.ts") === "http://s/live/a/od1.ts",
  feederBox.feederResolveUrl("http://s:8080/live/kanal/index.m3u8?token=1", "od1.ts"));
check("czytnik HLS: powod odmowy jest krotki i czytelny dla czlowieka",
  feederBox.feederReason(new Error("timeout")) === "timeout" &&
  feederBox.feederReason(null) === "?");

/* Pojedyncze metody czytnika wyciagniete z app.js — wolamy je na atrapie loadera
   (patrz umowa customLoader w mpegts.js 1.7.3: open/abort/destroy + _onDataArrival) */
run("var FeederLoader = function () {};", feederBox);
function feederMethod(name) {
  const at = src.indexOf("FeederLoader.prototype." + name + " = function");
  if (at < 0) throw new Error("Nie znalazlem FeederLoader.prototype." + name + " w app.js");
  const end = src.indexOf("\n    };", at);
  if (end < 0) throw new Error("Nie znalazlem konca FeederLoader.prototype." + name);
  vm.runInContext(src.slice(at, end + 7), feederBox);
  return feederBox.FeederLoader.prototype[name];
}

const queueSegments = feederMethod("_queueSegments");
function feederSeg(o) {
  const seg = Object.create(feederBox.FeederLoader.prototype);
  seg._playlistUrl = "http://s/live/kanal/index.m3u8";
  seg._started = !!(o && o.started);
  seg._endList = !!(o && o.endList);
  seg._seen = {};
  seg._seenCount = 0;
  seg._pending = (o && o.pending) || [];
  return seg;
}
const liveSeg = feederSeg({});
const fiveSegments = ["od1.ts", "od2.ts", "od3.ts", "od4.ts", "od5.ts"];
queueSegments.call(liveSeg, { segments: fiveSegments, endList: false });
check("czytnik HLS: na zywo startujemy od ostatnich odcinkow (obraz nie zostaje z tylu)",
  liveSeg._pending.join(",") === "http://s/live/kanal/od4.ts,http://s/live/kanal/od5.ts",
  liveSeg._pending.join(","));
liveSeg._started = true;
queueSegments.call(liveSeg, { segments: fiveSegments.concat(["od6.ts"]), endList: false });
check("czytnik HLS: po odczycie playlisty dochodzi tylko nowy odcinek (bez dublowania)",
  liveSeg._pending.join(",") ===
  "http://s/live/kanal/od4.ts,http://s/live/kanal/od5.ts,http://s/live/kanal/od6.ts",
  liveSeg._pending.join(","));
const vodSeg = feederSeg({ endList: true });
queueSegments.call(vodSeg, { segments: ["a.ts", "b.ts"], endList: true });
check("czytnik HLS: film z playlisty puszczamy od pierwszego odcinka (jest koniec listy)",
  vodSeg._pending.join(",") === "http://s/live/kanal/a.ts,http://s/live/kanal/b.ts",
  vodSeg._pending.join(","));

const variantBetter = feederMethod("_variantBetter");
check("czytnik HLS: z playlisty wariantow wybieramy najciezszy poziom (4K HEVC jest tam)",
  masterList.variants.reduce(function (best, v) { return variantBetter.call(null, v, best) ? v : best; },
    masterList.variants[0]).url === "uhd/index.m3u8" &&
  variantBetter.call(null, { bandwidth: 8000000, height: 2160 }, { bandwidth: 8000000, height: 1080 }) === true &&
  variantBetter.call(null, { bandwidth: 8000000, height: 1080 }, { bandwidth: 32000000, height: 2160 }) === false &&
  variantBetter.call(null, { bandwidth: 8000000, height: 1080 }, { bandwidth: 8000000, height: 1080 }) === false);

const segmentFailed = feederMethod("_segmentFailed");
function failedHarness() {
  const seg = feederSeg({});
  const calls = { retry: [], failed: [] };
  seg._segmentFails = 0;
  seg._schedulePump = function (delay) { calls.retry.push(delay); };
  seg._fail = function (message) { calls.failed.push(message); };
  return { seg: seg, calls: calls };
}
const fs1 = failedHarness();
check("czytnik HLS: nieodebrany odcinek wraca na poczatek kolejki i czeka pol sekundy",
  segmentFailed.call(fs1.seg, "http://s/live/kanal/od3.ts", "timeout") === true &&
  fs1.seg._pending.join(",") === "http://s/live/kanal/od3.ts" &&
  fs1.calls.retry.join(",") === "500" && fs1.calls.failed.length === 0,
  JSON.stringify(fs1.calls));
segmentFailed.call(fs1.seg, "http://s/live/kanal/od3.ts", "timeout");
check("czytnik HLS: trzecia nieudana proba odcinka konczy te probe (z powodem w komunikacie)",
  segmentFailed.call(fs1.seg, "http://s/live/kanal/od3.ts", "timeout") === false &&
  fs1.calls.failed.length === 1 && fs1.calls.failed[0] === "<err_feeder_segment>" &&
  fs1.calls.retry.length === 2,
  JSON.stringify(fs1.calls));

/* Odebrany odcinek i odebrana playlista meldują się jako ruch w strumieniu
   (patrz noteStreamActivity, streamStillComing): bez tego budziki obrazu widzą
   ciszę w <video> i ucinają próbę, która właśnie się wczytuje — tak 4K z playlisty
   traciło obraz w połowie pobierania odcinków. */
const pumpActivity = (function () {
  /* metody, których dotyka _pump/_readPlaylist — w atrapie są doklejane po jednej */
  feederMethod("_schedulePump");
  feederMethod("_scheduleRefresh");
  feederMethod("_asChunk");
  feederMethod("_noteLag");
  const pump = feederMethod("_pump");
  const seg = feederSeg({ pending: ["http://s/live/kanal/od1.ts"] });
  seg._stopped = false;
  seg._fetching = false;
  seg._offset = 0;
  seg._segmentFails = 0;
  seg._onDataArrival = function () {};
  const before = feederCalls.activity;
  pump.call(seg);
  return { before: before, after: feederCalls.activity, offset: seg._offset, pending: seg._pending.length };
})();
check("czytnik HLS: odebrany odcinek melduje ruch w strumieniu",
  pumpActivity.after === pumpActivity.before + 1 && pumpActivity.offset === 8 &&
  pumpActivity.pending === 0, JSON.stringify(pumpActivity));

const playlistActivity = (function () {
  const read = feederMethod("_readPlaylist");
  const seg = feederSeg({});
  seg._stopped = false;
  seg._target = 4;
  seg._pending = [];
  /* odcinek już wysłany, więc próba kończy się na samym odczycie playlisty */
  seg._seen = { "http://s/live/kanal/od1.ts": true };
  seg._seenCount = 1;
  feederText = "#EXTM3U\n#EXTINF:4,\nod1.ts\n";
  const before = feederCalls.activity;
  read.call(seg, 0);
  return { before: before, after: feederCalls.activity, pending: seg._pending.join(",") };
})();
check("czytnik HLS: odebrana playlista melduje ruch w strumieniu",
  playlistActivity.after === playlistActivity.before + 1 &&
  playlistActivity.pending === "", JSON.stringify(playlistActivity));

feederMethod("_asChunk");
vm.runInContext("var __probe = {}; var __ab = new ArrayBuffer(8); var __view = new Uint8Array(__ab, 4, 2);\n" +
  "__probe.same = FeederLoader.prototype._asChunk.call(null, __ab) === __ab;\n" +
  "__probe.view = (function () { var out = FeederLoader.prototype._asChunk.call(null, __view);\n" +
  "  return out instanceof ArrayBuffer && out !== __ab && out.byteLength === 2; })();\n" +
  "__probe.whole = FeederLoader.prototype._asChunk.call(null, new Uint8Array(__ab)) === __ab;\n" +
  "__probe.bad = FeederLoader.prototype._asChunk.call(null, \"tekst\") === null &&\n" +
  "  FeederLoader.prototype._asChunk.call(null, null) === null;", feederBox);
check("czytnik HLS: odcinek idzie do mpegts.js jako ArrayBuffer (takze gdy webOS da same bajty)",
  feederBox.__probe.same === true && feederBox.__probe.view === true &&
  feederBox.__probe.whole === true && feederBox.__probe.bad === true,
  JSON.stringify(feederBox.__probe));

const bufferedAhead = feederMethod("_bufferedAhead");
check("czytnik HLS: bufor liczymy od miejsca odtwarzania (na zywo nie wyprzedzamy obrazu)",
  bufferedAhead.call(null, {
    currentTime: 10,
    buffered: { length: 1, start: function () { return 5; }, end: function () { return 14; } }
  }) === 4 &&
  bufferedAhead.call(null, { currentTime: 10, buffered: { length: 0 } }) === 0 &&
  bufferedAhead.call(null, {}) === 0 &&
  bufferedAhead.call(null, {
    currentTime: 2,
    buffered: { length: 2, start: function (i) { return i ? 100 : 0; }, end: function (i) { return i ? 120 : 4; } }
  }) === 2);

/* Zaszyty w strumieniu czas idzie od tego, co nadawca wpisał w znaczniki — bufor
   potrafi więc zaczynać się za miejscem odtwarzania (świeży bufor MSE), a odtwarzanie
   może stać w dziurze bufora. Starszy rachunek zwracał tam zero, więc czytnik pobierał
   odcinki dalej: zapas rósł bez końca, a obraz oddalał się od transmisji. */
check("czytnik HLS: bufor zaczynajacy sie za miejscem odtwarzania tez liczy sie jako zapas",
  bufferedAhead.call(null, {
    currentTime: 0,
    buffered: { length: 1, start: function () { return 5; }, end: function () { return 8; } }
  }) === 8 &&
  bufferedAhead.call(null, {
    currentTime: 3,
    buffered: { length: 2, start: function (i) { return i ? 40 : 0; }, end: function (i) { return i ? 45 : 2; } }
  }) === 42,
  String(bufferedAhead.call(null, {
    currentTime: 0,
    buffered: { length: 1, start: function () { return 5; }, end: function () { return 8; } }
  })));

/* Zapas 4K jest większy niż HD: odcinek jest cięższy, więc jeden wolniejszy odcinek
   nie może opróżnić bufora do zera — z tego brały się zrywania obrazu. Sam zapas nie
   rośnie jednak z niczego: playlista publikuje odcinki w tempie transmisji, więc 4K
   musi zacząć od większej liczby odcinków z jej końca (2 odcinki to ~8 s). */
vm.runInContext("var state = { uhdSeen: true };", feederBox);
check("czytnik HLS: kanal 4K trzyma wiekszy zapas niz HD",
  feederBox.FEEDER_BUFFER_AHEAD === 10 && feederBox.FEEDER_BUFFER_AHEAD_UHD === 24 &&
  feederBox.feederBufferAheadLimit() === 24 &&
  feederBox.feederChannelIsUhd() === true,
  String(feederBox.feederBufferAheadLimit()));
const uhdSeg = feederSeg({});
queueSegments.call(uhdSeg, {
  segments: ["od1.ts", "od2.ts", "od3.ts", "od4.ts", "od5.ts",
    "od6.ts", "od7.ts", "od8.ts", "od9.ts", "od10.ts"],
  endList: false
});
check("czytnik HLS: 4K startuje z wiekszej liczby odcinkow (z tego powstaje jego zapas)",
  feederBox.FEEDER_LIVE_SEGMENTS_UHD === 6 &&
  uhdSeg._pending.length === 6 &&
  uhdSeg._pending[0] === "http://s/live/kanal/od5.ts" &&
  uhdSeg._pending[5] === "http://s/live/kanal/od10.ts",
  uhdSeg._pending.join(","));

/* Kolejka odcinków jest ograniczona: gdy łącze nie wyrabia za kanałem, odcinki z
   playlisty przychodzą szybciej, niż je oddajemy. Bez limitu obraz odjeżdżałby od
   transmisji na zawsze, a pamięć rosła (patrz FEEDER_PENDING_MAX). */
const capSeg = feederSeg({});
queueSegments.call(capSeg, {
  segments: ["b1.ts", "b2.ts", "b3.ts", "b4.ts", "b5.ts", "b6.ts",
    "b7.ts", "b8.ts", "b9.ts", "b10.ts"],
  endList: false
});
const capFirst = capSeg._pending.length;
queueSegments.call(capSeg, {
  segments: ["b1.ts", "b2.ts", "b3.ts", "b4.ts", "b5.ts", "b6.ts", "b7.ts", "b8.ts",
    "b9.ts", "b10.ts", "b11.ts", "b12.ts", "b13.ts", "b14.ts"],
  endList: false
});
check("czytnik HLS: kolejka odcinkow sie nie rozrasta (obraz wraca na zywo)",
  feederBox.FEEDER_PENDING_MAX === 8 && capFirst === 6 &&
  capSeg._pending.length === 8 &&
  capSeg._pending[0] === "http://s/live/kanal/b7.ts" &&
  capSeg._pending[7] === "http://s/live/kanal/b14.ts",
  "kolejka: " + capSeg._pending.join(","));

/* --- 26b. start na zapasie (nie na pierwszych kilobajtach) ----------------
   Dekoder, któremu każe się grać od razu, przez kilka sekund nadrabia to, co
   przyszło — klatka po klatce. Na 4K wygląda to dokładnie jak zrywanie obrazu,
   dlatego odtwarzanie rusza na zapasie, a nie na zdarzeniu „canplay” (przy 4K
   potrafi ono przyjść przy jednej sekundzie obrazu). */
check("start kanalu czeka na zapas w buforze, a nie na pierwsze kilobajty",
  src.indexOf("function playWhenBuffered(player, video, token, ahead, wait) {") > 0 &&
  src.indexOf("playWhenBuffered(\n          player,") > 0 &&
  src.indexOf("var MSE_START_AHEAD = 3;") > 0 &&
  src.indexOf("var MSE_START_AHEAD_UHD = 12;") > 0 &&
  src.indexOf("var ready = videoBufferedAhead(video) >= ahead;") > 0);
check("start na zapasie: 4K czeka dluzej, film z archiwum startuje od razu",
  src.indexOf("if (state.watchProgram) return 0;") > 0 &&
  src.indexOf("return (state.uhdSeen || videoIsUhd()) ? MSE_START_AHEAD_UHD : MSE_START_AHEAD;") > 0 &&
  src.indexOf("state.engineFeeder ? FEEDER_START_WAIT : MSE_START_WAIT") > 0 &&
  src.indexOf("var FEEDER_START_WAIT = 15000;") > 0);
check("start na zapasie: czekanie jest ograniczone i nie gasi proby",
  src.indexOf("if (ready || expired || video.error) {") > 0 &&
  src.indexOf("if (video.readyState >= 1) noteStreamActivity();") > 0 &&
  src.indexOf("if (state.engineToken !== token || !state.watchChannel) return;") > 0);

/* Droga MSE nie woła już play() od razu — gdyby wołała, zapas, na który czeka start,
   byłby tylko ozdobą. */
check("MSE: play() wychodzi ze startu na zapasie",
  (function () {
    const at = src.indexOf("function startMseSource(entry) {");
    const end = src.indexOf("/* =========  START NA ZAPASIE", at);
    const body = at > 0 && end > at ? src.slice(at, end) : "";
    return body.indexOf("player.play()") < 0 && body.indexOf("playWhenBuffered(") > 0;
  })());

/* Krótkie zrywki nie mogą migać komunikatem „Ładowanie strumienia…”: na kanale 4K
   komunikat pojawiał się przy każdym odcinku i wyglądało to jak zepsuty kanał,
   choć obraz wracał po ułamku sekundy. */
check("krotka zrywka nie miga komunikatem o wczytywaniu (komunikat dopiero po 800 ms)",
  src.indexOf("clearTimeout(state.bufferTimer);\n      state.bufferTimer = setTimeout(function () {") > 0 &&
  src.indexOf("}, 800);") > 0 &&
  src.indexOf("if (current && !current.paused && current.readyState >= 3) return;") > 0);
check("obraz wrocil: komunikat o wczytywaniu gasnie razem z nim",
  src.indexOf("clearTimeout(state.bufferTimer);\n      state.bufferTimer = null;\n      clearStartWatchdog();") > 0);

/* Panel diagnostyki: 4K z playlisty ma tylko jedną drogę do obrazu (mpegts.js + MSE),
   więc musi mówić, czy ten dekoder w ogóle wciągnie HEVC — to własny test biblioteki,
   a nie nasze zgadywanie. */
check("panel diagnostyki: mpegts.js mowi, czy MSE wciagnie HEVC",
  src.indexOf("window.mpegts.getFeatureList") > 0 &&
  src.indexOf("features.mseH265Playback ? t(\"diag_yes\") : t(\"diag_no\")") > 0);
check("nowe napisy diagnostyki sa w obu jezykach",
  src.indexOf("diag_mpegts: \"mpegts.js (MSE) — co potrafi\"") > 0 &&
  src.indexOf("diag_mpegts: \"mpegts.js (MSE) — what it supports\"") > 0 &&
  src.indexOf("diag_feeder_lag: \"zaległość wobec transmisji: {s} s") > 0 &&
  src.indexOf("diag_feeder_lag: \"lag behind the broadcast: {s} s") > 0);

/* Ten sam kod chodzi na Fire TV, Android TV i Google TV (w tym Chromecast z Google TV),
   a każdy z nich ma inny WebView — więc panel diagnostyki musi je rozróżniać.
   Aktualizacja w aplikacji musi przy tym wskazywać dla nich tę samą paczkę .apk. */
check("Google TV i Chromecast rozpoznane osobno, ale aktualizacja to ta sama paczka .apk",
  src.indexOf("if (/google tv|chromecast|crkey/.test(ua)) {") > 0 &&
  src.indexOf("os = \"googletv\";") > 0 &&
  src.indexOf("/^(android|androidtv|googletv|firetv)$/.test(platformInfo.os)") > 0 &&
  src.indexOf("platform_googletv: \"Google TV\"") > 0);


/* --- 26c. kondycja obrazu na zywo: zrywy, pamiec i swiezy strumien ----------
   Obraz 4K przez MSE rozsypuje sie po dluzszym ogladaniu: dekoder odrzuca klatki,
   pamiec rosnie i system zamyka aplikacje. Tego nie widac ani w jednej liczbie, ani
   z jednego zdjecia panelu — dlatego aplikacja mierzy zrywy i odrzucone klatki
   w oknie czasu, a gdy obraz naprawde sie rozsypuje, wystawia ten sam strumien na
   swiezym MSE. W miejscu, w ktorym dotad konczylo sie to wyjsciem z aplikacji. */
check("kondycja obrazu: zrywy i odrzucone klatki mierzone w oknie czasu",
  src.indexOf('var GUARD_TICK = 1000;') > 0 &&
  src.indexOf('var GUARD_WINDOW = 90000;') > 0 &&
  src.indexOf('var GUARD_STALLS = 8;') > 0 &&
  src.indexOf('var GUARD_DROPPED = 1500;') > 0 &&
  src.indexOf('video.webkitDroppedFrameCount ? video.webkitDroppedFrameCount | 0 : 0') > 0 &&
  src.indexOf('if (state.guardStalls < GUARD_STALLS && state.guardDroppedSum < GUARD_DROPPED) return;') > 0);
check("kondycja obrazu: zryw z <video> liczy sie do kondycji",
  src.indexOf('function noteStall() {') > 0 &&
  src.indexOf('if (state.watchProgram || state.engine !== "mse") return;') > 0 &&
  src.indexOf('      noteStall();\n') > 0);
check("kondycja obrazu: strumien startuje na swiezym MSE, a nie na kolejnym sposobie",
  src.indexOf('function recycleStream() {') > 0 &&
  src.indexOf('diagNote(t("diag_recycle", { n: state.guardRecycles }));') > 0 &&
  src.indexOf('showPlayerToast(t("osd_recycle"));') > 0 &&
  src.indexOf('clearStartWatchdog();\n    destroyEngine();\n    startSourceEntry(entry);') > 0);
check("kondycja obrazu: odswiezamy tylko obraz na zywo przez MSE i tylko do limitu",
  src.indexOf('var GUARD_UPTIME = 20000;') > 0 &&
  src.indexOf('var GUARD_MAX_RECYCLES = 3;') > 0 &&
  src.indexOf('function guardLimitReached() {') > 0 &&
  src.indexOf('if (!state.watchChannel || state.watchProgram) return false;') > 0 &&
  src.indexOf('if (state.engine !== "mse") return false;') > 0 &&
  src.indexOf('return !guardLimitReached();') > 0);
check("kondycja obrazu: gdy zrywy wracaja, panel mowi o granicy odtwarzacza",
  src.indexOf('function guardGiveUp() {') > 0 &&
  src.indexOf('diagNote(t("diag_recycle_stop"));') > 0 &&
  src.indexOf('if (diagVisible()) return;\n    state.diagAutoShown = true;\n    openDiagnostics();') > 0);
check("kondycja obrazu: budzik chodzi tylko przy obrazie na zywo przez MSE",
  src.indexOf('if (entry.engine === "mse" && !state.watchProgram) startGuard();\n    else stopGuard();') > 0 &&
  src.indexOf('clearInterval(state.guardTicker);\n    state.guardTicker = null;') > 0 &&
  src.indexOf('stopGuard();\n    if (!instance) return;') > 0 &&
  src.indexOf('stopGuard();\n    /* obraz systemowy i VLC gasną razem z kanałem') > 0);
check("kondycja obrazu: nowy kanal liczy kondycje od zera",
  src.indexOf('state.guardRecycles = 0;\n    state.guardGaveUp = false;\n    stopGuard();') > 0);
check("panel diagnostyki: pokazuje pamiec interfejsu, zrywy i przestrajania",
  src.indexOf('function diagHeapMb() {') > 0 &&
  src.indexOf('memory.usedJSHeapSize / 1048576') > 0 &&
  src.indexOf('t("diag_health") + ": " + t("diag_heap")') > 0 &&
  src.indexOf('t("diag_stalls") + ": " + (state.guardStalls | 0)') > 0);
check("nowe napisy kondycji obrazu sa w obu jezykach",
  src.indexOf('diag_health: "KONDYCJA OBRAZU"') > 0 &&
  src.indexOf('diag_health: "PICTURE HEALTH"') > 0 &&
  src.indexOf('diag_stalls: "zrywy"') > 0 &&
  src.indexOf('diag_stalls: "hiccups"') > 0 &&
  src.indexOf('osd_recycle: "Przestrajanie obrazu…"') > 0 &&
  src.indexOf('osd_recycle: "Restarting the picture…"') > 0 &&
  src.indexOf('diag_recycle_stop: "zrywy wracają także na świeżym strumieniu') > 0 &&
  src.indexOf('diag_recycle_stop: "hiccups come back on a fresh stream too') > 0);
check("czytnik playlisty: kolejka odcinkow jest ograniczona (obraz wraca na zywo)",
  src.indexOf('var FEEDER_PENDING_MAX = 8;') > 0 &&
  src.indexOf('var extra = this._pending.length - FEEDER_PENDING_MAX;') > 0 &&
  src.indexOf('this._pending.splice(0, extra);') > 0 &&
  src.indexOf('diagNote(t("diag_feeder_drop", { n: extra }));') > 0 &&
  src.indexOf('diag_feeder_drop: "kolejka odcinków skrócona o {n}') > 0 &&
  src.indexOf('diag_feeder_drop: "segment queue trimmed by {n}') > 0);

/* Zachowanie strażnika, nie tylko jego obecność: z jednym kanałem 4K na żywo przez
   MSE w atrapie <video>. Atrapa ma własny zegar, bo okno zrywów liczy się z czasu. */
const guardCodeStart = src.indexOf("var GUARD_TICK = 1000;");
const guardCodeEnd = src.indexOf("/* Czy hls.js mówi wprost", guardCodeStart);
if (guardCodeStart < 0 || guardCodeEnd <= guardCodeStart) {
  throw new Error("Nie znalazlem bloku kondycji obrazu w app.js");
}
const guardCode = src.slice(guardCodeStart, guardCodeEnd);
["startGuard", "stopGuard", "noteStall", "guardLimitReached", "guardCanRecycle",
  "guardTick", "recycleStream", "guardGiveUp"].forEach(function (fn) {
  if (guardCode.indexOf("function " + fn) < 0) throw new Error("Wyciety blok kondycji nie ma " + fn);
});

function guardHarness(o) {
  o = o || {};
  const calls = { notes: [], toasts: [], started: [], destroyed: 0, opened: 0, intervals: 0, stopped: 0 };
  let clock = o.nowMs === undefined ? 1700000000000 : o.nowMs;
  let intervalFn = null;
  const video = { webkitDroppedFrameCount: o.dropped || 0 };
  const sandbox = {
    state: {
      watchChannel: o.channel === undefined ? { name: "Eleven Sports 1 4K" } : o.channel,
      watchProgram: o.program === true,
      engine: o.engine || "mse",
      /* obraz gra już od minuty — nowy obraz nie jest odświeżany (GUARD_UPTIME) */
      entryWaitStart: o.waitStart === undefined ? clock - 60000 : o.waitStart,
      sources: [{ engine: "mse", url: "http://s/live/4k.m3u8", hls: true }],
      sourceIndex: 0,
      guardTicker: null,
      guardWindowAt: clock,
      guardStalls: 0,
      guardDroppedBase: 0,
      guardDroppedSum: 0,
      guardRecycles: o.recycles | 0,
      guardGaveUp: false,
      diagAutoShown: false
    },
    t: function (key) { return "<" + key + ">"; },
    $: function (id) { return id === "video" ? video : null; },
    Date: { now: function () { return clock; } },
    setInterval: function (fn) { calls.intervals++; intervalFn = fn; return 42; },
    clearInterval: function () { calls.stopped++; },
    diagNote: function (note) { calls.notes.push(note); },
    showPlayerToast: function (text) { calls.toasts.push(text); },
    clearPictureWatchdog: function () {},
    clearStartWatchdog: function () {},
    destroyEngine: function () { calls.destroyed++; },
    startSourceEntry: function (entry) { calls.started.push(entry); },
    diagVisible: function () { return o.diagVisible === true; },
    openDiagnostics: function () { calls.opened++; }
  };
  run(guardCode, sandbox);
  return {
    api: sandbox, calls: calls, video: video,
    setNow: function (value) { clock = value; return clock; },
    /* jedna próbka budzika: tak, jak zrobiłby to setInterval (a gdy budzik nie
       wstał, wołamy próbkę wprost — testy niżej zakładają go osobno) */
    tick: function () { if (intervalFn) intervalFn(); else sandbox.guardTick(); }
  };
}

let gh = guardHarness({});
gh.tick();
check("kondycja obrazu: spokojny obraz nie jest ruszany",
  gh.calls.started.length === 0 && gh.calls.destroyed === 0 && gh.calls.opened === 0);

gh = guardHarness({});
for (let i = 0; i < 8; i++) gh.api.noteStall();
check("kondycja obrazu: zrywy licza sie do progu", gh.api.state.guardStalls === 8);
gh.tick();
check("kondycja obrazu: zrywy odswiezaja TEN SAM wpis na swiezym MSE",
  gh.calls.started.length === 1 && gh.calls.destroyed === 1 &&
  gh.calls.started[0].hls === true && gh.calls.started[0].url === "http://s/live/4k.m3u8" &&
  gh.api.state.guardRecycles === 1 && gh.api.state.guardStalls === 0 &&
  gh.calls.notes.indexOf("<diag_recycle>") >= 0 && gh.calls.toasts.indexOf("<osd_recycle>") >= 0,
  JSON.stringify({ started: gh.calls.started.length, notes: gh.calls.notes }));

/* Druga droga do tego samego wniosku: dekoder odrzuca klatki, a obraz stoi. */
gh = guardHarness({});
gh.video.webkitDroppedFrameCount = 1600;
gh.tick();
check("kondycja obrazu: klatki odrzucone przez dekoder tez odswiezaja strumien",
  gh.calls.started.length === 1 && gh.api.state.guardDroppedSum === 0);

/* Świeży obraz (pierwsze sekundy wczytywania): zrywy są, ale restart nic nie da. */
gh = guardHarness({ waitStart: 1700000000000 });
for (let i = 0; i < 8; i++) gh.api.noteStall();
gh.tick();
check("kondycja obrazu: swiezego obrazu nie odswiezamy i nie straszymy panelem",
  gh.calls.started.length === 0 && gh.calls.opened === 0 && gh.api.state.guardGaveUp === false);

/* Film z archiwum i droga sprzętowa: tam nie ma czego zwalniać. */
gh = guardHarness({ program: true });
gh.api.noteStall();
check("kondycja obrazu: film z archiwum nie liczy zrywow na zywo",
  gh.api.state.guardStalls === 0);
gh = guardHarness({ engine: "native" });
gh.api.noteStall();
gh.tick();
check("kondycja obrazu: droga sprzetowa nie jest odswiezana",
  gh.api.state.guardStalls === 0 && gh.calls.started.length === 0);

/* Limit wyczerpany: dalej już nic nie restartujemy — panel pokazuje liczby. */
gh = guardHarness({ recycles: 3 });
for (let i = 0; i < 8; i++) gh.api.noteStall();
gh.tick();
check("kondycja obrazu: po limicie odswiezen panel mowi o granicy odtwarzacza",
  gh.calls.started.length === 0 && gh.calls.opened === 1 &&
  gh.calls.notes.indexOf("<diag_recycle_stop>") >= 0 && gh.api.state.diagAutoShown === true,
  JSON.stringify(gh.calls.notes));
gh.tick();
check("kondycja obrazu: o granicy meldujemy raz, a nie co sekunde",
  gh.calls.opened === 1 && gh.calls.notes.length === 1);

/* Budzik chodzi tylko przy obrazie na żywo przez MSE — inaczej budziłby procesor
   co sekundę bez powodu (patrz startSourceEntry). */
gh = guardHarness({});
gh.api.startGuard();
check("kondycja obrazu: budzik wstaje raz i liczy okno od nowa",
  gh.calls.intervals === 1 && gh.api.state.guardStalls === 0 && gh.api.state.guardRecycles === 0);
gh.api.startGuard();
check("kondycja obrazu: drugie uruchomienie nie zaklada drugiego budzika",
  gh.calls.intervals === 1);
gh.api.stopGuard();
check("kondycja obrazu: zamkniecie obrazu gasi budzik",
  gh.calls.stopped === 1 && gh.api.state.guardTicker === null);


/* --- 27. odtwarzacz systemowy (Android: ExoPlayer pod strona) ---------------
   Kanał na żywo idzie wprost do odtwarzacza odbiornika: on rozbiera TS i HLS
   w kodzie natywnym, więc 4K nie musi przechodzić przez JavaScript i MSE (i dlatego
   nie zrywa się ani nie zabiera pamięci). Strona oddaje mu adres przez ten sam most
   co przy pilocie, a obraz rysuje się POD nią — nazwy metod i zdarzeń muszą się
   zgadzać co do znaku, bo inaczej wywołanie trafia w pustkę i kanał wraca do
   JavaScriptu, czyli do problemu, który ta droga rozwiązuje. */
check("odtwarzacz systemowy: most jest ten sam co przy pilocie i ma wszystkie metody",
  java.indexOf("\"OpenIptvNative\"") > 0 &&
  src.indexOf("window.OpenIptvNative") > 0 &&
  java.indexOf("public String playNative(final String url, final String userAgent)") > 0 &&
  java.indexOf("public void stopNative()") > 0 &&
  java.indexOf("public void setNativePlaying(final boolean playing)") > 0 &&
  java.indexOf("public void setNativeMuted(final boolean muted)") > 0 &&
  java.indexOf("public String nativeState()") > 0 &&
  java.indexOf("public String nativeInfo()") > 0 &&
  src.indexOf("bridge.playNative(entry.url, navigator.userAgent || \"\")") > 0 &&
  src.indexOf("bridge.setNativePlaying(playing !== false)") > 0 &&
  src.indexOf("bridge.setNativeMuted(muted === true)") > 0 &&
  src.indexOf("bridge.stopNative()") > 0 &&
  src.indexOf("bridge.nativeInfo()") > 0);
check("odtwarzacz systemowy: zdarzenia wracaja do strony pod ta sama nazwa",
  java.indexOf("window.__openiptvNativeEvent&&window.__openiptvNativeEvent(") > 0 &&
  src.indexOf("window.__openiptvNativeEvent = exoEvent;") > 0 &&
  src.indexOf("function exoEvent(event)") > 0 &&
  java.indexOf("onVideoSizeChanged(VideoSize size)") > 0 &&
  java.indexOf("onIsPlayingChanged(boolean playing)") > 0 &&
  java.indexOf("onPlayerError(PlaybackException error)") > 0);
check("odtwarzacz systemowy: obraz rysuje sie pod strona, wiec strona jest przezroczysta",
  java.indexOf("root.addView(videoView, 0);") > 0 &&
  java.indexOf("webView.setBackgroundColor(Color.TRANSPARENT);") > 0 &&
  src.indexOf("root.classList.toggle(\"exo-player\", want)") > 0 &&
  src.indexOf("document.body.classList.toggle(\"exo-player\", want)") > 0 &&
  css.indexOf("html.exo-player, body.exo-player { background: transparent; }") > 0 &&
  css.indexOf("body.exo-player .screen { background: transparent; }") > 0);
check("odtwarzacz systemowy: bufor na zywo krotszy niz domyslne 50 s",
  java.indexOf(".setBufferDurationsMs(8000, 24000, 1500, 4000)") > 0 &&
  java.indexOf("player.setVideoTextureView(videoView);") > 0 &&
  java.indexOf("player.setMediaItem(MediaItem.fromUri(Uri.parse(url)));") > 0 &&
  java.indexOf("setAllowCrossProtocolRedirects(true)") > 0 &&
  java.indexOf("FLAG_KEEP_SCREEN_ON") > 0);
/* Warstwa obrazu: na odbiorniku, na którym element <video> zostawał czarny, dopóki
   klatki nie poszły kompozytorem GPU (patrz „video-layer-fix” w styles.css), klatki
   ExoPlayera nie mogą iść sprzętową płaszczyzną obrazu — SurfaceView. TextureView
   prowadzi je tą samą drogą co <video>, więc obraz ma się gdzie pokazać. */
check("odtwarzacz systemowy: obraz idzie kompozytorem GPU, a nie sprzetowa plaszczyzna",
  java.indexOf("import android.view.TextureView;") > 0 &&
  java.indexOf("import android.view.SurfaceView;") < 0 &&
  java.indexOf("private TextureView videoView;") > 0 &&
  java.indexOf("videoView = new TextureView(this);") > 0 &&
  java.indexOf("videoView.setSurfaceTextureListener(") > 0 &&
  java.indexOf("player.setVideoTextureView(videoView);") > 0 &&
  java.indexOf("player.clearVideoSurface();") > 0 &&
  java.indexOf("videoView.setVisibility(View.VISIBLE);") > 0);
/* Diagnostyka musi umieć odróżnić „dekoder nie nadąża” od „klatek nie widać”:
   inaczej szukanie naprawy jest zgadywaniem (patrz nativeInfo w MainActivity). */
check("odtwarzacz systemowy: panel diagnostyki zna dekoder, klatki na obrazie i zgubione",
  java.indexOf("player.addAnalyticsListener(new AnalyticsListener()") > 0 &&
  java.indexOf("onVideoDecoderInitialized(AnalyticsListener.EventTime eventTime") > 0 &&
  java.indexOf("onDroppedVideoFrames(AnalyticsListener.EventTime eventTime") > 0 &&
  java.indexOf("public void onRenderedFirstFrame()") > 0 &&
  java.indexOf("info.put(\"decoder\", nativeDecoder);") > 0 &&
  java.indexOf("info.put(\"firstFrame\", nativeFirstFrame);") > 0 &&
  java.indexOf("info.put(\"dropped\", dropped > 0 ? dropped : 0);") > 0 &&
  src.indexOf("t(\"diag_exo_frames\")") > 0 &&
  src.indexOf("t(\"diag_exo_dropped\")") > 0 &&
  src.indexOf("diag_exo_frames: \"klatki na obrazie\"") > 0 &&
  src.indexOf("diag_exo_frames: \"frames on screen\"") > 0 &&
  src.indexOf("diag_exo_dropped: \"zgubione klatki\"") > 0 &&
  src.indexOf("diag_exo_dropped: \"dropped frames\"") > 0);
check("odtwarzacz systemowy: odtwarzacz odbiornika jest w paczce Androida (takze HLS)",
  gradle.indexOf("androidx.media3:media3-exoplayer:$media3Version") > 0 &&
  gradle.indexOf("androidx.media3:media3-exoplayer-hls:$media3Version") > 0 &&
  gradleVars.indexOf("media3Version = '1.4.1'") > 0);
check("odtwarzacz systemowy: bez mostu (webOS, przegladarka) droga jest pomijana",
  src.indexOf("function exoBridge() {") > 0 &&
  src.indexOf("if (!platformInfo.native) return null;") > 0 &&
  src.indexOf("if (!bridge || typeof bridge.playNative !== \"function\") return null;") > 0);
check("odtwarzacz systemowy: domyslnie wylaczony — wlacza go przełącznik w ustawieniach",
  src.indexOf("nativePlayer: false,") > 0 &&
  src.indexOf("if (settings.nativePlayer === true && exoBridge()) {") > 0 &&
  html.indexOf('id="nativePlayer"') > 0 &&
  src.indexOf("$(\"nativePlayer\").checked = settings.nativePlayer === true;") > 0 &&
  src.indexOf("settings.nativePlayer = $(\"nativePlayer\").checked;") > 0 &&
  src.indexOf("native_player: \"Odtwarzacz systemowy (beta)") > 0 &&
  src.indexOf("native_player: \"System player (beta)") > 0);
check("odtwarzacz systemowy: panel diagnostyki pokazuje odtwarzacz odbiornika i jego HEVC",
  src.indexOf("function exoInfo() {") > 0 &&
  src.indexOf("var native = exoInfo();") > 0 &&
  src.indexOf("t(\"diag_native_player\")") > 0 &&
  src.indexOf("diag_native_player: \"odtwarzacz systemowy (ExoPlayer)\"") > 0 &&
  src.indexOf("diag_native_player: \"system player (ExoPlayer)\"") > 0 &&
  java.indexOf("MediaCodec.createDecoderByType(\"video/hevc\")") > 0);
check("odtwarzacz systemowy: nowe napisy sa w obu jezykach",
  src.indexOf("engine_exo: \"odtwarzacz systemowy\"") > 0 &&
  src.indexOf("engine_exo: \"system player\"") > 0 &&
  src.indexOf("diag_exo: \"obraz systemowy\"") > 0 &&
  src.indexOf("diag_exo: \"system picture\"") > 0 &&
  src.indexOf("diag_exo_start: \"oddaję kanał odtwarzaczowi systemowemu\"") > 0 &&
  src.indexOf("diag_exo_start: \"handing the channel to the system player\"") > 0);

/* --- 27b. silnik VLC (libVLC): trzecia droga obrazu -------------------------
   Ten sam pomysł co odtwarzacz systemowy, ale inny silnik: libVLC ma własny
   demukser TS/HLS i oddaje obraz przez TextureView, czyli tą samą drogą, którą
   idą klatki pozostałych odtwarzaczy. Włączany ręcznie, tylko na kanale na żywo,
   i tylko wtedy, gdy most istnieje; gdy nie da obrazu, kolejka idzie dalej. */
check("VLC: silnik jest w paczce Androida (biblioteki tylko dla ABI telewizorow)",
  gradle.indexOf("org.videolan.android:libvlc-all:$libvlcVersion") > 0 &&
  gradleVars.indexOf("libvlcVersion = '3.6.5'") > 0 &&
  gradleVars.indexOf("libvlcAbiFilters = ['arm64-v8a', 'armeabi-v7a']") > 0 &&
  gradle.indexOf("for (abi in rootProject.ext.libvlcAbiFilters)") > 0 &&
  gradle.indexOf("useLegacyPackaging true") > 0);
check("VLC: droge obrazu wybiera powierzchnia (TextureView), a nie kopiowanie klatek",
  javaVlc.indexOf("import org.videolan.libvlc.util.VLCVideoLayout;") > 0 &&
  javaVlc.indexOf("player.attachViews(layout, null, false, useTexture);") > 0 &&
  /* Renderowania wprost nie wolno wylaczac: to ta droga zatrzymywala obraz na
     jednej klatce przy grajacym dzwieku na kazdym kanale (blad zgloszony z 2.1.9).
     Nazwa opcji moze wystapic w komentarzu, wiec pytamy o samo wywolanie. */
  javaVlc.indexOf("options.add(\"--no-mediacodec-dr\");") < 0 &&
  /* Warstwa widoczna, zanim powstanie jej powierzchnia: inaczej powierzchnia
     powstaje dopiero przy nastepnym wejsciu na kanal (patrz startNative). */
  javaVlc.indexOf("layout.setVisibility(View.VISIBLE);") > 0 &&
  javaVlc.indexOf("layout.setVisibility(View.VISIBLE);") <
    javaVlc.indexOf("player.attachViews(layout, null, false, useTexture);") &&
  javaVlc.indexOf("root.addView(layout, 0);") > 0 &&
  javaVlc.indexOf("webView.setBackgroundColor(Color.TRANSPARENT);") > 0);
check("VLC: sprzetowy dekoder wymagany (programowe 4K to slepa ulica)",
  javaVlc.indexOf("media.setHWDecoderEnabled(true, true);") > 0 &&
  javaVlc.indexOf("options.add(\"--avcodec-hw=mediacodec\");") > 0);
check("VLC: panel diagnostyki ma liczby, ktorych nie ma droga systemowa",
  javaVlc.indexOf("stats.lostPictures") > 0 &&
  javaVlc.indexOf("stats.displayedPictures") > 0 &&
  javaVlc.indexOf("stats.demuxCorrupted") > 0 &&
  javaVlc.indexOf("stats.demuxBitrate") > 0 &&
  javaVlc.indexOf("case MediaPlayer.Event.Vout:") > 0 &&
  javaVlc.indexOf("IMedia.Stats stats = media != null ? media.getStats() : null;") > 0);
/* Klatki na sekunde i zatrzymany obraz: dopiero te liczby odrozniaja obraz zywy od
   zatrzymanego na jednej klatce, a silnik ma oddac kanal kolejce, gdy klatki
   przestana dochodzic (patrz countFrames w VlcEngine i vlcEvent w app.js). */
check("VLC: klatki na sekunde, licznik powierzchni obrazu i zatrzymany obraz",
  javaVlc.indexOf("private static final int STALL_TICKS = 10;") > 0 &&
  javaVlc.indexOf("private void countFrames() {") > 0 &&
  javaVlc.indexOf("private void watchSurfaceFrames() {") > 0 &&
  javaVlc.indexOf("public void onSurfaceTextureUpdated(SurfaceTexture surface) {") > 0 &&
  javaVlc.indexOf("info.put(\"fps\", fps);") > 0 &&
  javaVlc.indexOf("info.put(\"texFrames\", texFrames);") > 0 &&
  javaVlc.indexOf("info.put(\"stalled\", stalled);") > 0 &&
  javaVlc.indexOf("emit(\"stalled\", null, width, height);") > 0 &&
  src.indexOf("function vlcFps(vlc) {") > 0 &&
  src.indexOf("diag_vlc_fps: \"klatki na sekundę\"") > 0 &&
  src.indexOf("diag_vlc_fps: \"frames per second\"") > 0 &&
  src.indexOf("diag_stall: \"obraz stanął — klatki przestały dochodzić\"") > 0 &&
  src.indexOf("diag_stall: \"picture stopped — frames stopped arriving\"") > 0);
check("VLC: most ma te same zadania, co droga systemowa",
  java.indexOf("public String playVlc(final String url, final String userAgent, final boolean textureView)") > 0 &&
  java.indexOf("public void stopVlc()") > 0 &&
  java.indexOf("public void setVlcPlaying(final boolean playing)") > 0 &&
  java.indexOf("public void setVlcMuted(final boolean muted)") > 0 &&
  java.indexOf("public String vlcInfo()") > 0 &&
  java.indexOf("window.__openiptvVlcEvent&&window.__openiptvVlcEvent(") > 0 &&
  java.indexOf("initVlcEngine();") > 0);
check("VLC: domyslnie wlaczony — droga obrazu, a przelacznik ja wylacza",
  src.indexOf("vlcPlayer: true,") > 0 &&
  src.indexOf("if (schema < 5) {\n      stored.vlcPlayer = true;\n    }") > 0 &&
  src.indexOf("vlcTexture: true,") > 0 &&
  src.indexOf("if (settings.vlcPlayer === true && vlcBridge()) {") > 0 &&
  html.indexOf('id="vlcPlayer"') > 0 &&
  html.indexOf('id="vlcTexture"') > 0 &&
  src.indexOf('$("vlcPlayer").checked = settings.vlcPlayer === true;') > 0 &&
  src.indexOf('settings.vlcPlayer = $("vlcPlayer").checked;') > 0 &&
  src.indexOf("vlc_player: \"VLC player (recommended)") > 0 &&
  src.indexOf("vlc_texture: \"VLC: picture through the picture surface (TextureView)") > 0 &&
  src.indexOf("vlc_player: \"Odtwarzacz VLC (zalecany)") > 0 &&
  src.indexOf("vlc_texture: \"VLC: obraz przez powierzchnię obrazu (TextureView)") > 0);
check("VLC: bez mostu (webOS, przegladarka) droga jest pomijana",
  src.indexOf("function vlcBridge() {") > 0 &&
  src.indexOf("if (!bridge || typeof bridge.playVlc !== \"function\") return null;") > 0 &&
  java.indexOf("if (vlcEngine == null || !VlcEngine.available()) return \"error: brak silnika\";") > 0);
check("VLC: nowe napisy sa w obu jezykach",
  src.indexOf("engine_vlc: \"VLC player\"") > 0 &&
  src.indexOf("engine_vlc: \"odtwarzacz VLC\"") > 0 &&
  src.indexOf("diag_vlc: \"VLC picture\"") > 0 &&
  src.indexOf("diag_vlc: \"obraz VLC\"") > 0 &&
  src.indexOf("diag_vlc_start: \"handing the channel to the VLC engine\"") > 0 &&
  src.indexOf("diag_vlc_start: \"oddaję kanał silnikowi VLC\"") > 0 &&
  src.indexOf("diag_vlc_native: \"VLC player (libVLC)\"") > 0 &&
  src.indexOf("diag_vlc_native: \"odtwarzacz VLC (libVLC)\"") > 0 &&
  src.indexOf("diag_vlc_lost: \"dropped frames\"") > 0 &&
  src.indexOf("diag_vlc_lost: \"zgubione klatki\"") > 0);
check("VLC: wspolna warstwa obu silnikow (pasek, pauza, wyciszenie)",
  src.indexOf("function nativeLayerActive() {") > 0 &&
  src.indexOf("return exoActive() || vlcActive();") > 0 &&
  src.indexOf("function nativeSetPlaying(playing) {") > 0 &&
  src.indexOf("function nativeSetMuted(muted) {") > 0 &&
  src.indexOf("if (entry.engine === \"vlc\") startVlcSource(entry);") > 0 &&
  src.indexOf("if (entry.engine !== \"exo\" && entry.engine !== \"vlc\") {") > 0);

/* Zegar obrazu i przewijanie nagrania: catch-up kanalu 4K idzie silnikiem (drogi
   przegladarki nie daja tam obrazu), a obraz VLC nie ma elementu <video> — pozycja
   i dlugosc okna musza przyjsc z mostu, a skok o krok jego metoda (patrz emitClock
   i setTime w VlcEngine oraz vlcEvent, vlcSeek i seekArchiveHardware w app.js). */
check("VLC: most przekazuje pozycje i dlugosc okna oraz przyjmuje skok o krok",
  java.indexOf("public void setVlcTime(final long ms)") > 0 &&
  java.indexOf("vlcEngine.setTime(ms);") > 0 &&
  javaVlc.indexOf("void setTime(long ms) {") > 0 &&
  javaVlc.indexOf("player.setTime(Math.max(0, ms));") > 0 &&
  javaVlc.indexOf("private void emitClock() {") > 0 &&
  javaVlc.indexOf("if (time >= clockTime && time - clockTime < 250 && length == clockLength) return;") > 0 &&
  javaVlc.indexOf("case MediaPlayer.Event.TimeChanged:") > 0 &&
  javaVlc.indexOf("case MediaPlayer.Event.LengthChanged:") > 0 &&
  javaVlc.indexOf("event.put(\"type\", \"time\");") > 0 &&
  javaVlc.indexOf("event.put(\"time\", time);") > 0 &&
  javaVlc.indexOf("if (length > 0) event.put(\"length\", length);") > 0);
check("VLC: archiwum idzie silnikiem, a skok o krok jego zegarem",
  src.indexOf("function vlcSeek(ms) {") > 0 &&
  src.indexOf("bridge.setVlcTime(target);") > 0 &&
  src.indexOf("if (type === \"time\") {") > 0 &&
  src.indexOf("state.vlcLength = event.length | 0;") > 0 &&
  src.indexOf("if (state.isArchive && vlcActive() && state.vlcLength > 0) {") > 0 &&
  src.indexOf("function seekArchiveHardware(direction, step) {") > 0 &&
  src.indexOf("if (nativeLayerActive()) {\n      seekArchiveHardware(direction, step);") > 0 &&
  src.indexOf("return preferEngine(hardware.concat(browser), settings.engineHint);") > 0 &&
  src.indexOf("function archiveProgramSeconds() {") > 0);

/* Zachowanie drogi natywnej, nie tylko obecność kodu: atrapa mostu (Java) + atrapa
   elementu <video>, którą droga natywna gasi. Zegar i budziki w rękach testu. */
const exoStart = src.indexOf("var EXO_START_WAIT = 9000;");
const exoEnd = src.indexOf("/* Kolejka prób dla kanału.", exoStart);
if (exoStart < 0 || exoEnd <= exoStart) throw new Error("Nie znalazlem bloku odtwarzacza systemowego w app.js");
const exoCode = src.slice(exoStart, exoEnd);
["exoBridge", "exoInfo", "exoActive", "markExoMode", "clearVideoQuietly", "exoPlay",
  "exoVolume", "startExoSource", "stopExo", "exoEvent", "armExoWatchdog"].forEach(function (fn) {
  if (exoCode.indexOf("function " + fn) < 0) {
    throw new Error("Wyciety blok odtwarzacza systemowego nie ma " + fn);
  }
});

function exoHarness(o) {
  o = o || {};
  const calls = { errors: [], notes: [], played: [], playCalls: [], muted: [], stopped: 0, timers: [] };
  const classes = { html: [], body: [] };
  const toggle = function (list, name, on) {
    const at = list.indexOf(name);
    if (on && at < 0) list.push(name);
    if (!on && at >= 0) list.splice(at, 1);
  };
  /* atrapa mostu: app.js woła dokładnie te same metody, co prawdziwa Java */
  const bridge = {
    playNative: function (url, ua) { calls.played.push({ url: url, ua: ua }); return o.playResult || "ok"; },
    stopNative: function () { calls.stopped++; },
    setNativePlaying: function (playing) { calls.playCalls.push(playing); },
    setNativeMuted: function (muted) { calls.muted.push(muted); },
    nativeState: function () { return "{\"type\":\"idle\"}"; },
    nativeInfo: function () { return o.info === undefined ? "{\"media3\":\"1.4.1\",\"api\":34,\"hevc\":true}" : o.info; }
  };
  const video = {
    pause: function () { calls.videoPaused = true; },
    removeAttribute: function () { calls.videoCleared = true; },
    load: function () {}
  };
  const sandbox = {
    platformInfo: { native: o.native !== false, os: "androidtv" },
    navigator: { userAgent: "UA-4K" },
    state: {
      engine: o.engine || "exo",
      engineToken: 3,
      watchChannel: o.noChannel === true ? null : { name: "Eleven Sports 1 4K" },
      watchProgram: null,
      engineLoading: true,
      engineInstance: null,
      exoPlaying: o.playing === true,
      exoWidth: o.width | 0,
      exoHeight: o.height | 0,
      exoMuted: o.muted === true,
      exoPictureWaited: false,
      watchStart: 0,
      startTimer: null
    },
    t: function (key) { return "<" + key + ">"; },
    $: function (id) {
      if (id === "video") return video;
      return { classList: { add: function () {}, remove: function () {} }, textContent: "" };
    },
    document: {
      documentElement: { classList: { toggle: function (name, on) { toggle(classes.html, name, on); } } },
      body: { classList: { toggle: function (name, on) { toggle(classes.body, name, on); } } }
    },
    OpenIptvNative: o.noBridge === true ? {} : bridge,
    /* token bierzemy z tego samego stanu, co atrapa: budzik porównuje go ze sobą */
    nextEngineToken: function () { return sandbox.state.engineToken; },
    engineName: function (engine) {
      return "<engine_" + (engine === "exo" || engine === "mse" || engine === "hls" ? engine : "native") + ">";
    },
    handlePlaybackError: function (message) { calls.errors.push(message); },
    diagNote: function (note) { calls.notes.push(note); },
    noteStreamActivity: function () {},
    scheduleRecentRecord: function () {},
    updateOsd: function () {},
    scheduleOsdHide: function () {},
    clearStartWatchdog: function () { sandbox.state.startTimer = null; },
    setTimeout: function (fn) { calls.timers.push(fn); return calls.timers.length; },
    clearTimeout: function () {}
  };
  /* window to ten sam obiekt co zbiór zmiennych globalnych: tak działa i most, i
     zdarzenie window.__openiptvNativeEvent, które app.js na nim zapisuje */
  sandbox.window = sandbox;
  run(exoCode, sandbox);
  return {
    api: sandbox, calls: calls, classes: classes,
    /* wywołanie budzika czekającego w kolejce (jakby minął czas) */
    fire: function () {
      const queued = calls.timers.splice(0);
      queued.forEach(function (fn) { fn(); });
      return queued.length;
    }
  };
}

let xh = exoHarness({});
xh.api.startExoSource({ engine: "exo", url: "http://s/live/4k.m3u8" });
check("odtwarzacz systemowy: adres kanalu idzie do mostu razem z identyfikatorem przegladarki",
  xh.calls.played.length === 1 && xh.calls.played[0].url === "http://s/live/4k.m3u8" &&
  xh.calls.played[0].ua === "UA-4K" && xh.calls.errors.length === 0,
  JSON.stringify(xh.calls.played));
check("odtwarzacz systemowy: droga natywna gasi <video> i wlacza przezroczystosc strony",
  xh.calls.videoPaused === true && xh.calls.videoCleared === true &&
  xh.classes.html.indexOf("exo-player") >= 0 && xh.classes.body.indexOf("exo-player") >= 0 &&
  xh.api.state.engine === "exo" && xh.api.state.engineLoading === true);
check("odtwarzacz systemowy: start uzbraja budzik i melduje sie w diagnozie",
  xh.calls.timers.length === 1 && xh.calls.notes.indexOf("<diag_exo_start>") >= 0);

/* Nic nie ruszyło w czasie startu: kanał wraca do kolejki (MSE/HLS), a nie zostaje
   na czarnym ekranie. */
xh.fire();
check("odtwarzacz systemowy: brak obrazu w czasie startu oddaje kanal kolejce",
  xh.calls.errors.length === 1 && xh.calls.errors[0].indexOf("<engine_exo>") > 0,
  JSON.stringify(xh.calls.errors));

/* Ruszyło i są klatki: budzik nie ma już nic do roboty. */
xh = exoHarness({});
xh.api.startExoSource({ engine: "exo", url: "http://s/live/4k.m3u8" });
xh.api.exoEvent({ type: "size", width: 3840, height: 2160 });
xh.api.exoEvent({ type: "playing" });
xh.fire();
check("odtwarzacz systemowy: obraz jest (4K) — budzik nic nie robi",
  xh.calls.errors.length === 0 && xh.api.state.exoWidth === 3840);

/* Ruszyło, ale klatek nie ma: jeden oddech na obraz, potem kolejka. */
xh = exoHarness({});
xh.api.startExoSource({ engine: "exo", url: "http://s/live/4k.m3u8" });
xh.api.exoEvent({ type: "playing" });
xh.fire();
check("odtwarzacz systemowy: dzwiek bez klatek dostaje jeszcze jedna probe",
  xh.calls.errors.length === 0 && xh.api.state.exoPictureWaited === true && xh.calls.timers.length === 1,
  JSON.stringify({ errors: xh.calls.errors, timers: xh.calls.timers.length }));
xh.fire();
check("odtwarzacz systemowy: dzwiek bez klatek (takze tu) oddaje kanal kolejce",
  xh.calls.errors.length === 1 && xh.calls.errors[0].indexOf("<err_no_picture>") > 0,
  JSON.stringify(xh.calls.errors));

/* Zdarzenia z mostu trzymają ten sam stan, co zdarzenia <video> na innych drogach. */
xh = exoHarness({});
xh.api.startExoSource({ engine: "exo", url: "http://s/live/4k.m3u8" });
xh.api.exoEvent({ type: "size", width: 3840, height: 2160 });
xh.api.exoEvent({ type: "playing" });
check("odtwarzacz systemowy: zdarzenie mostu mowi, ze obraz leci i jaka ma klatke",
  xh.api.state.exoPlaying === true && xh.api.state.engineLoading === false &&
  xh.api.state.exoWidth === 3840 && xh.api.state.exoHeight === 2160);
xh.api.exoEvent({ type: "paused" });
check("odtwarzacz systemowy: pauza z mostu gasi stan obrazu", xh.api.state.exoPlaying === false);
xh.api.exoEvent({ type: "error", message: "brak kodeka" });
check("odtwarzacz systemowy: blad mostu oddaje kanal kolejce (z powodem)",
  xh.calls.errors.length === 1 && xh.calls.errors[0].indexOf("brak kodeka") > 0,
  JSON.stringify(xh.calls.errors));

/* Pauza i wyciszenie idą mostem, a nie elementem <video>. */
xh = exoHarness({ playing: true });
xh.api.startExoSource({ engine: "exo", url: "http://s/live/4k.m3u8" });
xh.api.exoVolume(true);
xh.api.exoPlay(false);
check("odtwarzacz systemowy: wyciszenie i pauza ida mostem",
  xh.calls.muted.join(",") === "true" && xh.calls.playCalls.join(",") === "false" &&
  xh.api.exoActive() === true);
xh.api.stopExo();
check("odtwarzacz systemowy: zamkniecie obrazu gasi odtwarzacz i zdejmuje przezroczystosc",
  xh.calls.stopped === 1 && xh.api.state.exoPlaying === false &&
  xh.classes.html.indexOf("exo-player") < 0 && xh.classes.body.indexOf("exo-player") < 0);

/* Most, którego nie ma (webOS, przeglądarka, starsza paczka) — kanał idzie dalej. */
xh = exoHarness({ native: false });
xh.api.startExoSource({ engine: "exo", url: "http://s/live/4k.m3u8" });
check("odtwarzacz systemowy: bez mostu kanal idzie kolejna droga (bez wywolania)",
  xh.api.exoBridge() === null && xh.calls.played.length === 0 && xh.calls.errors.length === 1);
xh = exoHarness({ noBridge: true });
check("odtwarzacz systemowy: starsza paczka bez playNative tez jest pomijana",
  xh.api.exoBridge() === null);
xh = exoHarness({ playResult: "error: brak adresu" });
xh.api.startExoSource({ engine: "exo", url: "" });
check("odtwarzacz systemowy: odmowa mostu konczy probe z powodem",
  xh.calls.played.length === 1 && xh.calls.errors.length === 1 &&
  xh.calls.errors[0].indexOf("error: brak adresu") > 0, JSON.stringify(xh.calls.errors));

/* Rozpoznanie odtwarzacza odbiornika (panel diagnostyki). */
xh = exoHarness({});
check("odtwarzacz systemowy: panel czyta z mostu wersje i sprzetowy HEVC",
  xh.api.exoInfo() !== null && xh.api.exoInfo().media3 === "1.4.1" &&
  xh.api.exoInfo().hevc === true);
xh = exoHarness({ info: "" });
check("odtwarzacz systemowy: brak odpowiedzi mostu nie psuje panelu", xh.api.exoInfo() === null);

/* --- 27c. silnik VLC: zachowanie, nie tylko obecnosc kodu ------------------
   Atrapa mostu (Java) + atrapa <video>, ktora droga natywna gasi. Budziki
   w rekach testu, tak samo jak przy odtwarzaczu systemowym. Kod wycinamy
   z app.js (nie kopiujemy); markExoMode i clearVideoQuietly naleza do bloku
   odtwarzacza systemowego, wiec w atrapie robia to samo. */
const vlcStart = src.indexOf("var VLC_START_WAIT = 9000;");
const vlcQueueAt = src.indexOf("function buildSourceQueue(primaryUrl)", vlcStart);
const vlcEnd = src.lastIndexOf("\n  }", vlcQueueAt) + 4;
if (vlcStart < 0 || vlcQueueAt <= vlcStart || vlcEnd <= vlcStart) {
  throw new Error("Nie znalazlem bloku odtwarzacza VLC w app.js");
}
const vlcCode = src.slice(vlcStart, vlcEnd);
["vlcBridge", "vlcInfo", "vlcActive", "vlcPlay", "vlcVolume", "vlcSeek", "startVlcSource",
  "stopVlc", "vlcEvent", "armVlcWatchdog"].forEach(function (fn) {
  if (vlcCode.indexOf("function " + fn) < 0) {
    throw new Error("Wyciety blok odtwarzacza VLC nie ma " + fn);
  }
});

function vlcHarness(o) {
  o = o || {};
  const calls = { errors: [], notes: [], played: [], playing: [], muted: [], times: [], stopped: 0, timers: [] };
  const classes = { html: [], body: [] };
  const toggle = function (list, name, on) {
    const at = list.indexOf(name);
    if (on && at < 0) list.push(name);
    if (!on && at >= 0) list.splice(at, 1);
  };
  /* atrapa mostu: app.js wola dokladnie te same metody, co prawdziwa Java */
  const bridge = {
    playVlc: function (url, ua, texture) {
      calls.played.push({ url: url, ua: ua, texture: texture });
      return o.playResult || "ok";
    },
    stopVlc: function () { calls.stopped++; },
    setVlcPlaying: function (playing) { calls.playing.push(playing); },
    setVlcMuted: function (muted) { calls.muted.push(muted); },
    setVlcTime: function (ms) { calls.times.push(ms); },
    vlcInfo: function () {
      return o.info === undefined
        ? "{\"libvlc\":\"3.6.5\",\"api\":34,\"texture\":true,\"decoder\":\"hevc\",\"firstFrame\":true,\"lost\":3,\"bitrate\":8200}"
        : o.info;
    }
  };
  const video = {
    pause: function () { calls.videoPaused = true; },
    removeAttribute: function () { calls.videoCleared = true; },
    load: function () {}
  };
  const sandbox = {
    platformInfo: { native: o.native !== false, os: "androidtv" },
    navigator: { userAgent: "UA-4K" },
    settings: { vlcTexture: o.texture !== false },
    state: {
      engine: o.engine || "vlc",
      engineToken: 7,
      watchChannel: o.noChannel === true ? null : { name: "Eleven Sports 1 4K" },
      watchProgram: null,
      engineLoading: true,
      engineInstance: null,
      vlcPlaying: o.playing === true,
      vlcWidth: o.width | 0,
      vlcHeight: o.height | 0,
      vlcMuted: o.muted === true,
      vlcFirstFrame: o.firstFrame === true,
      vlcPictureWaited: false,
      /* zegar obrazu (pozycja i dlugosc okna nagrania) — patrz vlcEvent */
      vlcTime: o.time | 0,
      vlcLength: o.length | 0,
      watchStart: 0,
      startTimer: null
    },
    t: function (key) { return "<" + key + ">"; },
    $: function (id) {
      if (id === "video") return video;
      return { classList: { add: function () {}, remove: function () {} }, textContent: "" };
    },
    document: {
      documentElement: { classList: { toggle: function (name, on) { toggle(classes.html, name, on); } } },
      body: { classList: { toggle: function (name, on) { toggle(classes.body, name, on); } } }
    },
    OpenIptvNative: o.noBridge === true ? {} : bridge,
    nextEngineToken: function () { return sandbox.state.engineToken; },
    engineName: function (engine) { return "<engine_" + engine + ">"; },
    handlePlaybackError: function (message) { calls.errors.push(message); },
    diagNote: function (note) { calls.notes.push(note); },
    noteStreamActivity: function () {},
    scheduleRecentRecord: function () {},
    updateOsd: function () {},
    scheduleOsdHide: function () {},
    clearStartWatchdog: function () { sandbox.state.startTimer = null; },
    setTimeout: function (fn) { calls.timers.push(fn); return calls.timers.length; },
    clearTimeout: function () {},
    /* przezroczystosc strony i zgaszenie <video> — to samo, co robi blok
       odtwarzacza systemowego (patrz markExoMode i clearVideoQuietly w app.js) */
    markExoMode: function (on) {
      const want = on !== false;
      toggle(classes.html, "exo-player", want);
      toggle(classes.body, "exo-player", want);
    },
    clearVideoQuietly: function () {
      calls.videoPaused = true;
      calls.videoCleared = true;
    }
  };
  sandbox.window = sandbox;
  run(vlcCode, sandbox);
  return {
    api: sandbox, calls: calls, classes: classes,
    fire: function () {
      const queued = calls.timers.splice(0);
      queued.forEach(function (fn) { fn(); });
      return queued.length;
    }
  };
}

let vh = vlcHarness({});
vh.api.startVlcSource({ engine: "vlc", url: "http://s/live/4k.ts" });
check("VLC: adres kanalu idzie do mostu razem z droga obrazu z ustawien",
  vh.calls.played.length === 1 && vh.calls.played[0].url === "http://s/live/4k.ts" &&
  vh.calls.played[0].ua === "UA-4K" && vh.calls.played[0].texture === true &&
  vh.calls.videoCleared === true && vh.api.vlcActive() === true);
check("VLC: obraz rysuje sie pod strona, wiec strona jest na ten czas przezroczysta",
  vh.classes.html.indexOf("exo-player") >= 0 && vh.classes.body.indexOf("exo-player") >= 0);
vh = vlcHarness({ texture: false });
vh.api.startVlcSource({ engine: "vlc", url: "http://s/live/4k.ts" });
check("VLC: przelacznik drogi obrazu idzie do mostu (wprost na plaszczyzne obrazu)",
  vh.calls.played.length === 1 && vh.calls.played[0].texture === false);

/* Zdarzenia z mostu trzymaja ten sam stan, co zdarzenia <video> na innych drogach. */
vh = vlcHarness({});
vh.api.startVlcSource({ engine: "vlc", url: "http://s/live/4k.ts" });
vh.api.vlcEvent({ type: "size", width: 3840, height: 2160 });
vh.api.vlcEvent({ type: "playing" });
check("VLC: zdarzenie mostu mowi, ze obraz leci, jaka ma klatke i ze doszla na obraz",
  vh.api.state.vlcPlaying === true && vh.api.state.engineLoading === false &&
  vh.api.state.vlcWidth === 3840 && vh.api.state.vlcHeight === 2160 &&
  vh.api.state.vlcFirstFrame === true);
vh.api.vlcEvent({ type: "paused" });
check("VLC: pauza z mostu gasi stan obrazu", vh.api.state.vlcPlaying === false);
vh.api.vlcEvent({ type: "error", message: "brak kodeka" });
check("VLC: blad mostu oddaje kanal kolejce (z powodem)",
  vh.calls.errors.length === 1 && vh.calls.errors[0].indexOf("brak kodeka") > 0,
  JSON.stringify(vh.calls.errors));

/* Obraz stanal: klatki przestaly dochodzic, a silnik dalej twierdzi, ze gra.
   Kanal wraca do kolejki, zamiast trzymac jedna klatke do konca meczu (patrz
   countFrames w VlcEngine i vlcEvent w app.js). */
vh = vlcHarness({});
vh.api.startVlcSource({ engine: "vlc", url: "http://s/live/4k.ts" });
vh.api.vlcEvent({ type: "playing" });
vh.api.vlcEvent({ type: "stalled" });
check("VLC: zatrzymany obraz oddaje kanal kolejce (z powodem)",
  vh.calls.errors.length === 1 && vh.calls.errors[0].indexOf("<diag_stall>") > 0,
  JSON.stringify(vh.calls.errors));
check("VLC: panel wie, ze obraz stanal",
  vh.api.state.vlcStalled === true && vh.calls.notes.join(",").indexOf("diag_stall") >= 0);

/* Budzik: dzwiek gra, a klatek nie ma — kanal nie moze zostac na czarnym ekranie. */
vh = vlcHarness({});
vh.api.startVlcSource({ engine: "vlc", url: "http://s/live/4k.ts" });
vh.api.vlcEvent({ type: "playing" });
vh.fire();
vh.fire();
check("VLC: dzwiek bez klatki po budzetach oddaje kanal kolejce",
  vh.calls.errors.length === 1 && vh.calls.errors[0].indexOf("<err_no_picture>") > 0,
  JSON.stringify(vh.calls.errors));

/* Pauza i wyciszenie ida mostem, a nie elementem <video>. */
vh = vlcHarness({ playing: true });
vh.api.startVlcSource({ engine: "vlc", url: "http://s/live/4k.ts" });
vh.api.vlcVolume(true);
vh.api.vlcPlay(false);
check("VLC: wyciszenie i pauza ida mostem",
  vh.calls.muted.join(",") === "true" && vh.calls.playing.join(",") === "false" &&
  vh.api.vlcActive() === true);
vh.api.stopVlc();
check("VLC: zamkniecie obrazu gasi silnik i zdejmuje przezroczystosc",
  vh.calls.stopped === 1 && vh.api.state.vlcPlaying === false &&
  vh.classes.html.indexOf("exo-player") < 0 && vh.classes.body.indexOf("exo-player") < 0);

/* Zegar obrazu: pozycja i dlugosc okna nagrania przychodza z mostu, a skok o krok
   (⏪/⏩) idzie jego metoda. Bez tego catch-up na drodze VLC mial obraz, ale bez
   paska odtwarzania i bez przewijania (patrz vlcEvent, vlcSeek, seekBy). */
vh = vlcHarness({ playing: true });
vh.api.startVlcSource({ engine: "vlc", url: "http://s/catchup/4k.ts" });
vh.api.vlcEvent({ type: "time", time: 42000, length: 5400000 });
check("VLC: pozycja i dlugosc okna nagrania przychodza z mostu",
  vh.api.state.vlcTime === 42000 && vh.api.state.vlcLength === 5400000,
  JSON.stringify({ time: vh.api.state.vlcTime, length: vh.api.state.vlcLength }));
vh.api.vlcEvent({ type: "time", time: 50000 });
check("VLC: zdarzenie bez dlugosci nie kasuje znanego okna nagrania",
  vh.api.state.vlcTime === 50000 && vh.api.state.vlcLength === 5400000);
check("VLC: skok o krok idzie metoda mostu i rusza paskiem od razu",
  vh.api.vlcSeek(19000) === true && vh.calls.times.join(",") === "19000" &&
  vh.api.state.vlcTime === 19000, JSON.stringify(vh.calls.times));
vh.api.vlcEvent({ type: "time", time: -5 });
check("VLC: pozycja z silnika nie schodzi ponizej zera", vh.api.state.vlcTime === 0);
check("VLC: skok w tyl tez idzie do mostu (ujemna pozycja przycieta do zera)",
  vh.api.vlcSeek(-3000) === true && vh.calls.times.join(",") === "19000,0",
  JSON.stringify(vh.calls.times));
vh.api.stopVlc();
check("VLC: zamkniecie obrazu zeruje zegar silnika",
  vh.api.state.vlcTime === 0 && vh.api.state.vlcLength === 0);
vh = vlcHarness({ noBridge: true });
check("VLC: bez mostu nie ma czym przewijac (skok zglasza porazke)",
  vh.api.vlcSeek(5000) === false);

/* Most, ktorego nie ma (webOS, przegladarka, paczka bez bibliotek VLC dla tej ABI). */
vh = vlcHarness({ noBridge: true });
vh.api.startVlcSource({ engine: "vlc", url: "http://s/live/4k.ts" });
check("VLC: bez mostu kanal idzie kolejna droga (bez wywolania)",
  vh.api.vlcBridge() === null && vh.calls.played.length === 0 && vh.calls.errors.length === 1);
vh = vlcHarness({ playResult: "error: brak silnika" });
vh.api.startVlcSource({ engine: "vlc", url: "http://s/live/4k.ts" });
check("VLC: odmowa mostu konczy probe z powodem",
  vh.calls.played.length === 1 && vh.calls.errors.length === 1 &&
  vh.calls.errors[0].indexOf("error: brak silnika") > 0, JSON.stringify(vh.calls.errors));

/* Rozpoznanie silnika (panel diagnostyki): to ono ma rozstrzygnac, czy brak obrazu
   to wina dekodera, warstwy obrazu, czy samego strumienia (patrz diag_vlc_*). */
vh = vlcHarness({});
check("VLC: panel czyta z mostu wersje silnika, droge obrazu i zgubione klatki",
  vh.api.vlcInfo() !== null && vh.api.vlcInfo().libvlc === "3.6.5" &&
  vh.api.vlcInfo().texture === true && vh.api.vlcInfo().lost === 3);
vh = vlcHarness({ info: "" });
check("VLC: brak odpowiedzi mostu nie psuje panelu", vh.api.vlcInfo() === null);

/* Wspolna warstwa obu silnikow: pasek odtwarzacza pyta o jedno, nie o dwa. */
xh = exoHarness({ playing: true });
check("pasek odtwarzacza: pauza i wyciszenie pytaja o oba silniki odbiornika",
  xh.api.nativeLayerActive() === true && xh.api.nativePlaying() === true &&
  xh.api.nativeMuted() === false);
xh.api.nativeSetPlaying(false);
xh.api.nativeSetMuted(true);
check("pasek odtwarzacza: stan idzie do mostu wlasciwego silnika",
  xh.calls.playCalls.join(",") === "false" && xh.calls.muted.join(",") === "true" &&
  xh.api.state.exoPlaying === false && xh.api.state.exoMuted === true);

/* --- 26. panel diagnostyki obrazu (dzwiek gra, a obrazu nie ma) ----------
   Kanal 4K zostawial czarny ekran i z kanapy nie bylo widac dlaczego: dzwiek
   gral, wiec odtwarzacz uznawal kanal za uruchomiony. Panel zbiera to, czego
   nie widac (system odbiornika, kodeki, stan elementu <video>, manifest HLS),
   a otwiera sie sam tylko w jednej sytuacji: dzwiek leci, a klatek nie ma. */
check("panel diagnostyki jest nakladka nad obrazem, a nie kolejnym ekranem",
  src.indexOf('panel.className = "diag-panel hidden"') > 0 &&
  src.indexOf("document.body.appendChild(panel);") > 0 &&
  css.indexOf(".diag-panel {") > 0 && css.indexOf(".diag-text {") > 0 &&
  css.indexOf(".diag-panel.hidden { display: none; }") > 0 &&
  /\.diag-panel\s*\{[^}]*z-index: 60/.test(css));

check("panel otwiera przycisk na pasku odtwarzacza, a Wstecz zamyka go pierwszy",
  src.indexOf('osdButton("diag", t("osd_diag"), toggleDiagnostics)') > 0 &&
  src.indexOf("if (diagVisible()) {\n      closeDiagnostics();\n      return true;\n    }") > 0 &&
  src.indexOf("function toggleDiagnostics()") > 0);

check("panel ma wlasne klawisze: strzalki przewijaja tresc, zamiast zmieniac kanal",
  src.indexOf('document.addEventListener("keydown", diagKeydown, true);') > 0 &&
  src.indexOf("event.stopImmediatePropagation();\n      diagScroll(") > 0 &&
  src.indexOf("if (text) text.scrollTop += direction * 80;") > 0);

check("diagnostyka mowi to samo po polsku i po angielsku",
  src.indexOf('diag_title: "Diagnostyka obrazu"') > 0 &&
  src.indexOf('diag_title: "Picture diagnostics"') > 0 &&
  /osd_diag: "[^"]*Diagnostyka"/.test(src) && /osd_diag: "[^"]*Diagnostics"/.test(src));

/* Decyzja „otworzyc panel samemu” to cztery warunki naraz, wiec wyciagamy sama
   funkcje i karmimy ja atrapami <video> — inaczej latwo otworzyc panel tam,
   gdzie obraz po prostu jeszcze sie wczytuje (kanal 4K robi to kilka sekund). */
const autoStart = src.indexOf("function maybeAutoDiagnose(reason) {");
const autoEnd = src.indexOf("function nextEngineToken(");
if (autoStart < 0 || autoEnd <= autoStart) throw new Error("Nie znalazlem maybeAutoDiagnose w app.js");
const codeAuto = src.slice(autoStart, autoEnd);

function autoHarness(o) {
  o = o || {};
  const calls = { opened: 0, notes: [] };
  const sandbox = {
    state: { diagAutoShown: o.autoShown === true },
    diagVisible: function () { return o.panelOpen === true; },
    $: function () { return o.noVideo ? null : (o.video || { paused: false, readyState: 4 }); },
    videoHasPicture: function () { return o.picture === true; },
    t: function (key) { return "<" + key + ">"; },
    diagNote: function (label) { calls.notes.push(label); },
    openDiagnostics: function () { calls.opened++; }
  };
  run(codeAuto, sandbox);
  return { api: sandbox, calls: calls };
}

let ah = autoHarness({});
check("dzwiek gra, a klatek nie ma: panel otwiera sie sam i tylko raz na kanal",
  ah.api.maybeAutoDiagnose("<diag_auto>") === true && ah.calls.opened === 1 &&
  ah.api.state.diagAutoShown === true && ah.calls.notes.join("|") === "<diag_auto>",
  JSON.stringify(ah.calls));
check("drugie wywolanie przy tym samym kanale nic nie otwiera",
  ah.api.maybeAutoDiagnose("<diag_auto>") === false && ah.calls.opened === 1,
  "otwarć: " + ah.calls.opened);

ah = autoHarness({ picture: true });
check("obraz jest (klatka ma wymiary): panel nie wchodzi na obraz",
  ah.api.maybeAutoDiagnose("x") === false && ah.calls.opened === 0 &&
  ah.api.state.diagAutoShown === false);

ah = autoHarness({ video: { paused: true, readyState: 4 } });
check("zatrzymany obraz to nie „brak obrazu”",
  ah.api.maybeAutoDiagnose("x") === false && ah.calls.opened === 0);

ah = autoHarness({ video: { paused: false, readyState: 1 } });
check("dane jeszcze nie doszly (same metadane albo nic): jeszcze nie oceniamy",
  ah.api.maybeAutoDiagnose("x") === false && ah.calls.opened === 0);

ah = autoHarness({ noVideo: true });
check("brak elementu <video>: nie ma czego diagnozowac",
  ah.api.maybeAutoDiagnose("x") === false && ah.calls.opened === 0);

ah = autoHarness({ panelOpen: true });
check("panel otwarty recznie zostaje otwarty — nic nie otwieramy drugi raz",
  ah.api.maybeAutoDiagnose("x") === false && ah.calls.opened === 0 &&
  ah.api.state.diagAutoShown === false);

check("panel uzbraja sie na starcie dzwieku i przed zmiana sposobu odtwarzania",
  src.indexOf("var DIAG_AUTO_DELAY = 8000;") > 0 &&
  src.indexOf("video.addEventListener(\"playing\", function () {\n      noteStreamActivity();") > 0 &&
  src.indexOf("armDiagAuto();\n      /* Od tego miejsca liczy się czas") > 0 &&
  src.indexOf("if (!notePicture()) armPictureWatchdog();") > 0 &&
  src.indexOf("maybeAutoDiagnose(t(\"diag_auto\"));") > 0 &&
  src.indexOf("var attempts = parseInt(settings.retryAttempts, 10) || 0;") > 0);

check("nowy kanal gasi budzik panelu (panel nie wchodzi w srodku wczytywania)",
  src.indexOf("clearTimeout(state.diagAutoTimer);\n    state.diagAutoTimer = null;") > 0 &&
  src.indexOf("state.diagAutoShown = false;") > 0);

check("panel otwarty sam schodzi z drogi, gdy obraz sie jednak pojawi",
  src.indexOf("if (state.diagAutoShown && videoHasPicture($(\"video\"))) {\n        closeDiagnostics();") > 0);

/* sondowanie manifestu HLS: .ts leci bez konca, wiec pytamy o ten sam adres
   z rozszerzeniem .m3u8; atrybuty czytamy razem z cudzyslowem w srodku */
const urlStart = src.indexOf("function diagManifestUrl(url)");
const urlEnd = src.indexOf("function diagAttributes(text)");
if (urlStart < 0 || urlEnd <= urlStart) throw new Error("Nie znalazlem diagManifestUrl w app.js");
const urlBox = run(src.slice(urlStart, urlEnd), {});
check("sondowanie manifestu nie trafia na sam strumien .ts",
  urlBox.diagManifestUrl("http://s/live/u/p/12345.ts") === "http://s/live/u/p/12345.m3u8" &&
  urlBox.diagManifestUrl("http://s/x.m3u8?token=1") === "http://s/x.m3u8?token=1" &&
  urlBox.diagManifestUrl("http://s/live/u/p/12345") === "" &&
  urlBox.diagManifestUrl("") === "",
  JSON.stringify([urlBox.diagManifestUrl("http://s/live/u/p/12345.ts"),
    urlBox.diagManifestUrl("http://s/live/u/p/12345")]));

const attrStart = src.indexOf("function diagAttributes(text)");
const attrEnd = src.indexOf("function diagManifestInfo(text)");
if (attrStart < 0 || attrEnd <= attrStart) throw new Error("Nie znalazlem diagAttributes w app.js");
const attrBox = run(src.slice(attrStart, attrEnd), {});
const attrs = attrBox.diagAttributes('RESOLUTION=3840x2160,FRAME-RATE=50.000,CODECS="hvc1.1.6.L153,mp4a.40.2"');
check("atrybuty manifestu czytane z cudzyslowem w srodku (kodek 4K HEVC ma przecinek)",
  attrs.RESOLUTION === "3840x2160" && attrs["FRAME-RATE"] === "50.000" &&
  attrs.CODECS === "hvc1.1.6.L153,mp4a.40.2", JSON.stringify(attrs));

/* --- 29. silnik pierwszy, okno programu i EPG z odciskiem zrodla -------------
   Trzy rzeczy z 2.1.12: droga VLC jest zawsze pierwsza (patrz buildSourceQueue),
   pasek nagrania opisuje dlugosc programu, a nie calego okna oddanego przez
   serwer (patrz archiveProgramSeconds), EPG da sie przesunac o godzine i nie
   pobiera sie od nowa przy kazdym zapisie ustawien (patrz shiftPrograms, epgKey). */

/* okno programu: nagranie 1:59:59 dla programu godzinnego ma pokazywac 1 h */
const winStart = src.indexOf("function archiveProgramSeconds()");
const winEnd = src.indexOf("function seekBy(direction)");
if (winStart < 0 || winEnd <= winStart) throw new Error("Nie znalazlem archiveProgramSeconds w app.js");
const NOW_H = 1700000000000;
const winBox = run(src.slice(winStart, winEnd), { Date: { now: function () { return NOW_H; } }, state: {} });
winBox.state.watchProgram = { start: NOW_H - 7200000, end: NOW_H - 3600000 };
check("nagranie w calosci: okno to dlugosc programu (1 h, nie 1:59:59)",
  winBox.archiveProgramSeconds() === 3600, String(winBox.archiveProgramSeconds()));
winBox.state.watchProgram = { start: NOW_H - 1800000, end: NOW_H + 1800000 };
check("program, ktory wciaz leci: okno konczy sie na chwili obecnej",
  winBox.archiveProgramSeconds() === 1800, String(winBox.archiveProgramSeconds()));
winBox.state.watchProgram = { start: NOW_H - 60000, end: NOW_H, timeshift: true };
check("okno catch-up (timeshift): dlugosc okna bez zmian",
  winBox.archiveProgramSeconds() === 60, String(winBox.archiveProgramSeconds()));
winBox.state.watchProgram = null;
check("kanal bez wybranego programu: nie ma czego przycinac",
  winBox.archiveProgramSeconds() === 0, String(winBox.archiveProgramSeconds()));
check("pasek i kroki ⏪/⏩ koncza sie na granicy programu, nie na koncu okna od serwera",
  src.indexOf("if (programSeconds > 0) windowSeconds = Math.min(windowSeconds, programSeconds);") > 0 &&
  src.indexOf("var limit = windowSeconds > 0 ? Math.min(video.duration, windowSeconds) : video.duration;") > 0 &&
  src.indexOf("var limitMs = programSeconds > 0 ? Math.min(state.vlcLength, programSeconds * 1000) : state.vlcLength;") > 0);

/* przesuniecie godzin EPG (czas zimowy / letni) */
const shiftStart = src.indexOf("function shiftPrograms(programs, hours)");
const shiftEnd = src.indexOf("function loadEpgInBackground(");
if (shiftStart < 0 || shiftEnd <= shiftStart) throw new Error("Nie znalazlem shiftPrograms w app.js");
const shiftBox = run(src.slice(shiftStart, shiftEnd), {});
const shifted = shiftBox.shiftPrograms({ c1: [{ start: 1000, end: 2000, title: "X" }] }, 1);
check("przesuniecie EPG o +1 h: wszystkie kanaly, a reszta pol bez zmian",
  shifted.c1[0].start === 1000 + 3600000 && shifted.c1[0].end === 2000 + 3600000 &&
  shifted.c1[0].title === "X", JSON.stringify(shifted));
const shiftedBack = shiftBox.shiftPrograms({ c1: [{ start: 1000, end: 2000 }] }, -1.5);
check("przesuniecie o -1,5 h tez dziala (zrodla o pol godziny obok)",
  shiftedBack.c1[0].start === 1000 - 5400000, JSON.stringify(shiftedBack));
const rawEpg = { c1: [{ start: 1, end: 2 }] };
check("przesuniecie 0 zostawia surowy wynik bez kopiowania",
  shiftBox.shiftPrograms(rawEpg, 0) === rawEpg);
check("przesuniecie z formularza: pol godziny dokladnosci i zakres ±12 h",
  shiftBox.normalizeEpgShift("1") === 1 && shiftBox.normalizeEpgShift("-1") === -1 &&
  shiftBox.normalizeEpgShift("-1.5") === -1.5 && shiftBox.normalizeEpgShift("0.5") === 0.5 &&
  shiftBox.normalizeEpgShift("40") === 12 && shiftBox.normalizeEpgShift("-40") === -12 &&
  shiftBox.normalizeEpgShift("") === 0 && shiftBox.normalizeEpgShift("abc") === 0,
  String(shiftBox.normalizeEpgShift("40")));
check("EPG: surowy wynik + przesuniecie, wiec zmiana ustawienia nic nie pobiera",
  src.indexOf("state.epgRaw = programs;") > 0 &&
  src.indexOf("state.programs = shiftPrograms(state.epgRaw, settings.epgShiftHours);") > 0 &&
  html.indexOf('id="epgShiftHours"') > 0 &&
  html.indexOf('id="epgRefreshNow"') > 0 &&
  src.indexOf('$("epgShiftHours").onchange') > 0 &&
  src.indexOf('$("epgRefreshNow").onclick') > 0 &&
  src.indexOf('settings.epgShiftHours = normalizeEpgShift($("epgShiftHours").value);') > 0);

/* „Pobierz EPG teraz” wyglądał jak przycisk główny: nie miał żadnej obwódki,
   a napis brał się z body (22 px), gdy listy i podpisy obok mają 18 px. Teraz
   trzyma rozmiar i ramkę reszty ustawień (jak #settingsBack). */
check("przycisk „Pobierz EPG teraz” ma obwodke i napis jak pola obok",
  /#epgRefreshNow\s*\{[^}]*font-size: 18px[^}]*border: 2px solid var\(--border\)/.test(css) &&
  css.indexOf("body.uimode-tv #epgRefreshNow { padding: 14px 22px; font-size: 21px; }") > 0);

/* odcisk zrodla EPG: dokad zrodlo i zakres dni sa te same, zapis ustawien nie
   pobiera EPG od nowa (a wiec nie kasuje tego, co juz widac na liscie kanalow) */
const epgKeyStart = src.indexOf("function epgKey(profile, url)");
const epgKeyEnd = src.indexOf("function shiftPrograms(programs, hours)");
if (epgKeyStart < 0 || epgKeyEnd <= epgKeyStart) throw new Error("Nie znalazlem epgKey w app.js");
const keyBox = run(src.slice(epgKeyStart, epgKeyEnd), { settings: { archiveDays: 7 } });
const liveProfile = { id: "p1", epgFileText: "" };
check("odcisk zrodla EPG: ten sam profil i adres = te same programy",
  keyBox.epgKey(liveProfile, "http://s/epg.xml") === keyBox.epgKey(liveProfile, "http://s/epg.xml") &&
  keyBox.epgKey(liveProfile, "http://s/a.xml") !== keyBox.epgKey(liveProfile, "http://s/b.xml"),
  keyBox.epgKey(liveProfile, "http://s/epg.xml"));
check("odcisk zrodla EPG zmienia sie z plikiem, profilem i zakresem dni",
  keyBox.epgKey({ id: "p1", epgFileText: "<xml/>" }, "http://s/a.xml") !==
  keyBox.epgKey({ id: "p1", epgFileText: "" }, "http://s/a.xml") &&
  keyBox.epgKey({ id: "p2", epgFileText: "" }, "http://s/a.xml") !==
  keyBox.epgKey({ id: "p1", epgFileText: "" }, "http://s/a.xml") &&
  (function () {
    keyBox.settings.archiveDays = 14;
    const other = keyBox.epgKey(liveProfile, "http://s/a.xml");
    keyBox.settings.archiveDays = 7;
    return other !== keyBox.epgKey(liveProfile, "http://s/a.xml");
  })());
check("zapis ustawien nie zaciaga EPG po raz drugi (loadCatalog pyta o odcisk zrodla)",
  src.indexOf("if (state.epgKey && state.epgKey === epgKey(profile, state.epgUrl)) {") > 0 &&
  src.indexOf("state.epgKey = epgKey(profile, epgUrl);") > 0 &&
  src.indexOf("function clearEpg() {") > 0);

/* --- 30. pasek odtwarzacza bez dublowanego zegara i z podpisem „odtwarzane” -- */
check("pasek odtwarzacza nie dubluje zegara (godzina jest w rogu obrazu)",
  html.indexOf('id="playerClock"') < 0 &&
  css.indexOf(".player-clock") < 0 &&
  src.indexOf('$("playerClock")') < 0);

const watchStart = src.indexOf("function isWatchedProgram(program)");
const watchEnd = src.indexOf("function programEntry(channel, program, fromPlayer)");
if (watchStart < 0 || watchEnd <= watchStart) throw new Error("Nie znalazlem isWatchedProgram w app.js");
const watchBox = run(src.slice(watchStart, watchEnd), { state: {} });
const onAirEntry = { start: 100, end: 200, title: "X" };
watchBox.state.watchProgram = { start: 100, end: 200 };
check("lista programow rozpoznaje material odtwarzany teraz",
  watchBox.isWatchedProgram(onAirEntry) === true &&
  watchBox.isWatchedProgram({ start: 100, end: 300 }) === false &&
  watchBox.isWatchedProgram(null) === false);
watchBox.state.watchProgram = null;
check("bez odtwarzania zaden wpis nie jest podpisany jako odtwarzany",
  watchBox.isWatchedProgram(onAirEntry) === false);
check("lista i siatka EPG podpisuja odtwarzany material, a lista staje na nim fokusem",
  src.indexOf('playing.className = "program-playing";') > 0 &&
  src.indexOf("archive.playingButton = button;") > 0 &&
  src.indexOf('block.classList.toggle("playing", watching);') > 0 &&
  src.indexOf("if (fromPlayer && live) {") > 0 &&
  css.indexOf(".program.playing time {") > 0 &&
  css.indexOf(".program-playing {") > 0 &&
  src.indexOf('program_playing: "ODTWARZANE"') > 0 &&
  src.indexOf('program_playing: "PLAYING"') > 0);

/* Gwiazdka ulubionych to osobny przycisk w kafelku kanalu. Krotkie OK musi
   przelaczyc ulubione, a nie wlaczyc kanal: focusedChannelCard() obejmuje caly
   kafelek (closest(".channel")), wiec bez wyjatku na gwiazdke OK ja pomijalo. */
check("OK na gwiazdce ulubionych przelacza ulubione, a nie wlacza kanal",
  src.indexOf("okFocus.classList.contains(\"favorite-button\")") > 0 &&
  src.indexOf("startOkHold(function () { okFocus.click(); });") > 0);

/* --- tryb dzielony: obraz + EPG obok siebie ------------------------------
   „EPG” w odtwarzaczu nie zasłania już transmisji: obraz zwęża się do lewej
   kolumny, a lista programów oglądanego kanału staje po prawej (showPlayerEpg
   + body.player-epg). */
check("„EPG” w odtwarzaczu dzieli ekran: obraz po lewej, program kanalu po prawej",
  src.indexOf("function showPlayerEpg()") > 0 &&
  src.indexOf('document.body.classList.add("player-epg")') > 0 &&
  src.indexOf("if (fromPlayer && state.watchChannel) showPlayerEpg();") > 0 &&
  css.indexOf("body.player-epg #playerScreen") > 0 &&
  css.indexOf("body.player-epg #archiveScreen") > 0);
check("powrot do jednego ekranu sam zdejmuje tryb dzielony",
  src.indexOf("function exitPlayerEpg()") > 0 &&
  src.indexOf('document.body.classList.remove("player-epg")') > 0 &&
  src.indexOf("  function showScreen(id) {\n    exitPlayerEpg();") > 0);
check("w trybie dzielonym klawisze ida do listy, a Wstecz zamyka panel",
  src.indexOf('var inPlayerEpg = !!(document.body && document.body.classList &&') > 0 &&
  src.indexOf('var inPlayer = !inPlayerEpg && !$("playerScreen").classList.contains("hidden");') > 0 &&
  src.indexOf('if (document.body && document.body.classList &&\n        document.body.classList.contains("player-epg")) {\n      /* tryb dzielony') > 0);
check("warstwe obrazu na Androidzie zweza most setVideoSplit",
  java.indexOf("public void setVideoSplit(final boolean on)") > 0 &&
  java.indexOf("private void applyVideoSplit(boolean on)") > 0 &&
  javaVlc.indexOf("void setSplit(boolean on)") > 0);

console.log("");
if (fails) { console.log("BLEDY: " + fails); process.exit(1); }
console.log("Wszystkie sprawdzenia przeszly.");




