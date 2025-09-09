FROM node:lts-slim AS base
WORKDIR /usr/local/app

COPY package*.json ./
RUN npm install
COPY ./src ./src

FROM base AS dev
CMD ["npm", "run", "dev"]

FROM base AS prod
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]