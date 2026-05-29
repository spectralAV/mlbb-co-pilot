# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/package-lock.json ./backend/
COPY frontend/package.json frontend/package-lock.json ./frontend/

RUN npm ci \
  && cd backend && npm ci \
  && cd ../frontend && npm ci

COPY . .

RUN npm run build \
  && npm prune --omit=dev \
  && cd backend && npm prune --omit=dev \
  && cd ../frontend && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787

WORKDIR /app/backend

COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/package.json ./package.json
COPY --from=build /app/backend/package-lock.json ./package-lock.json
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/frontend/dist /app/frontend/dist
COPY --from=build /app/data/cache/.gitkeep /app/data/cache/.gitkeep
COPY --from=build /app/data/obs /app/data/obs
COPY --from=build /app/data/map /app/data/map
COPY --from=build /app/map-runtime /app/map-runtime
COPY --from=build /app/LICENSE /app/LICENSE
COPY --from=build /app/NOTICE /app/NOTICE
COPY --from=build /app/README.md /app/README.md

EXPOSE 8787

CMD ["node", "dist/server.js"]
