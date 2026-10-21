# CreatorPrompt backend — immagine self-contained con FFmpeg e whisper.cpp.
# Costruzione: docker build -t creatorprompt-backend .
FROM node:20-slim AS build
WORKDIR /app
COPY package.json ./
RUN bun install --frozen-lockfile || npm install
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git build-essential cmake curl && rm -rf /var/lib/apt/lists/*
# whisper.cpp: compilato dai sorgenti (open source, nessun servizio a pagamento)
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp /opt/whisper.cpp \
    && cd /opt/whisper.cpp && cmake -B build -DGGML_CUDA=OFF && cmake --build build --config Release -j2 \
    && cp build/bin/whisper-cli /usr/local/bin/whisper-cli \
    && mkdir /models
# Scarica un modello leggero multilingue (~466 MB). Esiste anche base.en per l'inglese.
RUN curl -L -o /models/ggml-base.bin https://huggingface.co/ggml-org/whisper.cpp/resolve/main/ggml-base.bin

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY public ./public
ENV WHISPER_BIN=/usr/local/bin/whisper-cli WHISPER_MODEL=/models/ggml-base.bin
EXPOSE 3000
CMD ["node", "dist/index.js"]
