const admin = require('firebase-admin');
const axios = require('axios');

// Secret aus GitHub Environment laden
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();
const appId = "ep-pro-strategie"; 

// Konfiguration
const HISTORY_RETENTION_MS = 60 * 60 * 1000; // 1 Stunde Historie behalten

async function runCheck() {
    console.log("--- START CHECK ---");
    const now = Date.now();
    
    try {
        // 1. Live Daten holen
        const response = await axios.get("https://queue-times.com/parks/51/queue_times.json");
        const lands = response.data.lands;
        
        const allRides = {}; // Für schnellen Zugriff bei Alarmen
        const historyData = {}; // Für die Datenbank (kompakter)

        lands.forEach(land => {
            land.rides.forEach(ride => {
                // Map für Alarme
                allRides[ride.id] = ride;
                
                // Objekt für Historie
                historyData[ride.id] = {
                    n: ride.name,
                    w: ride.wait_time,
                    o: ride.is_open
                };
            });
        });

        // 2. Alarme verarbeiten (Push)
        const jobsSnapshot = await db.collection('artifacts').doc(appId)
            .collection('public').doc('data')
            .collection('alertJobs').get();

        const messages = [];
        const updates = [];

        if (!jobsSnapshot.empty) {
            jobsSnapshot.forEach((docSnap) => {
                const job = docSnap.data();
                const userId = docSnap.id;
                const fcmToken = job.fcmToken;

                if (!fcmToken) return;

                // A) Manueller Verbindungstest
                if (job.testRequested) {
                    messages.push({
                        notification: { title: 'Verbindung OK! 🚀', body: 'Deine Alarme und Historie werden jetzt verarbeitet.' },
                        token: fcmToken
                    });
                    updates.push({ ref: docSnap.ref, data: { testRequested: false } });
                }

                // B) Echte Schwellwert-Prüfung
                if (job.alerts && typeof job.alerts === 'object') {
                    Object.keys(job.alerts).forEach(rideId => {
                        const threshold = job.alerts[rideId];
                        const currentRide = allRides[rideId];

                        if (currentRide && currentRide.is_open) {
                            if (currentRide.wait_time <= threshold) {
                                console.log(`ALARM ${userId}: ${currentRide.name} (${currentRide.wait_time} min <= ${threshold})`);
                                messages.push({
                                    notification: {
                                        title: `🎯 ${currentRide.name}`,
                                        body: `Zeit: ${currentRide.wait_time} min (Limit: ${threshold} min).`
                                    },
                                    token: fcmToken
                                });
                            }
                        }
                    });
                }
            });
        }

        // Nachrichten senden
        if (messages.length > 0) {
            console.log(`Sende ${messages.length} Nachrichten...`);
            await admin.messaging().sendEach(messages);
        }

        // Test-Flags zurücksetzen
        for (const up of updates) {
            await up.ref.update(up.data);
        }

        // 3. Historie speichern (NEU HINZUGEFÜGT)
        console.log("Speichere Historie...");
        const historyRef = db.collection('artifacts').doc(appId)
            .collection('public').doc('data')
            .collection('history');

        await historyRef.add({
            timestamp: now,
            rides: historyData
        });

        // 4. Alte Daten löschen (Cleanup)
        const cutoff = now - HISTORY_RETENTION_MS;
        const oldDocs = await historyRef.where('timestamp', '<', cutoff).get();

        if (!oldDocs.empty) {
            console.log(`Lösche ${oldDocs.size} alte Datensätze...`);
            const batch = db.batch();
            oldDocs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        }

    } catch (error) {
        console.error("ERROR:", error);
        process.exit(1);
    }
    console.log("--- ENDE CHECK ---");
}

runCheck();
