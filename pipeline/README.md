# pipeline — constitution des bases d'images par lots

Remplace le croquis Processing (`StreetViewImageLoader`) par deux scripts
Node.js qui calculent le parcours **et** téléchargent les images Street View
**par lots mensuels**, pour rester sous le quota gratuit (~10 000 requêtes/mois).

- **Zéro dépendance npm** — Node 18+ suffit (`fetch` natif). Pas de `npm install`.
- Source du parcours : **Google Directions** *ou* **fichier GPX**.
- Reprise automatique : un lot interrompu reprend là où il s'est arrêté.

## Configuration (une seule fois)

1. Clé API en variable d'environnement (jamais dans le dépôt) :
   ```bash
   export GOOGLE_MAPS_API_KEY="AIza...ta_cle"
   ```
   Activer **Directions API** + **Street View Static API** côté Google Cloud
   (voir `../SETUP-API.md`).
2. Créer ta config :
   ```bash
   cd pipeline
   cp config.example.json config.json
   ```
   Puis éditer `config.json` (voir champs ci-dessous).
3. Calculer le parcours et le découpage :
   ```bash
   npm run plan
   ```
   Crée `build/<route_name>/` avec `locations.txt`, `plan.json`, `state.json`
   et `segments.json` (à copier dans `../Site/data/`).

## Une fois par mois

```bash
npm run fetch      # traite le PROCHAIN lot non terminé, puis s'arrête
```

C'est tout. Le script prend automatiquement le premier lot « à faire »,
télécharge ses images (~9 000 max) dans les dossiers du Site, marque le lot
« fait » et affiche combien de lots/mois restent.

```bash
npm run status     # tableau des lots faits / à faire
npm run fetch -- --lot lot-003   # forcer un lot précis
npm run fetch -- --dry           # simuler sans télécharger
```

## Champs de `config.json`

| Champ | Rôle |
|---|---|
| `route.source` | `"directions"` ou `"gpx"` |
| `route.directions` | `origin`, `destination`, `waypoints[]`, `mode` (si source directions) |
| `route.gpx_file` | chemin du `.gpx` (si source gpx), relatif à la config |
| `step_m` | distance entre deux images (10 m = comme l'original) |
| `chunk_size` | images par lot ; **9000** garde une marge sous les 10k gratuits/mois |
| `segment_size` | taille des dossiers Site (`null` = un seul segment) |
| `route_name` | nom du parcours = dossier des images et préfixe des segments |
| `image` | `size`, `pitch`, `fov`, `scale` de l'API Street View Static |
| `precheck_metadata` | `true` : vérifie l'imagerie via l'endpoint **metadata (gratuit)** avant de payer une image — évite de gaspiller le quota sur les zones sans Street View |
| `output_dir` | racine des images, relative à la config (`../Site/medias/images`) |
| `concurrency` | requêtes simultanées (4 par défaut) |

## Sortie

- Images : `<output_dir>/<route_name>/<route_name>-NN/<index>.jpg`
- Pour le Site : copier `build/<route_name>/segments.json` dans `Site/data/`
  et régler `basedir` sur `./medias/images/<route_name>/` dans
  `Site/data/configuration.json` (+ `max_frames` = `plan.json → count`).

## Notes quota / qualité

- `precheck_metadata` interroge l'API **metadata** (gratuite) : seules les
  positions avec imagerie consomment une requête image payante. Les positions
  sans Street View sont mémorisées dans `state.json` (`noImageryFrames`) et ne
  sont plus re-testées aux runs suivants.
- Les trous (positions sans imagerie) laissent un index manquant : le Site
  affiche alors la frame précédente ~40 ms — léger micro-figement, pas bloquant.
- `build/` et `config.json` sont git-ignorés (avancement local + éventuelles
  spécificités de trajet). Les images vont dans `Site/medias/images`, déjà
  ignoré par le `.gitignore` racine.
