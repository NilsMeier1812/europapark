/**
 * Dieses Skript wird von GitHub Actions aufgerufen.
 * Es führt eine einmalige Prüfung durch und beendet sich dann.
 */

const admin = require('firebase-admin');
const axios = require('axios');

// Firebase Admin Initialisierung über Umgebungsvariablen (für GitHub Secrets)
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();
const appId = "ep-strategie-pro"; 

async function runCheck() {
    console.log("Starte Wartezeiten-Check...");
    
    try {
        // 1. Daten vom Europa-Park holen
        const response = await axios.get("https://queue-times.com/parks/51/queue_times.json");
        const lands = response.data.lands;
        const allRides = {};
        
        lands.forEach(land => {
            land.rides.forEach(ride => {
                allRides[ride.id] = ride;
            });
        });

        // 2. Aktive Jobs aus Firestore laden (Pfad gemäß deiner Regeln)
        const jobsSnapshot = await db.collection('artifacts').doc(appId)
            .collection('public').doc('data')
            .collection('alertJobs').where('active', '==', true).get();

        if (jobsSnapshot.empty) {
            console.log("Keine aktiven Alarme vorhanden.");
            return;
        }

        const promises = [];

        // 3. Alarme prüfen
        jobsSnapshot.forEach((doc) => {
            const job = doc.data();
            const userId = doc.id;

            job.alerts.forEach(rideId => {
                const currentRide = allRides[rideId];
                // Kriterium: Offen und weniger als 20 Min Wartezeit
                if (currentRide && currentRide.is_open && currentRide.wait_time <= 20) {
                    console.log(`Bedingung erfüllt für User ${userId}: ${currentRide.name}`);
                    
                    /**
                     * HIER FOLGT DIE PUSH-LOGIK (FCM)
                     * Da wir noch keine Push-Tokens speichern, loggen wir es hier nur.
                     * Sobald du FCM-Tokens in der DB hast, würdest du hier admin.messaging().send() aufrufen.
                     */
                }
            });
        });

        await Promise.all(promises);
        console.log("Check beendet.");

    } catch (error) {
        console.error("Fehler im Lauf:", error);
        process.exit(1);
    }
}

runCheck();
