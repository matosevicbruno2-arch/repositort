# Elink ICT — poslovni pult

Web aplikacija koja na jednom mjestu pokazuje stanje obrta: što treba naplatiti, što
je otvoreno, što čeka fakturiranje, što je stiglo u inbox i što je u kalendaru.

Podaci se čitaju **izravno s tvojeg Google računa** pri svakom osvježavanju —
aplikacija nema svoju bazu i ništa ne pohranjuje.

| Dio pulta | Izvor |
|---|---|
| Računi za naplatiti, otvoreni poslovi, za fakturirati, primici po mjesecu | Google tablica (Sheets API) |
| Inbox zadnjih 7 dana s kategorizacijom | Gmail API |
| Kalendar sljedećih 7 dana | Google Calendar API |
| Slanje opomena i spremanje skica | Gmail API |
| Chat „Pitaj Claudea“ + dodavanje termina | Claude API + Calendar API |

## Što aplikacija radi

- **Za naplatiti** — zbroj otvorenih računa, koliko ih kasni i za koliko dana.
  Storno se automatski sparuje s računom koji poništava (isti iznos, prednost ima
  isti klijent) i oba ispadaju s popisa.
- **Opomena u dva klika** — klik na račun otvara pripremljenu poruku; adresa klijenta
  se traži u Gmailu iz Solo mailova za taj račun, a prikazuje se i je li Solo već
  slao obavijest o dugovanju. Može se poslati odmah ili spremiti kao skica.
- **Otvoreni poslovi** — sortirani po roku, pa prioritetu, pa vrijednosti.
- **Inbox** — razvrstan na klijente, financije, upozorenja i ostalo, s filtrima.
- **Chat** — odgovara na pitanja isključivo iz onoga što pult trenutno prikazuje
  („Tko kasni s plaćanjem?“, „Što mi je sutra?“) i može dodati termin u kalendar.

## Struktura tablice

Aplikacija u radnoj knjizi traži tri tablice po nazivima stupaca u zaglavlju — mogu
biti na istom listu jedna ispod druge ili razdvojene po listovima, bilo gdje u listu:

| Tablica | Prepoznaje se po stupcima | Ostali stupci koji se koriste |
|---|---|---|
| Radovi | `ID`, `Klijent`, `Status rada` | `Projekt / posao`, `Opis / sljedeći korak`, `Prioritet`, `Rok`, `Vrijednost posla (€)`, `Datum unosa`, `Datum završetka`, `Za fakturirati (€)`, `Broj računa`, `Napomena` |
| Solo računi | `Broj računa`, `Status praćenja`, `Iznos (€)` | `Klijent`, `Datum računa`, `Rok plaćanja`, `Solo status`, `PDF` |
| Primici | `Ime`, `Iznos`, `Datum uplate` | redak `Ukupno` se uzima kao ukupan iznos, a ne kao uplata |

Vrijednosti se čitaju u hrvatskom formatu: iznosi `1.234,56 €`, datumi `5.9.2026.`

Statusi koji nešto znače: `Za naplatiti` (račun ide na popis za naplatu),
`Za napraviti` / `U tijeku` / `Čeka materijal/klijenta` (otvoren posao),
`Završeno - nije fakturirano` (ide u „za fakturirati“).

## Postavljanje

### 1. Google Cloud projekt

Google je OAuth postavke preselio iz *APIs & Services* u zaseban odjeljak
**Google Auth Platform**, pa se starije upute na internetu često ne poklapaju s
onim što vidiš. Poveznice ispod vode izravno na pravo mjesto; uz svaki korak je i
putanja kroz izbornik, za oba rasporeda.

**1.1 Napravi projekt** — <https://console.cloud.google.com/projectcreate>

Nakon stvaranja provjeri u plavoj traci na vrhu da je odabran baš taj projekt.
Krivo odabran projekt najčešći je uzrok kasnijih „ne vidim ništa“ situacija.

**1.2 Uključi tri API-ja** — otvori svaku poveznicu i klikni **Enable**:

- [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)
- [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
- [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)

> Kroz izbornik: ☰ → **APIs & Services → Library** → upiši ime API-ja → **Enable**.

**1.3 Ekran pristanka** — <https://console.cloud.google.com/auth/overview>

Prvi put traži osnovne podatke: naziv aplikacije, e-mail za podršku,
**Audience → External**, kontakt e-mail i prihvaćanje uvjeta.

**1.4 Dodaj se kao test korisnik** — <https://console.cloud.google.com/auth/audience>

Pod **Test users → Add users** upiši svoju Google adresu i spremi.

Ovaj korak nije neobavezan: dok je aplikacija u statusu *Testing*, prijava prolazi
**samo** s adresa upisanih ovdje.

> Stariji raspored: **APIs & Services → OAuth consent screen**, gdje su ekran
> pristanka i test korisnici na istoj stranici.

**1.5 Napravi OAuth client ID** — <https://console.cloud.google.com/auth/clients>
→ **Create client**

- **Application type**: `Web application`
- **Name**: bilo što, npr. `Pult lokalno`
- **Authorized redirect URIs** → **Add URI**:

  ```
  http://localhost:3000/auth/google/callback
  ```

  Za javni poslužitelj dodaj i `https://tvoja-domena/auth/google/callback`.

Klikni **Create**; otvori se prozorčić s **Client ID** i **Client secret**. Secret
se kasnije može ponovno pogledati klikom na klijenta u popisu.

Dvije zamke: mora biti **redirect URI**, ne *Authorized JavaScript origin*, i mora
se poklapati znak po znak (`http`, ne `https`, sa `/auth/google/callback` na kraju).
Neslaganje daje grešku `redirect_uri_mismatch` pri prijavi.

> Stariji raspored: **APIs & Services → Credentials → Create credentials →
> OAuth client ID**.

**Data Access** (popis dopuštenja) ne treba dirati dok je aplikacija u *Testing*
modu — traži ih sama pri prijavi, a test korisnik ih odobri. Traže se: čitanje
tablica, čitanje Gmaila, pisanje i slanje pošte te upravljanje terminima u kalendaru.

**Pri prvoj prijavi** Google prikazuje upozorenje *„Google hasn't verified this
app“*. To je očekivano za aplikaciju u *Testing* modu — klikni **Advanced** →
**Go to … (unsafe)**. Zatim prihvati sva tražena dopuštenja; ako neko odznačiš,
taj dio pulta neće raditi.

### 2. Postavke

```bash
cp .env.example .env
```

Popuni četiri vrijednosti:

| Varijabla | Odakle |
|---|---|
| `GOOGLE_CLIENT_ID` | iz koraka 1.5 |
| `GOOGLE_CLIENT_SECRET` | iz koraka 1.5 |
| `SHEET_ID` | iz adrese tablice, dio između `/d/` i `/edit` |
| `SESSION_SECRET` | `openssl rand -hex 32` |

```
docs.google.com/spreadsheets/d/1L6BNk7i9qF070trOztCGqRLCfWTWBl_pYIkUEMXORUs/edit
                               └───────────────── SHEET_ID ─────────────────┘
```

U `ALLOWED_EMAILS` upiši adrese koje smiju ući. **Ako je prazno, prijaviti se može
bilo koji Google račun** — na javnom poslužitelju to obavezno popuni.

Chat radi samo ako postaviš `ANTHROPIC_API_KEY` ([console.anthropic.com](https://console.anthropic.com/));
bez ključa ostatak pulta radi normalno, a gumb za chat je skriven.

### 3. Pokretanje

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # s automatskim ponovnim pokretanjem
npm test           # provjera logike pulta
```

## Objava na poslužitelj

- Postavi `NODE_ENV=production` i `BASE_URL=https://tvoja-domena` — kolačić sesije
  tada ide samo preko HTTPS-a.
- Dodaj istu adresu u *Authorized redirect URIs* u Google Cloud Console.
- Sesije se drže u memoriji procesa, pa se ponovnim pokretanjem gubi prijava. Za
  više instanci ili trajnu prijavu dodaj vanjski `session store` (Redis, SQLite).

## Kako je posloženo

```
src/
  server.js            Express, sesija, statične datoteke
  config.js            postavke iz okruženja i popis Google dopuštenja
  auth.js              Google OAuth (prijava, odjava, provjera pristupa)
  routes/api.js        /api/* rute i prijevod grešaka u poruke na hrvatskom
  services/
    sheets.js          čitanje tablice preko Sheets API-ja
    gmail.js           inbox, traženje adrese klijenta, slanje opomene
    calendar.js        termini sljedećih 7 dana, dodavanje termina
    chat.js            Claude API (tok odgovora) + alat dodaj_termin
  lib/
    dashboard.js       izračun svih brojki pulta (bez mreže i postavki)
    parse.js           iznosi i datumi u hrvatskom formatu
    tables.js          pronalaženje tablica u listovima
    cache.js           kratkotrajna predmemorija po korisniku
public/                sučelje (index.html, styles.css, app.js)
test/                  provjera logike pulta bez mreže
```

Poslužitelj drži podatke u predmemoriji 60 sekundi po korisniku (`CACHE_TTL_MS`),
a sučelje se osvježava svakih 5 minuta i na klik *Osvježi sada*.

Izračun pulta (`lib/dashboard.js`) odvojen je od Google poziva i od postavki, pa se
cijela logika — storno, kašnjenja, zbrojevi, grupiranje primitaka — provjerava
testovima bez mreže i bez `.env` datoteke.
