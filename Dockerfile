# ---- Stufe 1: Frontend bauen ------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Erst nur die Manifeste kopieren: solange sich die Abhaengigkeiten nicht
# aendern, bleibt die npm-ci-Schicht im Cache und der Rebuild ist schnell.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Stufe 2: ausliefern -----------------------------------------------------
# Kein nginx mehr: der Server liefert sowohl die gebauten Assets als auch die
# Datei-API aus einem einzigen Node-Prozess (server/index.ts). Der Server hat
# ausser Node selbst keine Laufzeit-Abhaengigkeiten (nur node:http, node:fs,
# node:crypto, node:path), deshalb braucht diese Stufe kein node_modules und
# kein npm ci – nur die eigenen Quelldateien.
FROM node:22-alpine AS serve

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/model ./src/model

ENV PORT=3000
ENV WORKSPACE_DIR=/app/workspace
ENV DIST_DIR=/app/dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget --spider -q http://localhost:3000/api/island || exit 1

CMD ["node", "server/index.ts"]
