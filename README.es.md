
<p align="center">
  <img src="resources/icons/icon/icon_256x256.png" width="120" alt="ArborMark">
</p>

<h1 align="center">ArborMark</h1>

<p align="center">Ein lokaler WYSIWYG-Markdown-Editor für den Desktop</p>

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
  <img src="https://img.shields.io/badge/version-4.0.0-green.svg" alt="Version">
</p>

<p align="center">
  <img src="docs/images/screenshot.png" width="820" alt="ArborMark-Hauptfenster: Gliederungsleiste links, WYSIWYG-Editor rechts">
</p>

***

## Einführung

ArborMark (chinesischer Name: 简筑) ist ein unabhängiger Markdown-Editor für den Desktop, entwickelt mit **Electron** und einer eigenen Rendering-Engine für Rich Text.

Er verbindet die Einfachheit von Markdown mit der Unmittelbarkeit eines Rich-Text-Editors: Inhalte werden während der Eingabe gerendert, und mit einer Tastenkombination wechselt man in den Quelltextmodus. Dokumente werden immer lokal als standardkonforme `.md`-Dateien gespeichert – ohne Bindung an ein Format, ein Konto oder die Cloud.

* Repository: <https://github.com/Arbor4/ArborMark>
* Fehler melden: <https://github.com/Arbor4/ArborMark/issues>
* Downloads: <https://github.com/Arbor4/ArborMark/releases>

## Funktionen

| Funktion                 | Beschreibung                                                                            |
| :----------------------- | :-------------------------------------------------------------------------------------- |
| Live-Vorschau            | Rendert beim Tippen; der aktuelle Block kann seinen Markdown-Quelltext zeigen           |
| Quelltextmodus           | Wechsel zu reiner Textbearbeitung für präzise Markdown-Arbeit                           |
| Gliederung und Dateibaum | Überschriften-Gliederung, Ordnerbaum, Dateiliste und globale Suche                      |
| Erweiterte Syntax        | Tabellen, Aufgabenlisten, Fußnoten, YAML-Front-Matter, Hoch-/Tiefstellung, Hervorhebung |
| Formeln                  | Inline- und Block-LaTeX über MathJax, optional mit Nummerierung                         |
| Diagramme                | Mermaid (Flussdiagramm, Sequenz, Klasse, Zustand, Gantt, Kreis), Flowchart.js, Sequence |
| Bilder                   | Drag & Drop, relative Pfade, Kopieren in einen Ordner, Upload zu Bildhostern            |
| Import und Export        | PDF, HTML, Bilder sowie Word / EPUB / LaTeX über Pandoc                                 |
| Themes                   | Mehrere integrierte Themes; **Liquid Glass** ist der macOS-Standard                     |
| Lokalisierung            | 40 Sprachen, folgt dem System oder manuell wählbar                                      |
| Sicheres Speichern       | Automatisches Speichern, Absturz- und Entwurfswiederherstellung                         |
| Kommandozeile            | Dateien oder Ordner über die Kommandozeile öffnen                                       |

## Download und Installation

Laden Sie den Installer für Ihre Plattform von [Releases](https://github.com/Arbor4/ArborMark/releases) herunter:

* macOS: `.dmg` / `.zip`
* Windows: NSIS-Installer / portable `.zip`
* Linux: `.AppImage` / `.deb`

Falls macOS den ersten Start blockiert, erlauben Sie die App unter **Systemeinstellungen → Datenschutz & Sicherheit**.

## Entwicklung

### Voraussetzungen

* Node.js **20+**
* npm 10+
* macOS, Windows oder Linux

### Lokal starten

```bash
git clone https://github.com/Arbor4/ArborMark.git
cd ArborMark
npm install
npm run build
npm start
```

Entwicklungsmodus (Seiten und Runtime bauen, dann Electron starten):

```bash
npm run dev
```

Installer erzeugen:

```bash
npm run dist:mac
```

### Tests

```bash
# Unit- und Integrationstests
npm test

# End-to-End-Tests (Desktop-Sitzung erforderlich)
npm run test:e2e
```

### Paketierung

```bash
npm run dist:mac     # macOS dmg / zip
npm run dist:win     # Windows nsis / zip
npm run dist:linux   # Linux AppImage / deb
```

> Nicht bei jeder Änderung paketieren; `npm start` lädt den aktuellen Quellcode direkt.

## Projektstruktur

```text
ArborMark/
├── src/
│   ├── main/                  # Electron-Hauptprozess (Fenster, Menüs, IPC, Protokolle, Speicher)
│   ├── preload/               # Kontextisolierung und sichere Brücke
│   ├── renderer/
│   │   ├── core/              # Editor-Kern, Auswahl, Undo/Redo
│   │   ├── block/             # Codeblöcke, Tabellen, Formeln, Diagramme, Bilder
│   │   ├── markdown/          # Markdown-Parsing und Serialisierung
│   │   ├── io/                # Dateien, Export, Zwischenablage, Pandoc
│   │   ├── ui/                # Menüs, Seitenleiste, Gliederung, Suche, Dateibaum
│   │   ├── pages/             # React-Seiten für Einstellungen, Willkommen, Lizenz
│   │   ├── vendor/            # Drittanbieter-Runtime (CodeMirror, jQuery, Rangy, ...)
│   │   └── static/            # Host-HTML, Themes, integrierte Dokumente, Icons
│   └── shared/                # Gemeinsame Konstanten von Main und Renderer
├── tools/                     # Build- und Testskripte
├── test/                      # Unit-, Integrations- und E2E-Tests
├── resources/                 # App-Icons und Installer-Ressourcen
└── docs/                      # Architektur- und Drittanbieter-Dokumentation
```

Eine genauere Modulübersicht steht in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Designhinweise

* **Lokal zuerst**: Dokumente, Bilder, Themes und Einstellungen bleiben standardmäßig auf dem Rechner.
* **Reiner Text**: Alles wird als Standard-Markdown gespeichert und kann überall geöffnet werden.
* **Erweiterbare Themes**: Themes sind normale CSS-Dateien; im Benutzer-Theme-Ordner werden sie automatisch erkannt.
* **Sichere Grenzen**: Der Renderer erhält nur eine minimale preload-API; externe Links durchlaufen eine Protokoll-Allowlist.
* **Wartbarkeit**: Main-, Renderer- und Shared-Schicht sind getrennt; Kernverhalten ist durch Regressionstests abgesichert.

Das integrierte Vollbeispiel ist in der App unter **Hilfe → Markdown-Demo** verfügbar. Quelldatei: [Markdown Demo.md](src/web/src/bridge/demo/markdown-full-demo.md).

## Mitwirken

Issues und Pull Requests sind willkommen.

1. Repository forken und einen Branch `feat/your-feature` oder `fix/your-fix` anlegen.
2. Vor dem Einreichen die relevanten Tests ausführen: `node tools/run-tests.mjs test/unit/<test>.test.mjs`
3. Aussagekräftige Commit-Nachrichten verwenden, zum Beispiel:
   * `feat(editor): weitere Sprache für Codeblöcke unterstützen`
   * `fix(export): fehlende Bilder im PDF-Export beheben`
4. Im PR Änderungen, Testweise und bei UI-Änderungen Screenshots beschreiben.

Mit dem Einreichen eines Beitrags erklären Sie sich damit einverstanden, ihn unter der Open-Source-Lizenz des Projekts zu veröffentlichen.

## Lizenz

ArborMark steht unter der **GNU General Public License v3.0 or later (GPL-3.0-or-later)**.

Sie dürfen:

* das Projekt nutzen, kopieren und verändern;
* veränderte Versionen verbreiten;
* das Projekt kommerziell nutzen.

Es gilt die Copyleft-Bedingung: **Wer ein abgeleitetes Werk verbreitet, muss es ebenfalls unter GPL-3.0-or-later mit vollständigem Quellcode veröffentlichen**. Die Software wird ohne Gewährleistung bereitgestellt.

Der vollständige Text steht in [LICENSE](LICENSE).

> Warum GPL-3.0: eine ausgereifte, starke Copyleft-Lizenz, passend für eine vollständige Desktop-Anwendung. Sie ist mit den enthaltenen MIT-/Apache-2.0-Komponenten kompatibel und verhindert, dass abgeleitete Versionen geschlossen weiterverbreitet werden.

## Drittanbieter-Komponenten

ArborMark nutzt unter anderem diese Open-Source-Projekte:

* [Electron](https://www.electronjs.org/) (MIT)
* [CodeMirror](https://codemirror.net/5/) (MIT)
* [MathJax](https://www.mathjax.org/) (Apache-2.0)
* [Mermaid](https://mermaid.js.org/) (MIT)
* [jQuery](https://jquery.com/) (MIT)
* [Rangy](https://github.com/timdown/rangy) (MIT)
* [DOMPurify](https://github.com/cure53/DOMPurify) (Apache-2.0 / MPL-2.0)
* [React](https://react.dev/) (MIT)

Vollständige Copyright- und Lizenzinformationen finden Sie in der App unter **Hilfe → Danksagungen** und in den LICENSE-Dateien der Abhängigkeiten.

## Haftungsausschluss

ArborMark ist ein unabhängiges Open-Source-Projekt und steht in keiner Verbindung zu einem kommerziellen Markdown-Editor. Name, Icons und UI-Ressourcen sind eigenständig oder lizenziert; Rechte an Drittanbieter-Komponenten liegen bei den jeweiligen Autoren.

Wenn Sie der Ansicht sind, dass Inhalte Ihre Rechte verletzen, kontaktieren Sie uns über [Issues](https://github.com/Arbor4/ArborMark/issues).

***

Copyright © 2026 Arbor · ArborMark contributors
