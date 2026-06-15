# Brancher l'accès aux API Google

Marche à suivre pour rendre le pipeline de génération d'images fonctionnel
(état juin 2026). Le *Site* (lecture des `.jpg`) n'a besoin d'aucune API ;
seules les étapes 1 et 2 du pipeline en ont besoin.

## Quelles API pour quel outil

| Outil | Fichier | API Google à activer |
|---|---|---|
| `DirectionsToLatLng` | `DirectionsToLatLng/index.html` | **Maps JavaScript API** + **Directions API** |
| `StreetViewImageLoader` | `StreetViewImageLoader/StreetViewImageLoader.pde` | **Street View Static API** |

---

## Étape 1 — Projet Cloud + facturation

1. Aller sur <https://console.cloud.google.com/>.
2. Créer un projet (ex. `roadtrip`).
3. **Activer la facturation** sur ce projet (menu *Billing*). C'est
   obligatoire depuis 2025, **même pour rester dans le quota gratuit** — sans
   compte de facturation lié, chaque requête échoue.

## Étape 2 — Activer les API

Dans *APIs & Services → Library*, rechercher et activer les trois :

- **Maps JavaScript API**
- **Directions API**
- **Street View Static API**

(N'activer que ce qui est listé : moins d'API exposées = moins de risque si la
clé fuite.)

## Étape 3 — Créer la clé API

1. *APIs & Services → Credentials → Create credentials → API key*.
2. Copier la clé (format `AIza...`).

Idéalement créer **deux clés séparées** (une par usage), car les bonnes
restrictions diffèrent — voir étape 5.

## Étape 4 — Coller la clé dans les fichiers

### a) `DirectionsToLatLng/index.html` (~ligne 184)

Remplacer le placeholder `YOU_API_KEY` :

```html
<!-- avant -->
src="https://maps.googleapis.com/maps/api/js?key=YOU_API_KEY&callback=initMap">
<!-- après -->
src="https://maps.googleapis.com/maps/api/js?key=AIza...TA_CLE&callback=initMap">
```

### b) `StreetViewImageLoader/StreetViewImageLoader.pde` (ligne 30)

Remplacer la clé en dur (actuellement morte) :

```java
// avant
String API_KEY = "AIzaSyCduSaCAbc59uIdEX-g9RvM2iv3CnFpeAY";
// après
String API_KEY = "AIza...TA_CLE";
```

> ⚠️ Ne **jamais committer** une vraie clé. Mettre une valeur factice avant
> de pousser, ou ajouter ces fichiers à un `.gitignore` local pendant le run.

## Étape 5 — Restreindre les clés (recommandé)

Dans *Credentials*, cliquer sur chaque clé :

- **Clé de `DirectionsToLatLng`** (tourne dans le navigateur) :
  - *Application restrictions* → **HTTP referrers**. Ajouter l'URL d'où tu
    ouvres la page. Le plus simple est de servir le fichier via un petit
    serveur local et d'autoriser `http://localhost:*/*` (avec `file://` les
    restrictions par referrer ne marchent pas).
  - *API restrictions* → limiter à *Maps JavaScript API* + *Directions API*.
- **Clé du `.pde`** (appli desktop Processing) :
  - *API restrictions* → limiter à *Street View Static API*.
  - Pas de restriction par referrer possible ici. Le `.pde` fait des requêtes
    **non signées** ; Google le tolère mais le recommande peu. Pour durcir, on
    peut générer une **signature numérique** (HMAC-SHA1 sur l'URL avec un
    secret) — non implémenté dans le `.pde` actuel, à ajouter seulement si tu
    actives « bloquer les requêtes non signées ».

## Étape 6 — Plafonds de quota (éviter les mauvaises surprises)

Le Street View Static est facturé **par image** : ~10 000 gratuites/mois (SKU
*Essentials*), puis ~0,007 $/image. Pour ne pas exploser la note si une boucle
s'emballe :

- *APIs & Services → Street View Static API → Quotas* → fixer un **plafond de
  requêtes par jour** cohérent avec ton budget.
- Découper les longs trajets en tranches de **~10 000 images/mois** pour rester
  gratuit (le `.pde` reprend depuis `locations.txt`, donc on peut le faire par
  lots). Détails et tableau de coûts dans `CLAUDE.md`, section « État 2026 ».

## Étape 7 — Tester rapidement

1. **Directions** : ouvrir `DirectionsToLatLng/index.html`, saisir un trajet
   court, cliquer *Calculate* → une liste `lat,lng,angle` doit apparaître. Si
   erreur `REQUEST_DENIED` → clé/API/facturation pas en place.
2. **Street View** : tester l'URL dans un navigateur avec ta clé :
   ```
   https://maps.googleapis.com/maps/api/streetview?size=640x640&location=46.71211,6.37912&heading=0&key=TA_CLE
   ```
   Une photo s'affiche → OK. Une image grise « Sorry, we have no imagery here »
   → la clé marche mais pas de StreetView à cet endroit. Une erreur → vérifier
   l'activation de *Street View Static API* et la facturation.
3. Lancer le `.pde` dans l'IDE **Processing** une fois `locations.txt` rempli.
