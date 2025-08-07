FROM node:22-alpine

ENV NODE_ENV production

WORKDIR /app

#RUN corepack enable && yarn set version stable && yarn config set nodeLinker node-modules

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases/* ./.yarn/releases/
COPY patches/* ./patches/

RUN corepack enable && yarn install

USER 1000:1000

COPY . .

EXPOSE 8080

CMD ["node", "app.mjs"]
