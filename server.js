const admin = require('firebase-admin');
const axios = require('axios');

// Key aus Secrets laden
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();
const appId = "ep-pro-strategie"; // Pfad-Konstante muss identisch sein

async function runCheck() {
    console.log("--- SERVER START ---");
    console.log(`Prüfe Datenbank: artifacts/${appId}/public/data/alertJobs`);
    
    try {
        const jobsSnapshot = await db.collection('artifacts')
            .doc(appId)
            .collection('public')
            .doc('data')
            .collection('alertJobs')
            .get();

        if (jobsSnapshot.empty) {
            console.log("WARNUNG: Collection ist leer oder Pfad falsch.");
            return;
        }

        const messages = [];
        const updates = [];

        jobsSnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const userId = docSnap.id;
            
            // DIAGNOSE LOG: Was sehen wir im Dokument?
            // (Verkürzt den Token für Sicherheit im Log)
            const tokenPreview = data.fcmToken ? data.fcmToken.substring(0, 10) + "..." : "NICHT GEFUNDEN";
            
            if (data.testRequested === true) {
                console.log(`[TEST] User ${userId} fordert Test an.`);
                console.log(`       Token Status: ${tokenPreview}`);
                
                if (data.fcmToken) {
                    messages.push({
                        notification: {
                            title: 'Verbindung steht! 🚀',
                            body: 'Dies ist der Test vom GitHub-Server an dein Handy.'
                        },
                        token: data.fcmToken
                    });
                    // Flag zurücksetzen vormerken
                    updates.push(docSnap.ref);
                } else {
                    console.log(`       FEHLER: Test angefordert, aber kein 'fcmToken' im Dokument!`);
                }
            }
        });

        if (messages.length > 0) {
            console.log(`Versende ${messages.length} Nachrichten...`);
            const response = await admin.messaging().sendEach(messages);
            console.log("FCM Antwort:", response.successCount + " erfolgreich.");
            
            // Flags zurücksetzen
            for (const ref of updates) {
                await ref.update({ testRequested: false });
                console.log("Test-Flag zurückgesetzt.");
            }
        } else {
            console.log("Keine aktiven Aufgaben für diesen Lauf.");
        }

    } catch (error) {
        console.error("CRASH:", error);
        process.exit(1);
    }
    console.log("--- SERVER ENDE ---");
}

runCheck();
