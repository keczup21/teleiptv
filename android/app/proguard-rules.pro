# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ---------------------------------------------------------------------------
# Paczka na GitHuba to wariant debug (Gradle assembleDebug), a mimo to jest
# przepuszczana przez R8 — patrz buildTypes w build.gradle. Ponizsze reguly
# pilnuja tego, czego R8 nie widzi: wywolan po nazwie, ktorych nie ma w kodzie.
# ---------------------------------------------------------------------------

# libvlc-android: kod natywny wola Jave po nazwach (JNI) i ta sama droga wraca
# do metod. Zmiana nazw pakietu, klas albo metod przewraca obraz drogi VLC
# (przelacznik "Odtwarzacz VLC (beta)"), dlatego pakiet zostaje w calosci.
-keep class org.videolan.** { *; }
-dontwarn org.videolan.**

# Most do strony (addJavascriptInterface w MainActivity): JavaScript wola te
# metody po nazwach, wiec nazwy musza zostac.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Wlasne pluginy (OpenIptvFiles, OpenIptvUpdater): Capacitor zbiera ich metody
# przez refleksje (po adnotacji @PluginMethod) i wola je po nazwach podanych
# w www/app.js. Zmiana nazw metod nie psuje kompilacji - plugin przestaje
# odpowiadac i przycisk "Wybierz plik" albo instalacja aktualizacji milczy.
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod <methods>;
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
}

# Bez nazw plikow i numerow linii stos wywolania w zgloszeniu bledu jest
# bezuzyteczny (nazwy klas i tak sa zamienione).
-keepattributes SourceFile,LineNumberTable
