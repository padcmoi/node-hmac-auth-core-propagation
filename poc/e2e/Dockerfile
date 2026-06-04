FROM node:20-alpine

# docker CLI lets the runner stop/start sibling containers via the mounted socket
# (used by the "offline target" scenarios). curl is for ad-hoc debugging.
RUN apk add --no-cache docker-cli curl

ENV CI=true
ENV PNPM_VERSION=10.33.0

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /workspace

COPY poc/e2e/package.json poc/e2e/tsconfig.json ./
RUN pnpm install --shamefully-hoist

COPY poc/e2e/src ./src

CMD ["pnpm", "start"]
