# CreatorPrompt Studio

App per creator che unisce in un unico flusso: **generazione dello script** (AI gratuita) → **teleprompter** integrato mentre registri con la fotocamera → **montaggio automatico** (sottotitoli animati, silenzi tagliati, audio pulito) → **pubblicazione sui social** (YouTube Shorts, Instagram Reels, Facebook, TikTok).

Interfaccia in **italiano**, tema scuro, pensata per l'uso con una mano.

## Vincolo: costo zero

Tutto lo stack usa **solo servizi gratuiti** (free tier o open source):

| Servizio | Alternativa a pagamento evitata | Costo |
|---|---|---|
| Google Gemini API (Flash/Flash-Lite) | Claude API, OpenAI API | Gratis (free tier) |
| Ollama (alternativa 100% locale) | — | Gratis, offline |
| FFmpeg | Submagic, Kapwing | Open source |
| whisper.cpp | API Whisper a pagamento | Open source |
| YouTube Data API v3 / Instagram Graph / Facebook Pages / TikTok Content Posting | Repurpose.io | Gratis (API ufficiali) |
| Cloudflare Tunnel | ngrok a pagamento | Gratis |
| Expo Go | Account Apple Developer ($99/anno) | Gratis |

### Come ottenere ogni chiave gratis

**GEMINI_API_KEY** — Vai su https://aistudio.google.com/apikey → "Create API key" → copiala nel `backend/.env`. 
- *Limiti free tier* (possono cambiare: verifica su https://ai.google.dev/pricing): circa 10-15 richieste al minuto e 200-1500 al giorno per i modelli Flash/Flash-Lite. 
- *Se superi i limiti*: l'app riceve un errore 429 e **ripete automaticamente la richiesta con backoff esponenziale**; se la quota giornaliera è esaurita, devi aspettare il giorno dopo. 
- *⚠️ Privacy*: sul piano gratuito **Google può usare i contenuti inviati per migliorare i suoi prodotti**: non scrivere dati sensibili negli argomenti. In alternativa usa `LLM_PROVIDER=ollama` (100% locale).

**YOUTUBE_CLIENT_ID / SECRET** — https://console.cloud.google.com → nuovo progetto → "API e servizi" → attiva **YouTube Data API v3** → credenziali OAuth 2.0 (app desktop o web) → scarica client ID e secret. 
- *Limiti*: 10.000 unità di quota/giorno (un upload costa ~1600 unità = ~6 video/giorno). 
- *Se superi*: l'upload del giorno successivo funziona di nuovo; nessun costo. NB: le app in fase di "testing" hanno i token OAuth che scadono dopo 7 giorni (basta ricollegare l'account).

**META_APP_ID / SECRET** (Instagram + Facebook) — https://developers.facebook.com → crea app tipo "Business". Per pubblicare Reels serve un **account Instagram Business/Creator collegato a una Pagina Facebook** (entrambi gratuiti). 
- *Limiti*: 200 chiamate/ora per utente, 25 post alle 24 ore per Instagram. 
- *Se superi*: attendi la finestra successiva. Instagram richiede un **URL pubblico del video**: il backend lo fornisce via Cloudflare Tunnel.

**TIKTOK_CLIENT_KEY / SECRET** — https://developers.tiktok.com → gestisci app → prodotti "Content Posting API" + "Login Kit". 
- ⚠️ *Limite importante*: finché TikTok non approva la tua app (audit gratuito), i video vengono pubblicati **solo in modalità privata** (SELF_ONLY). È già implementato così; dopo l'approvazione basta cambiare `privacy_level` in `backend/src/publishers/tiktok.ts`.

**TOKEN_ENCRYPTION_KEY** — `openssl rand -hex 32`. Cifra i token OAuth sul disco (AES-256-GCM).

## Struttura

```
expo/       → app mobile (React Native + TypeScript, Expo SDK)
backend/    → API (Express + TypeScript) con FFmpeg, whisper.cpp, coda job
```

## Avvio rapido

### 1. Backend

```bash
cd backend
cp .env.example .env       # riempi le chiavi (almeno GEMINI_API_KEY)
bun install
bun run dev                # http://localhost:3000
```

Requisiti sul PC: **FFmpeg** (`apt install ffmpeg` / `brew install ffmpeg`) e **whisper.cpp**:

```bash
git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp
cmake -B build && cmake --build build --config Release -j4
curl -L -o models/ggml-base.bin https://huggingface.co/ggml-org/whisper.cpp/resolve/main/ggml-base.bin
# nel .env: WHISPER_BIN=<percorso>/build/bin/whisper-cli WHISPER_MODEL=<percorso>/models/ggml-base.bin
```

Oppure tutto in Docker (include FFmpeg + whisper.cpp precompilati):

```bash
cd backend && docker compose up --build
```

### 2. Rendere il backend raggiungibile (gratuito)

Per registrare dal telefono e per i social che vogliono un URL pubblico (Instagram/Facebook), esponi il backend con **Cloudflare Tunnel**:

```bash
cloudflared tunnel --url http://localhost:3000
```

Metti l'URL restituito in `backend/.env` (`PUBLIC_URL=...`) e in `expo/.env` (`EXPO_PUBLIC_BACKEND_URL=...`).

### 3. App

```bash
cd expo
cp .env.example .env 2>/dev/null; echo "EXPO_PUBLIC_BACKEND_URL=http://<IP-del-PC>:3000" > .env
bun install
npx expo start
```

- **Android**: scansiona il QR con l'app **Expo Go**, oppure build locale `npx expo run:android` con Android Studio.
- **iPhone**: scansiona il QR con **Expo Go** (gratuito). NOTA: installare l'app fuori da Expo Go richiede un **Apple Developer Account a pagamento**; per uso personale Expo Go è l'alternativa gratuita.

### 4. Build Android locale (gratuita)

```bash
cd expo && npx expo prebuild --platform android   # genera la cartella android/
cd android && ./gradlew assembleRelease            # APK in app/build/outputs/apk/release/
```

## Hosting gratuito del backend (limiti reali)

| Opzione | Gratis | Limiti |
|---|---|---|
| **PC locale + Cloudflare Tunnel** | Sì, illimitato | Il PC deve restare acceso; il montaggio usa la tua CPU |
| **Oracle Cloud Free Tier** | Sì (4 ARM core, 24 GB RAM) | Il montaggio è comunque lento; CPU condivisa |
| **Railway / Render free** | Credito mensile limitato | CPU minima e sleep dopo inattività: un montaggio può durare diversi minuti o andare in timeout |
| **Docker su qualsiasi VPS** | Dipende dal provider | — |

Il montaggio video è **pesante sulla CPU**: sui piani gratuiti un video da 60s può metterci 3-10 minuti. La coda del backend elabora **un job alla volta** e l'app mostra l'avanzamento in tempo reale.

## Endpoint del backend

- `POST /api/script` → `{ script, title, hashtags }` (Gemini o Ollama, con retry su 429)
- `POST /api/edit` → riceve il video (multipart, max 200 MB), ritorna `{ jobId }`
- `GET /api/edit/:jobId` → `{ stage, progress, message?, finalVideoUrl? }`
- `POST /api/publish` → pubblica sui social scelti, ritorna lo stato per ciascuno
- `GET /api/auth/:provider` e `.../callback` → OAuth2 (YouTube, Meta, TikTok con PKCE)
- `GET /api/health` → stato del server

## Scelte fatte (e cosa NON c'è)

- **CuePrompter** è solo un sito web senza API pubblica: il teleprompter è costruito dentro l'app (scroll automatico, velocità e dimensione regolabili, mirror per prompter a cristalli, countdown 3-2-1).
- **Repurpose.io** non ha piano gratuito né API di upload: la pubblicazione usa le API ufficiali dei social, ogni social come modulo indipendente con la stessa interfaccia — se uno fallisce, gli altri pubblicano comunque, e puoi premere "Riprova" su quello fallito.
- **Nessuna chiave API nell'app**: tutto passa dal backend; i token OAuth sono cifrati (AES-256-GCM).
- Sicurezza backend: rate limiting, validazione input con zod, messaggi d'errore in italiano, log, pulizia automatica dei file temporanei ogni 30 minuti.
- Video finale: **MP4 H.264, 1080×1920, 30 fps**, sottotitoli .ass con parola evidenziata in ambra, audio con riduzione rumore (afftdn) + normalizzazione (loudnorm).

## Cosa testare, passo per passo

1. **Backend + script**: avvia il backend, apri l'app → "Nuovo video" → compila e genera lo script. Se vedi l'errore quota, attendi o passa a `LLM_PROVIDER=ollama`.
2. **Fotocamera + teleprompter**: premi "Registra", prova countdown, velocità, dimensione testo, mirror e cambio camera. Registra 20 secondi.
3. **Montaggio**: rivedi il video → "Monta il video" → segui gli stati (trascrizione → montaggio → pronto). Appena i silenzi sono tagliati parte l'**anteprima live**: guardi il video già tagliato con i sottotitoli sincronizzati (parola evidenziata) mentre l'export finale prosegue sul backend. Verifica che i sottotitoli combacino con la voce.
4. **Pubblicazione**: collega almeno YouTube con le tue chiavi OAuth, pubblica, verifica il video sul canale. Prova anche "Riprova" dopo un errore volontario.
