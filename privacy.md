# viral — Informativa sulla privacy / Privacy Policy

_Ultimo aggiornamento / Last updated: 21 ottobre 2026 / October 21, 2026_

## Italiano

**Chi tratta i dati.** viral è un'app personale. Il backend che elabora i video gira sul computer o server dell'utente stesso: non esiste un server centrale di viral che raccoglie dati.

**Quali dati usa l'app**
- **Video, audio, immagini e testi** che registri o scegli: servono solo a montare il video. I file temporanei vengono cancellati automaticamente (file di lavoro dopo 2 ore, video montati e media dopo 24 ore).
- **Argomento dello script**: viene inviato a Google Gemini (o a un modello locale Ollama) per generare il testo. Sul piano gratuito di Gemini, Google può usare questi contenuti per migliorare i propri servizi: non inserire dati sensibili.
- **Account social collegati** (TikTok, YouTube, Instagram, Facebook): l'app riceve tramite OAuth un token di accesso, salvato **cifrato** (AES-256-GCM) sul backend dell'utente. Da TikTok usa solo le informazioni di base del profilo (`user.info.basic`) e i permessi per caricare e pubblicare video (`video.upload`, `video.publish`).
- **Cronologia dei progetti**: salvata solo sul telefono.

**Cosa non facciamo.** Nessuna vendita o cessione di dati, nessuna pubblicità, nessun tracciamento, nessuna profilazione.

**Condivisione.** I dati vengono inviati solo ai servizi necessari al funzionamento: Google Gemini per lo script e i social che scegli per la pubblicazione, ciascuno con la propria informativa.

**I tuoi diritti.** Puoi cancellare in ogni momento i progetti dall'app, i token collegati (cancellando `data/tokens.json` sul backend o revocando l'accesso dalle impostazioni del social) e i file sul backend. Per richieste: https://github.com/Felixzeu/pene/issues

## English

**Who processes data.** viral is a personal app. The backend that processes videos runs on the user's own computer or server: there is no central viral server collecting data.

**What data the app uses**
- **Videos, audio, images and text** you record or select: used only to edit the video. Temporary files are deleted automatically (working files after 2 hours, edited videos and media after 24 hours).
- **Script topic**: sent to Google Gemini (or a local Ollama model) to generate the text. On Gemini's free tier, Google may use this content to improve its services: do not enter sensitive data.
- **Connected social accounts** (TikTok, YouTube, Instagram, Facebook): the app receives an OAuth access token, stored **encrypted** (AES-256-GCM) on the user's backend. From TikTok it uses only basic profile information (`user.info.basic`) and the permissions to upload and publish videos (`video.upload`, `video.publish`).
- **Project history**: stored only on the phone.

**What we don't do.** No selling or transfer of data, no advertising, no tracking, no profiling.

**Sharing.** Data is sent only to the services needed for the app to work: Google Gemini for the script and the social platforms you choose for publishing, each under its own privacy policy.

**Your rights.** You can delete projects from the app, connected tokens (by deleting `data/tokens.json` on the backend or revoking access in the platform's settings) and files on the backend at any time. For requests: https://github.com/Felixzeu/pene/issues
