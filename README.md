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

1. Otvori [console.cloud.google.com](https://console.cloud.google.com/) i napravi projekt.
2. **APIs & Services → Library** — uključi: *Google Sheets API*, *Gmail API*, *Google Calendar API*.
3. **APIs & Services → OAuth consent screen** — tip *External*, ispuni naziv i
   kontakt. Dok je aplikacija u statusu *Testing*, pod **Test users** dodaj svoju
   Google adresu (inače prijava neće proći).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - tip: *Web application*
   - **Authorized redirect URIs**: `http://localhost:3000/auth/google/callback`
     (za javni poslužitelj dodaj i `https://tvoja-domena/auth/google/callback`)
5. Zapiši *Client ID* i *Client secret*.

Tražena dopuštenja: čitanje tablica, čitanje Gmaila, pisanje i slanje pošte, te
upravljanje terminima u kalendaru.

### 2. Postavke

```bash
cp .env.example .env
```

Popuni `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SHEET_ID` i `SESSION_SECRET`
(`openssl rand -hex 32`). `SHEET_ID` je dio adrese tablice između `/d/` i `/edit`.

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
