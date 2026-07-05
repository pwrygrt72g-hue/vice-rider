/* ================= DONNÉES — modèles réels =================
   Specs issues des essais presse : vitesse max bridée ~108 km/h
   (accord constructeurs / US Coast Guard), Spark Trixx ~80 km/h.
   Données pures : aucune dépendance à three.js ni au DOM. */

export const MODELS = [
  { id: 'rxpx', kind: 'jetski', brand: 'Sea-Doo', name: 'RXP-X 325', hp: 325, top: 108, weight: 353, style: 'race',
    colors: { hull: 0x121318, deck: 0xd8232a, accent: 0x0c0d10, seat: 0x1a1c22, trim: 0xe8e8e8 } },
  { id: 'gtx', kind: 'jetski', brand: 'Sea-Doo', name: 'GTX Limited 300', hp: 300, top: 105, weight: 390, style: 'luxe',
    colors: { hull: 0x2b2f36, deck: 0xd9d5cc, accent: 0xc9a24a, seat: 0x4a3826, trim: 0x2b2f36 } },
  { id: 'spark', kind: 'jetski', brand: 'Sea-Doo', name: 'Spark Trixx', hp: 90, top: 80, weight: 139, style: 'fun',
    colors: { hull: 0x18b8c9, deck: 0xff7a1a, accent: 0xffd23c, seat: 0x22242a, trim: 0x18b8c9 } },
  { id: 'gp', kind: 'jetski', brand: 'Yamaha', name: 'GP1800R SVHO', hp: 250, top: 108, weight: 338, style: 'race',
    colors: { hull: 0x0a2e6e, deck: 0xf2f4f6, accent: 0x1a5cc9, seat: 0x14161c, trim: 0xd8232a } },
  { id: 'fx', kind: 'jetski', brand: 'Yamaha', name: 'FX Cruiser SVHO', hp: 250, top: 105, weight: 380, style: 'luxe',
    colors: { hull: 0x14161a, deck: 0x9aa3ad, accent: 0x2456b8, seat: 0x3c332a, trim: 0x9aa3ad } },
  { id: 'ultra', kind: 'jetski', brand: 'Kawasaki', name: 'Ultra 310LX', hp: 310, top: 108, weight: 465, style: 'luxe',
    colors: { hull: 0x0f130f, deck: 0x35a832, accent: 0x0f130f, seat: 0x1c1e22, trim: 0xc2c8cc } }
];

export const JETSKIS = MODELS.filter(m => m.kind === 'jetski');

export const PILOTES = [
  { id: 'sonny', name: 'Sonny', skin: 0xd9a878 },
  { id: 'rico', name: 'Rico', skin: 0x6e4a32 },
  { id: 'gina', name: 'Gina', skin: 0xc98e62 }
];

export const SUITS = [
  { id: 'rose', name: 'Rose néon', c: 0xff4d7d, c2: 0x35e0e0 },
  { id: 'turquoise', name: 'Turquoise', c: 0x1fb8c4, c2: 0xff4d7d },
  { id: 'blanc', name: 'Blanc Miami', c: 0xe8e6df, c2: 0xd4a53c },
  { id: 'noir', name: 'Noir nuit', c: 0x22242c, c2: 0xff4d7d }
];

export const QUALITIES = [
  { id: 'faible', name: 'Faible', pr: 1, segs: 288, bloom: false, shadow: 0 },
  { id: 'moyen', name: 'Moyen', pr: 1.5, segs: 384, bloom: true, shadow: 1024 },
  { id: 'eleve', name: 'Élevé', pr: 2, segs: 448, bloom: true, shadow: 2048 }
];
