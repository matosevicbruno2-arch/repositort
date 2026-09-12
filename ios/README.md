# Elink ICT — iOS aplikacija

Nativna SwiftUI aplikacija koja prikazuje isti pult kao web: računi, poslovi,
inbox i kalendar. Uz to omogućuje **unos posla s terena** i prima **push
obavijesti** kad račun prođe rok plaćanja ili posao ima rok danas ili sutra.

> **Važno prije početka:** ovaj kod nije preveden ni pokrenut. Razvijen je na
> Linuxu, gdje Xcode i SwiftUI ne postoje, pa je pisan pažljivo ali neprovjereno.
> Backend na koji se spaja jest provjeren i pokriven testovima. Očekuj da će pri
> prvom prevođenju trebati ispraviti poneku sitnicu — javi grešku i riješit ćemo je.

## Što treba prije

1. **Mac s Xcodeom 15 ili novijim** (App Store, oko 15 GB).
2. **Apple Developer Program** (99 $/god) — nužan za push obavijesti. Bez njega
   aplikacija radi, ali bez obavijesti i mora se ponovno instalirati svakih 7 dana.
3. **Pult na javnoj adresi** (https). Vidi „Objava na poslužitelj" u glavnom
   `README.md`. Za prvo isprobavanje dovoljan je i Mac na istoj Wi-Fi mreži —
   aplikacija dopušta `http` prema lokalnoj mreži.

## Stvaranje Xcode projekta

Swift datoteke su u `ios/ElinkPult/`. Sam `.xcodeproj` nije u repozitoriju jer
je to generirana datoteka koja se teško uređuje ručno.

**Preporučeno — XcodeGen:**

```bash
brew install xcodegen
cd ios
xcodegen generate
open ElinkPult.xcodeproj
```

**Ručno, bez XcodeGena:**

1. Xcode → *File → New → Project → iOS → App*
2. Product Name `Pult`, Interface **SwiftUI**, Language **Swift**,
   Bundle Identifier `hr.elink.pult`
3. Obriši `ContentView.swift` i generirani `…App.swift`
4. Povuci mapu `ios/ElinkPult` u projekt (*Copy items if needed* isključeno,
   *Create groups* uključeno)
5. U *Target → Info* dodaj URL Type sa shemom `elinkpult`
6. U *Target → Signing & Capabilities* dodaj **Push Notifications**

## Postavljanje push obavijesti

### Kod Applea

1. [developer.apple.com](https://developer.apple.com/account) → **Certificates,
   Identifiers & Profiles**
2. **Identifiers** → registriraj App ID `hr.elink.pult` i uključi **Push Notifications**
3. **Keys** → **+** → naziv npr. `Pult APNs`, označi **Apple Push Notifications
   service (APNs)** → *Continue* → *Register*
4. Preuzmi `.p8` datoteku — **može se preuzeti samo jednom**, spremi je dobro
5. Zapiši **Key ID** (s te stranice) i **Team ID** (gore desno u računu)

### Na poslužitelju

U `.env` pulta dodaj:

```
APNS_KEY_ID=ABC1234567
APNS_TEAM_ID=DEF7654321
APNS_BUNDLE_ID=hr.elink.pult
APNS_KEY="-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqG...\n-----END PRIVATE KEY-----"
APNS_PRODUCTION=0
NOTIFY_INTERVAL_MS=10800000
```

`APNS_KEY` je sadržaj `.p8` datoteke u jednom retku — novi redovi kao `\n`.
Pretvorbu radi:

```bash
awk 'BEGIN{ORS="\\n"} {print}' AuthKey_ABC1234567.p8
```

`APNS_PRODUCTION=0` ide uz `aps-environment: development` u entitlementima (build
iz Xcodea). Za TestFlight i App Store postavi oboje na production.

Ako `APNS_*` nisu postavljeni, pult radi normalno — samo bez obavijesti, i to
napiše pri pokretanju.

## Prvo pokretanje

1. Priključi iPhone kabelom, odaberi ga kao odredište u Xcodeu, pritisni **Run**
2. Prvi put: iPhone → *Postavke → Općenito → VPN i upravljanje uređajem* →
   vjeruj svom razvojnom certifikatu
3. U aplikaciji upiši **adresu poslužitelja** (npr. `https://pult.tvoja-domena.hr`)
4. **Prijavi se Google računom** — otvara se isti OAuth kao na webu
5. Dopusti obavijesti kad pita

Prijava se pamti u Keychainu, pa se ne traži pri svakom otvaranju.

## Kako je posloženo

```
ElinkPult/
  ElinkPultApp.swift     ulazna točka, AppDelegate i registracija za push
  API.swift              pozivi na poslužitelj, token u Authorization zaglavlju
  Models.swift           strukture koje odgovaraju JSON-u poslužitelja
  Keychain.swift         čuvanje tokena prijave
  Format.swift           iznosi i datumi u hrvatskom obliku
  Theme.swift            boje preuzete s web pulta, svijetla i tamna
  Views/
    RootView.swift       kartice: Pult, Inbox, Kalendar, Postavke
    PrijavaView.swift    prijava kroz ASWebAuthenticationSession
    PultView.swift       brojke, računi, poslovi, graf primitaka
    InboxView.swift      poruke s filtrima po kategoriji
    KalendarView.swift   termini sljedećih 7 dana
    NoviPosaoView.swift  unos posla s terena
    PostavkeView.swift   adresa poslužitelja, stanje obavijesti, odjava
```

Prijava ne koristi zaseban Google OAuth klijent za iOS: aplikacija otvara
`/auth/google?mode=app` na tvom poslužitelju, a on nakon uspjeha vraća token
kroz `elinkpult://auth?token=…`. Tako postoji samo jedno mjesto s Google
postavkama, ono koje već radi.

## Što aplikacija ne radi

Slanje opomena i chat „Pitaj Claudea" zasad su samo na webu. Oboje se može dodati
— opomene traže još jedan zaslon, chat streaming odgovora.
