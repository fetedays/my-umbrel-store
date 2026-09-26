FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV MEDIA_ROOT=/data/media
ENV CONFIG_DIR=/data/config

EXPOSE 80

CMD ["node", "server.js"]
