/**
 * Dieser Service Worker verarbeitet eingehende Push-Nachrichten,
 * wenn das Handy im Standby ist.
 */

importScripts('https://www.gstatic.com/firebasejs/11.6.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging-compat.js');

// WICHTIG: Die Konfiguration muss hier erneut rein
const firebaseConfig = {
    // Kopiere deine Config hierher
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Hintergrund-Nachrichten verarbeiten
messaging.onBackgroundMessage((payload) => {
    console.log('[sw.js] Background Message:', payload);
    
    const notificationTitle = payload.notification.title;
    const notificationOptions = {
        body: payload.notification.body,
        icon: 'https://fav.farm/🎢',
        vibrate: [300, 100, 300],
        tag: 'ep-strategy-alert'
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});
