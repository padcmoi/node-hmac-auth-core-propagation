FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
ENV CI=true

WORKDIR /workspace

COPY package.json README.md ./
COPY dist ./dist
COPY poc/libs ./poc/libs
COPY poc/management-nest ./poc/management-nest

WORKDIR /workspace/poc/management-nest
RUN pnpm install --no-frozen-lockfile --shamefully-hoist

ENV NODE_OPTIONS="--enable-source-maps"

EXPOSE 3001
CMD ["pnpm", "start"]
