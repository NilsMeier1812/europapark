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
    console.log("--- START CHECK ---");
    
    try {
        // 1. Live Daten
        const response = await axios.get("https://queue-times.com/parks/51/queue_times.json");
        const lands = response.data.lands;
        const allRides = {};
        lands.forEach(land => land.rides.forEach(ride => { allRides[ride.id] = ride; }));

        // 2. Jobs
        const jobsSnapshot = await db.collection('artifacts').doc(appId)
            .collection('public').doc('data')
            .collection('alertJobs').get();

        const messages = [];
        const updates = [];

        jobsSnapshot.forEach((docSnap) => {
            const job = docSnap.data();
            const userId = docSnap.id;
            const fcmToken = job.fcmToken;

            if (!fcmToken) return;

            // Manueller Verbindungstest
            if (job.testRequested) {
                messages.push({
                    notification: { title: 'Verbindung OK! 🚀', body: 'Deine Custom-Alarme sind jetzt aktiv.' },
                    token: fcmToken
                });
                updates.push({ ref: docSnap.ref, data: { testRequested: false } });
            }

            // ECHTE PRÜFUNG
            // job.alerts ist jetzt ein Objekt: { "123": 20, "456": 15 }
            if (job.alerts && typeof job.alerts === 'object') {
                
                Object.keys(job.alerts).forEach(rideId => {
                    const threshold = job.alerts[rideId];
                    const currentRide = allRides[rideId];

                    if (currentRide && currentRide.is_open) {
                        // Logik: Ist Wartezeit kleiner/gleich Schwellwert?
                        if (currentRide.wait_time <= threshold) {
                            
                            // Spam-Schutz: Wir könnten hier prüfen, ob wir schon benachrichtigt haben
                            // Fürs erste senden wir einfach (GitHub läuft ja nur alle 5-10 min)
                            
                            console.log(`ALARM ${userId}: ${currentRide.name} (${currentRide.wait_time} min <= ${threshold})`);
                            
                            messages.push({
                                notification: {
                                    title: `🎯 ${currentRide.name}`,
                                    body: `Wartezeit nur ${currentRide.wait_time} min (Dein Limit: ${threshold} min)!`
                                },
                                token: fcmToken
                            });
                        }
                    }
                });
            }
        });

        if (messages.length > 0) {
            console.log(`Sende ${messages.length} Nachrichten...`);
            await admin.messaging().sendEach(messages);
        }

        // Clean up
        for (const up of updates) {
            await up.ref.update(up.data);
        }

    } catch (error) {
        console.error("ERROR:", error);
        process.exit(1);
    }
    console.log("--- ENDE CHECK ---");
}

runCheck();
