# Build stage
FROM node:22-alpine3.21 AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . ./

# Production stage
FROM node:22-alpine3.21
WORKDIR /app
RUN apk add --no-cache chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
COPY --from=builder /app ./
CMD ["node", "--import", "tsx", "src/Main.ts"]
