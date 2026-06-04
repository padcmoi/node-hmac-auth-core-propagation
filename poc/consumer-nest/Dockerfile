FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
ENV CI=true

WORKDIR /workspace

COPY package.json README.md ./
COPY dist ./dist
COPY poc/consumer-nest ./poc/consumer-nest

WORKDIR /workspace/poc/consumer-nest
RUN pnpm install --no-frozen-lockfile --shamefully-hoist

EXPOSE 3002
CMD ["pnpm", "start"]
