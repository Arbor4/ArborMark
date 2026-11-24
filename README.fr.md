<p align="center">
  <img src="resources/icons/icon/icon_256x256.png" width="120" alt="ArborMark">
</p>


<h1 align="center">ArborMark</h1>

<p align="center">Un éditeur Markdown WYSIWYG local pour le bureau</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.zh-TW.md">繁體中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.es.md">Español</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg" alt="Platform">
  <img src="https://img.shields.io/badge/tauri-2-FFC131.svg" alt="Tauri">
  <img src="https://img.shields.io/badge/version-4.0.3-green.svg" alt="Version">
</p>

<p align="center">
  <img src="docs/images/screenshot.png" width="820" alt="Fenêtre principale d'ArborMark : panneau de plan à gauche, éditeur WYSIWYG à droite">
</p>

***

## Introduction

ArborMark (nom chinois : 简筑) est un éditeur Markdown WYSIWYG de bureau moderne, ultra-léger et ultra-performant. Conçu sur un socle natif avec **Tauri 2 + Rust**, il s'appuie sur **React 19 + Milkdown (ProseMirror)** pour un rendu enrichi fluide en temps réel, et sur **CodeMirror 6** pour un mode source en texte brut de niveau professionnel.

Il combine la pureté de Markdown avec le retour visuel immédiat d'un traitement de texte : la mise en page s'affiche en direct pendant la frappe, et un raccourci (`⌘/Ctrl + /`) bascule instantanément vers le code source. Tous les documents sont enregistrés localement au format standard `.md` — **aucun compte requis, aucune collecte de données, 100% respectueux de votre vie privée**.

* Dépôt : <https://github.com/Arbor4/ArborMark>
* Signaler un problème : <https://github.com/Arbor4/ArborMark/issues>
* Téléchargements : <https://github.com/Arbor4/ArborMark/releases>

---

## Pourquoi choisir ArborMark ?

| Critère | ArborMark | Éditeurs Markdown Electron classiques | Vos avantages |
| :--- | :--- | :--- | :--- |
| **Poids de l'installateur** | **~15 Mo** | 120 Mo ~ 180 Mo+ | 🚀 **90% plus léger**, téléchargement et installation instantanés |
| **Consommation RAM** | **~50 Mo - 80 Mo** | 300 Mo ~ 600 Mo+ | 🍃 Très faible empreinte, exécution fluide sans ralentissement |
| **Démarrage à froid** | **< 300 ms** ultra-rapide | 2 à 4 secondes | ⚡ S'ouvre sur-le-champ pour capturer vos idées |
| **Local-First** | **100% hors-ligne & privé** | Dépendance cloud / compte obligatoire | 🔒 Maîtrise totale de vos données confidentielles |
| **Double moteur** | **Milkdown + CodeMirror 6** | Simple Webview ou double écran scindé | 🎨 Le meilleur du WYSIWYG et de l'édition de code |
| **Multi-fenêtres** | **Natif & indépendant (⌘⇧N)** | Onglets lents ou mémoire doublée | 🪟 Travaillez confortablement sur plusieurs documents en parallèle |

---

## Fonctionnalités

| Fonction             | Description                                                                                       |
| :------------------- | :------------------------------------------------------------------------------------------------ |
| WYSIWYG en temps réel | Rendu instantané pendant la saisie ; modification sur place des titres, tableaux, formules, blocs de code et diagrammes |
| Mode source double   | Édition texte brut CodeMirror 6 avec gouttière de numérotation fixe, repliage de code et coloration (⌘/Ctrl + /) |
| Fichiers et navigation | Arborescence de dossiers, liste plate, plan des titres, ouverture rapide (⌘P), recherche globale (⌘⇧F) |
| Système de préférences | Panneaux dédiés (Fichiers, Apparence, Éditeur, Markdown, Image, Export, Général) avec choix des sauts de ligne (LF/CRLF) |
| Ergonomie d'édition  | Copier/couper la ligne entière sans sélection (⌘C / ⌘X), zoom molette avec Ctrl/⌘, appariement automatique des symboles |
| Tableaux et formules | Barre d'outils flottante, insertion/suppression de lignes/colonnes, redimensionnement ; formules KaTeX éditables sur place |
| Rendu de diagrammes  | Diagrammes Mermaid, Flowchart.js et Sequence avec conservation automatique du ratio et rendu différé |
| Images et PDF        | Glisser-déposer local, préférences de chemins relatifs, visionneuse d'images intégrée et aperçu PDF |
| Support multi-fenêtres | Flux de travail multi-fenêtres natif et indépendant (⌘⇧N) pour éditer plusieurs documents simultanément |
| Import et export     | Export PDF et HTML de haute qualité ; conversion Word / EPUB / LaTeX via Pandoc                   |
| Système de thèmes    | Thèmes intégrés élégants (dont **Liquid Glass**) et chargement à chaud de thèmes CSS/JSON personnalisés |
| Multilingue mondial  | Français, Anglais, Chinois (simplifié/traditionnel), Allemand, Espagnol, etc. (16+ langues) synchronisées avec les menus |
| Sauvegarde sécurisée | Sauvegarde auto au changement de fichier, anti-rebond à la frappe, suivi des modifications et sécurité anti-plantage |
| CLI et glisser-déposer | Ouvrez rapidement des fichiers ou dossiers depuis le terminal ou en les déposant dans la fenêtre |

## Téléchargement et installation

Téléchargez l'installateur de votre plateforme depuis [Releases](https://github.com/Arbor4/ArborMark/releases) :

* macOS : `.dmg` / `.zip`
* Windows : installateur NSIS / `.zip` portable
* Linux : `.AppImage` / `.deb`

Si macOS bloque le premier lancement, autorisez l'application dans **Réglages Système → Confidentialité et sécurité**.

## Développement

### Prérequis

* Node.js **20+**
* npm 10+
* macOS, Windows ou Linux

### Lancer en local

```bash
git clone https://github.com/Arbor4/ArborMark.git
cd ArborMark
npm install
npm run build
npm start
```

Mode développement (compiler les pages et le runtime, puis lancer Electron) :

```bash
npm run dev
```

Pour produire un installateur :

```bash
npm run dist:mac
```

### Tests

```bash
# Tests unitaires + intégration
npm test

# Tests de bout en bout (session de bureau requise)
npm run test:e2e
```

### Empaquetage

```bash
npm run dist:mac     # macOS dmg / zip
npm run dist:win     # Windows nsis / zip
npm run dist:linux   # Linux AppImage / deb
```

> Évitez d'empaqueter à chaque modification ; `npm start` charge directement les sources à jour.

## Structure du projet

```text
ArborMark/
├── src/
│   ├── main/                  # Processus principal Electron (fenêtres, menus, IPC, protocoles, stockage)
│   ├── preload/               # Isolation de contexte et pont sécurisé
│   ├── renderer/
│   │   ├── core/              # Cœur de l'éditeur, sélection, annuler/rétablir
│   │   ├── block/             # Blocs de code, tableaux, formules, diagrammes, images
│   │   ├── markdown/          # Analyse et sérialisation Markdown
│   │   ├── io/                # Fichiers, export, presse-papiers, Pandoc
│   │   ├── ui/                # Menus, barre latérale, plan, recherche, arborescence
│   │   ├── pages/             # Pages React préférences, accueil, licence
│   │   ├── vendor/            # Runtime tiers (CodeMirror, jQuery, Rangy, etc.)
│   │   └── static/            # HTML hôte, thèmes, documentation intégrée, icônes
│   └── shared/                # Constantes partagées entre main et renderer
├── tools/                     # Scripts de build et de test
├── test/                      # Tests unitaires, intégration et E2E
├── resources/                 # Icônes de l'application et ressources d'installation
└── docs/                      # Architecture et notes sur les composants tiers
```

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour une description plus détaillée des modules.

## Notes de conception

* **Local d'abord** : documents, images, thèmes et réglages restent sur la machine par défaut.
* **Texte brut** : tout est enregistré en Markdown standard, ouvrable ailleurs.
* **Thèmes extensibles** : les thèmes sont de simples fichiers CSS ; déposez-en un dans le dossier utilisateur pour qu'il soit détecté.
* **Frontières sûres** : le renderer ne reçoit qu'une API preload minimale ; les liens externes passent par une liste blanche de protocoles.
* **Maintenabilité** : les couches main, renderer et partagée sont séparées, avec des tests de régression sur le comportement central.

L'exemple complet intégré est accessible dans l'application via **Aide → Démo Markdown**. Fichier source : [Markdown Demo.md](src/web/src/bridge/demo/markdown-full-demo.md).

## Contribuer

Les issues et pull requests sont bienvenues.

1. Forkez le dépôt et créez une branche `feat/your-feature` ou `fix/your-fix`.
2. Lancez les tests concernés avant de soumettre : `node tools/run-tests.mjs test/unit/<test>.test.mjs`
3. Utilisez des messages de commit explicites, par exemple :
   * `feat(editor): prendre en charge un nouveau langage de bloc de code`
   * `fix(export): corriger les images manquantes à l'export PDF`
4. Décrivez les changements, la méthode de test et joignez des captures pour les modifications d'interface.

En soumettant une contribution, vous acceptez de la publier sous la licence open source du projet.

## Licence

ArborMark est publié sous **GNU General Public License v3.0 or later (GPL-3.0-or-later)**.

Vous pouvez librement :

* utiliser, copier et modifier le projet ;
* distribuer des versions modifiées ;
* l'utiliser à des fins commerciales.

La condition copyleft s'applique : **toute œuvre dérivée distribuée doit aussi être publiée sous GPL-3.0-or-later avec le code source complet**. Le logiciel est fourni sans garantie.

Voir [LICENSE](LICENSE) pour le texte complet.

> Pourquoi GPL-3.0 : une licence copyleft forte et mature, adaptée à une application de bureau complète. Elle est compatible avec les composants MIT / Apache-2.0 inclus et empêche la redistribution fermée de versions dérivées.

## Composants tiers

ArborMark s'appuie notamment sur ces projets open source :

* [Electron](https://www.electronjs.org/) (MIT)
* [CodeMirror](https://codemirror.net/5/) (MIT)
* [MathJax](https://www.mathjax.org/) (Apache-2.0)
* [Mermaid](https://mermaid.js.org/) (MIT)
* [jQuery](https://jquery.com/) (MIT)
* [Rangy](https://github.com/timdown/rangy) (MIT)
* [DOMPurify](https://github.com/cure53/DOMPurify) (Apache-2.0 / MPL-2.0)
* [React](https://react.dev/) (MIT)

Les informations complètes de copyright et de licence figurent dans **Aide → Crédits** et dans les fichiers LICENSE des dépendances.

## Avertissement

ArborMark est un projet open source indépendant, sans affiliation, approbation ni parrainage d'un éditeur Markdown commercial. Le nom, les icônes et les ressources d'interface sont originaux ou utilisés avec autorisation ; les composants tiers restent la propriété de leurs auteurs.

Si vous estimez que ce projet porte atteinte à vos droits, contactez-nous via [Issues](https://github.com/Arbor4/ArborMark/issues).

***

Copyright © 2026 Arbor · ArborMark contributors
