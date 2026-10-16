/* Test katalogu z pamięci (szybki start aplikacji) — bez dekodera.
   Wyciaga z www/app.js blok zapisu/odczytu katalogu (nie kopiuje logiki)
   i sprawdza same decyzje: co trafia do pamięci, kiedy zapis jest wazny,
   a kiedy lista z pamięci nie moze udawac swiezej.

   Uruchomienie: npm run test:cache */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const zlib = require("zlib");

const APP = path.join(__dirname, "..", "www", "app.js");
const src = fs.readFileSync(APP, "utf8").replace(/\r\n/g, "\n");

/* Blok katalogu z pamieci: od listy pol do sekcji wczytywania katalogu.
   Granice po funkcjach, nie po numerach linii — tak samo jak w pozostalych
   testach (test-seek-logic.js, test-navigation.js). */
const cStart = src.indexOf("var CATALOG_FIELDS = [");
const cEnd = src.indexOf("/* ==========================  WCZYTANIE KATALOGU");
if (cStart < 0 || cEnd <= cStart) throw new Error("Nie znalazlem bloku katalogu z pamieci w app.js");
const code = src.slice(src.lastIndexOf("\n\n", cStart) + 2, cEnd);
["compactCatalogChannels", "expandCatalogChannels", "catalogSignature",
  "catalogFingerprint", "writeCatalogCache", "readCatalogCache"].forEach(function (fn) {
  if (code.indexOf("function " + fn) < 0) throw new Error("Wyciety blok katalogu nie ma " + fn);
});
if (code.indexOf("function compactCatalogChannels") < 0) throw new Error("brak kompaktowania");

const maxChars = parseInt(/var CATALOG_MAX_CHARS = (\d+);/.exec(src)[1], 10);

let fails = 0;
function check(name, cond, extra) {
  if (cond) { console.log("  OK   " + name); }
  else { fails++; console.log("  FAIL " + name + (extra ? "   -> " + extra : "")); }
}

/* pako w aplikacji pakuje katalog; tutaj robi to samo zlib Node'a (ten sam
   format — deflate z naglowkiem zlib, czyli to, co czyta pako.inflate). */
const pako = {
  deflate: function (text) { return new Uint8Array(zlib.deflateSync(Buffer.from(text, "utf8"))); },
  inflate: function (bytes) { return zlib.inflateSync(Buffer.from(bytes)).toString("utf8"); }
};

function makeStore(limit) {
  const data = {};
  return {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem: function (key, value) {
      const text = String(value);
      if (limit && text.length > limit) {
        const error = new Error("QuotaExceededError");
        error.name = "QuotaExceededError";
        throw error;
      }
      data[key] = text;
    },
    removeItem: function (key) { delete data[key]; },
    dump: function () { return data; }
  };
}

function load(sandbox) {
  const b64 = {
    btoa: function (s) { return Buffer.from(s, "binary").toString("base64"); },
    atob: function (s) { return Buffer.from(s, "base64").toString("binary"); }
  };
  const context = Object.assign({
    CATALOG_KEY: "openiptvCatalog",
    CATALOG_SCHEMA: 1,
    CATALOG_MAX_CHARS: maxChars,
    btoa: b64.btoa,
    atob: b64.atob
  }, sandbox || {});
  /* okno aplikacji: pako (pakowanie) i base64 — dokladnie te dwa wejscia,
     ktorych uzywa zapis katalogu w app.js */
  context.window = Object.assign({ btoa: b64.btoa, atob: b64.atob }, (sandbox && sandbox.window) || {});
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

/* Kanal w takiej postaci, w jakiej robi go parsePlaylist w app.js —
   klucz kanalu to miejsce na liscie i adres strumienia */
function channel(i) {
  return {
    key: (i - 1) + "|http://host/live/" + i + ".ts",
    name: "Kanal " + i,
    streamUrl: "http://host/live/" + i + ".ts",
    tvgId: "tvg" + i,
    group: "Grupa " + (i % 2),
    logoUrl: "http://host/logo" + i + ".png",
    catchupType: i % 3 ? "append" : "",
    catchupSource: "",
    catchupDays: i % 4,
    correction: -2
  };
}

const CAPTURE = { id: "p1", sourceType: "m3u-url", playlistUrl: "http://host/list.m3u" };
const channels = [channel(1), channel(2), channel(3)];

/* --- 1. zapis i odczyt kanalu ------------------------------------------- */
let box = load({ localStorage: makeStore(), window: { pako: pako } });
const rows = box.compactCatalogChannels(channels);
check("kanal idzie do zapisu jako tablica wartosci (bez nazw pol)",
  Array.isArray(rows[0]) && rows[0].length === 9 && rows[0][0] === "Kanal 1",
  JSON.stringify(rows[0]));

const back = box.expandCatalogChannels(rows);
check("odczytany kanal ma te same pola, co zapisany",
  back.length === 3 && back[2].name === "Kanal 3" && back[2].streamUrl === "http://host/live/3.ts" &&
  back[2].tvgId === "tvg3" && back[2].group === "Grupa 1" &&
  back[2].logoUrl === "http://host/logo3.png" && back[2].catchupType === "" &&
  back[2].catchupSource === "" && back[1].catchupDays === 2 && back[0].correction === -2,
  JSON.stringify(back[2]));

check("klucz kanalu odtwarzany tak samo, jak w parsePlaylist (miejsce + adres)",
  back[0].key === "0|http://host/live/1.ts" && back[2].key === channels[2].key,
  JSON.stringify([back[0].key, channels[2].key]));

check("puste pola wracaja jako napis/liczba, nie null",
  box.expandCatalogChannels([[]])[0].name === "" && box.expandCatalogChannels([[]])[0].catchupDays === 0,
  JSON.stringify(box.expandCatalogChannels([[]])[0]));

/* --- 2. odcisk listy ----------------------------------------------------- */
const same = box.catalogFingerprint(channels);
check("ta sama lista = ten sam odcisk",
  same === box.catalogFingerprint(box.expandCatalogChannels(rows)), same);
check("inna nazwa kanalu = inny odcisk",
  same !== box.catalogFingerprint([channel(1), channel(2), Object.assign(channel(3), { name: "Inny" })]));
const swapped = [channels[1], channels[0], channels[2]];
check("przestawione kanaly = inny odcisk (numer na liscie ma znaczenie)",
  same !== box.catalogFingerprint(swapped));
check("krotsza lista = inny odcisk", same !== box.catalogFingerprint(channels.slice(0, 2)));
check("odcisk miesci liczbe kanalow (widac ja bez rozpakowywania)",
  same.indexOf("3:") === 0, same);

/* --- 3. zapis i odczyt z pamieci (pako) --------------------------------- */
const store = makeStore();
box = load({ localStorage: store, window: { pako: pako } });
box.writeCatalogCache(CAPTURE, { channels: channels, epgUrl: "http://host/epg.xml" });

const raw = store.dump().openiptvCatalog;
check("katalog trafia do pamieci pod jednym kluczem, wpis na profil",
  !!raw && Object.keys(JSON.parse(raw)).length === 1, raw && raw.slice(0, 40));

const entry = JSON.parse(raw).p1;
check("wpis jest spakowany i ma podpis zrodla",
  entry.zip === 1 && entry.count === 3 && entry.signature === box.catalogSignature(CAPTURE),
  JSON.stringify({ zip: entry.zip, count: entry.count, sig: entry.signature }));
/* Zapas miejsca w pamieci: na trzech kanalach pakowanie nie ma z czego
   zaoszczedzic, a na tysiacach — i owszem (o to chodzilo w zapisie). */
const many = [];
for (let i = 1; i <= 500; i++) many.push(channel(i));
const manyStore = makeStore();
const boxMany = load({ localStorage: manyStore, window: { pako: pako } });
boxMany.writeCatalogCache(CAPTURE, { channels: many, epgUrl: "" });
const manyEntry = JSON.parse(manyStore.dump().openiptvCatalog).p1;
const manyRaw = JSON.stringify({ channels: boxMany.compactCatalogChannels(many) });
check("500 kanalow pakuje sie wielokrotnie mniej niz surowy JSON",
  manyEntry.zip === 1 && manyEntry.data.length * 3 < manyRaw.length,
  manyEntry.data.length + " vs " + manyRaw.length);
check("duza lista wraca z pamieci w calosci",
  boxMany.readCatalogCache(CAPTURE).channels.length === 500);

const cached = box.readCatalogCache(CAPTURE);
check("odczyt z pamieci oddaje kanaly, adres EPG i odcisk listy",
  !!cached && cached.channels.length === 3 && cached.channels[1].name === "Kanal 2" &&
  cached.epgUrl === "http://host/epg.xml" && cached.fingerprint === same,
  JSON.stringify(cached && { n: cached.channels.length, epg: cached.epgUrl, fp: cached.fingerprint }));

/* --- 4. kiedy zapis przestaje byc wazny --------------------------------- */
check("inny profil nie widzi cudzego katalogu",
  box.readCatalogCache({ id: "p2", sourceType: "m3u-url", playlistUrl: "http://host/list.m3u" }) === null);
check("zmiana adresu playlisty uniewaznia zapis (zadnej starej listy)",
  box.readCatalogCache({ id: "p1", sourceType: "m3u-url", playlistUrl: "http://host/inna.m3u" }) === null);
check("zmiana serwera lub konta Xtream uniewaznia zapis",
  box.readCatalogCache({ id: "p1", sourceType: "xtream", xtreamServer: "http://s", xtreamUser: "u" }) === null &&
  box.catalogSignature({ id: "p1", xtreamServer: "http://s", xtreamUser: "u" }) !==
  box.catalogSignature({ id: "p1", xtreamServer: "http://s", xtreamUser: "u2" }));

/* --- 5. uszkodzony zapis, brak pako, brak miejsca ----------------------- */
const broken = makeStore();
broken.setItem("openiptvCatalog", "{to nie jest json");
check("uszkodzony zapis to brak katalogu, a nie blad aplikacji",
  load({ localStorage: broken, window: { pako: pako } }).readCatalogCache(CAPTURE) === null);

const noPako = makeStore();
const boxNoPako = load({ localStorage: noPako, window: {} });
boxNoPako.writeCatalogCache(CAPTURE, { channels: channels, epgUrl: "" });
check("bez pako katalog tez sie zapisuje (surowy JSON) i wraca",
  JSON.parse(noPako.dump().openiptvCatalog).p1.zip === 0 &&
  boxNoPako.readCatalogCache(CAPTURE).channels.length === 3);
check("wpisu spakowanego nie da sie czytac bez pako — zamiast smieci brak listy",
  load({ localStorage: store, window: {} }).readCatalogCache(CAPTURE) === null);
check("zly odcisk zapisu jest odrzucany (katalog z innej wersji zapisu)",
  (function () {
    const odd = makeStore();
    odd.setItem("openiptvCatalog", JSON.stringify({ p1: { schema: 99, signature: box.catalogSignature(CAPTURE), data: "{}" } }));
    return load({ localStorage: odd, window: { pako: pako } }).readCatalogCache(CAPTURE) === null;
  })());

const never = makeStore(-1);
let removed = 0;
const baseRemove = never.removeItem.bind(never);
never.removeItem = function (key) { removed++; return baseRemove(key); };
const boxNever = load({ localStorage: never, window: { pako: pako } });
let threw = "";
try { boxNever.writeCatalogCache(CAPTURE, { channels: channels, epgUrl: "" }); }
catch (error) { threw = String(error && error.message); }
check("brak miejsca w pamieci nie przewraca zapisu katalogu",
  threw === "" && never.dump().openiptvCatalog === undefined && removed === 1,
  JSON.stringify({ threw: threw, removed: removed }));

const tight = makeStore();
const baseSet = tight.setItem.bind(tight);
tight.setItem = function (key, value) {
  if (Object.keys(JSON.parse(String(value))).length > 1) {
    const error = new Error("QuotaExceededError");
    error.name = "QuotaExceededError";
    throw error;
  }
  return baseSet(key, value);
};
const boxTight = load({ localStorage: tight, window: { pako: pako } });
boxTight.writeCatalogCache({ id: "p1", sourceType: "m3u-url", playlistUrl: "http://host/a.m3u" }, { channels: channels });
boxTight.writeCatalogCache({ id: "p2", sourceType: "m3u-url", playlistUrl: "http://host/b.m3u" }, { channels: channels });
check("gdy dwa katalogi sie nie mieszcza, zostaje ten ostatni (a nie zaden)",
  Object.keys(JSON.parse(tight.dump().openiptvCatalog)).join(",") === "p2",
  Object.keys(JSON.parse(tight.dump().openiptvCatalog)).join(","));

/* --- 6. zrodlo z pliku i zbyt duzy katalog ------------------------------ */
const fileStore = makeStore();
load({ localStorage: fileStore, window: { pako: pako } })
  .writeCatalogCache({ id: "p1", sourceType: "m3u-file", playlistFileName: "lista.m3u" },
    { channels: channels, epgUrl: "" });
check("zrodlo z pliku nie zapisuje katalogu (plik i tak jest pod reka)",
  fileStore.dump().openiptvCatalog === undefined);

const smallStore = makeStore();
load({ localStorage: smallStore, window: { pako: pako }, CATALOG_MAX_CHARS: 50 })
  .writeCatalogCache(CAPTURE, { channels: channels, epgUrl: "" });
check("zbyt duzy katalog nie jest zapisywany (pamiec dzielimy z EPG)",
  smallStore.dump().openiptvCatalog === undefined);

/* --- 7. wpisy po usunietych profilach ----------------------------------- */
const pruneStore = makeStore();
const boxPrune = load({ localStorage: pruneStore, window: { pako: pako }, settings: { profiles: [{ id: "p1" }] } });
boxPrune.writeCatalogCache({ id: "p2", sourceType: "m3u-url", playlistUrl: "http://host/b.m3u" }, { channels: channels });
boxPrune.writeCatalogCache({ id: "p1", sourceType: "m3u-url", playlistUrl: "http://host/list.m3u" }, { channels: channels });
check("wpis po usunietym profilu nie zajmuje pamieci",
  Object.keys(JSON.parse(pruneStore.dump().openiptvCatalog)).join(",") === "p1");

/* --- 8. wpiecie w wczytywanie katalogu --------------------------------- */
const cacheIdx = src.indexOf('var cached = profile.sourceType === "m3u-file"');
const fetchIdx = src.indexOf("loadSource = fetchText(profile.playlistUrl)");
check("lista z pamieci jest czytana przed pobraniem playlisty",
  cacheIdx > 0 && fetchIdx > cacheIdx, JSON.stringify([cacheIdx, fetchIdx]));
check("katalog z pamieci rysuje sie od razu, a swiezy idzie w tle",
  src.indexOf("applyCatalog(profile, cached, true)") > 0 &&
  src.indexOf("writeCatalogCache(profile, catalog)") > 0);
check("przy liscie z pamieci status nie klamie („pobieranie” tylko bez zapisu)",
  /if \(!cached\) setStatus\(t\("loading_playlist"\)\);/.test(src) &&
  /if \(!cached\) setStatus\(t\("connecting_xtream"\)\);/.test(src));
check("brak lacza przy liscie z pamieci nie czysci listy",
  /if \(cached\) \{\s*\n\s*setStatus\(state\.channels\.length \+ " " \+ t\("channels_count"\) \+ " • " \+ t\("catalog_offline"\)\);\s*\n\s*return;/.test(src));
check("nowa lista czeka na powrot do kanalow, gdy uzytkownik chodzi po liscie",
  src.indexOf("function catalogIsBrowsed") > 0 &&
  src.indexOf("applyPendingCatalog();") > 0 &&
  src.indexOf("state.catalogPending = { profile: profile") > 0);
check("oba jezyki maja napisy o liscie z pamieci",
  (src.match(/catalog_cached:/g) || []).length === 2 &&
  (src.match(/catalog_offline:/g) || []).length === 2 &&
  (src.match(/catalog_new:/g) || []).length === 2);

console.log("");
if (fails) { console.log("BLEDY: " + fails); process.exit(1); }
console.log("Wszystkie sprawdzenia przeszly.");
