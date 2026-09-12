#!/bin/bash
# Pretvara Appleov .p8 ključ u jedan redak za APNS_KEY.
#   bash scripts/apns-kljuc.sh ~/Downloads/AuthKey_ABC1234567.p8
set -u

DATOTEKA="${1:-}"
if [ -z "$DATOTEKA" ]; then
  echo "Upotreba: bash scripts/apns-kljuc.sh <putanja do .p8>" >&2
  exit 1
fi
[ -f "$DATOTEKA" ] || { echo "Ne postoji: $DATOTEKA" >&2; exit 1; }
grep -q "BEGIN PRIVATE KEY" "$DATOTEKA" || { echo "To ne izgleda kao .p8 ključ." >&2; exit 1; }

# Key ID je u nazivu datoteke: AuthKey_ABC1234567.p8
KEY_ID=$(basename "$DATOTEKA" | sed -n 's/^AuthKey_\([A-Z0-9]*\)\.p8$/\1/p')

echo
echo "Dodaj u .env (ili u Railway varijable):"
echo "────────────────────────────────────────────────"
[ -n "$KEY_ID" ] && echo "APNS_KEY_ID=$KEY_ID"
echo "APNS_TEAM_ID=<Team ID, gore desno na developer.apple.com>"
echo "APNS_BUNDLE_ID=hr.elink.pult"
printf 'APNS_KEY="'
awk 'BEGIN{ORS="\\n"} {print}' "$DATOTEKA"
printf '"\n'
echo "APNS_PRODUCTION=0"
echo "────────────────────────────────────────────────"
echo
echo "APNS_PRODUCTION: 0 za build iz Xcodea, 1 za TestFlight i App Store."
echo
