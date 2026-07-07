/* ================= DONNÉES — modèles (marques FICTIVES) =================
   Marques et noms 100 % inventés (WAVE-DOO / MARLIN / RIPTIDE) : aucune
   référence à un constructeur réel -> jeu commercialisable (CrazyGames, stores).
   Les specs restent des ordres de grandeur crédibles pour le feeling arcade.
   Données pures : aucune dépendance à three.js ni au DOM. */

export const MODELS = [
  { id: 'rxpx', kind: 'jetski', brand: 'WAVE-DOO', name: 'RX-9 Turbo', hp: 325, top: 108, weight: 353, style: 'race',
    colors: { hull: 0x121318, deck: 0xd8232a, accent: 0x0c0d10, seat: 0x1a1c22, trim: 0xe8e8e8 } },
  { id: 'gtx', kind: 'jetski', brand: 'WAVE-DOO', name: 'Grand Cruiser 300', hp: 300, top: 105, weight: 390, style: 'luxe',
    colors: { hull: 0x2b2f36, deck: 0xd9d5cc, accent: 0xc9a24a, seat: 0x4a3826, trim: 0x2b2f36 } },
  { id: 'spark', kind: 'jetski', brand: 'WAVE-DOO', name: 'Trixx 90', hp: 90, top: 80, weight: 139, style: 'fun',
    colors: { hull: 0x18b8c9, deck: 0xff7a1a, accent: 0xffd23c, seat: 0x22242a, trim: 0x18b8c9 } },
  { id: 'gp', kind: 'jetski', brand: 'MARLIN', name: 'Blade 1800', hp: 250, top: 108, weight: 338, style: 'race',
    colors: { hull: 0x0a2e6e, deck: 0xf2f4f6, accent: 0x1a5cc9, seat: 0x14161c, trim: 0xd8232a } },
  { id: 'fx', kind: 'jetski', brand: 'MARLIN', name: 'Cruiser 250', hp: 250, top: 105, weight: 380, style: 'luxe',
    colors: { hull: 0x14161a, deck: 0x9aa3ad, accent: 0x2456b8, seat: 0x3c332a, trim: 0x9aa3ad } },
  { id: 'ultra', kind: 'jetski', brand: 'RIPTIDE', name: 'Storm 310', hp: 310, top: 108, weight: 465, style: 'luxe',
    colors: { hull: 0x0f130f, deck: 0x35a832, accent: 0x0f130f, seat: 0x1c1e22, trim: 0xc2c8cc } }
];

export const JETSKIS = MODELS.filter(m => m.kind === 'jetski');

export const PILOTES = [
  { id: 'sonny', name: 'Sonny', skin: 0xd9a878 },
  { id: 'rico', name: 'Rico', skin: 0x6e4a32 },
  { id: 'gina', name: 'Gina', skin: 0xc98e62 }
];

/* Tenues du pilote — mood Miami 80s. c = couleur principale, c2 = liseré/accents.
   price 0 = offerte ; bling = chaîne en or au cou (flambe façon South Beach). */
export const SUITS = [
  { id: 'rose', name: 'Rose néon', c: 0xff4d7d, c2: 0x35e0e0, price: 0 },
  { id: 'turquoise', name: 'Turquoise', c: 0x1fb8c4, c2: 0xff4d7d, price: 0 },
  { id: 'blanc', name: 'Blanc Miami', c: 0xe8e6df, c2: 0xd4a53c, price: 0 },
  { id: 'noir', name: 'Noir nuit', c: 0x22242c, c2: 0xff4d7d, price: 0 },
  { id: 'pastel', name: 'Pastel Vice', c: 0xf4a6cf, c2: 0x59d6c6, price: 400 },
  { id: 'linen', name: 'Lin South Beach', c: 0xf2efe6, c2: 0x7fc9c2, price: 700, bling: true },
  { id: 'flamingo', name: 'Flamant rose', c: 0xff5fa2, c2: 0xffd23c, price: 900 },
  { id: 'sunset', name: 'Sunset néon', c: 0xff5c3a, c2: 0xff2f8f, price: 1200 },
  { id: 'tropical', name: 'Tropical 86', c: 0x14c4a8, c2: 0xffcf3a, price: 1500 },
  { id: 'gold', name: 'Or & Onyx', c: 0x18181f, c2: 0xf5c542, price: 2200, bling: true },
  { id: 'cyber', name: 'Cyber Miami', c: 0x7a3cff, c2: 0x22e0ff, price: 2800, bling: true },
  { id: 'vice', name: 'Vice Squad', c: 0xff2f8f, c2: 0x22e0ff, price: 3600, bling: true }
];

export const QUALITIES = [
  { id: 'faible', name: 'Faible', pr: 1, segs: 288, bloom: false, shadow: 0 },
  { id: 'moyen', name: 'Moyen', pr: 1.5, segs: 384, bloom: true, shadow: 1024 },
  { id: 'eleve', name: 'Élevé', pr: 2, segs: 448, bloom: true, shadow: 2048 }
];
