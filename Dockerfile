FROM node:20-alpine

WORKDIR /app

COPY index.html server.js ./

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=1455

EXPOSE 1455

USER node

CMD ["node", "server.js"]
