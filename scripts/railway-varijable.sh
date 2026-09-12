#!/bin/bash
# Ispisuje blok varijabli za Railway (Variables → Raw Editor).
# Tajne se generiraju ovdje, na tvom računalu.
#   bash scripts/railway-varijable.sh
set -u

cd "$(dirname "$0")/.." || exit 1
command -v openssl >/dev/null 2>&1 || { echo "Nedostaje openssl." >&2; exit 1; }

# Postojeće vrijednosti iz .env se ponude, da ih ne prepisuješ ručno.
procitaj() {
  [ -f .env ] || return 0
  grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//'
}

CLIENT_ID=$(procitaj GOOGLE_CLIENT_ID)
CLIENT_SECRET=$(procitaj GOOGLE_CLIENT_SECRET)
TABLICA=$(procitaj SHEET_ID)
EMAIL=$(procitaj ALLOWED_EMAILS)
ANTHROPIC=$(procitaj ANTHROPIC_API_KEY)

# Produkcija dobiva vlastite tajne, različite od lokalnih.
SESIJA=$(openssl rand -hex 32)
SIFRA=$(openssl rand -hex 32)

cat <<KRAJ

Zalijepi ovo u Railway → Variables → Raw Editor:
────────────────────────────────────────────────
NODE_ENV=production
GOOGLE_CLIENT_ID=${CLIENT_ID:-<iz Google konzole>}
GOOGLE_CLIENT_SECRET=${CLIENT_SECRET:-<iz Google konzole>}
SHEET_ID=${TABLICA:-<iz adrese tablice>}
SESSION_SECRET=$SESIJA
ENCRYPTION_KEY=$SIFRA
ALLOWED_EMAILS=${EMAIL:-<tvoj@gmail.com>}
DB_PATH=/data/pult.db
SENDER_EMAIL=${EMAIL:-}
$([ -n "$ANTHROPIC" ] && echo "ANTHROPIC_API_KEY=$ANTHROPIC")
────────────────────────────────────────────────

Napomene:
  • PORT i BASE_URL ne postavljaj — Railway javlja domenu, pult je pročita.
  • DB_PATH=/data/pult.db traži priključen disk:
    Settings → Volumes → Add Volume, mount path /data
  • Nakon Generate Domain dodaj u Google konzolu redirect URI:
    https://<tvoja-domena>/auth/google/callback

KRAJ
