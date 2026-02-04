// Service Worker per Menu Famiglia PWA
const CACHE_NAME = 'menu-famiglia-v1';
const urlsToCache = [
  '/MealPlanner/index.html',
  '/MealPlanner/manifest.json'
];

// Installazione Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache aperta');
        return cache.addAll(urlsToCache);
      })
  );
});

// Attivazione Service Worker
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Eliminazione cache vecchia:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Intercettazione richieste
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - ritorna la risposta dalla cache
        if (response) {
          return response;
        }
        
        // Clona la richiesta
        const fetchRequest = event.request.clone();
        
        return fetch(fetchRequest).then(response => {
          // Controlla se la risposta è valida
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          
          // Clona la risposta
          const responseToCache = response.clone();
          
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });
          
          return response;
        });
      })
  );
});

// Gestione notifiche push
self.addEventListener('push', event => {
  const options = {
    body: event.data ? event.data.text() : 'Nuovo aggiornamento del menu!',
    icon: '/MealPlanner/icon-192.png',
    badge: '/MealPlanner/icon-192.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'explore',
        title: 'Visualizza Menu',
        icon: '/MealPlanner/icon-192.png'
      },
      {
        action: 'close',
        title: 'Chiudi',
        icon: '/MealPlanner/icon-192.png'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('Menu Famiglia', options)
  );
});

// Gestione click su notifica
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/MealPlanner/index.html')
    );
  }
});

// Gestione messaggi Firebase
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Background Sync per sincronizzazione offline
self.addEventListener('sync', event => {
  if (event.tag === 'sync-menu') {
    event.waitUntil(syncMenuData());
  }
});

async function syncMenuData() {
  // Implementa la logica di sincronizzazione
  // Qui puoi inviare i dati salvati offline al server quando la connessione ritorna
  console.log('Sincronizzazione menu in background...');
}

// Notifiche periodiche (richiede permesso utente)
self.addEventListener('periodicsync', event => {
  if (event.tag === 'daily-menu-reminder') {
    event.waitUntil(sendDailyReminder());
  }
});

async function sendDailyReminder() {
  const now = new Date();
  const hour = now.getHours();
  
  // Invia promemoria alle 11:00 per il pranzo e alle 17:00 per la cena
  if (hour === 11 || hour === 17) {
    const mealType = hour === 11 ? 'pranzo' : 'cena';
    const options = {
      body: `È ora di preparare il ${mealType}!`,
      icon: '/MealPlanner/icon-192.png',
      badge: '/MealPlanner/icon-192.png',
      tag: 'meal-reminder'
    };
    
    await self.registration.showNotification('Promemoria Menu', options);
  }
}
