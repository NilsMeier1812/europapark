/**
 * Aktualisiertes Server-Skript für GitHub Actions.
 * Unterstützt nun einen manuellen Push-Test über die App.
 */

const admin = require('firebase-admin');
const axios = require('axios');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();
const appId = "ep-pro-strategie"; 

async function runCheck() {
    console.log("Starte Lauf...");
    try {
        // 1. Daten vom Europa-Park holen
        const response = await axios.get("https://queue-times.com/parks/51/queue_times.json");
        const lands = response.data.lands;
        const allRides = {};
        lands.forEach(land => land.rides.forEach(ride => { allRides[ride.id] = ride; }));

        // 2. Alle Jobs aus Firestore laden
        const jobsSnapshot = await db.collection('artifacts').doc(appId)
            .collection('public').doc('data')
            .collection('alertJobs').get();

        if (jobsSnapshot.empty) {
            console.log("Keine Jobs gefunden.");
            return;
        }

        const messages = [];
        const jobsToUpdate = [];

        jobsSnapshot.forEach((docSnap) => {
            const job = docSnap.data();
            const userId = docSnap.id;
            const fcmToken = job.fcmToken;

            if (!fcmToken) return;

            let sendNow = false;
            let messageBody = "";

            // PRÜFUNG 1: Manueller Test-Request
            if (job.testRequested === true) {
                console.log(`Manueller Test-Push für User ${userId} angefordert.`);
                sendNow = true;
                messageBody = "🚀 Verbindungstest erfolgreich! Dein Handy empfängt Nachrichten vom GitHub-Server.";
                // Flag zurücksetzen
                jobsToUpdate.push({ id: userId, data: { testRequested: false } });
            }

            // PRÜFUNG 2: Wartezeiten (Normaler Betrieb)
            if (job.active && job.alerts) {
                job.alerts.forEach(rideId => {
                    const currentRide = allRides[rideId];
                    if (currentRide && currentRide.is_open && currentRide.wait_time <= 20) {
                        sendNow = true;
                        messageBody = `🎢 ${currentRide.name} hat nur noch ${currentRide.wait_time} min Wartezeit!`;
                    }
                });
            }

            if (sendNow && messageBody) {
                messages.push({
                    notification: {
                        title: 'EP Strategie',
                        body: messageBody
                    },
                    token: fcmToken
                });
            }
        });

        // 3. Nachrichten senden
        if (messages.length > 0) {
            console.log(`Sende ${messages.length} Nachricht(en)...`);
            await admin.messaging().sendEach(messages);
        }

        // 4. Firestore-Status aktualisieren (Test-Flags zurücksetzen)
        for (const update of jobsToUpdate) {
            await db.collection('artifacts').doc(appId)
                .collection('public').doc('data')
                .collection('alertJobs').doc(update.id).update(update.data);
        }

        console.log("Lauf erfolgreich beendet.");

    } catch (error) {
        console.error("Fehler im Skript:", error);
        process.exit(1);
    }
}

runCheck();
