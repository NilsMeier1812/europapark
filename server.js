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
    console.log("--- START FELD-DIAGNOSE ---");
    
    try {
        const jobsSnapshot = await db.collection('artifacts')
            .doc(appId)
            .collection('public')
            .doc('data')
            .collection('alertJobs')
            .get();

        if (jobsSnapshot.empty) {
            console.log("❌ Keine Dokumente gefunden.");
            return;
        }

        const messages = [];
        const updates = [];

        jobsSnapshot.forEach((docSnap) => {
            const job = docSnap.data();
            const userId = docSnap.id;
            
            // DIAGNOSE: Zeige uns alle vorhandenen Felder
            const fields = Object.keys(job);
            console.log(`User: ${userId} | Felder im Dokument: [${fields.join(', ')}]`);

            // Wir versuchen verschiedene Feldnamen für den Token
            const token = job.fcmToken || job.token || job.pushToken;

            if (token) {
                console.log(`✅ Token erkannt (Länge: ${token.length})`);
                
                if (job.testRequested === true) {
                    console.log(`🚀 Sende Test-Nachricht an ${userId}...`);
                    messages.push({
                        notification: {
                            title: 'EP Strategie: Test OK! ✅',
                            body: 'Der Server hat deinen Token gefunden und die Nachricht gesendet.'
                        },
                        token: token
                    });
                    updates.push({ ref: docSnap.ref });
                }
            } else {
                console.log(`❌ Kein Token-Feld gefunden. Bitte stelle sicher, dass das Feld 'fcmToken' heißt.`);
            }
        });

        if (messages.length > 0) {
            const response = await admin.messaging().sendEach(messages);
            console.log("FCM Antwort:", JSON.stringify(response));
            
            for (const item of updates) {
                await item.ref.update({ testRequested: false });
            }
        }

    } catch (error) {
        console.error("SKRIPT-FEHLER:", error);
    }
    console.log("--- ENDE FELD-DIAGNOSE ---");
}

runCheck();
