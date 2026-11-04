# Lieferwerk

Webanwendung zur Verwaltung von **Lieferaufträgen, Packlisten, Pfand und Fuhrpark** (Fahrzeuge & Anhänger).
Läuft auf Linux, macOS, Windows und in Docker. Keine externen Pakete, keine Datenbank-Installation nötig
(Node.js + eingebautes SQLite, TypeScript wird von Node direkt ausgeführt).

## Funktionen

- **Aufträge** anlegen mit Kunde, Adresse, Lieferdatum/Zeitfenster, Notizen und Positionen
- **Produkte** vorab festlegen (mit Kategorie, Einheit, Standard-Verpackung, Standard-Pfandregel) oder **manuell** im Auftrag eintippen
- **Pfand** pro Position: einzeln oder Kasten, frei definierbare Pfandregeln, optional manueller Betrag
- **Packlisten** für Mitarbeiter: online abhaken (auch Teilmengen), auf dem Smartphone bedienbar, druckbar
- **Pfand ein-/ausblenden**: Packer können Pfand in der Packliste selbst per Schalter anzeigen oder ausblenden (Standard: ausgeblendet). Der Admin kann das unter Einstellungen komplett abschalten, dann bekommen Packer die Beträge gar nicht übertragen
- **Kunden**: eigene Kundenverwaltung (anlegen, bearbeiten, löschen) mit Lieferhistorie; im Auftrag einen bestehenden Kunden auswählen (mit Suche) oder direkt einen neuen anlegen
- **Archiv**: alle erledigten und stornierten Lieferungen, mit Datums- und Textfilter und CSV-Export
- **Fuhrpark**: alle Fahrzeuge und Anhänger auf einer Seite, filterbar nach Art (Fahrzeuge/Anhänger), Zustand (frei/unterwegs/Werkstatt) und Suche; Ansicht als Kacheln oder Liste. Zeigt aktuellen und nächsten Einsatz, HU/TÜV-Warnung; Warnung bei Doppelbelegung
- **Tagesplanung**: Aufträge eines Tages per Drag & Drop auf Fahrer verteilen, Reihenfolge der Stopps festlegen, Fahrzeug/Anhänger je Tour setzen
- **Lieferschein (PDF)** mit Absenderdaten (Einstellungen), Positionen und Pfand; der Fahrer lässt den Empfänger am Handy unterschreiben, die Unterschrift erscheint im PDF
- **Ersatz & „nicht lieferbar“**: Beim Packen lässt sich über das ⚠ an einer Position ein Ersatzartikel (mit Menge/Einheit/Hinweis) eintragen oder die Position als nicht lieferbar markieren. Fortschritt, Abschluss, Fahrer-Ladung, Druckansicht und Lieferschein berücksichtigen das; bei „nicht lieferbar“ entfällt das Pfand, beim Zurücksetzen wird alles wiederhergestellt.
- **Fahrzeugakte**: zu jedem Fahrzeug/Anhänger ein Logbuch (Tanken, Service, Reparatur, HU, Reifen) mit Kosten, km-Stand und Litern; Auswertung von Kosten und Verbrauch (l/100 km), Kilometerstand, Service-Erinnerung (nach Datum oder km) und HU-Warnung, dazu die letzten Lieferungen. Erreichbar über „Akte“ auf der Fuhrpark-Kachel.
- **Auswertung**: Kennzahlen für einen frei wählbaren Zeitraum (Aufträge, geliefert, offen, Pfand, Fuhrparkkosten), Diagramm der Aufträge pro Tag bzw. Monat, Top-Kunden, beliebteste Artikel, Auswertung je Fahrer und Fahrzeug sowie Fuhrparkkosten aus der Fahrzeugakte; als CSV exportierbar.
- **App aufs Handy (PWA)**: Lieferwerk lässt sich auf dem Startbildschirm installieren (Android: „App installieren“, iPhone: Teilen → Zum Home-Bildschirm; Einstellungen → „App aufs Handy“). Packlisten und Touren bleiben offline im zuletzt geladenen Stand lesbar, Änderungen brauchen Verbindung; beim Abmelden werden die Offline-Daten gelöscht. Voraussetzung: HTTPS (z. B. über einen Reverse-Proxy) oder localhost.
- **Automatische Datensicherung**: tägliche Sicherung der Datenbank mit Aufbewahrungsfrist, Download und manuelles „Jetzt sichern“ in den Einstellungen, Wiederherstellung per Kommandozeile.
- **Fahrer-Ansicht**: eigene Touren, Navigation, Anruf, „Losfahren“ / „Geliefert“
- **Rollen**: Administrator, Packer, Fahrer – pro Mitarbeiter auch **mehrere Rollen** möglich (z. B. Packer + Fahrer; ein Administrator kann zusätzlich als Packer/Fahrer eingeteilt werden). Wer Packer und Fahrer ist, sieht Pfand in der Fahrer-Ansicht immer und in der Packliste nach den Packer-Regeln
- **Testdaten**: Einstellungen → „Testdaten erzeugen“ legt Beispiel-Aufträge (Packlisten, Touren, Archiv), Kunden, Fuhrpark und Demo-Mitarbeiter an; „Testdaten entfernen“ löscht nur diese wieder
- **Seitenmenü** (ein-/ausklappbar, merkt sich den Zustand; auf dem Handy als ausfahrbares Menü) und **Dunkelmodus** (Umschalter im Menü, folgt standardmäßig dem System)
- **Auftragsformular mit Reitern**: Kunde & Lieferung, Zuweisung, Positionen

## Starten

### Windows: Doppelklick

1. Einmalig **Node.js (LTS, 22 oder neuer)** von https://nodejs.org installieren.
2. ZIP-Datei entpacken und **`start.bat`** doppelklicken. Es öffnet sich ein Fenster und nach wenigen Sekunden der Browser mit `http://localhost:3000`.
3. Beim allerersten Öffnen legst du im Browser den ersten Benutzer an. Das Fenster offen lassen, solange die App laufen soll.

Andere Rechner im selben Netzwerk erreichen die App über `http://<IP-des-Rechners>:3000` (ggf. die Windows-Firewall-Meldung bestätigen).

macOS/Linux: `./start.sh` (oder `npm start`).

### Mit Node.js (Linux, macOS, Windows, Kommandozeile)

Voraussetzung: **Node.js 22.18 oder neuer** (https://nodejs.org).

```bash
npm start
```

Dann im Browser `http://localhost:3000` öffnen. Es muss nichts installiert oder gebaut werden.
Für Entwicklung mit automatischem Neustart: `npm run dev`.

Beim allerersten Öffnen erscheint die **Einrichtung**: Dort legst du den ersten Benutzer (Administrator) mit eigenem Namen und Passwort an. Weitere Benutzer legst du danach unter *Team* an.

Windows (PowerShell) mit eigenem Passwort und Port:

```powershell
$env:ADMIN_PASSWORD = "mein-sicheres-passwort"; $env:PORT = "8080"; npm start
```

### Mit Docker

```bash
docker compose up -d --build
```

Erreichbar unter `http://localhost:3000`. Die Daten liegen im Docker-Volume `lieferwerk-data`.
Danach im Browser den ersten Benutzer einrichten. Alternativ in `docker-compose.yml` `ADMIN_PASSWORD` setzen, dann wird automatisch der Benutzer `admin` angelegt.

## Erste Schritte

1. Ersten Benutzer einrichten, dann unter **Team** Packer und Fahrer anlegen.
2. Unter **Pfand** die vorbelegten Beispiel-Regeln prüfen und an die echten Beträge anpassen.
3. Unter **Produkte** häufige Artikel pflegen, unter **Fuhrpark** Fahrzeuge und Anhänger eintragen.
4. **Auftrag anlegen**, Positionen hinzufügen, Packer/Fahrer/Fahrzeug/Anhänger zuweisen.
5. Packer packen am Handy, Fahrer starten die Tour, der Fuhrpark zeigt automatisch, was unterwegs ist.

### Ablauf eines Auftrags

`Neu` → `Wird gepackt` (sobald der Packer abhakt) → `Gepackt` → `Unterwegs` (Fahrer) → `Geliefert`.
Der Admin kann den Status jederzeit ändern. Fahrzeuge und Anhänger gelten als „unterwegs“, solange ein zugewiesener Auftrag unterwegs ist.

## Pfand-Berechnung

Eine **Pfandregel** besteht aus: Pfand je Flasche/Dose, Pfand je Kasten (leer) und Flaschen pro Kasten.

| Verpackung | Pfand der Position |
|---|---|
| einzeln | Menge × Flaschenpfand |
| Kasten | Menge × (Kastenpfand + Flaschen pro Kasten × Flaschenpfand) |

Beispiel: 2 Kästen Mehrweg-Glas (0,08 € je Flasche, 1,50 € Kasten, 12 Flaschen) = 2 × (1,50 + 12 × 0,08) = 4,92 €.
Pro Position kann zusätzlich ein **manueller Betrag** eingetragen werden, der die Regel überschreibt.
Berechnete Beträge werden im Auftrag gespeichert und ändern sich nicht, wenn eine Regel später angepasst wird.

> Die vorbelegten Regeln sind **Beispielwerte**, bitte vor dem produktiven Einsatz prüfen.

## Konfiguration (Umgebungsvariablen)

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | Port des Servers |
| `HOST` | `0.0.0.0` | Adresse, auf der gelauscht wird (`127.0.0.1` = nur lokal) |
| `DATA_DIR` | `./data` (Docker: `/data`) | Ordner für die Datenbank `lieferwerk.db` |
| `ADMIN_PASSWORD` | – | Optional: legt beim ersten Start automatisch den Benutzer `admin` an (mind. 8 Zeichen). Ohne Angabe erfolgt die Einrichtung im Browser. |
| `COOKIE_SECURE` | – | `1` setzen, wenn die App hinter HTTPS läuft |
| `TRUST_PROXY` | – | `1` setzen, wenn ein Reverse Proxy `X-Forwarded-For` liefert |

## Datensicherung & Wartung

- **Automatische Sicherung:** Lieferwerk sichert die Datenbank täglich zur eingestellten Uhrzeit (Standard 02:00) in den Ordner `data/backups/` (Docker: `/data/backups`). Wurde der Server zu der Zeit nicht ausgeführt, wird die Sicherung beim nächsten Start nachgeholt. Die letzten 14 Sicherungen bleiben erhalten (einstellbar). Unter Einstellungen → „Datensicherung“ gibt es **Jetzt sichern**, die Liste der Sicherungen zum **Herunterladen** und die Einstellungen. Mit der Umgebungsvariable `BACKUP_DIR` lässt sich ein anderer Ordner (z. B. ein anderes Laufwerk) festlegen.
- **Wichtig:** Eine Sicherung auf demselben Laufwerk schützt nicht vor einem Festplattenschaden. Sicherungen deshalb regelmäßig herunterladen oder `BACKUP_DIR` auf ein anderes Laufwerk/Netzlaufwerk legen.
- **Wiederherstellen** (Server vorher stoppen): `npm run cli -- restore` listet die Sicherungen, `npm run cli -- restore lieferwerk-20260101-020000-auto.db` spielt eine ein. Der bisherige Stand wird als `lieferwerk-vor-restore-….db` daneben abgelegt. Docker: `docker compose stop`, dann `docker compose run --rm lieferwerk node --disable-warning=ExperimentalWarning src/cli.ts restore <datei>`, dann `docker compose up -d`.
- **Sicherung per Kommandozeile:** `npm run cli -- backup`
- **Passwort vergessen:** `npm run cli -- reset-password admin NeuesPasswort123`
- **Benutzer per Kommandozeile:** `npm run cli -- create-user max "Max Mustermann" packer,driver Passwort1234` (mehrere Rollen mit Komma)
- **Dasselbe in Docker:** `docker compose exec lieferwerk node --disable-warning=ExperimentalWarning src/cli.ts reset-password admin NeuesPasswort123`

## Sicherheit

- Passwörter werden mit scrypt gehasht, Sitzungen per Cookie (HttpOnly, SameSite=Lax), Login mit Sperre nach zu vielen Fehlversuchen.
- Rechte werden **serverseitig** geprüft: Packer erhalten Pfandbeträge nicht, solange der Admin sie nicht freigibt.
- Für den Zugriff über das Internet bitte einen Reverse Proxy mit HTTPS davorschalten (und `COOKIE_SECURE=1` setzen).

## Projektstruktur

```
src/            Backend (TypeScript, ohne Build-Schritt)
  server.ts       Einstieg
  db.ts           SQLite-Schema, Beispieldaten
  auth.ts         Anmeldung, Sitzungen, Rollen
  routes/         API (Aufträge, Packen/Fahren, Fuhrpark, Admin)
  lib/            Pfand-Berechnung, Validierung, kleiner Webserver
public/         Frontend (HTML/CSS/JavaScript, ohne Framework)
Dockerfile, docker-compose.yml
```

`npm run check` prüft die Typen (benötigt `typescript` und `@types/node`, optional).
