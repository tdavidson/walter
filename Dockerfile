# Walter's web API. Build: docker build -t walter .  Run: docker run -p 3790:3790 -e WALTER_API_KEY=... walter
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY engine engine
RUN npm ci --ignore-scripts && npm run build -w engine

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3790
COPY --from=build /app/engine/package.json /app/engine/LICENSE ./
COPY --from=build /app/engine/dist ./dist
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
USER node
EXPOSE 3790
CMD ["node", "dist/cli.js", "serve"]
