# Enhetsteller

En PWA (installerbar nettapp) for å telle alkoholenheter per dag. Frontend (`public/`)
kjører i telefonen og viser data momentant fra en lokal kopi (`localStorage`), mens
en liten Node/Express-server (`server.js`) lagrer alt i en ekte Postgres-database
slik at dataene overlever at man lukker appen, bytter nettleser, eller sletter
lokal nettleserdata (så lenge samme anonyme enhets-ID beholdes, se under).

## Mappestruktur

```
server.js        – Express-server: serverer public/ og et lite REST-API
package.json      – avhengigheter (express, pg)
public/           – selve appen (HTML/CSS/JS/ikoner/manifest)
```

## Hvordan data lagres

- Hver telefon/nettleser får en tilfeldig, anonym enhets-ID lagret i `localStorage`
  første gang appen åpnes. Ingen pålogging.
- Alt som legges inn sendes til `PUT /api/entries` og lagres i tabellen `entries`,
  nøkkel `(device_id, entry_date, item_id)`.
- Ved oppstart henter appen `GET /api/entries?device=...` og bruker det som fasit.
  Går ikke nettverket akkurat da, brukes den lokale kopien i mellomtiden.
- **Viktig begrensning:** siden det ikke er noen pålogging, er enhets-IDen det eneste
  som kobler en telefon til dataene sine. Sletter man nettleserdata/cookies for
  siden (eller avinstallerer/reinstallerer appen), mister man koblingen til det som
  ligger lagret fra før, og får en ny, tom ID.

## Resultattavle (side 3)

Tredje fane i appen. Man skriver inn et navn, som lagres i tabellen `players`
(`device_id` → `name`, én rad per enhets-ID). `GET /api/scoreboard` summerer alle
registreringer per enhets-ID (omregnet til 0,5L øl-ekvivalenter, samme faktorer
som resten av appen — se `ITEM_FACTORS` i `server.js`), og returnerer kun de
enhets-IDene som har satt et navn, sortert høyest total først.

Merk: siden det ikke er pålogging, er det ingenting i veien for at to personer
skriver inn samme navn — resultattavlen skiller dem uansett internt på
enhets-ID, men de vil se ut som duplikater i lista.

## Deploy til Railway (via GitHub)

1. **Opprett et GitHub-repo** og legg inn alt innholdet i denne mappen (unntatt
   `node_modules/`, som allerede ligger i `.gitignore`).
2. **Railway → New Project → Deploy from GitHub repo**, velg repoet.
3. I samme Railway-prosjekt: **+ New → Database → Add PostgreSQL**.
4. Åpne app-tjenesten din i Railway → fanen **Variables** → legg til:
   - `DATABASE_URL` → sett verdien til en referanse til Postgres-tjenesten,
     f.eks. `${{Postgres.DATABASE_URL}}` (Railway foreslår vanligvis dette selv
     når begge tjenester ligger i samme prosjekt).
5. Railway kjenner igjen Node-appen automatisk via `package.json` (`npm install`
   og `npm start`). Ingen ekstra bygg-konfigurasjon nødvendig.
6. Når deployen er ferdig får du en URL i stil med `https://enhetsteller-production.up.railway.app`.
   Åpne den i Safari på iPhone → Del-knappen → **Legg til på Hjem-skjerm**.
   Del samme lenke med alle du vil skal kunne bruke appen – de får sin egen
   anonyme enhets-ID automatisk.

Serveren oppretter databasetabellen selv ved oppstart (`CREATE TABLE IF NOT EXISTS`),
så det trengs ingen manuell migrasjon.

### Feilsøking

- Loggene i Railway (fanen **Deployments** → **View Logs**) viser om serveren
  klarte å koble til databasen. Meldingen
  `ADVARSEL: DATABASE_URL er ikke satt` betyr at variabelen i steg 4 mangler.
- Skulle du få en SSL-relatert databasefeil, prøv å sette miljøvariabelen
  `PGSSL=disable` på app-tjenesten.

## Kjøre lokalt (valgfritt, for egen utvikling)

Krever Node 18+ og en lokal eller ekstern Postgres-database.

```bash
npm install
export DATABASE_URL="postgres://bruker:passord@localhost:5432/enhetsteller"
npm start
```

Appen kjører da på http://localhost:3000.

## Justere enhetstyper/omregningsfaktorer

Se `ITEMS`-arrayet øverst i `public/app.js` (frontend – styrer UI og lokal
omregning) og `ITEM_IDS` øverst i `server.js` (backend – styrer hvilke type-IDer
som godtas). De to listene med ID-er må stemme overens.
