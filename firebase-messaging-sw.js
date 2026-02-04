// Firebase Messaging Service Worker
// Questo file gestisce le notifiche push in background

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Configurazione Firebase (usa la stessa configurazione dell'app)
const firebaseConfig = {
  apiKey: "AIzaSyAp_2VabxjEQek4Oo8118wSOsisoytyJ_I",
  authDomain: "menu-settimanale-2913d.firebaseapp.com",
  databaseURL: "https://menu-settimanale-2913d-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "menu-settimanale-2913d",
  storageBucket: "menu-settimanale-2913d.firebasestorage.app",
  messagingSenderId: "974523761082",
  appId: "1:974523761082:web:4f4ad5c5d2b978e9f55d83"
};

// Inizializza Firebase nel service worker
firebase.initializeApp(firebaseConfig);

// Recupera l'istanza di messaging
const messaging = firebase.messaging();

// Gestione notifiche in background
messaging.onBackgroundMessage((payload) => {
  console.log('Messaggio ricevuto in background:', payload);

  const notificationTitle = payload.notification?.title || 'Menu Famiglia';
  const notificationOptions = {
    body: payload.notification?.body || 'Nuovo aggiornamento disponibile',
    icon: payload.notification?.icon || '/MealPlanner/icon-192.png',
    badge: '/MealPlanner/icon-192.png',
    data: payload.data,
    tag: 'menu-famiglia-notification',
    requireInteraction: false,
    actions: [
      {
        action: 'open',
        title: 'Apri App'
      },
      {
        action: 'close',
        title: 'Chiudi'
      }
    ]
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Gestione click sulla notifica
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          // Se c'è già una finestra aperta, mettila in focus
          for (let i = 0; i < clientList.length; i++) {
            const client = clientList[i];
            if (client.url.includes('MealPlanner') && 'focus' in client) {
              return client.focus();
            }
          }
          // Altrimenti apri una nuova finestra
          if (clients.openWindow) {
            return clients.openWindow('/MealPlanner/index.html');
          }
        })
    );
  }
});

// Gestione errori
self.addEventListener('error', (event) => {
  console.error('Service Worker error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Service Worker unhandled rejection:', event.reason);
});
