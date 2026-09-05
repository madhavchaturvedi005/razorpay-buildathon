FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
  && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8080
ENV TZ=Asia/Kolkata
ENV HOSTNAME=0.0.0.0

EXPOSE 8080

CMD ["npm", "run", "start"]
