# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Vue d'ensemble

`roadtrip` génère des films à partir d'images Google StreetView prises le long
d'un itinéraire. Le projet n'a **pas de build, pas de gestionnaire de paquets,
pas de tests** : c'est un pipeline en trois étapes manuelles, chaque outil
produisant un fichier consommé par le suivant.

```
DirectionsToLatLng  →  locations.txt  →  StreetViewImageLoader  →  images  →  Site
   (HTML/JS, navigateur)                  (Processing/.pde)               (HTML/JS, navigateur)
```

## Le pipeline en trois outils

### 1. DirectionsToLatLng (`DirectionsToLatLng/index.html`)
Page HTML autonome utilisant l'API Google Maps Directions. On saisit un objet
Route Google Maps (origin/destination/waypoints en lat,lng), elle calcule un
point tous les ~10 mètres et, pour chaque point, le **heading** (cap) via
`Math.atan2` entre le point courant et le précédent. Sortie : lignes
`lat,lng,angle` à coller dans `StreetViewImageLoader/data/locations.txt`.
Nécessite une clé API Google Maps (placeholder `YOU_API_KEY` ligne ~184).

### 2. StreetViewImageLoader (`StreetViewImageLoader/StreetViewImageLoader.pde`)
Croquis **Processing** (Java), pas du JavaScript. Lit `data/locations.txt`,
appelle l'API StreetView Image pour chaque ligne (`location`, `heading`,
`pitch=-0.76`) et sauvegarde `images/<index>.jpg`. À ouvrir/exécuter dans
l'IDE Processing. Limite : 25 000 images/jour sur l'API. Les images ratées
(pas de vue, mauvaise voie, ponts) doivent être supprimées **et la séquence
renumérotée** manuellement avant l'étape 3. Clé API en dur ligne 30.

### 3. Site (`Site/`)
Le lecteur web. Affiche une image toutes les **40 ms** sur un `<canvas>` avec
effets visuels, son de fond et barre de navigation. Aucun serveur applicatif —
à servir en statique (les chemins sont relatifs, donc servir depuis `Site/`).

## Architecture du Site

Trois classes ES6 chargées via `<script>` dans `index.html` (jQuery + jQuery UI
+ glfx.js depuis CDN, glfx.js en local dans `vendor/`) :

- **`Application`** (`scripts/application.js`) — orchestrateur et point d'entrée.
  `loadConfiguration()` charge en chaîne `configuration.json` → `segments.json`
  → `places.json`, puis instancie le `Sequencer` et l'`AudioPlayer`. Gère toute
  l'UI : barre de progression (`#track`), curseur draggable, raccourcis
  (Espace = pause), clics sur lieux, bascule de filtre, focus/blur de fenêtre.
- **`Sequencer`** (`scripts/sequencer.js`) — moteur de lecture. `run()` lance un
  `setInterval` de 40 ms qui incrémente `current_frame` et appelle `nextImage()`.
  `getImageUrl()` traduit un numéro de frame global en `dossier/index.jpg` en
  parcourant les segments. Le rendu passe par **deux canvas** : `buffer_sfx`
  (canvas glfx.js WebGL pour les effets) puis `buffer_draw` (canvas visible 2D).
  4 filtres dans `pre_filter()` (effets glfx : brightness, vibrance, zoomBlur,
  vignette, noise…) et `post_filter()` (overlay scanlines, soft-light).
- **`AudioPlayer`** (`scripts/audioPlayer.js`) — Web Audio API. Charge deux
  pistes (intro jouée une fois + loop), gère le volume via un `GainNode`
  (pause = gain 0). `unlock()` débloque l'audio sur mobile (iOS).

### Système de frames, segments et places (essentiel)

Tout est indexé par un **numéro de frame global** (1 → `max_frames`).
- Un **segment** = un dossier d'images numérotées depuis 0 (`{folder_name, count}`
  dans `segments.json`). Les segments sont concaténés bout à bout : la frame
  globale 2422 correspond à l'image `0.jpg` du 2ᵉ segment si le 1ᵉʳ en a 2422.
  C'est `getSegmentStartFrame()` (Application) et `getImageUrl()` (Sequencer)
  qui font cette conversion.
- Une **place** (`places.json`) est un `point` (jalon) ou une `area` (zone
  start→end), affiché dans la nav du bas. La position peut être donnée soit en
  frame brute (`start`/`end`), soit via un ID de segment (`start_segment`/
  `end_segment`) — dans ce cas la frame est calculée au chargement.
- Distance affichée = `frame * 10 / 1000` km (≈ 1 image tous les 10 m).

## Configuration du Site (`Site/data/`)

Pour changer le trajet affiché, éditer ces trois fichiers (aucune logique de
code à toucher) :
- `configuration.json` — `max_frames`, `basedir` (dossier des images),
  chemins des fichiers segments/places, liste `audio`.
- `segments.json` — un objet `{folder_name, count}` par dossier d'images.
- `places.json` — `points` et `areas` (voir système de frames ci-dessus).

Les images vont dans `Site/medias/images/<basedir>/<folder_name>/<n>.jpg`.
Le `.gitignore` exclut `medias/images/hd`, `medias/images/sd`, les `*.mp3` et
les exports Processing (`application.*`, `applet`).

## pipeline/ — génération des images par lots (Node.js)

Alternative moderne au croquis Processing pour constituer les bases d'images.
Deux scripts Node (zéro dépendance, Node 18+) :
- `pipeline/plan.js` — calcule le parcours (source **Google Directions** ou
  **GPX**), rééchantillonne tous les `step_m` mètres, calcule le heading, et
  découpe en **segments** (dossiers Site) + **lots** (~9000 images pour rester
  sous le quota gratuit mensuel). Produit `build/<route>/` avec `locations.txt`,
  `plan.json`, `state.json`, `segments.json`.
- `pipeline/fetch.js` — télécharge le **prochain lot non terminé** puis s'arrête
  (cadence « une fois par mois »). Reprise auto (saute les fichiers présents),
  pré-vérifie l'imagerie via l'endpoint metadata **gratuit** (`precheck_metadata`)
  pour ne pas gaspiller le quota, mémorise les trous dans `state.noImageryFrames`.
- `pipeline/status.js` — avancement des lots.

Clé via env `GOOGLE_MAPS_API_KEY`. Détails dans `pipeline/README.md`. Ce flux
remplace `StreetViewImageLoader` mais produit le même `locations.txt` et la même
structure de dossiers d'images attendue par le Site.

## Clés API

Deux emplacements à renseigner avec une clé Google personnelle :
`DirectionsToLatLng/index.html` (~ligne 184) et
`StreetViewImageLoader/StreetViewImageLoader.pde` (ligne 30). Ne pas committer
de vraie clé.

## État 2026 — l'API fonctionne, mais plus tel quel (vérifié juin 2026)

Les API Google existent toujours (**Street View Static API** pour le `.pde`,
**Directions API** pour `DirectionsToLatLng`). Le *Site* ne touche aucune API au
runtime (il lit des `.jpg` locaux) donc lui n'est pas concerné. Mais le pipeline
de génération d'images ne tourne plus en l'état :

- **Clés en dur mortes** : celle du `.pde` (ligne 30) et le placeholder
  `YOU_API_KEY` du `DirectionsToLatLng` doivent être remplacées par la tienne.
- **Facturation obligatoire** : depuis 2025, il faut un compte de facturation
  activé sur un projet Google Cloud **et** les API explicitement activées
  (Street View Static API + Directions API), sinon chaque requête échoue. Mettre
  un **plafond de quota journalier** dans la console pour éviter de faire
  exploser la note si une boucle s'emballe.
- **Requêtes non signées** : le `.pde` construit une URL brute avec la clé. Ça
  marche encore mais Google recommande une signature numérique et permet de
  bloquer les requêtes non signées. La clé étant en clair, la restreindre
  (par API + quota).

### Quotas et chunking (le point qui a changé)

Le **« 25 000 images/jour gratuit » du README est obsolète** (ancien quota
journalier, plus une notion de gratuité), tout comme le crédit de 200 $/mois
(supprimé le 1ᵉʳ mars 2025). Le Street View Static est désormais un SKU
**Essentials** : **~10 000 requêtes gratuites par mois**, puis ~0,007 $/image
(dégressif).

Avec ~1 image tous les 10 m :
- Démo (~47 km, 4 714 images) → **gratuit** (sous le seuil mensuel).
- ~100 km (~10 000 images) → à la limite du gratuit.
- ~400 km (~40 000 images) → ~210 $, ou étalé sur ~4 mois pour rester gratuit.

**Il faut donc toujours chunker, mais désormais pour rester sous le seuil
mensuel de 10k** (et non plus le plafond journalier de 25k). Le `.pde` reprend
depuis `locations.txt`, donc on peut traiter par tranches de ~10 000 images/mois
pour rester à 0 €, ou activer la facturation et payer d'un coup.

Sources : [Street View Static API — Usage & Billing](https://developers.google.com/maps/documentation/streetview/usage-and-billing),
[Changes to GMP credit & pricing](https://developers.google.com/maps/billing-and-pricing/faq),
[Digital Signature](https://developers.google.com/maps/documentation/streetview/digital-signature).
