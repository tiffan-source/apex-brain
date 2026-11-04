# ADR 0005 — Les clients lisent ce que fait Akari, pas la machine

- Statut : accepté
- Date : 2026-11-02

## Contexte

Pendant un tour, les clients voyaient surtout « Akari réfléchit… », parfois très longtemps. Deux causes :

- Ils choisissaient leur phrase d'après `value`, la valeur brute de la machine XState, et n'en
  lisaient que le premier niveau : tout ce qui touche aux outils donnait la même phrase. Renommer un
  état de la machine aurait aussi changé ce que les écrans affichent.
- Ils interrogent l'état chaque seconde. La vérification d'un accord dure quelques millisecondes et
  une lecture quelques centaines : une interrogation ne les voit presque jamais. Seuls les appels à
  l'IA durent assez longtemps pour être vus. Un flux SSE ne changerait rien à l'écran : ces étapes
  passeraient trop vite pour être lues.

## Décision

- La machine tient un **journal du tour** (`context.activity`) : chaque étape ajoute un code public et
  son instant à son entrée. Le retour au repos le vide, y compris après une panne. Le journal est
  persisté avec le contexte ; un état persisté avant son arrivée n'en a pas, et reste lisible.
- L'API expose `activity` : l'étape en cours, le temps passé dessus, le nombre de passages par l'IA, et
  ce qui a déjà été fait pendant ce tour (`docs/api.md`).
- Les codes sont **un contrat indépendant de la machine** : ni nom d'outil, ni fournisseur d'IA, ni
  état XState. Les clients ont leur phrase par code, comme pour les codes d'erreur.
- Le temps passé est mesuré par le serveur (`elapsedMs`) : l'horloge d'un téléphone peut être fausse,
  et l'interrogation donne une valeur fraîche à chaque lecture.
- Le journal dit ce qui a eu lieu, pas ce que cela a donné : les outils rendent leurs refus comme des
  résultats, que seule l'IA interprète. Un client ne présente donc pas `writing` comme une réussite.
- `value` reste dans la réponse pour les versions déjà installées, et n'est plus lu par les clients à
  jour. Il sera retiré quand plus aucune version ne le lira, avec `lastError.step`, qui porte encore un
  nom d'état de la machine et qu'aucun client ne lit.

## Conséquences

- Une nouvelle étape visible, c'est un nouveau code : un client qui ne le connaît pas garde une phrase
  par défaut et n'affiche pas la ligne du journal. Le renommage d'un état de la machine ne touche
  plus les clients.
- La taille du journal suit celle du tour. Elle n'est pas bornée, comme le nombre de tours de boucle.
