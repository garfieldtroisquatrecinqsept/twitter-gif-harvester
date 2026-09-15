# Twitter GIF Harvest

Extension qui télécharge les GIF de X / Twitter en **vrais fichiers `.gif` animés**. Fonctionne sur
Chrome / Edge / Brave **et** sur Firefox.

X ne stocke pas de GIF : les « GIF » sont des MP4 muets et en boucle. L'extension récupère ce MP4, le
redécode image par image et le réencode en GIF89a **entièrement en local** — aucun service en ligne,
aucune dépendance externe, rien n'est envoyé nulle part.

## Installation — Firefox

Firefox exige qu'une extension soit signée par Mozilla pour être installée **définitivement**. Deux
options :

**Add-on temporaire** (immédiat, disparaît au redémarrage de Firefox)

1. Ouvrir `about:debugging#/runtime/this-firefox`
2. **Charger un module temporaire…**
3. Choisir `dist/twitter-gif-harvest-firefox.xpi`

Ouvrir le `.xpi` directement (double-clic, glisser-déposer, ou « Installer un module depuis un
fichier ») **ne marchera pas** : ce chemin-là exige une signature Mozilla et refuse l'extension. Sur
Firefox release, cette exigence ne peut pas être désactivée — la préférence
`xpinstall.signatures.required` n'a d'effet que sur Developer Edition, Nightly et ESR.

**Installation permanente** : faire signer le XPI par Mozilla en distribution privée
(« self-distribution »). Compte AMO gratuit, aucune publication publique, l'extension reste privée.

Soit par le site : [addons.mozilla.org/developers](https://addons.mozilla.org/developers/) → *Submit a
New Add-on* → *On your own* → envoyer le XPI → récupérer la version signée.

Soit en ligne de commande, avec des clés créées sur
[la page des clés API AMO](https://addons.mozilla.org/developers/addon/api/key/) :

```bash
npx web-ext sign --source-dir=dist/firefox --channel=unlisted --api-key=VOTRE_CLE --api-secret=VOTRE_SECRET
```

Le XPI signé atterrit dans `web-ext-artifacts/` et s'installe alors normalement, en permanence.

Le paquet Firefox se reconstruit avec :

```bash
python tools/build-firefox.py
```

Si le bouton n'apparaît pas sur X, c'est une question de permissions de site (elles sont optionnelles
en MV3 chez Mozilla) : cliquer l'icône de l'extension, le popup propose alors un bouton
**Autoriser**.

## Installation — Chrome / Edge / Brave

1. Ouvrir `chrome://extensions`
2. Activer le **mode développeur**
3. **Charger l'extension non empaquetée** et choisir le dossier `TWITTER_GIF_HARVEST` (la racine,
   pas `dist/`)

## Utilisation

- Survoler un GIF sur X : un bouton **GIF** apparaît en bas à gauche du lecteur. Un clic lance la
  conversion, le bouton affiche la progression puis le fichier part dans les téléchargements.
- Ou clic droit sur le GIF → **Telecharger ce GIF (.gif)**.
- L'icône de l'extension affiche les derniers fichiers produits et donne accès aux réglages.

## Réglages

| Réglage | Défaut | Effet |
| --- | --- | --- |
| Images par seconde max | 25 | Plafonne la fluidité sans la diviser : une source à 30 im/s plafonnée à 25 en garde 25, avec la durée exacte de chaque image |
| Largeur / hauteur max | 640 px | Redimensionne en gardant les proportions |
| Tramage Floyd-Steinberg | activé | Meilleurs dégradés, fichier un peu plus lourd |
| Tolérance inter-images | 8 | Plus haut = plus de pixels jugés identiques = fichier plus léger |
| Boucle infinie | activée | Sinon lecture unique |
| Sous-dossier | `TwitterGifHarvest` | Sous-dossier dans Téléchargements |
| Modèle de nom | `{screen_name}-{tweet_id}-{index}` | Variables : `{screen_name}` `{tweet_id}` `{index}` `{media_id}` `{date}` `{time}` |

## Architecture

Un seul code, deux enveloppes — la différence tient à *où* le navigateur autorise le décodage vidéo.

```
src/content/      détecte les <video> en /tweet_video/ et injecte le bouton
src/background/
  core.js         logique commune : réglages, nommage, téléchargement, menu contextuel, historique
  service-worker.js     Chrome : le service worker n'a pas de DOM -> délègue à un document offscreen
  background-firefox.js Firefox : la page de fond a un DOM -> convertit directement
src/lib/
  convert.js      décodage image par image + assemblage du GIF
  mp4.js          lit la table stts du MP4 -> durées d'images exactes, sans lire la vidéo
  quantize.js     palette par median cut (256 couleurs) + tramage Floyd-Steinberg
  gif.js          écriture GIF89a + compression LZW
src/offscreen/    document invisible, utilisé par Chrome uniquement
```

`manifest.json` vise Chrome, `manifest.firefox.json` vise Firefox ; `tools/build-firefox.py` assemble
le second en `dist/firefox/` + un XPI, et vérifie au passage que tout fichier référencé par le
manifeste est bien dans le paquet.

Deux choix qui font la qualité du résultat :

- **Timing exact.** Les durées d'images sont lues dans le conteneur MP4 (`stts`) plutôt que devinées
  en lisant la vidéo. C'est indispensable ici : sur Chrome le décodage tourne dans un document
  *offscreen*, donc invisible, où `requestVideoFrameCallback` peut ne jamais se déclencher. Repli
  automatique sur une estimation si le conteneur n'est pas exploitable.
- **Compression inter-images.** Chaque image n'encode que son rectangle modifié, les pixels
  identiques à l'image précédente devenant transparents. Sur un GIF à fond fixe, le gain est énorme.

## Tests

Deux bancs de test exécutables dans le navigateur. Depuis le dossier parent :

```bash
python -m http.server 8899
```

- `http://localhost:8899/TWITTER_GIF_HARVEST/tests/harness.html` — encodage
- `http://localhost:8899/TWITTER_GIF_HARVEST/tests/content-harness.html` — script de contenu

| Test | Vérifie |
| --- | --- |
| A — LZW | aller-retour encode/décode **exact au pixel** sur 2 images et 233 couleurs |
| B — transparence | le rectangle partiel et les pixels transparents laissent bien voir l'image précédente |
| C — quantification | palette de 256 couleurs, erreur moyenne < 6 par canal sur un dégradé |
| D — parseur MP4 | timescale, nombre et durées d'images lus correctement, piste audio ignorée |
| E — pipeline | vidéo réelle -> GIF : dimensions, nombre d'images et couleurs de fond conformes |
| F — plafond FPS | le plafond réduit sans diviser (30→25 donne 25 im/s), durée totale conservée au 1e-6 |
| détection | GIF reconnu par la source directe **et** déduit du poster ; vraie vidéo ignorée |
| rendu | icône SVG, libellé et positionnement du bouton dans le lecteur |
| clic | bonne URL et bonnes métadonnées envoyées, sans ouvrir le tweet |
| anti-doublon | aucune réinjection de bouton après mutation du DOM |

Les GIF produits sont vérifiés en les redécodant avec l'API `ImageDecoder` de Chrome.
Dernière exécution : tout au vert (6 tests d'encodage + 4 du script de contenu).

Le paquet Firefox passe `web-ext lint` (l'outil officiel de Mozilla) avec **0 erreur, 0 avertissement,
0 notice** :

```bash
npx web-ext lint --source-dir=dist/firefox --self-hosted
```

## Limites connues

- Ne traite que les **GIF** (`video.twimg.com/tweet_video/…`). Les vraies vidéos X sont servies en
  HLS et ne sont pas concernées.
- Un GIF reste un format à 256 couleurs par image : le rendu est forcément moins fin que le MP4
  d'origine, et le fichier plus lourd. Baisser la largeur max ou les FPS si le poids gêne.
- Plafond de 600 images par GIF.
- Le paquet Firefox demande Firefox 140+ (142+ sur Android) : c'est la version minimale qui accepte
  la déclaration de collecte de données exigée par Mozilla.
