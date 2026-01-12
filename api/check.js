const admin = require('firebase-admin');
const axios = require('axios');

// Vercel lädt Umgebungsvariablen automatisch
// Wir müssen prüfen, ob Firebase schon initialisiert ist (Hot Reloading bei Vercel)
if (!admin.apps.length) {
    // WICHTIG: In Vercel speichern wir den Key als Base64 oder String in den Settings
    // Hier parsen wir ihn sicher.
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();
const messaging = admin.messaging();
const appId = "ep-pro-strategie"; 
const HISTORY_RETENTION_MS = 60 * 60 * 1000;

// Das ist die Funktion, die Vercel bei jedem Aufruf startet
export default async function handler(req, res) {
    // Optional: Sicherheits-Token prüfen, damit niemand Fremdes den Check auslöst
    if (req.query.secret !== process.env.CRON_SECRET) {
        return res.status(401).send('Unauthorized');
    }

    console.log("--- START VERCEL CHECK ---");
    const now = Date.now();
    const logs = []; // Wir sammeln Logs für die Response

    const log = (msg) => {
        console.log(msg);
        logs.push(msg);
    };

    try {
        // 1. Live Daten
        const response = await axios.get("https://queue-times.com/parks/51/queue_times.json");
        const lands = response.data.lands;
        const allRides = {}; 
        const miniHistory = {};

        lands.forEach(land => {
            land.rides.forEach(ride => {
                allRides[ride.id] = ride;
                miniHistory[ride.id] = ride.is_open ? ride.wait_time : -1; 
            });
        });

        // 2. Rolling History
        const historyRef = db.collection('artifacts').doc(appId)
            .collection('public').doc('data')
            .collection('history_rolling').doc('main');

        const historySnap = await historyRef.get();
        let points = historySnap.exists ? (historySnap.data().points || []) : [];

        // Cleanup & Update
        const cutoff = now - HISTORY_RETENTION_MS;
        points = points.filter(p => p.t > cutoff);
        points.push({ t: now, rides: miniHistory });

        await historyRef.set({ points: points });
        log(`History updated. Points: ${points.length}`);

        // 3. Alarme
        const jobsSnapshot = await db.collection('artifacts').doc(appId)
            .collection('public').doc('data')
            .collection('alertJobs').where('active', '==', true).get();

        const messages = [];
        const updates = [];

        jobsSnapshot.forEach((docSnap) => {
            const job = docSnap.data();
            const fcmToken = job.fcmToken;
            if (!fcmToken) return;

            // A) Test
            if (job.testRequested) {
                messages.push({
                    notification: { title: 'Verbindung OK! 🚀', body: 'Vercel Server läuft!' },
                    token: fcmToken
                });
                updates.push({ ref: docSnap.ref, data: { testRequested: false } });
            }

            // B) Alarme
            if (job.alerts) {
                Object.keys(job.alerts).forEach(rideId => {
                    const threshold = job.alerts[rideId];
                    const currentRide = allRides[rideId];
                    if (currentRide && currentRide.is_open && currentRide.wait_time <= threshold) {
                        // Optional: Hier Logik einbauen, um nicht alle 2 min zu spammen
                        // z.B. prüfen wann der letzte Alarm war
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
            log(`Sende ${messages.length} Nachrichten...`);
            await messaging.sendEach(messages);
        } else {
            log("Keine Nachrichten zu senden.");
        }

        // Cleanup Flags
        for (const up of updates) await up.ref.update(up.data);

        res.status(200).json({ status: 'Ok', logs: logs });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
}

