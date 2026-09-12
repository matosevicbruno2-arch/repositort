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
| Unos novog posla s terena | Sheets API (upis) |
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
- **iOS aplikacija** — isti pult na iPhoneu, s unosom posla s terena i push
  obavijestima kad račun prođe rok. Vidi [`ios/README.md`](ios/README.md).

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

Najbrže skriptom — provjeri Node, instalira ovisnosti, pita za četiri podatka,
sam generira tajne i pokrene provjere:

```bash
bash scripts/postavi.sh
```

Postojeći `.env` ne prepisuje bez pitanja, a tajne generira na tvom računalu
(`openssl rand -hex 32`), pa nikad ne prolaze kroz razgovor ni kroz repozitorij.

Ako radije ručno:

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

Pult mora biti na internetu da bi mu se pristupalo s mobitela i da bi push
obavijesti radile — provjera rokova je pozadinski posao koji mora raditi i kad
nitko nije prijavljen.

U repozitoriju su `Dockerfile` i `railway.json`, pa radi na svakoj platformi koja
zna pokrenuti Docker sliku. Upute ispod su za **Railway** jer ne uspavljuje
aplikaciju i nudi trajni disk; oko 5 $ mjesečno.

> Docker slika nije izgrađena ni pokrenuta odavde (u razvojnom okruženju nema
> Docker daemona). Sam poslužitelj jest provjeren s produkcijskim postavkama:
> healthcheck, adresa iz okruženja, baza na zadanoj putanji i uredno gašenje
> na SIGTERM.

### 1. Projekt

1. [railway.app](https://railway.app) → prijava GitHub računom
2. **New Project → Deploy from GitHub repo** → odaberi `repositort`
3. U **Settings → Source** postavi granu `claude/aplikacija-a1ht0r`

Railway pročita `railway.json`, izgradi po `Dockerfile`-u i prati `/zdravlje`.

### 2. Trajni disk (obavezno)

Bez njega se baza briše pri svakoj objavi — gubi se prijava, a push obavijesti
prestaju raditi jer nestane refresh token.

**Settings → Volumes → Add Volume**, mount path `/data`.

### 3. Varijable

Skripta složi cijeli blok — uzme vrijednosti iz tvog `.env` i generira **nove**
tajne za produkciju (druge od lokalnih):

```bash
bash scripts/railway-varijable.sh
```

Ispisano zalijepi u **Variables → Raw Editor**.

`ALLOWED_EMAILS` ovdje nije neobavezan — pult je na javnoj adresi.

`PORT` i `BASE_URL` ne treba postavljati: Railway sam javlja port i domenu, a
pult je pročita. Uz vlastitu domenu postavi `BASE_URL=https://pult.tvoja-domena.hr`.

Chat i push dodaj kasnije (`ANTHROPIC_API_KEY`, `APNS_*` — vidi `.env.example`).

### 4. Domena i Google

1. **Settings → Networking → Generate Domain** → dobiješ
   `nesto.up.railway.app`
2. U [Google konzoli](https://console.cloud.google.com/auth/clients) otvori svoj
   OAuth client i pod **Authorized redirect URIs** dodaj:

   ```
   https://nesto.up.railway.app/auth/google/callback
   ```

   Zadrži i onaj za `localhost` ako želiš i dalje razvijati lokalno.

### 5. Provjera

Otvori `https://nesto.up.railway.app/zdravlje` — treba vratiti `{"ok":true}`.
Zatim otvori korijen i prijavi se. Prijava sada preživljava objave jer se sesije
čuvaju u bazi na disku.

### Na vlastitom poslužitelju

```bash
docker build -t elink-pult .
docker run -d --name pult -p 3000:3000 \
  -v /srv/pult-data:/data \
  --env-file .env \
  --restart unless-stopped \
  elink-pult
```

Ispred stavi reverse proxy s HTTPS-om (Caddy ili nginx) i postavi
`BASE_URL=https://tvoja-domena`. Bez HTTPS-a kolačić sesije se u produkciji ne
šalje, pa prijava ne prolazi.

## Sigurnost

Pult smije čitati tvoj Gmail, slati poštu s tvoje adrese, pisati u tablicu i
upravljati kalendarom, pa na javnoj adresi vrijedi znati kako je zaštićen:

- **Pristup** se provjerava pri svakom zahtjevu, ne samo pri prijavi. Kad adresu
  makneš iz `ALLOWED_EMAILS`, sesija i tokeni te osobe prestaju vrijediti odmah.
  Ostavljen prazan popis znači da se može prijaviti bilo tko — na javnoj adresi
  ga obavezno popuni.
- **Refresh tokeni** su u bazi šifrirani (AES-256-GCM, `ENCRYPTION_KEY`).
  Tokeni aplikacije pamte se samo kao otisak i vrijede 180 dana.
- **Prijava** stvara novu sesiju, pa podmetnuti ID sesije ne vrijedi nakon nje.
  Kolačić je `httpOnly`, `sameSite=lax` i u produkciji `secure`.
- **Sadržaj e-maila je podatak, ne uputa.** Chat u kontekst dobiva inbox, koji
  piše bilo tko tko ti pošalje poruku; sustavska uputa mu izričito zabranjuje
  postupanje po naredbama iz podataka i dodavanje termina osim na tvoj zahtjev.
- Upiti prema bazi su parametrizirani, nazivi listova i broj računa se provjeravaju
  prije nego uđu u upit, a poveznice iz tablice otvaraju se samo ako su `http(s)`.

Ako pult objaviš, drži `ALLOWED_EMAILS` popunjenim i `ENCRYPTION_KEY` različitim
od `SESSION_SECRET`.

## Skripte

| Skripta | Što radi |
|---|---|
| `bash scripts/postavi.sh` | Postavlja pult za lokalni rad: provjeri Node i ovisnosti, pita za četiri podatka, generira tajne, složi `.env`, pokrene provjere. |
| `bash scripts/railway-varijable.sh` | Ispiše blok varijabli za Railway, s novim tajnama za produkciju. |
| `bash scripts/apns-kljuc.sh <.p8>` | Pretvori Appleov ključ u jedan redak za `APNS_KEY` i pročita Key ID iz naziva datoteke. |

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
    push.js            slanje push obavijesti na APNs
    notifier.js        povremena provjera rokova i slanje obavijesti
ios/                   nativna iOS aplikacija (SwiftUI)
  lib/
    dashboard.js       izračun svih brojki pulta (bez mreže i postavki)
    session-store.js   sesije preglednika u bazi umjesto u memoriji
    newjob.js          sastavljanje novog retka i mjesto upisa u tablicu
    notifications.js   pravila za push obavijesti
    store.js           trajna pohrana (SQLite)
    crypto.js          šifriranje tokena u bazi
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
