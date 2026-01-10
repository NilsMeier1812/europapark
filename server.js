const admin = require('firebase-admin');
const axios = require('axios');

// Firebase Admin Initialisierung
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();
const appId = "ep-pro-strategie"; 

async function runCheck() {
    console.log("--- DIAGNOSE LAUF START ---");
    console.log("Suche in App-ID:", appId);
    
    try {
        // 1. Pfad-Check: Wir listen mal alle Dokumente im alertJobs Ordner auf
        // Wir probieren den Pfad absolut anzusprechen
        const jobsPath = `artifacts/${appId}/public/data/alertJobs`;
        console.log("Prüfe Pfad:", jobsPath);
        
        const jobsSnapshot = await db.collection('artifacts')
            .doc(appId)
            .collection('public')
            .doc('data')
            .collection('alertJobs')
            .get();

        console.log(`Anzahl gefundener User-Dokumente: ${jobsSnapshot.size}`);

        if (jobsSnapshot.empty) {
            console.log("❌ FEHLER: Keine Dokumente unter diesem Pfad gefunden!");
            console.log("Bitte prüfe in der Firebase Console, ob der Pfad exakt so aussieht:");
            console.log("artifacts -> ep-pro-strategie -> public -> data -> alertJobs");
            return;
        }

        const messages = [];
        const updates = [];

        jobsSnapshot.forEach((docSnap) => {
            const job = docSnap.data();
            const userId = docSnap.id;
            console.log(`Prüfe User: ${userId}`);
            console.log(`- Token vorhanden: ${!!job.fcmToken}`);
            console.log(`- testRequested: ${job.testRequested}`);

            // Test-Logik
            if (job.testRequested === true && job.fcmToken) {
                console.log(`✅ TEST-TREFFER für ${userId}! Bereite Nachricht vor...`);
                messages.push({
                    notification: {
                        title: 'EP Strategie: Verbindung steht! 🚀',
                        body: 'Dein Server-Check funktioniert. Die Rakete ist gelandet!'
                    },
                    token: job.fcmToken
                });
                updates.push({ id: userId, ref: docSnap.ref });
            }
        });

        // 2. Nachrichten senden
        if (messages.length > 0) {
            console.log(`Sende ${messages.length} Nachricht(en) via FCM...`);
            const response = await admin.messaging().sendEach(messages);
            console.log("FCM Antwort:", JSON.stringify(response));
            
            // 3. Flags zurücksetzen
            for (const item of updates) {
                await item.ref.update({ testRequested: false });
                console.log(`Flag für ${item.id} auf false gesetzt.`);
            }
        } else {
            console.log("Keine Nachrichten zu versenden.");
        }

    } catch (error) {
        console.error("KRITISCHER SKRIPT-FEHLER:", error);
        process.exit(1);
    }
    console.log("--- DIAGNOSE LAUF ENDE ---");
}

runCheck();
