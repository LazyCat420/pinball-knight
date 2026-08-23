# ============================================================
# Pinball Knight — Standalone Three.js / WebGPU Client
# ============================================================

# Stage 1: Build static distribution with Vite
FROM node:26-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm
RUN apk add --no-cache python3 make g++ cairo-dev pango-dev jpeg-dev giflib-dev pixman-dev

COPY package.json pnpm-workspace.yaml* pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile=false

# Copy source and config files
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
COPY components ./components

# Build production bundle to dist/
RUN pnpm run build

# Stage 2: Serve with Nginx Alpine
FROM nginx:alpine

# Remove default nginx assets
RUN rm -rf /usr/share/nginx/html/*

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy build artifacts
COPY --from=builder /app/dist /usr/share/nginx/html
RUN chmod -R 755 /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 -O /dev/null http://127.0.0.1:80/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
