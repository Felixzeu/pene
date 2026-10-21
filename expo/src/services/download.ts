import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';

/** Scarica il video montato dal backend e lo salva nel rullino (app Foto). */
export async function saveVideoToPhotos(url: string): Promise<void> {
  const perm = await MediaLibrary.requestPermissionsAsync(true); // solo scrittura
  if (!perm.granted) {
    throw new Error('Permesso negato: attiva l accesso alle Foto in Impostazioni › Expo Go › Foto.');
  }
  const dest = new File(Paths.cache, `creatorprompt-${Date.now()}.mp4`);
  try {
    await File.downloadFileAsync(url, dest);
  } catch {
    throw new Error('Download non riuscito: controlla che il backend sia raggiungibile e che il video non sia scaduto (24 ore).');
  }
  try {
    await MediaLibrary.saveToLibraryAsync(dest.uri);
  } finally {
    try { dest.delete(); } catch { /* già rimosso */ }
  }
}
