FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
ENV CI=true

WORKDIR /workspace

COPY package.json README.md ./
COPY dist ./dist
COPY poc/consumer-nuxt ./poc/consumer-nuxt

WORKDIR /workspace/poc/consumer-nuxt
RUN pnpm install --no-frozen-lockfile --shamefully-hoist
RUN pnpm run build

ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=3003

EXPOSE 3003
CMD ["pnpm", "start"]
