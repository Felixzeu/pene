// Messaggi di errore sempre in italiano e pronti da mostrare all'utente.
export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const ERR = {
  quotaGemini: 'Gemini ha esaurito la quota gratuita di questo minuto/giorno: riprova tra qualche minuto.',
  geminiKey: 'Chiave GEMINI_API_KEY mancante: ottenila gratis su aistudio.google.com/apikey e inseriscila nel file .env del backend.',
  ollamaDown: 'Ollama non risponde: assicurati che sia avviato (ollama serve) e che il modello sia scaricato.',
  whisperMissing: 'whisper.cpp non è installato sul backend: vedi la sezione README "Installare Whisper".',
  ffmpegMissing: 'FFmpeg non è disponibile sul backend: installalo con "apt install ffmpeg" o brew.',
  jobNotFound: 'Lavoro di montaggio non trovato o scaduto.',
  videoTooLarge: 'Il video supera il limite di 200 MB: registra una clip più corta.',
  noFile: 'Nessun video ricevuto: riprova la registrazione.',
  badProvider: 'Social non supportato.',
  notLinked: 'Account non collegato: tocca "Collega" e completa l autorizzazione nel browser.',
  publishFailed: (p: string, m: string) => `Pubblicazione su ${p} non riuscita: ${m}`,
};
