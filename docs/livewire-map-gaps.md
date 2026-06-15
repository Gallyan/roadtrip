# livewire-map — fonctions manquantes pour un éditeur d'itinéraire

Manques identifiés en voulant utiliser **`livewire-map`** comme éditeur de
parcours dans le projet roadtrip (placer/déplacer origine, destination,
waypoints ; afficher un tracé et un GPX). Chaque entrée indique si elle est
**générale** (utile à tout le monde → bon candidat pour la PR FluxUI / le package
Packagist) ou **spécifique roadtrip**.

Référence du code analysé : `resources/js/livewire-map.js`,
`resources/views/components/livewire-map.blade.php`.

## Déjà couvert (rien à faire)

- Affichage du tracé : `:routes` (polylines stylées) + `updateRoutes`.
- Import/affichage GPX : convertir le GPX en GeoJSON côté app, passer en
  `:geojson` + `updateGeoJson`.
- Ajout de point au clic : événement **`map-click {lat,lng}`**.
- Markers cliquables (`marker-click`), sélection, `wire:model`.
- `map-ready` qui renvoie l'objet Leaflet → **escape hatch** pour tout besoin
  avancé non couvert.

---

## 1. Markers déplaçables + événement `dragend` — **bloquant éditeur · général**

Aujourd'hui `addMarkers()` crée des `L.marker` **statiques** : pas d'option
`draggable`, aucun handler `dragend`. Impossible d'ajuster un point en le
glissant — geste de base d'un éditeur de carte.

**Proposition d'API**
- Option par marker : `['lat'=>…, 'lng'=>…, 'draggable'=>true, 'id'=>…]`.
- Option globale du composant : `:draggable-markers="true"`.
- Nouvel événement Alpine `$dispatch('marker-dragend', { id, lat, lng })` (et
  idéalement `marker-dragstart` / `marker-drag` pour du live).
- Propager l'`id` du marker dans **tous** les événements marker (déjà le cas via
  `markerData`, mais le garantir et le documenter).

**Implémentation** : dans `addMarkers()`, `L.marker([...], { draggable })` puis
`marker.on('dragend', e => this.$dispatch('marker-dragend', { id: markerData.id, ...e.target.getLatLng() }))`.

## 2. Clic sur le tracé (route) — **utile éditeur · général**

`addRoutes()` ajoute les polylines mais ne pose **aucun** handler de clic
(contrairement aux polygones/cercles/GeoJSON qui émettent `shape-click`). Or
cliquer sur le tracé pour **insérer un waypoint** est un geste d'édition courant.

**Proposition** : émettre `route-click { lat, lng, index }` (avec l'index du
segment cliqué si dispo), aligné sur le modèle `shape-click` existant.

## 3. Ajout/suppression incrémentale d'un marker — **confort · général**

`updateMarkers()` **vide tout** puis reconstruit l'ensemble. Acceptable pour peu
de points, mais pour de l'édition fréquente c'est lourd (perte de l'état de
sélection, clignotement). Proposer `addMarker` / `removeMarker(id)` /
`updateMarker(id, …)` ciblés via `$wire.$on`.

## 4. Marqueur animé le long d'un tracé — **spécifique roadtrip · optionnel**

Pour matérialiser la position courante de lecture du film sur la carte, il
faudrait un marker qui se déplace le long d'une polyline (position pilotée par
fraction 0→1 ou par index de frame). **Probablement hors périmètre du package** —
faisable côté app via l'escape hatch `map-ready` (on récupère `map` et on gère
notre propre marker). À ne mettre dans le package que si une API générique
« marker animé » a du sens pour FluxUI.

## 5. Helpers GPX/GeoJSON — **hors périmètre (à garder côté app)**

Le parsing GPX → GeoJSON et le rééchantillonnage restent la responsabilité de
l'app, pas du composant carte. À **ne pas** mettre dans `livewire-map`.

---

## Priorisation suggérée

| # | Fonction | Pour roadtrip | Pour le package (FluxUI/Packagist) |
|---|---|---|---|
| 1 | Markers déplaçables + `dragend` | bloquant | fort intérêt général |
| 2 | `route-click` | utile | cohérent avec `shape-click` |
| 3 | Add/remove marker ciblé | confort | bonus qualité |
| 4 | Marker animé | optionnel | douteux (plutôt app) |

**Minimum pour débloquer l'éditeur roadtrip** : le point **1**. Le reste se
contourne via `map-ready`. Les points 1, 2 et 3 sont génériques et renforcent
l'argument « composant carte interactif complet » pour une PR FluxUI ou une
publication Packagist.
