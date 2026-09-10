importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCAm-k7_6djFPDgO-RMMtiknGT-LCnnTBc",
  authDomain: "escala-dml.firebaseapp.com",
  projectId: "escala-dml",
  storageBucket: "escala-dml.firebasestorage.app",
  messagingSenderId: "219409261265",
  appId: "1:219409261265:web:d919096c27487df65bdbf0"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body, url } = payload.data || {};
  self.registration.showNotification(title || 'Escala DML', {
    body: body || '',
    icon: '/favicon.ico',
    data: { url: url || '/' }
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(clients.openWindow(url));
});
