const admin = require('firebase-admin');
const axios = require('axios');

// Secret muss in GitHub Settings sein
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();
const appId = "ep-pro-strategie"; 

async function runCheck() {
    console.log("--- SERVER LAUF START ---");
    
    try {
        // Holen wir die Daten aus /alertJobs
        const jobsSnapshot = await db.collection('artifacts')
            .doc(appId)
            .collection('public')
            .doc('data')
            .collection('alertJobs')
            .get();

        if (jobsSnapshot.empty) {
            console.log("WARNUNG: Keine Jobs gefunden. Datenbank leer oder Pfad falsch?");
            return;
        }

        const messages = [];
        const updates = [];

        jobsSnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const userId = docSnap.id;
            
            // DIAGNOSE
            if (data.testRequested) {
                console.log(`[TEST] User ${userId} will Test.`);
                if (data.fcmToken) {
                    console.log(`       ✅ Token gefunden! Sende Nachricht.`);
                    messages.push({
                        notification: {
                            title: 'Verbindung erfolgreich! 🚀',
                            body: 'Dein Server-Setup ist perfekt. Viel Spaß im Park!'
                        },
                        token: data.fcmToken
                    });
                    updates.push(docSnap.ref);
                } else {
                    console.log(`       ❌ FEHLER: Kein Token im Dokument.`);
                }
            }
        });

        if (messages.length > 0) {
            console.log(`Sende ${messages.length} Nachrichten an FCM...`);
            const response = await admin.messaging().sendEach(messages);
            console.log("FCM Antwort:", response.successCount + " gesendet.");
            
            for (const ref of updates) {
                await ref.update({ testRequested: false });
            }
        } else {
            console.log("Nichts zu tun.");
        }

    } catch (error) {
        console.error("CRASH:", error);
        process.exit(1);
    }
    console.log("--- SERVER LAUF ENDE ---");
}

runCheck();
