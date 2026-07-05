MODÈLES 3D RÉELS — mode d'emploi
=================================

Le jeu charge automatiquement un modèle .glb / .gltf s'il est présent ici :

    jeu-video/vendor/models/jetski.glb   -> affiché dans le GARAGE (plateau tournant)

COMMENT OBTENIR UN MODÈLE UTILISABLE
------------------------------------
Sketchfab ne permet PAS de télécharger un modèle sans compte connecté
(l'API renvoie une erreur 401), et beaucoup de modèles ne sont pas
téléchargeables du tout. Pour en récupérer un légalement :

1. Crée un compte gratuit sur sketchfab.com
2. Ouvre un modèle marqué "Downloadable" avec une licence CC
   (ex. "JetSki Kawasaki SX-R", CC Attribution, ~19k triangles)
3. Clique "Download 3D model" -> format glTF (.glb)
4. Renomme le fichier en  jetski.glb  et dépose-le dans CE dossier
5. Recharge le jeu : le modèle apparaît dans le garage

Autres sources 100% libres et téléchargeables sans compte :
- polyhaven.com (CC0)
- quaternius.com (CC0, packs low-poly)
- kenney.nl (CC0)

CONSEILS
--------
- Privilégie un modèle sous ~50 000 triangles pour garder 60 fps.
- Le modèle "Filipino Jetski Rider RDAK" fait 500 000 triangles et n'est
  pas téléchargeable : à éviter même s'il était dispo (trop lourd).
- Le jeu recadre et met à l'échelle automatiquement le modèle.
  Si l'orientation est de travers, dis-le moi avec le nom du fichier et
  j'ajuste les constantes de calage dans src/main.js.
