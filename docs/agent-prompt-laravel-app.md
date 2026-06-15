# Prompt agent — Application Laravel « roadtrip »

> Copie-colle ce document comme brief à un agent de code. Il est **autonome** :
> tout le contexte nécessaire y est. Ne suppose aucun accès à des échanges
> antérieurs.

---

## 1. Mission

Tu construis une **application web Laravel, auto-hébergée et open source**, qui
permet de fabriquer des « films de road trip » à partir d'images Google Street
View prises le long d'un itinéraire — puis de les visionner, exporter en MP4 et
partager.

L'app est **mono-utilisateur par instance** : chaque personne déploie sa propre
copie et fournit **sa propre clé Google Maps via `.env`** (pas de comptes, pas
de multi-tenant, pas de stockage de clé en base).

## 2. Contexte technique du domaine (à connaître absolument)

Le dépôt contient déjà :
- `Site/` — un lecteur web : il affiche une séquence de JPG sur un `<canvas>` à
  raison d'une image toutes les **40 ms**, avec effets rétro (via `glfx.js`),
  son de fond et une timeline cliquable. C'est le moteur de lecture à réutiliser.
- `pipeline/` — des scripts Node (sans dépendance) qui : calculent un parcours
  (Google **Directions API** *ou* fichier **GPX**), rééchantillonnent un point
  tous les ~10 m avec un cap (`heading`) géodésique, découpent en **lots**, puis
  téléchargent les images **Street View Static API**. Toute cette logique métier
  est à **porter en PHP** (voir §11).

**Réalités des API Google (déterminent toute l'architecture quota) :**
- Le téléchargement utilise **Street View Static API** (SKU *Essentials*) :
  facturé **par image**, avec **~10 000 requêtes gratuites/mois** puis ~0,007 $/
  image. Le quota gratuit **se réinitialise par mois calendaire**.
- L'endpoint **Street View Static Metadata est GRATUIT** : il faut s'en servir
  pour vérifier qu'il existe de l'imagerie à une position *avant* de payer une
  image (évite de gaspiller le quota sur les zones sans Street View).
- **Directions API** sert au calcul d'itinéraire.
- La **facturation doit être activée** côté Google Cloud même pour rester dans
  le gratuit ; un dépassement est facturé automatiquement. Le garde-fou est donc
  applicatif : un **budget mensuel** à ne pas dépasser.
- Concepts clés : un **segment** = un dossier d'images numérotées depuis 0 ; une
  **frame globale** = index continu sur tout le parcours ; un **lot** = une
  tranche de frames téléchargée par cycle mensuel (≈ le budget gratuit mensuel).

## 3. Principes directeurs

- **Suis les conventions standard de Laravel** et PSR-12 : arborescence par
  défaut, contrôleurs de ressource, Eloquent, validation via Form Requests,
  enums et typage PHP moderne.
- Lis la clé API et les réglages via le helper `config()` (évite `env()` en
  dehors des fichiers `config/`, comportement recommandé par Laravel).
- Garde le code lisible et testé, sans sur-ingénierie.

## 4. Stack

- Laravel (dernière version stable), PHP 8.3+.
- Base : SQLite par défaut (zéro config pour l'auto-hébergement), MySQL/Postgres
  supportés.
- Files d'attente : driver `database` par défaut (Redis optionnel et recommandé
  pour le throttling fin).
- Temps réel page de statut : polling simple suffit en MVP ; **Laravel Reverb**
  optionnel.
- **ffmpeg** requis sur l'hôte pour l'export MP4 (appelé via le `Process`
  Laravel).
- Front : Blade + un peu de JS. Carte via **Leaflet/MapLibre** ou Google Maps JS.
  Réutiliser le lecteur canvas de `Site/` pour l'aperçu.

## 5. Périmètre fonctionnel (flux utilisateur)

1. **Créer un projet** (un trajet/film).
2. **Définir l'itinéraire** dans un éditeur : soit via Google Directions
   (origine / destination / waypoints / mode), soit par **upload d'un GPX**.
   Prévisualiser le tracé sur la carte.
3. **Planifier** : l'app calcule les points (tous les `step_m` mètres), le
   `heading`, le nombre total d'images, la découpe en segments + lots, et
   affiche une **estimation** : nombre d'images, distance (km), **coût estimé**
   et **nombre de mois** au rythme gratuit.
4. **Lancer la récupération** : elle s'exécute **en tâche de fond via des jobs**,
   à un **rythme qui respecte le budget mensuel gratuit** (gouverneur de quota,
   §8). Possibilité de mettre en pause / reprendre.
5. **Suivre la progression** sur une **page de statut** (par lot, images
   récupérées, trous, ETA en mois).
6. **Page de stats / consommation** (exigence explicite, §10) : suivre la
   consommation de génération d'images dans le temps.
7. **Aperçu permanent** : visionner à tout moment le film de ce qui est **déjà
   rapatrié** (lecture incrémentale sur canvas, sans encodage).
8. **Exporter en MP4** (job ffmpeg, audio optionnel) et obtenir une **URL
   partageable** `/v/{slug}` (lecture publique, sans authentification spectateur).

## 6. Modèle de données

**`projects`**
- `id`, `name`, `slug` (unique)
- `status` — enum `ProjectStatus { Draft, Planned, Fetching, Paused, Completed }`
- `route_source` — enum `RouteSource { Directions, Gpx }`
- `route_params` (json : origin, destination, waypoints[], mode) — nullable
- `gpx_path` (nullable, chemin du fichier uploadé)
- `step_m` (int, défaut 10)
- `monthly_budget` (int, défaut tiré de config — images/mois, ≈ taille de lot)
- `segment_size` (int nullable ; null = un seul segment)
- `image_settings` (json : size, pitch, fov, scale)
- `precheck_metadata` (bool, défaut true)
- `frame_count` (int nullable, renseigné après planification)
- timestamps

**`lots`**
- `id`, `project_id`
- `position` (int, ordre) + `identifier` (ex. `lot-001`)
- `start_frame`, `end_frame`, `count`
- `status` — enum `LotStatus { Pending, Running, Partial, Done }`
- `fetched_count`, `no_imagery_count`, `failed_count` (int, défaut 0)
- `last_run_at` (nullable)
- timestamps

**`renders`** (exports MP4)
- `id`, `project_id`, `slug` (unique)
- `status` — enum `RenderStatus { Queued, Encoding, Ready, Failed }`
- `fps` (int), `with_audio` (bool)
- `frame_count` (int)
- `path` (nullable), `size_bytes` (nullable), `error` (nullable)
- timestamps

**`image_usages`** (journal de consommation — alimente la page de stats)
- `id`, `project_id` (nullable pour agrégats globaux)
- `period` (string `YYYY-MM`)
- `paid_images` (int) — requêtes image facturables
- `metadata_calls` (int) — appels metadata (gratuits)
- `no_imagery` (int) — positions sans Street View (skippées)
- index unique sur (`project_id`, `period`)

> Les points du parcours (`lat,lng,heading`) ne vont **pas en base** : stocke-les
> dans un fichier `locations.txt` par projet (cf. §9). Les frames « sans
> imagerie » connues : un fichier `no-imagery.json` par projet (set d'index)
> pour ne pas re-tester gratuitement à chaque cycle.

## 7. Calcul d'itinéraire (service `RoutePlanner`)

Porte la logique de `pipeline/` en PHP :
- décodage de polyline Google (algorithme standard),
- distance haversine, cap (`bearing`) géodésique,
- **rééchantillonnage** : marcher le long de la polyline et émettre un point
  tous les `step_m` mètres (interpolation linéaire), `heading` orienté vers le
  point suivant,
- parsing GPX (`<trkpt lat lon>`, ordre d'attributs indifférent).

Sortie : liste `{lat, lng, heading}` écrite dans `locations.txt`, + construction
des segments (`{folder_name, count, start_frame}`) et des lots.

## 8. Jobs & gouverneur de quota mensuel (cœur du système)

**Jobs :**
- `PlanRouteJob` — calcule les points, écrit `locations.txt`, crée segments +
  lots, passe le projet en `Planned`.
- `FetchImageJob` (unité de travail) — pour une frame donnée :
  1. si le fichier image existe déjà → skip (reprise idempotente) ;
  2. si frame dans `no-imagery.json` → skip ;
  3. **gate budget** : si le compteur `paid_images` du **mois courant** ≥
     `monthly_budget` → le job s'arrête sans rien payer (le cycle reprendra le
     mois suivant) ;
  4. si `precheck_metadata` : appel **metadata (gratuit)** ; si statut ≠ `OK` →
     incrémente `no_imagery`, ajoute la frame à `no-imagery.json`, fin ;
  5. télécharge l'image (payant) → écrit le fichier, incrémente `paid_images`
     pour le mois (de façon atomique).
- `EncodeVideoJob` — assemble les frames en MP4 via ffmpeg (§ ci-dessous).

**Gouverneur (le « rythme qui va bien ») :**
- Le budget gratuit **se réinitialise par mois calendaire** → utilise une **clé
  de période `YYYY-MM`** dérivée de la date courante. Quand le mois change, le
  compteur de la nouvelle période est à 0 → le travail reprend **tout seul**,
  sans cron spécial « mensuel ».
- Une **commande planifiée** `app:advance-fetching` (scheduler, ex. toutes les
  quelques minutes) parcourt les projets `Fetching` et, tant que le budget
  mensuel n'est pas épuisé, **enqueue des `FetchImageJob`** pour les frames non
  résolues du lot courant. Le compteur ne compte **que les images payantes**.
- **Throttle de politesse** : limite par minute (Redis `throttle` ou middleware
  `RateLimited`) + `WithoutOverlapping` par projet, pour ne pas marteler l'API.
- Quand toutes les frames d'un lot sont résolues → lot `Done`, passe au suivant.
  Quand tous les lots sont `Done` → projet `Completed`.
- `monthly_budget` par défaut **9000** (marge sous les 10 000 gratuits, car
  retries et marge de sécurité). Configurable.

## 9. Stockage

Disque `public` (avec `php artisan storage:link`) pour que l'aperçu canvas
charge les JPG directement :
```
storage/app/public/projects/{id}/locations.txt
storage/app/public/projects/{id}/no-imagery.json
storage/app/public/projects/{id}/images/{segment_folder}/{local_index}.jpg
storage/app/public/projects/{id}/renders/{slug}.mp4
```
Expose un endpoint manifeste (`segments.json` + `configuration.json`) consommé
par le lecteur canvas.

## 10. Page de stats / consommation (exigence explicite — soigne-la)

Une page dédiée `/usage` (route `usage`) qui répond à : **« où en est ma
consommation de génération d'images ? »**. Doit afficher :

- **Mois courant** : images payantes consommées **vs budget mensuel**
  (jauge / barre de progression), **quota gratuit restant** estimé, et
  **coût estimé** du mois (images au-delà du gratuit × tarif configurable).
- **Répartition** : images payantes / appels metadata gratuits / positions sans
  imagerie.
- **Historique mensuel** : tableau ou graphe des `image_usages` par `period`
  (12 derniers mois), pour voir la consommation dans le temps.
- **Par projet** : ventilation de la consommation par projet (mois courant +
  cumul), et pour chaque projet en cours une **projection** « X images
  restantes → ~N mois au rythme gratuit ».
- **Total cumulé** : images générées depuis le début, coût cumulé estimé.

Le tarif et le budget viennent de la config (`google.cost_per_image`,
`google.free_monthly`, `google.monthly_budget`). Les chiffres proviennent de la
table `image_usages` ; n'invente pas d'appel à une API de facturation Google.

## 11. Réutilisation de l'existant

- **Lecteur canvas** : réutilise `Site/scripts/{sequencer,application,audioPlayer}.js`
  et `Site/vendor/glfx.js` pour l'aperçu live et la base de l'export. Le
  `Sequencer` lit `segments.json` + `configuration.json` + les JPG ; sers ces
  fichiers depuis les routes du projet.
- **Maths d'itinéraire** : porte `pipeline/lib/geo.js` et `pipeline/lib/route.js`
  en PHP (service `RoutePlanner`). Le format `locations.txt` (`lat,lng,heading`
  par ligne) reste identique.
- **Setup API** : un fichier `SETUP-API.md` existe déjà (activer Directions API
  + Street View Static API, facturation, clé restreinte) — référence-le dans le
  README d'install.

## 12. Routes & contrôleurs (indicatif, à respecter conventionnellement)

| Méthode | URL | Nom | Contrôleur |
|---|---|---|---|
| GET | `/projects` | `projects.index` | `ProjectsController@index` |
| GET | `/projects/create` | `projects.create` | `ProjectsController@create` |
| POST | `/projects` | `projects.store` | `ProjectsController@store` |
| GET | `/projects/{project}` | `projects.show` | `ProjectsController@show` (statut) |
| GET/PUT/DELETE | `/projects/{project}[/edit]` | … | `ProjectsController` |
| POST | `/projects/{project}/plan` | `projectPlan.store` | `ProjectPlanController@store` |
| POST | `/projects/{project}/fetch` | `projectFetch.store` | `ProjectFetchController@store` |
| DELETE | `/projects/{project}/fetch` | `projectFetch.destroy` | `ProjectFetchController@destroy` (pause) |
| GET | `/projects/{project}/preview` | `projectPreview.show` | `ProjectPreviewController@show` |
| POST | `/projects/{project}/renders` | `renders.store` | `RendersController@store` |
| GET | `/usage` | `usage` | `UsageController@index` |
| GET | `/v/{render:slug}` | `share` | `ShareController@show` (public) |

## 13. Config & `.env`

`config/services.php` :
```php
'google' => [
    'maps_key' => env('GOOGLE_MAPS_API_KEY'),
    'maps_browser_key' => env('GOOGLE_MAPS_BROWSER_KEY'),
    'monthly_budget' => env('GOOGLE_MONTHLY_BUDGET', 9000),
    'free_monthly' => env('GOOGLE_FREE_MONTHLY', 10000),
    'cost_per_image' => env('GOOGLE_COST_PER_IMAGE', 0.007),
    'rate_per_minute' => env('GOOGLE_RATE_PER_MINUTE', 120),
],
```
- `GOOGLE_MAPS_API_KEY` : clé **serveur** (Street View Static + Directions),
  jamais exposée au navigateur, jamais loggée.
- `GOOGLE_MAPS_BROWSER_KEY` : clé d'**affichage carte** (restreinte par
  referrer) — optionnelle si tu utilises Leaflet/MapLibre.
- Fournis un `.env.example` documenté.

## 14. Sécurité

- Clé serveur uniquement côté backend ; rédige-la dans les logs/exceptions.
- Comme l'app pilote **ta** clé (et donc ta facture), si l'instance est exposée
  sur Internet, protège-la par une **auth simple** (un mot de passe / un
  middleware) — configurable, désactivable en local. Les routes de **partage
  `/v/{slug}` restent publiques**.
- Valide la clé à la première utilisation (appel metadata) et affiche un
  diagnostic clair si une API n'est pas activée.

## 15. Export MP4 (ffmpeg)

- `EncodeVideoJob` génère un manifeste ordonné des frames existantes, puis
  appelle ffmpeg (concat demuxer, `1/fps` par image) pour produire le MP4 ;
  mux l'audio (`Site/medias/music/*`) si `with_audio`.
- Gère les trous (frames manquantes) en tenant la frame précédente ou en
  raccourcissant ; documente le choix.
- Statut `Encoding → Ready/Failed`, progression remontée à l'UI.

## 16. Livrables open source

- `README.md` d'install : clone, `composer install`, copie `.env`, clé Google,
  `php artisan migrate`, `storage:link`, lancer un **queue worker** et le
  **scheduler**, prérequis **ffmpeg**. Renvoie vers `SETUP-API.md`.
- `.env.example` complet.
- Tests : feature tests sur la planification, le gate de budget mensuel
  (vérifier qu'au-delà du budget aucune image payante n'est récupérée et que le
  cycle reprend à la période suivante), et la page `/usage`. Utilise les outils
  de test standard de Laravel (Pest ou PHPUnit, `RefreshDatabase`, factories).

## 17. Plan de livraison par phases

1. **Phase 1** — Projets (CRUD) + éditeur d'itinéraire (GPX + Directions) +
   `PlanRouteJob` + page d'estimation (images / km / mois / coût). Aucun
   téléchargement.
2. **Phase 2** — Récupération en tâche de fond : `FetchImageJob`, gouverneur de
   quota mensuel, throttle, page de **statut**, page de **stats/consommation**
   (§10), **aperçu canvas live** des images déjà rapatriées.
3. **Phase 3** — Export MP4 ffmpeg + partage public `/v/{slug}`.

Livre et fais valider phase par phase.

## 18. Critères d'acceptation

- On peut créer un projet, définir un itinéraire (GPX **et** Directions), et voir
  une estimation cohérente (images / km / mois / coût).
- La récupération tourne en fond et **ne dépasse jamais le budget mensuel** ; à
  l'épuisement elle s'arrête proprement et **reprend automatiquement** à la
  période suivante (prouvé par un test).
- La page `/usage` montre la consommation du mois (vs budget), la répartition
  payant/metadata/sans-imagerie, l'historique mensuel, la ventilation par projet
  et une projection en mois.
- On peut visionner à tout moment le film des images déjà présentes (canvas),
  exporter un MP4 et obtenir une URL `/v/{slug}` partageable.
- La clé n'apparaît jamais côté client ni dans les logs.

## 19. Hors périmètre / à demander si bloquant

- Pas de multi-tenant, pas d'inscription publique, pas de BYOK en base : clé en
  `.env`.
- Ne pas appeler d'API de facturation Google : les coûts/quotas sont **estimés**
  depuis la config et le journal `image_usages`.
- **À vérifier avant la phase 3** : les Google Maps Platform Terms encadrent le
  stockage durable et la republication d'imagerie Street View ; signale ce point
  et demande confirmation avant d'exposer le partage public.
