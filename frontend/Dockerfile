FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG BACKEND_ORIGIN=http://api:8000
ARG LAN_HOST=148.230.103.197
ARG NEXT_PUBLIC_MEDIA_HLS_BASE_URL=
ARG NEXT_PUBLIC_MEDIA_WEBRTC_BASE_URL=
ENV BACKEND_ORIGIN=$BACKEND_ORIGIN
ENV LAN_HOST=$LAN_HOST
ENV NEXT_PUBLIC_MEDIA_HLS_BASE_URL=$NEXT_PUBLIC_MEDIA_HLS_BASE_URL
ENV NEXT_PUBLIC_MEDIA_WEBRTC_BASE_URL=$NEXT_PUBLIC_MEDIA_WEBRTC_BASE_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
EXPOSE 3000
CMD ["npm", "run", "start"]