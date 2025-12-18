FROM node:22-slim

WORKDIR /app

# Copy shared CLI source
COPY src ./src

# Copy web source and config
COPY web/package.json ./web/
COPY web/tsconfig.json ./web/
COPY web/src ./web/src

WORKDIR /app/web

RUN npm install

RUN npm run build

EXPOSE 8080

CMD ["node", "dist/web/src/server.js"]
