// Stammdaten zu den Attraktionen – hier kannst du alles anpassen.
//
// Der Schlüssel ist die Ride-ID von queue-times.com (die Namen dort sind englisch
// und ändern sich gelegentlich, die IDs bleiben stabil).
//
//   name  – deutscher Anzeigename
//   lat/lon – Position auf der Karte (aus OpenStreetMap)
//   good  – ab dieser Wartezeit (Minuten oder weniger) gibt es das „Gute Zeit“-Abzeichen
//   sr    – true, wenn es eine Single-Rider-Schlange gibt
//
// Bahnen, die hier fehlen, werden trotzdem angezeigt (mit Originalnamen, ohne Kartenpunkt).

export const RIDES = {
  // Österreich
  5606: { name: "Alpenexpress „Enzian“", lat: 48.26208, lon: 7.72264, good: 15 },
  5624: { name: "Josefinas kaiserliche Zauberreise", lat: 48.2636, lon: 7.72182, good: 15 },
  5609: { name: "Tiroler Wildwasserbahn", lat: 48.26253, lon: 7.72224, good: 20 },
  5629: { name: "Wiener Wellenflieger", lat: 48.26234, lon: 7.72295, good: 10 },
  // Kroatien
  13349: { name: "Voltron Nevera", lat: 48.26572, lon: 7.7198, good: 40 },
  13504: { name: "VirtualLine: Voltron Nevera", lat: 48.26572, lon: 7.7198, good: 40, virtual: true },
  // England
  5621: { name: "Arena of Football", lat: 48.26546, lon: 7.72114, good: 10 },
  // Frankreich
  5619: { name: "Euro-Tower", lat: 48.26706, lon: 7.72199, good: 10 },
  5737: { name: "Eurosat – CanCan Coaster", lat: 48.26745, lon: 7.72085, good: 25 },
  6280: { name: "Eurosat Coastiality", lat: 48.26746, lon: 7.72045, good: 25 },
  5738: { name: "Madame Freudenreich Curiosités", lat: 48.26724, lon: 7.72095, good: 15 },
  5604: { name: "Silver Star", lat: 48.2677, lon: 7.72032, good: 25, sr: true },
  // Deutschland
  5631: { name: "Jim Knopf – Reise durch Lummerland", lat: 48.26725, lon: 7.72268, good: 15 },
  5630: { name: "Voletarium", lat: 48.26907, lon: 7.72266, good: 25, sr: true },
  11753: { name: "VirtualLine: Voletarium", lat: 48.26907, lon: 7.72266, good: 25, virtual: true },
  // Griechenland
  5615: { name: "Abenteuer Atlantis", lat: 48.26627, lon: 7.72021, good: 15 },
  5608: { name: "Pegasus", lat: 48.26773, lon: 7.71908, good: 15 },
  5611: { name: "Wasserachterbahn Poseidon", lat: 48.26667, lon: 7.71927, good: 25 },
  11754: { name: "VirtualLine: Poseidon", lat: 48.26667, lon: 7.71927, good: 25, virtual: true },
  // Island
  5603: { name: "blue fire Megacoaster", lat: 48.26205, lon: 7.71934, good: 30, sr: true },
  5614: { name: "Whale Adventures – Northern Lights", lat: 48.26164, lon: 7.7192, good: 15 },
  5602: { name: "WODAN – Timburcoaster", lat: 48.26136, lon: 7.71889, good: 35, sr: true },
  // Irland
  5622: { name: "Ba-a-a Express", lat: 48.26623, lon: 7.72324, good: 10 },
  5623: { name: "Dancing Dingie", lat: 48.26657, lon: 7.72401, good: 10 },
  5626: { name: "Old Mac Donald's Tractor Fun", lat: 48.26642, lon: 7.7228, good: 10 },
  // Italien
  5616: { name: "Castello dei Medici", lat: 48.26792, lon: 7.72183, good: 10 },
  5620: { name: "Volo da Vinci", lat: 48.26752, lon: 7.7223, good: 20 },
  // Luxemburg
  14534: { name: "Ed & Edda – Grand Prix EDventure", lat: 48.26425, lon: 7.72057, good: 15 },
  // Königreich der Minimoys
  5618: { name: "ARTHUR", lat: 48.26363, lon: 7.72411, good: 35, sr: true },
  5627: { name: "Poppy Towers", lat: 48.26414, lon: 7.72394, good: 10 },
  // Holland
  5617: { name: "Piraten in Batavia", lat: 48.26355, lon: 7.71999, good: 15 },
  // Portugal
  5610: { name: "Atlantica SuperSplash", lat: 48.26168, lon: 7.72108, good: 20 },
  // Russland
  5605: { name: "Euro-Mir", lat: 48.2648, lon: 7.71971, good: 25, sr: true },
  // Skandinavien
  5612: { name: "Fjord-Rafting", lat: 48.26211, lon: 7.72021, good: 30 },
  7301: { name: "Snorri Touren", lat: 48.26289, lon: 7.72008, good: 20 },
  5628: { name: "Vindjammer", lat: 48.2627, lon: 7.72066, good: 10 },
  // Spanien
  5625: { name: "Kolumbusjolle", lat: 48.26166, lon: 7.72323, good: 10 },
  // Schweiz
  5607: { name: "Matterhorn-Blitz", lat: 48.26683, lon: 7.72044, good: 30 },
  5613: { name: "Schweizer Bobbahn", lat: 48.26627, lon: 7.72156, good: 20 },
};

// queue-times liefert die Themenbereiche auf Englisch
export const LANDS = {
  Austria: "Österreich",
  Croatia: "Kroatien",
  England: "England",
  France: "Frankreich",
  Germany: "Deutschland",
  Greece: "Griechenland",
  Iceland: "Island",
  Ireland: "Irland",
  Italy: "Italien",
  Luxembourg: "Luxemburg",
  "Minimoys Kingdom": "Königreich der Minimoys",
  Netherlands: "Holland",
  Portugal: "Portugal",
  Russia: "Russland",
  Scandinavia: "Skandinavien",
  Spain: "Spanien",
  Switzerland: "Schweiz",
};
