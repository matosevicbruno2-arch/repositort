# Node 22 je uvjet: pult koristi ugrađeni node:sqlite, kojeg starije verzije nemaju.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Ovisnosti se instaliraju prije kopiranja koda, da se sloj ponovno koristi
# dok se package.json ne promijeni.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

# Baza ide na priključeni disk; bez njega se prijava gubi pri svakoj objavi.
ENV DB_PATH=/data/pult.db
VOLUME ["/data"]

# Ne pokreći poslužitelj kao root.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
