FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @hao/worker build
CMD ["node", "apps/worker/dist/index.js"]
