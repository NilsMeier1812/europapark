importScripts('https://www.gstatic.com/firebasejs/11.6.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyAf4nF5XItLd6CC3sdQ_ePEYduaSTdXjGI",
  authDomain: "ep-pro-c768d.firebaseapp.com",
  projectId: "ep-pro-c768d",
  storageBucket: "ep-pro-c768d.firebasestorage.app",
  messagingSenderId: "678617107748",
  appId: "1:678617107748:web:11c73addee5db76f26f7b1",
  measurementId: "G-1MBSKD8ZH4"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    console.log('Background Message:', payload);
    const notificationTitle = payload.notification.title;
    const notificationOptions = {
        body: payload.notification.body,
        icon: 'https://fav.farm/🎢',
        vibrate: [300, 100, 300],
        tag: 'ep-alert'
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});
