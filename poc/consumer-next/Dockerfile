FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
ENV CI=true

WORKDIR /workspace

COPY package.json README.md ./
COPY dist ./dist
COPY poc/consumer-next ./poc/consumer-next

WORKDIR /workspace/poc/consumer-next
RUN pnpm install --no-frozen-lockfile --shamefully-hoist
RUN pnpm run build

ENV PORT=3004
ENV HOSTNAME=0.0.0.0

EXPOSE 3004
CMD ["pnpm", "start"]
