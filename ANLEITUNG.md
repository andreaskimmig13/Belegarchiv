# Belegarchiv – Einrichtung (ca. 15–20 Minuten)

Am besten am PC einrichten, danach nutzt du die App auf dem Handy.

## 1. Claude API-Schlüssel besorgen
1. Gehe auf **console.anthropic.com** und lege ein Konto an.
2. Unter *Billing* ein kleines Guthaben aufladen (z. B. 5 €; das reicht für sehr viele Belege).
3. Unter *API Keys* → **Create Key** → Schlüssel kopieren (beginnt mit `sk-ant-…`).
   Tipp: Unter *Limits* ein Monatslimit setzen, z. B. 5 €.

## 2. Projekt anlegen
1. Öffne **script.google.com** (mit deinem Google-Konto) → **Neues Projekt**.
2. Oben links den Namen auf **Belegarchiv** ändern.
3. Die Datei `Code.gs` öffnen, alles darin löschen und den Inhalt von **Code.gs** einfügen.
4. Links bei *Dateien* auf **+** → **HTML** → Name `Index` (ohne .html). Inhalt löschen und **Index.html** einfügen.
5. Zahnrad (*Projekteinstellungen*) → Haken bei **„Manifestdatei appsscript.json im Editor anzeigen“**.
   Zurück im Editor `appsscript.json` öffnen und durch den Inhalt von **appsscript.json** ersetzen.
6. Speichern (Strg+S).

## 3. Einrichtung ausführen
1. Oben in der Funktionsauswahl **setup** wählen → **Ausführen**.
2. Google fragt nach Berechtigungen (Drive, Tabellen, Gmail, Kalender, externe Verbindungen).
   Da es dein eigenes Skript ist, erscheint „Google hat diese App nicht überprüft“ →
   **Erweitert** → **Zu Belegarchiv wechseln (unsicher)** → **Zulassen**.
   Das ist normal für private Skripte; die Daten bleiben in deinem Konto.
3. Im Ausführungsprotokoll erscheinen die Links zum neuen Drive-Ordner und zur Tabelle.

Angelegt werden: Ordner **Belegarchiv** (mit Jahresordnern und *Exporte*), die Tabelle **Belegarchiv – Datenbank**, das Gmail-Label **Belegarchiv/importiert** und ein täglicher Gmail-Import um 6 Uhr.

## 4. Als Web-App veröffentlichen
1. Oben rechts **Bereitstellen** → **Neue Bereitstellung** → Typ (Zahnrad) **Web-App**.
2. *Ausführen als:* **Ich** · *Zugriff:* **Nur ich selbst**.
3. **Bereitstellen** → die **Web-App-URL** kopieren.

## 5. Aufs Handy
1. Web-App-URL auf dem Handy öffnen (z. B. per Mail an dich selbst).
2. **iPhone (Safari):** Teilen → „Zum Home-Bildschirm“.
   **Android (Chrome):** ⋮ → „Zum Startbildschirm hinzufügen“.
3. In der App unter **Mehr → Einstellungen** den API-Schlüssel eintragen → **Speichern** → **Verbindung testen**.

Fertig. Beim ersten Foto fragt das Handy, ob die App auf die Kamera zugreifen darf.

---

## Gut zu wissen
- **Wo liegen die Daten?** Bilder/PDFs in Drive unter `Belegarchiv/<Jahr>/`, benannt wie `2026-10-18_Bauhaus_49,90EUR.jpg`. Alle Angaben stehen in der Tabelle – du kannst dort auch direkt filtern oder auswerten.
- **Gmail-Import:** sucht in Mails der letzten 30 Tage nach Rechnungen, Bestellbestätigungen usw. Gefundene Belege landen mit dem Status **„Zu prüfen“** im Archiv (Personen-Vorauswahl: Andreas). Verarbeitete Mails bekommen das Label *Belegarchiv/importiert* und werden nicht doppelt gelesen.
- **Erinnerungen:** Garantie-Ende → Termin im Google Kalender 4 Wochen vorher; Rückgabefrist → 2 Tage vorher.
- **Kosten:** Pro Beleg fallen bei der Claude API typischerweise Bruchteile eines Cents bis wenige Cent an. Günstiger geht's mit dem Modell `claude-haiku-5-5` (unter *Mehr → KI-Modell*), etwas weniger genau bei schlechten Fotos.
- **Code ändern:** Nach jeder Änderung **Bereitstellen → Bereitstellungen verwalten → Bearbeiten (Stift) → Version: Neue Version → Bereitstellen**. Die URL bleibt gleich.
- **Kategorien/Personen** änderst du jederzeit in der App unter *Mehr*.

## Später: Familie mitbenutzen lassen
1. Den Drive-Ordner *Belegarchiv* (inkl. Tabelle) mit den Google-Konten der Familie teilen (Bearbeiter).
2. Neue Bereitstellung mit *Ausführen als:* **Nutzer, der auf die Web-App zugreift** und *Zugriff:* **Jeder mit Google-Konto**.
3. Jede Person muss beim ersten Öffnen die Berechtigungen bestätigen.
   Hinweis: Der API-Schlüssel ist in den Skripteigenschaften gespeichert und wird mitbenutzt.

## Updates
1. Neue Dateien bei script.google.com einfügen und speichern.
2. **Bereitstellen → Bereitstellungen verwalten → Bearbeiten (Stift) → Version: Neue Version → Bereitstellen.**
   (Wer die Test-Adresse `…/dev` nutzt, kann Schritt 2 weglassen.)

Die App aktualisiert sich bewusst **nicht** selbst: Code aus diesem Repository gelangt nur in die App, wenn er von Hand eingefügt wird.

## App-Logo auf dem Homescreen
Statt der Google-Adresse die Startseite **andreaskimmig13.github.io/Belegarchiv** auf den Homescreen legen.
Sie zeigt das Logo und leitet sofort zur App weiter. (Zum Ansehen ohne Weiterleitung: `…/Belegarchiv/?stay`.)
