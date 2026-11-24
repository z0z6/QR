# QR

Generator kodów QR i **przesyłanie plików ruchomym kodem QR** – z ekranu na aparat, bez internetu, Bluetootha i parowania.
Działa na **Windows**, **Linuksie**, **macOS**, **Androidzie** oraz w **przeglądarce** (iPhone, iPad, dowolny komputer).
Jeden wspólny interfejs (HTML/JS, wygląd w stylu iOS, po polsku) – Electron na komputerach, Capacitor na Androidzie.

## Funkcje

**Generuj**
- duże pole do wklejenia linku, tekstu albo całej wizytówki (vCard) – rodzaj treści rozpoznaje się sam, wklejoną wizytówkę lub Wi-Fi można dalej edytować w formularzu,
- gotowe formularze: wizytówka (vCard 3.0), Wi-Fi, e-mail, SMS, telefon, miejsce (z „Moje położenie”), wydarzenie w kalendarzu,
- wczytanie pliku `.vcf`/`.txt` albo **obrazu z kodem QR** (odczyta treść i pozwoli ją zmienić),
- wygląd: poziom korekcji L/M/Q/H, moduły (kwadraty, obłe, kropki), narożniki, kolory (z ostrzeżeniem o złym kontraście), margines, **logo w środku**, podpis pod kodem,
- eksport PNG (512–4096 px) i SVG, kopiowanie obrazu do schowka, pełny ekran (ekran nie gaśnie), historia ostatnich kodów,
- treść za duża na jeden kod → jedno kliknięcie przenosi ją do nadajnika.

**Prześlij** – nadajnik
- pliki (dowolne, wiele naraz, przeciąganie na okno) albo tekst; tekst i dokumenty są kompresowane,
- trzy prędkości (Pewna ok. 3 KB/s, Zwykła ok. 7 KB/s, Szybka ok. 15 KB/s – zależnie od aparatu odbiorcy) i ustawienia zaawansowane (klatki/s, wielkość kodu, korekcja); tempo można zmieniać w trakcie,
- ekran nie gaśnie, na Androidzie podczas nadawania świeci najjaśniej.

**Odbierz**
- skanowanie aparatem (zwykłe kody i transmisje), z obrazu, ze schowka, a na komputerze także **wyszukanie kodu na ekranie**,
- akcje po odczycie: otwórz link (po pokazaniu adresu), zapisz kontakt, dodaj wydarzenie, skopiuj hasło Wi-Fi, edytuj w generatorze.

## Transmisja bez instalowania czegokolwiek u odbiorcy

1. Nadawca naciska **Rozpocznij transmisję** – pojawia się **kod startowy**: zwykły link do strony odbioru
   (`https://z0z6.github.io/QR/odbior.html#s=…&h=…`).
2. Odbiorca skanuje go wbudowanym aparatem (iPhone, Android) – otwiera się strona w przeglądarce.
   Widzi, co dostanie (nazwa, rozmiar), i dopiero po naciśnięciu **Odbieraj** oraz zgodzie na aparat zaczyna nasłuch.
3. Nadawca naciska **Start**. Odbiór kończy się sam, gdy dotrze komplet – aparat się wyłącza, a pliki można zapisać.

Dlaczego to bezpieczne:
- strona odbioru jest statyczna (GitHub Pages, HTTPS, ścisła polityka CSP) i **nie wysyła żadnych danych** – dane płyną tylko obrazem;
- parametry transmisji są w części adresu po `#`, której przeglądarka nie przesyła do serwera;
- odbiorca przyjmuje wyłącznie ramki z identyfikatorem sesji z kodu startowego, każda ramka ma CRC-16,
  a całość jest sprawdzana skrótem **SHA-256** zgodnym z kodem startowym;
- nic nie uruchamia się samo: linki trzeba otworzyć ręcznie, pliki nie otwierają się automatycznie.

Odbiorca z aplikacją QR może zamiast strony użyć zakładki **Odbierz**.

### Jak to działa technicznie

- Ramka to kod QR w trybie **alfanumerycznym** z danymi w **Base45** (RFC 9285) – ~97% pojemności trybu bajtowego,
  a odczyt jest jednoznaczny także przez systemowe czytniki (`BarcodeDetector`), które zwracają tylko tekst.
- **Kod fontannowy**: najpierw wszystkie bloki po kolei, potem bez końca losowe kombinacje XOR połowy bloków.
  Odbiorca nie musi łapać konkretnych klatek – wystarczy mu ~K dowolnych; dekoder to eliminacja Gaussa–Jordana
  prowadzona na bieżąco. W testach przy 10–50% zgubionych klatek potrzeba 1,00–1,01×K ramek.
- Można dołączyć w dowolnym momencie – każda ramka opisuje się sama.

## Pobieranie

Każdy push na `main` buduje w GitHub Actions (zakładka **Actions** → ostatnie uruchomienie → *Artifacts*):

| Artefakt | Plik |
|---|---|
| `QR-windows-portable` | `QR-<wersja>-portable.exe` – bez instalacji (ustawienia w folderze „QR - dane” obok pliku) |
| `QR-linux-AppImage` | `QR-<wersja>-linux-x86_64.AppImage` – `chmod +x` i uruchom |
| `QR-macos-dmg` | `QR-<wersja>-mac-arm64.dmg` (Apple Silicon) i `…-mac-x64.dmg` (Intel) |
| `QR-android-apk` | `QR-<wersja>-android.apk` – zezwól na instalację z nieznanych źródeł |
| `QR-web` | wersja webowa – ta sama, która trafia na https://z0z6.github.io/QR/ |

Tag `v*` (np. `v1.0.0`) tworzy wydanie (Release) z plikami dla wszystkich systemów.

**iPhone / iPad**: aplikacja działa w Safari pod adresem https://z0z6.github.io/QR/ – *Udostępnij → Do ekranu początkowego*
dodaje ją jak zwykłą aplikację (działa też bez internetu). Natywna wersja na iOS wymagałaby płatnego konta Apple Developer.

**macOS**: aplikacja nie jest podpisana certyfikatem Apple. Za pierwszym razem: otwórz ją, a potem
*Ustawienia systemowe → Prywatność i ochrona → Otwórz mimo to* (albo w Terminalu `xattr -cr /Applications/QR.app`).

## GitHub Pages (strona odbioru)

Workflow publikuje wersję webową na gałąź `gh-pages`. Jeśli strona nie działa, w repozytorium wybierz
*Settings → Pages → Source: Deploy from a branch → `gh-pages` / `(root)`*. Adres strony odbioru można zmienić
w aplikacji (*Ustawienia → Adres strony odbioru*), np. gdy hostujesz `odbior.html` u siebie – musi działać przez HTTPS.

## Podpis aplikacji na Androida

Bez dodatkowej konfiguracji APK jest podpisywany kluczem testowym z repozytorium (`android/app/debug.keystore`),
dzięki czemu kolejne wersje instalują się jako aktualizacja. Własny klucz – w *Settings → Secrets and variables → Actions*:

| Sekret | Zawartość |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | plik `.jks` zakodowany base64 (`base64 -w0 release.jks`) |
| `ANDROID_KEYSTORE_PASSWORD` | hasło magazynu kluczy |
| `ANDROID_KEY_ALIAS` | alias klucza |
| `ANDROID_KEY_PASSWORD` | hasło klucza |

## Rozwój

```bash
npm install
npm test            # testy: Base45 (RFC 9285), kod fontannowy, ramki, pełna ścieżka przez prawdziwe kody QR (jsQR), vCard/Wi-Fi
npm start           # Electron
npm run web         # wersja webowa do dist-web/
npm run dist:win    # przenośny .exe (na Windows)
npm run dist:linux  # AppImage (na Linuksie)
npm run dist:mac    # .dmg (na macOS)
npx cap sync android && npx cap open android   # Android Studio
```

Wersję zmieniasz w `package.json`, `src/renderer/platform.js` (`APP_VERSION`) i `src/renderer/sw.js` (`CACHE`) – test pilnuje zgodności.

### Struktura

| Ścieżka | Zawartość |
|---|---|
| `src/renderer/core/base45.js` | Base45 (RFC 9285) |
| `src/renderer/core/fountain.js` | kod fontannowy: koder i dekoder (Gauss–Jordan na bieżąco) |
| `src/renderer/core/transfer.js` | paczka plików, kompresja, ramki, CRC, SHA-256, link startowy, nadawca i odbiorca |
| `src/renderer/core/content.js` | budowanie i rozpoznawanie treści (vCard, Wi-Fi, mailto, SMS, geo, wydarzenie) |
| `src/renderer/qr.js` | rysowanie kodów (SVG/PNG, wygląd), odczyt z obrazu, skanowanie aparatem |
| `src/renderer/rx.js` | odbiornik (wspólny dla aplikacji i strony odbioru) |
| `src/renderer/app.js`, `ui.js`, `icons.js`, `styles.css` | interfejs aplikacji |
| `src/renderer/odbior.html`, `odbior.js` | strona odbioru otwierana z kodu startowego |
| `src/renderer/platform.js` | warstwa platformy: Electron / Android / przeglądarka |
| `src/main/main.js`, `src/preload.js` | Electron: okno, zapis plików, schowek, zrzut ekranu, blokada wygaszania |
| `android/` | projekt Capacitor + wtyczka `QrDevice` (ekran włączony, jasność, „Udostępnij → QR”) |

Biblioteki w `src/renderer/vendor`: [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0), [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT), Capacitor core (MIT); czcionka Inter (OFL).
