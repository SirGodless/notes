# ---- Stufe 1: bauen ---------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Erst nur die Manifeste kopieren: solange sich die Abhaengigkeiten nicht
# aendern, bleibt die npm-ci-Schicht im Cache und der Rebuild ist schnell.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Stufe 2: ausliefern ----------------------------------------------------
FROM nginx:alpine AS serve

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget --spider -q http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
