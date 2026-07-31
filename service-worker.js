// I miei viaggi - Service Worker
// Permette di navigare tra le pagine dell'app anche senza connessione,
// servendole dalla cache locale se la rete non risponde.
// Stesso pattern di Diario di viaggio: incrementare NOME_CACHE ad ogni
// consegna, così un singolo hard refresh aggiorna tutte le pagine insieme.

const NOME_CACHE = 'i-miei-viaggi-cache-v1';

const FILE_DA_CACHARE = [
  './index.html',
  './nuovo-viaggio.html',
  './viaggio.html',
  './gestione-viaggio.html',
  './nuova-tappa.html',
  './guida.html',
  './pianificazione.html',
  './manifest.json',
  './icons/icona-192.png',
  './icons/icona-512.png',
  './icons/icona-180.png',
  './css/stile.css',
  './js/db-locale.js',
  './js/version.js',
  './js/export-pdf.js',
  './js/export-itinerario.js',
  './img/sfondo-app.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(NOME_CACHE).then((cache) => cache.addAll(FILE_DA_CACHARE))
  );
  self.skipWaiting(); // attiva subito la nuova versione, senza aspettare la chiusura di tutte le schede
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomi) =>
      Promise.all(
        nomi.filter((nome) => nome !== NOME_CACHE).map((nome) => caches.delete(nome))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const stessoDominio = new URL(request.url).origin === self.location.origin;
  if (!stessoDominio) {
    return; // Nominatim, Overpass, Wikimedia, Wikivoyage, tile mappa, Geoapify: gestiti dal browser, non dalla nostra cache
  }

  event.respondWith(
    fetch(request)
      .then((rispostaRete) => {
        // Richiesta riuscita: aggiorna la cache con la versione più recente
        const copia = rispostaRete.clone();
        caches.open(NOME_CACHE).then((cache) => cache.put(request, copia));
        return rispostaRete;
      })
      .catch(() =>
        // Rete non disponibile: prova a servire dalla cache, ignorando eventuali
        // parametri nell'indirizzo (es. ?id=...&data=...); se è una navigazione
        // tra pagine e non c'è nulla in cache, fallback alla home
        caches.match(request, { ignoreSearch: true }).then((risorsaCache) => {
          if (risorsaCache) return risorsaCache;
          if (request.mode === 'navigate') return caches.match('./index.html');
          return new Response('', { status: 504, statusText: 'Offline, risorsa non disponibile in cache' });
        })
      )
  );
});
