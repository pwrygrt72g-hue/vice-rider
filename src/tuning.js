/* ================= RÉGLAGES DE FEEL (game feel) =================
   Constantes de "sensation" regroupées à un seul endroit lisible, pour régler
   le ressenti sans chasser des nombres magiques dans la boucle de rendu.
   Périmètre : physique de flottaison/assiette de coque + caméra. La géométrie,
   l'économie, les couleurs, etc. restent dans leurs modules respectifs.
   Valeurs pures : aucune dépendance à three.js ni au DOM.

   NB : ces nombres sont le fruit d'un tuning itératif — les commentaires
   indiquent le SENS de chaque réglage (↑/↓) pour qu'un contributeur puisse
   ajuster le feel en confiance. */

export const TUNING = {
  /* --- Flottaison & assiette de coque (modèle de coque planante) ---
     La coque est portée par une suspension masse-ressort amortie qui suit la
     houle longue et filtre le clapot court (skim). Voir la section "Flottaison
     + sauts" de la boucle. */
  hull: {
    halfLen: 1.7,        // demi-longueur d'empreinte échantillonnée avant/arrière (m)
    draftRest: 0.34,     // assiette au repos : origine du ski au-dessus de la surface (↑ = flotte plus haut)
    draftPlane: 0.34,    // supplément d'assiette au planage (la coque déjauge et se soulève)
    supportRest: 0.15,   // part de la crête portée au repos (0 = s'assoit dans le creux .. 1 = sur la crête)
    supportPlane: 0.50,  // supplément de portage au planage (skim sur les crêtes)
    stiff: 32,           // raideur de la suspension de flottaison (↑ = plus rigide/réactif)
    damp: 9.0,           // amortissement de la suspension (↑ = moins de rebond)
    sinkLimit: 0.8,      // enfoncement max sous la ligne de flottaison (m) — anti "coule"
    airPlunge: 0.28,     // dépassement de la surface portante au-delà duquel on est "en l'air"
    airArmTime: 0.35,    // temps d'air mini (s) avant d'armer l'accumulation des figures
    attitudeFollow: 10,  // vitesse de suivi de l'assiette pitch/roll : 1-exp(-dt·k) (↑ = colle à la vague)

    /* Réception d'un saut : la QUALITÉ d'atterrissage redirige le momentum.
       Nez aligné avec la trajectoire de chute + choc modéré = réception propre
       (on garde la vitesse, une part du choc vertical se reconvertit en glisse
       avant : la coque "recolle" et plane). Belly-flop / nez haut / retombée dans
       la face montante d'une vague = on laboure : gros scrub + grosse secousse. */
    land: {
      scrubBase: 0.05,   // perte de vitesse minimale même sur une réception parfaite
      scrubMax: 0.30,    // perte de vitesse additionnelle sur une réception ratée (désalignée)
      alignTol: 1.0,     // tolérance d'angle nez↔trajectoire (rad) avant scrub max (↑ = plus permissif)
      hardnessRef: 8,    // vitesse verticale d'impact (m/s) donnant un choc "dur" plein
      slopeScrub: 0.6,   // pénalité d'alignement si on retombe dans un mur d'eau montant
      carryGain: 0.12,   // fraction du choc vertical reconvertie en avancée (réception propre)
      carryMax: 3.5,     // avancée max reconvertie sur une réception propre (m/s)
    },
  },

  /* --- Caméra (FPV + chase) : réglages de ressenti "humain" par-dessus la
     physique. Étoffé à l'item caméra du polish. */
  cam: {
    fovBase: 74,         // FOV de base (deg)
    fovSpeedGain: 11,    // ajout de FOV à pleine vitesse : fov = base + gain·speedF (↑ = plus de "vitesse")
    impactDecay: 5,      // amortissement du coup d'impact caméra : exp(-dt·k) (↑ = se calme plus vite)
    joltDecay: 9,        // amortissement de la secousse caméra : exp(-dt·k)
    // Punch de FOV à l'ACCÉLÉRATION (hole-shot ressenti) : l'accél franche élargit
    // brièvement le champ, puis il se relâche. Indépendant de la vue.
    fovKickGain: 0.9,    // deg de punch par m/s² d'accélération
    fovKickMax: 9,       // punch de FOV max (deg)
    fovKickRise: 9,      // vitesse de montée du punch : 1-exp(-dt·k)
    fovKickFall: 2.4,    // vitesse de relâche du punch
    // "Thunk" de suspension DISTINCT à l'atterrissage sur l'eau (≠ secousse générique).
    landKick: 0.18,      // compression verticale caméra à la réception (m)
    landKickDecay: 8,    // relâche de la compression : exp(-dt·k)
    // Anti-plongée de la caméra chase : elle ne passe jamais sous la surface.
    chaseClearWater: 0.6, // hauteur mini au-dessus de la vague (m)
    // Grain organique de la vibration (casse la périodicité des sinus).
    shakeNoise: 0.5,     // part de bruit ajoutée à la vibration (0 = sinus purs)
  },
};
