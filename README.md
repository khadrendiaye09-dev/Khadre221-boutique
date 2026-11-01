# KHADRE221, boutique de parfums en ligne

Boutique complète : site client, commandes enregistrées sur le serveur, stock mis à jour
automatiquement, espace administrateur protégé par mot de passe, suivi de commande pour les clients.
Aucune dépendance à installer : il suffit de Node.js 18 ou plus récent.

## Tester sur votre ordinateur

    ADMIN_PASSWORD="choisissez-un-mot-de-passe-long" node server.js

Sous Windows (PowerShell) :

    $env:ADMIN_PASSWORD="choisissez-un-mot-de-passe-long"; node server.js

Ouvrez ensuite http://localhost:3000 (site) et http://localhost:3000/admin (administration).

## Mettre en ligne

Il faut un hébergeur qui exécute Node.js ET garde un disque permanent, car vos commandes sont
enregistrées dans le fichier `db.json`. Un hébergement gratuit qui efface les fichiers à chaque
redémarrage ne convient pas.

Réglages chez l’hébergeur :
- Commande de démarrage : `node server.js`
- Variable `ADMIN_PASSWORD` : votre mot de passe administrateur (8 caractères minimum, long de préférence)
- Variable `DATA_DIR` : le dossier du disque permanent (par exemple `/data`)
- Activez le HTTPS (souvent automatique), puis reliez votre nom de domaine (khadre221.com ou .sn).

Faites une copie régulière de `db.json` : c’est toute votre base de commandes et de produits.

## Espace administrateur (/admin)

- Commandes : liste, statut (Nouvelle, Confirmée, En livraison, Livrée, Annulée), paiement reçu.
  Annuler une commande remet les articles en stock.
- Produits : ajouter, modifier, masquer ou supprimer un parfum ; prix, promotion, stock et photo.
- Statistiques : chiffre d’affaires, commandes par statut, parfums les plus vendus, stock bas.

## Ce que le serveur vérifie

- Les prix et le total sont recalculés par le serveur : le client ne peut pas les modifier.
- Le stock est vérifié et décompté à chaque commande.
- Numéro de téléphone sénégalais valide, champ anti-robot, limite de commandes par connexion.
- Connexion administrateur limitée en tentatives, cookie sécurisé, aucune page admin sans connexion.

## Limites à connaître

- Wave et Orange Money : aucun paiement automatique. Le client choisit le moyen de paiement, votre
  équipe le contacte pour le confirmer, puis vous cochez « Paiement reçu ». Un vrai paiement en ligne
  demande un compte marchand chez le prestataire et une intégration dédiée.
- Pas d’e-mail ni de SMS automatique : consultez /admin régulièrement pour voir les nouvelles commandes.
- Un seul administrateur et une base en fichier : adapté à une boutique qui démarre. Pour beaucoup de
  commandes simultanées, prévoyez ensuite une vraie base de données.
- Les photos actuelles sont dans `public/img`. Celles ajoutées depuis l’administration sont dans
  `uploads`, dans le dossier de données.
- Prix, stocks, textes légaux et frais de livraison (`seed.json`, lu au premier démarrage) sont des
  exemples à adapter avant l’ouverture.
