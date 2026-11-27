# ---- Builder ----
FROM node:20-alpine AS builder
WORKDIR /app

# Install build deps for native modules (pdfkit etc.)
RUN apk add --no-cache python3 make g++ openssl

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json nest-cli.json ./
COPY src ./src
COPY views ./views
COPY public ./public

RUN npm run build
RUN npm prune --omit=dev

# ---- Runner ----
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/views ./views
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package*.json ./

EXPOSE 3000

# Apply DB migrations on boot, then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
