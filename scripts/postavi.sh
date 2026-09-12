#!/bin/bash
# Postavljanje pulta za lokalni rad: provjeri okruženje, složi .env, pokreni provjere.
# Pokreni iz korijena projekta:  bash scripts/postavi.sh
set -u

CRVENA=$'\033[31m'; ZELENA=$'\033[32m'; ZUTA=$'\033[33m'; SIVA=$'\033[90m'; KRAJ=$'\033[0m'
ok()    { printf "%s✓%s %s\n" "$ZELENA" "$KRAJ" "$1"; }
info()  { printf "%s•%s %s\n" "$SIVA" "$KRAJ" "$1"; }
upoz()  { printf "%s!%s %s\n" "$ZUTA" "$KRAJ" "$1"; }
greska(){ printf "%s✗%s %s\n" "$CRVENA" "$KRAJ" "$1"; exit 1; }

cd "$(dirname "$0")/.." || greska "Ne mogu pronaći korijen projekta."
[ -f package.json ] || greska "Pokreni ovo iz mape projekta (nema package.json)."

echo
echo "  Elink ICT — postavljanje pulta"
echo "  ─────────────────────────────"
echo

# --- Node ---
command -v node >/dev/null 2>&1 || greska "Node nije instaliran. Preuzmi ga s https://nodejs.org (verzija 22 ili novija)."
VERZIJA=$(node -p "process.versions.node.split('.')[0]")
[ "$VERZIJA" -ge 22 ] || greska "Potreban je Node 22 ili noviji (imaš $(node -v)). Pult koristi ugrađeni node:sqlite."
ok "Node $(node -v)"

command -v openssl >/dev/null 2>&1 || greska "Nedostaje openssl (treba za generiranje tajni)."

# --- Ovisnosti ---
if [ -d node_modules ]; then
  ok "Ovisnosti već instalirane"
else
  info "Instaliram ovisnosti…"
  npm install --no-fund --no-audit >/dev/null 2>&1 || greska "npm install nije uspio. Pokreni ga ručno da vidiš grešku."
  ok "Ovisnosti instalirane"
fi

# --- .env ---
if [ -f .env ]; then
  echo
  upoz ".env već postoji."
  printf "  Prepisati ga? Postojeće vrijednosti se gube. [d/N] "
  read -r ODGOVOR
  case "$ODGOVOR" in
    d|D|y|Y) cp .env ".env.backup.$(date +%Y%m%d%H%M%S)"; ok "Sigurnosna kopija spremljena" ;;
    *) echo; info "Ostavljam .env kakav jest."; echo; exit 0 ;;
  esac
fi

echo
echo "  Trebaju mi četiri podatka. Odakle ih uzeti piše u README.md, korak 1."
echo

pitaj() { # pitaj VARIJABLA "Pitanje" "napomena"
  local ime="$1" pitanje="$2" napomena="${3:-}" vrijednost=""
  while [ -z "$vrijednost" ]; do
    [ -n "$napomena" ] && printf "  %s%s%s\n" "$SIVA" "$napomena" "$KRAJ"
    printf "  %s: " "$pitanje"
    read -r vrijednost
    [ -z "$vrijednost" ] && printf "  %sOvo je obavezno.%s\n" "$ZUTA" "$KRAJ"
  done
  eval "$ime=\$vrijednost"
  echo
}

pitaj CLIENT_ID "Google Client ID" "završava s .apps.googleusercontent.com"
pitaj CLIENT_SECRET "Google Client Secret" "počinje s GOCSPX-"
pitaj TABLICA "SHEET_ID" "iz adrese tablice, dio između /d/ i /edit"
pitaj EMAIL "Tvoj Google e-mail" "samo se s te adrese može prijaviti"

# Tajne se generiraju ovdje, na tvom računalu — ne putuju kroz razgovor.
SESIJA=$(openssl rand -hex 32)
SIFRA=$(openssl rand -hex 32)

cat > .env <<KRAJ_ENV
# Složeno skriptom scripts/postavi.sh — $(date '+%d.%m.%Y. %H:%M')
GOOGLE_CLIENT_ID=$CLIENT_ID
GOOGLE_CLIENT_SECRET=$CLIENT_SECRET
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
SHEET_ID=$TABLICA
SESSION_SECRET=$SESIJA
ENCRYPTION_KEY=$SIFRA
ALLOWED_EMAILS=$EMAIL
DB_PATH=./data/pult.db
PORT=3000
BASE_URL=http://localhost:3000
NODE_ENV=development
SENDER_EMAIL=$EMAIL

# Chat "Pitaj Claudea" — neobavezno, ključ s console.anthropic.com
ANTHROPIC_API_KEY=
KRAJ_ENV

chmod 600 .env
ok ".env složen (tajne generirane lokalno, čitljiv samo tebi)"

# --- Provjere ---
info "Pokrećem provjere…"
if npm test >/dev/null 2>&1; then
  ok "Sve provjere prolaze"
else
  upoz "Neke provjere ne prolaze — pokreni 'npm test' da vidiš koje."
fi

echo
echo "  Gotovo. Sljedeće:"
echo
echo "    npm start          pa otvori http://localhost:3000"
echo
echo "  Ako prijava javi grešku, provjeri je li u Google konzoli"
echo "  upisan redirect URI:"
echo "    http://localhost:3000/auth/google/callback"
echo "  i je li tvoja adresa pod Test users."
echo
