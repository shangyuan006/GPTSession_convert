FROM node:24-alpine

WORKDIR /app

COPY index.html server.js ./
COPY static ./static

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=1455

EXPOSE 1455

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:1455/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

USER node

CMD ["node", "server.js"]
