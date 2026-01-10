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
    const now = Date.now();
    
    try {
        // 1. Live Daten
        const response = await axios.get("https://queue-times.com/parks/51/queue_times.json");
        const lands = response.data.lands;
        
        const allRides = {}; 
        const miniHistory = {}; // Kompaktes Format für Historie (nur wait_time)

        lands.forEach(land => {
            land.rides.forEach(ride => {
                allRides[ride.id] = ride;
                // Wir speichern nur die Wartezeit (int), um Platz zu sparen
                miniHistory[ride.id] = ride.is_open ? ride.wait_time : -1; 
            });
        });

        // 2. Rolling History Update
        // Wir laden das einzige History-Dokument
        const historyRef = db.collection('artifacts').doc(appId)
            .collection('public').doc('data')
            .collection('history_rolling');

        const historySnap = await historyRef.get();
        let points = [];

        if (historySnap.exists) {
            points = historySnap.data().points || [];
        }

        // Bereinigen (älter als 60 Min weg)
        const cutoff = now - (60 * 60 * 1000);
        points = points.filter(p => p.t > cutoff);

        // Neuen Punkt anfügen
        points.push({ t: now, rides: miniHistory });

        // Zurückspeichern
        await historyRef.set({ points: points });
        console.log(`History aktualisiert. Punkte: ${points.length}`);

        // 3. Alarme prüfen
        const jobsSnapshot = await db.collection('artifacts').doc(appId)
            .collection('public').doc('data')
            .collection('alertJobs').where('active', '==', true).get();

        const messages = [];
        const updates = [];

        jobsSnapshot.forEach((docSnap) => {
            const job = docSnap.data();
            const fcmToken = job.fcmToken;

            if (!fcmToken) return;

            // Manueller Test
            if (job.testRequested) {
                messages.push({
                    notification: { title: 'Verbindung OK! 🚀', body: 'Alarme & History aktiv.' },
                    token: fcmToken
                });
                updates.push({ ref: docSnap.ref, data: { testRequested: false } });
            }

            // Individuelle Alarme
            if (job.alerts && typeof job.alerts === 'object') {
                Object.keys(job.alerts).forEach(rideId => {
                    const threshold = job.alerts[rideId];
                    const currentRide = allRides[rideId];

                    if (currentRide && currentRide.is_open && currentRide.wait_time <= threshold) {
                        // Optional: Hier könnte man prüfen, ob der User VORHER schon alarmiert wurde
                        // um Spam zu vermeiden (z.B. lastAlertTime im User-Doc speichern)
                        
                        messages.push({
                            notification: {
                                title: `🎯 ${currentRide.name}`,
                                body: `Nur noch ${currentRide.wait_time} min!`
                            },
                            token: fcmToken
                        });
                    }
                });
            }
        });

        if (messages.length > 0) {
            console.log(`Sende ${messages.length} Nachrichten...`);
            await admin.messaging().sendEach(messages);
        }

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
