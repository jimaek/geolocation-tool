FROM node:22-slim

WORKDIR /app

# Copy and install root dependencies (for shared src)
COPY package.json ./
RUN npm install --omit=dev

# Copy shared CLI source
COPY src ./src

# Copy web source, config, and assets
COPY web/package.json ./web/
COPY web/tsconfig.json ./web/
COPY web/src ./web/src
COPY web/assets ./web/assets

WORKDIR /app/web

RUN npm install

RUN npm run build

EXPOSE 8080

CMD ["node", "dist/web/src/server.js"]
