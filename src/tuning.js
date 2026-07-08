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
    /* CALAGE v63 (MESURÉ via Box3 sur le ski PROCÉDURAL, le seul affiché — le glb
       est désactivé) : bas de carène à -0.06 local, pont jusqu'à +0.68 (carène
       haute de 0.48 m). draftRest NÉGATIF = l'origine s'enfonce sous la surface ->
       bas de carène à ~0.16 m sous l'eau (immersion 33 % de la carène), la ligne de
       flottaison COUPE la coque comme sur un vrai PWC au repos. (Ancienne valeur
       +0.34 : calée sur un bas de coque GLB à -0.79 — modèle absent/désactivé — et
       une cuvette shader supprimée depuis -> le jet flottait 28 cm DANS L'AIR.) */
    draftRest: -0.10,    // assiette au repos : origine vs surface (↑ = flotte plus haut)
    draftPlane: 0.10,    // remontée au déjaugeage (validé au banc : clairance creux 0.70->0.15 m, airtime inchangé)
    holeShotSquat: 0.10, // enfoncement de POUPE au hole-shot (gaz fort à basse vitesse) : le cul s'assoit
    planeTrim: 0.055,    // assiette de planage : ~3° nez haut permanent à pleine vitesse (l'avant sort, la poupe porte)
    supportRest: 0.15,   // part de la crête portée au repos (0 = s'assoit dans le creux .. 1 = sur la crête)
    supportPlane: 0.35,  // supplément de portage au planage (0.50->0.35 v63 : s'assoit un peu plus ENTRE les crêtes, skim préservé)
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
      realJumpAir: 0.15, // temps de vol mini (s) pour que la réception redirige le momentum —
                         // les micro-rentrées du clapot (airTime=0) gardent leur gerbe mais ne
                         // scrubbent/carrient plus (v63 : fini les à-coups permanents en houle)
      scrubBase: 0.05,   // perte de vitesse minimale même sur une réception parfaite
      scrubMax: 0.30,    // perte de vitesse additionnelle sur une réception ratée (désalignée)
      alignTol: 1.0,     // tolérance d'angle nez↔trajectoire (rad) avant scrub max (↑ = plus permissif)
      diveDepth: 0.62,   // immersion (m) au-delà de laquelle un VRAI plongeon (nez planté) freine
      diveDragK: 2.5,    // force du frein de plongeon (doux) — ne se déclenche plus sur chaque crête
      hardnessRef: 8,    // vitesse verticale d'impact (m/s) donnant un choc "dur" plein
      slopeScrub: 0.6,   // pénalité d'alignement si on retombe dans un mur d'eau montant
      carryGain: 0.12,   // fraction du choc vertical reconvertie en avancée (réception propre)
      carryMax: 3.5,     // avancée max reconvertie sur une réception propre (m/s)
    },

    /* Collision d'obstacle (île, rocher) : DÉFLEXION plutôt que mur collant.
       On retire la composante de vitesse RENTRANT dans l'obstacle (avec un peu de
       rebond) et on conserve la composante tangentielle → un frôlement GLISSE le
       long du bord, un choc frontal REBONDIT. `slide` = fraction tangentielle
       gardée ; `rest` = rebond (0 = mou, 1 = élastique). Sable (île) = mou/collant,
       rocher = dur/rebondissant. */
    collide: {
      slide: 0.9,        // conservation tangentielle sur le sable (frôlement d'île)
      rest: 0.25,        // rebond sur le sable
      rockSlide: 0.82,   // conservation tangentielle sur un rocher
      rockRest: 0.5,     // rebond sur un rocher (plus vif)
      hitSplash: 4,      // vitesse d'impact normale (m/s) au-delà de laquelle gerbe + secousse
    },

    /* POIDS RESSENTI par modèle : au-delà de l'accél de départ (déjà ∝ hp/poids),
       la masse pèse sur la GLISSE (un jet lourd erre plus loin quand on coupe) et
       sur la VIVACITÉ de lacet (il tourne plus mollement). La vitesse de POINTE est
       préservée (la traînée quadratique se recale). `ref` = poids pivot : au-dessus
       = lourd, en dessous = léger/flickable. */
    mass: {
      ref: 350,          // poids de référence (kg) — le hero (~353 kg) reste tel quel
      glide: 0.45,       // exposant masse sur la traînée linéaire : lourd = erre + longue
      yaw: 0.28,         // exposant masse sur la vivacité de lacet : lourd = tourne + mou
      yawMin: 4.0,       // borne basse de yawResp après effet masse
      yawMax: 8.5,       // borne haute (évite un ski léger trop nerveux)
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
    // v63 : l'accél est dérivée d'une vitesse LISSÉE (EMA) + clampée au domaine
    // physique de la poussée -> les impulsions d'une frame (carry d'atterrissage,
    // scrub) ne font plus pomper le FOV.
    fovKickGain: 0.9,    // deg de punch par m/s² d'accélération
    fovKickMax: 9,       // punch de FOV max (deg)
    fovKickRise: 9,      // vitesse de montée du punch : 1-exp(-dt·k)
    fovKickFall: 2.4,    // vitesse de relâche du punch
    fovAccelSmooth: 6,   // lissage EMA de la vitesse pour dériver l'accél (anti-pompage)
    fovAccelMax: 12,     // accél max prise en compte (m/s²) ≈ poussée physique max
    fovFollow: 10,       // vitesse de suivi du FOV (découplé de l'assiette de coque depuis v63)
    // "Thunk" de suspension DISTINCT à l'atterrissage sur l'eau (≠ secousse générique).
    landKick: 0.18,      // compression verticale caméra à la réception (m)
    landKickDecay: 8,    // relâche de la compression : exp(-dt·k)
    dipMax: 0.55,        // dépression FPV max cumulée (impact+jolt+land) — l'œil ne passe plus sous le guidon
    // Anti-plongée de la caméra chase : elle ne passe jamais sous la surface.
    chaseClearWater: 0.6, // hauteur mini au-dessus de la vague (m)
    // Grain organique de la vibration (casse la périodicité des sinus).
    shakeNoise: 0.5,     // part de bruit ajoutée à la vibration (0 = sinus purs)
  },
};
