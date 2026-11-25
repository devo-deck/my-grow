# My Grow – lokale PWA

My Grow ist eine einfache, dunkle Anbau-App fürs Handy (getestet als 393×873-Layout, gedacht für Android inkl. günstiger Xiaomi Redmi 14). Alles bleibt auf dem Gerät (IndexedDB, Fallback localStorage). Kein Konto, kein Server.

Die Anbau- und Athena-Daten stammen aus `data/grow_plan_data.json` und `data/grow_plan_logic.js` (Kopie von `/workspace/grow-plan/`). Zusätzliche Rechenlogik (Phase, Countdown, Gießen, PPFD-Schätzung) liegt in `js/app-logic.js`.

## Online

Öffentliche Version: [https://devo-deck.github.io/my-grow/](https://devo-deck.github.io/my-grow/). Alles bleibt im Browser auf dem Gerät; der GitHub-Host liefert nur die Dateien.

## Starten


Im Ordner `/workspace/grow-app`:

```bash
python3 -m http.server 8765
```

Dann im Browser oder auf dem Handy im selben Netz: `http://<rechner>:8765/`. Nicht als `file://` öffnen, sonst laden Daten und Service Worker nicht.

Auf dem Xiaomi: in Chrome das Menü öffnen und **Zum Startbildschirm hinzufügen**. Danach startet die App ohne Browserleiste und bleibt nach dem ersten Laden offline nutzbar.

`?demo=1` legt einen Beispieldurchgang an (nur für Screenshots/Tests; kann lokale Daten überschreiben, wenn dieser Schlüssel schon existiert).

## Was die App kann

- **Heute:** Gesamtdauer und restliche Zeit auf einen Blick, Tag/Woche, Phase, Countdown bis Ernte und bis zum nächsten Abschnitt, optionales echtes 12/12-Datum, Lampe, PPFD-Schätzung, Dünger-Mix, Gieß-Hilfe (Menge je Topf, Rhythmus, Check, Tipp bei Rinnen).
- **Plan:** alle 14 Wochen, wischen oder Zurück/Weiter; zeigt die empfohlene Dimmung (wie Heute/Lampe), Aufgaben passend zum Substrat.
- **Dünger:** großes Düngeschema über alle Wochen, heutiger Mix für den Tank, Athena Blended als Vorgabe, eigene Pläne, ml/L oder g/L, EC/pH.
- **Lampe:** Vorgabe Omega Infinity 600W Pro 3.0 (Typ Fläche/Leisten), eigene Lampe, Typ Fläche / Panel / Spot, optionale Hersteller-PPFD und eigene PAR-Messungen, Empfehlung für Dimmung/Abstand je Phase.
- **Setup:** Name, Start heute oder Datum, Pflanzenzahl frei, Zeltmaß frei, Substrat Erde (Standard) / Kokos / eigene, Topfgröße, mehrere Grows, JSON-Export/Import.
- **Infos:** Stecklinge, Anbauvereinigungen (Hamburg), KCanG-Kurzhinweis.

## Ehrliche Grenzen

- PPFD ohne eigene Werte ist eine Schätzung (PPF × Dimmung ÷ Zeltfläche × Typ-Faktor, leichter Abstandsabfall). Keine Messung und keine Lichtkarte. Typ-Faktoren (Streuung, höhere Hängehöhe bei Spot) sind Faustregeln.
- Hersteller-PPFD und PAR-Messungen werden linear nach Höhe interpoliert und proportional zur Dimmung skaliert. Eine einzelne Angabe wird zusätzlich mit dem Typ-Abstandsfaktor angepasst. Das ersetzt keine Lichtkarte.
- Ohne gesetztes 12/12-Datum bleibt der Blüte-Start auf Tag 35, Spülen 3 Tage vor der Ernte, Ernte nach 9 Blütewochen. Mit Datum verschieben sich Kalender, Countdown und Düngerwochen (längere Veg bleibt auf der letzten Veg-Rezeptur; frühere 12/12 überspringt offene Veg-Wochen). Die Blütedauer bleibt 9 Wochen.
- Gießmengen und -intervalle sind Faustregeln nach Topfgröße, Substrat und Phase, kein Sensor. Mit mindestens zwei „Gegossen“-Tagen nutzt die App den mittleren Abstand. Im Zweifel den Topf heben. Trockene Erde kann Rinnen bilden — dann langsam in Runden gießen oder kurz anstauen.
- Pflanzenzahl ist frei; über 3 erscheint nur ein Hinweis. Keine Rechtsberatung.
- Athena-Dosierungen kommen aus der offiziellen metrischen Tabelle ohne Fade (A01.004). Es gibt keine PDF-Erkennung.
- Service Worker kann bei der Entwicklung eine alte Datei aus dem Cache zeigen. Dann in `sw.js` den Cachenamen (`grow-app-v4`) hochzählen.

## Später als Android-APK (Capacitor)

Kein APK ist in diesem Stand gebaut. Zum Einpacken später, im App-Ordner:

```bash
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init Grow de.devrim.grow --web-dir .
npx cap add android
npx cap copy android
npx cap open android
```

Hinweise:

- `webDir` ist `.` (kein Build-Schritt). Vor jedem Native-Build `npx cap copy android`.
- `appId` nur einmal festlegen, z. B. `de.devrim.grow`.
- IndexedDB/localStorage bleiben in der WebView; kein extra Native-Storage nötig.
- Icons liegen unter `icons/`. In Android Studio noch in die `mipmap`-Slots setzen.
- `android:usesCleartextTraffic` nur für lokale Tests, nicht für eine Store-Version.
- Ziel: WebView aktuell halten (Android 8+ reicht für diese PWA; Redmi 14 hat neuere Software).

## Tests und Screenshots

```bash
node --input-type=module tests/logic.test.js
```

Handy-Screenshots (393×873 CSS-Pixel, 2×): `screenshots/`.
