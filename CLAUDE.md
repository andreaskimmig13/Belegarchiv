# Projekt-Regeln für Claude

## Rolle & Kommunikation
- Der Projektinhaber ist kein Programmierer. Alle Erklärungen, Rückfragen und Zusammenfassungen erfolgen auf Deutsch, präzise und ohne Entwickler-Fachsprache.
- **Plan vor Umsetzung:** Bei Änderungen an mehr als einer Datei, an Datenbank, Login/Berechtigungen oder API-Anbindungen zuerst einen kurzen Schritt-für-Schritt-Plan zeigen (bei Wahlmöglichkeiten max. zwei Wege mit Vor- und Nachteilen) und auf ausdrückliche Freigabe warten.
- **Kleinigkeiten** (Tippfehler, Texte, Farben, Abstände in einer Datei) direkt umsetzen und danach in einem Satz sagen, was geändert wurde.
- Wenn ich etwas selbst tun muss (Supabase, Vercel, GitHub): exakte Klickpfade nennen und sagen, woran ich erkenne, dass der Schritt geklappt hat.

## Entwicklungs-Standards
- **Minimal-Invasivität:** Nur Dateien und Code-Abschnitte ändern, die für die aktuelle Aufgabe nötig sind. Ein Feature oder Bugfix pro Durchgang. Bestehende Logik und Oberfläche nicht nebenbei verändern oder „aufräumen“.
- **Selbstkontrolle – tatsächlich ausführen, nicht nur behaupten:**
  - Gibt es eine `package.json`: nach jeder Änderung `npm run build` ausführen und das Ergebnis nennen.
  - Reine HTML/JS-Projekte: geänderte JS-Dateien mit `node --check` prüfen und Verweise (Dateinamen, Funktionen, IDs) kontrollieren.
  - Konnte etwas nicht geprüft werden, das ausdrücklich sagen.
- **Testanleitung:** Nach jedem Feature/Bugfix 2–4 Schritte nennen, wie ich es selbst teste („Klicke auf X – du solltest Y sehen“).
- **Vollständige Lieferung:** Wenn ich Dateien manuell kopieren muss, nie Platzhalter wie `// ... rest of code`, sondern vollständige, direkt einsetzbare Dateien oder exakte Diffs.

## Git & Veröffentlichung
- Ein Push auf `main` geht sofort live (Vercel / GitHub Pages) – auch für andere Nutzer. **Nie auf `main` pushen ohne meine Freigabe.**
- Nach jedem abgeschlossenen, getesteten Feature einen Commit mit verständlicher deutscher Beschreibung vorschlagen.
- **Noch nicht freigegebene Änderungen** nur auf den festen Zweig `entwurf` hochladen (wiederverwenden, nicht neu anlegen). **Keine weiteren Zweige anlegen** – Claude kann Zweige auf GitHub nicht wieder löschen.

## Sicherheit & Daten (Supabase / APIs)
- **Geheime Schlüssel:** API-Keys nur in `.env` bzw. in den Umgebungsvariablen von Vercel – nie im Code, nie committen. `.env` muss in `.gitignore` stehen. Der Supabase-`service_role`-Key darf nie im Frontend verwendet werden. Öffentliche Repos besonders beachten: alles im Code ist für jeden sichtbar.
- **Daten schützen:** Bestehende Tabellen, Spalten oder Produktivdaten nie löschen oder überschreiben ohne ausdrückliche Warnung und meine Bestätigung. Gilt auch für im Browser gespeicherte Daten (localStorage, IndexedDB) – Änderungen am Speicherformat müssen alte Daten weiter lesen können.
- **Datenbank-Änderungen** nur über Migrationsdateien, nicht direkt per SQL in der Live-Datenbank.
- Bei neuen Tabellen oder Endpunkten automatisch prüfen und berichten: Row Level Security (RLS) aktiv und sinnvoll, Login/Berechtigungsprüfung vorhanden, keine Schlüssel offengelegt.
- Sicherheitsrisiken proaktiv ansprechen, auch wenn nicht danach gefragt wurde.
