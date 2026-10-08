# Regntøj eller ej?

En dansk webapp, der hjælper brugeren med at vælge regntøj ud fra en frisk nedbørsmåling og DMI’s prognose for den valgte lokation. Appen er forberedt til Netlify.

## Teknologi

- HTML, CSS og JavaScript uden framework eller tredjepartsafhængigheder.
- En Netlify Function på `/api/weather` henter DMI’s data og håndterer cache, fejl og koordinater.
- Ingen database, login eller Supabase er nødvendig. Supabase kan tilføjes senere, hvis der bliver behov for brugerprofiler eller historik.
- DMI’s nye værtsnavn `opendataapi.dmi.dk` kræver ikke API-nøgle. Brug ikke det gamle `dmigw.govcloud.dk`.
- Node.js 22 eller nyere.

Vue/Nuxt ville tilføre ekstra opsætning uden at være nødvendig for denne lille app.

## Start lokalt

```sh
npm run dev
```

Åbn `http://localhost:8888`. Serveren leverer både frontend og den samme funktion, som bruges på Netlify. Der skal ikke installeres pakker. Vælg en by eller tryk “Brug min lokation”. Første besøg viser ikke en opdigtet vejrudsigt.

```sh
npm test
npm run build
```

Build-kommandoen kontrollerer JavaScript og kører testene. Frontend-filerne i `public/` er allerede klar til udgivelse.

## Udgiv på Netlify

**Via Git (anbefalet)**

1. Læg indholdet af denne mappe i et GitHub-, GitLab- eller Bitbucket-repository, med `netlify.toml` i repositoryets rod.
2. I Netlify: vælg **Add new project → Import an existing project**, og vælg repositoryet.
3. Netlify læser opsætningen fra `netlify.toml`: build `npm run build`, publish `public`, functions `netlify/functions`, Node 22.
4. Udgiv projektet. Der kræves ingen miljøvariabler eller DMI-nøgle.
5. Kontroller byvalg, geolokation, `/api/weather?lat=55.68&lon=12.57` og GIF-visning på den udgivne HTTPS-adresse.

**Via Netlify CLI**

Fra denne projektmappe, på en maskine med Node 22+:

```sh
npx netlify-cli login
npx netlify-cli init
npx netlify-cli deploy --build --prod
```

CLI'en guider dig til et nyt eller eksisterende Netlify-projekt. Log ind via browseren; læg aldrig et personligt Netlify-token i kildekoden.

En ren drag-and-drop-upload af `public/` er utilstrækkelig, fordi serverfunktionen også skal deployes. Brug Git-import eller CLI.

## Hvad appen gør

- Browserens geolokation eller manuelt valg mellem 44 danske byer.
- Resten af dagen, de næste 2 timer eller de næste 6 timer, altid afgrænset ved dansk midnat.
- Anbefaling, temperaturprognose, nedbør og stationsnavn med afstand og måletidspunkt.
- Vandret timeoversigt og mobiltilpasset layout.
- Den ønskede [GIPHY-animation](https://giphy.com/gifs/cute-dancing-39fj7g99qyD72), når regntøj anbefales. Ved reduceret bevægelse eller billedfejl bruges en rolig illustration.
- Automatisk opdatering hvert femte minut, mens siden er synlig, samt en manuel opdateringsknap.
- Ingen analyseværktøjer. Kun manuelt byvalg gemmes i browserens localStorage. Enhedens koordinater gemmes ikke i en brugerprofil.

## Datakilder og beregning

**Prognose:**

`GET https://opendataapi.dmi.dk/v1/forecastedr/collections/harmonie_dini_sf/position`

Parametre: `coords=POINT(lon lat)`, `crs=crs84`, `f=GeoJSON`, `parameter-name=total-precipitation,temperature-2m,wind-speed-10m,fraction-of-cloud-cover`.

En samlet forespørgsel henter alle tidstrin i den seneste komplette model. Nedbørsmængden beregnes som forskellen mellem akkumulerede værdier fra samme svar. Enheden kg/m² svarer til mm vand. Temperatur konverteres fra Kelvin til Celsius. Nulværdier, manglende data og fald i akkumulation blandes ikke sammen.

**Måling:**

`GET https://opendataapi.dmi.dk/v2/metObs/collections/observation/items`

Parametre: en lokal `bbox`, `parameterId=precip_past10min`, `period=latest-hour`, `limit=1000`.

Appen vælger den nærmeste station med en gyldig måling, der er højst 30 minutter gammel og ligger inden for 25 km. Stationsnavne hentes fra `/v2/metObs/collections/station/items`; historiske stationsversioner filtreres efter gyldighed. Målingen siger noget om stationen og kan ikke bevise, om det regner på brugerens præcise position.

**Anbefalingens tommelfingerregel:**

- Regntøj ved målt nedbør på mindst **0,1 mm / 10 minutter**, eller prognose på mindst **0,2 mm i en time** eller **0,5 mm samlet i de viste tidsrum**.
- “Lad regntøjet blive hjemme” kræver en sammenhængende, gyldig prognose for hele den valgte periode.
- Uden tilstrækkelig prognose vises “Vi mangler lidt af vejret”. Frisk observeret nedbør kan stadig begrunde en anbefaling om regntøj.
- En prognose, hvis første tidstrin er mere end 12 timer gammelt, regnes som for gammel. Dette er appens egen praktiske friskhedsgrænse.
- Timer, der overlapper perioden, medtages konservativt med hele deres nedbørsmængde. Den igangværende time kan indeholde allerede falden nedbør; sidste time kan strække sig ud over en 2- eller 6-timers periode. Dette fremgår af timeoversigtens note.
- Nedbør kan også være slud, sne eller hagl. Appen beregner ingen regnsandsynlighed og laver ikke radarbaseret nowcasting.

Grænserne kan ændres i `public/weather-model.mjs`. De er appens beslutningsregel, ikke en officiel beklædningsanbefaling fra DMI.

## Cache, privatliv og fejl

Koordinater afrundes til to decimaler før afsendelse fra browseren. Serveren validerer og afrunder dem igen. Appens område er en dansk bounding box (54,4–58° N, 7,5–15,5° Ø), som også indeholder lidt af nabolandene og havet.

DMI-svar caches kortvarigt i funktionens hukommelse, med højst 100 poster. Stationsmetadata caches længere. Netlify CDN må cache brugbare svar i op til 120 sekunder; cachetiden afkortes ved dansk midnat. Der anvendes ikke `stale-while-revalidate`, som kunne lade gårsdagens svar fortsætte efter midnat. Dataforespørgsler kan fremgå af Netlify og DMI’s driftslogs. GIF'en hentes direkte fra GIPHY, når den er relevant; GIPHY kan dermed se billedforespørgslen.

DMI-kald har timeout og én kort retry ved midlertidig overbelastning. Funktionens prognose- og observationskald er uafhængige, så en fejlet prognose ikke skjuler en brugbar observation. Manglende og gamle data bliver aldrig stiltiende til 0 mm.

## Verifikation i denne leverance

- 13 automatiske tests dækker nedbørsdifferencer, perioder, dansk midnat og sommertid, tærskler, gamle/manglende data, stationsvalg, koordinater, API-validering og en overbelastet prognosetjeneste.
- Lokal HTTP-server og aktuelle målinger er afprøvet med rigtige DMI-data. For København blev stationen Botanisk Have valgt med navn, afstand og frisk måletid.
- DMI’s prognoseendpoint returnerede gentagne gange HTTP 429 “Server is busy” under afprøvningen den 8. oktober 2026. En vellykket live-prognose kan derfor endnu ikke bekræftes. Prognoseintegration er kontrolleret mod dokumentationen og testdata med det dokumenterede GeoJSON-format.
- Automatisk browserkontrol kunne ikke starte i dette lokale miljø. Visuel kontrol og browserens geolokation/GIF-flow skal derfor bekræftes på previewet eller efter deployment.
- Projektet er ikke udgivet på Netlify fra denne chat; der mangler en tilknyttet Netlify-konto eller et målprojekt.

## Officielle kilder

- [DMI: API-oversigt](https://www.dmi.dk/friedata/dokumentation/apis)
- [DMI: endpoints, autentifikation og begrænsninger](https://www.dmi.dk/friedata/dokumentation/basics)
- [DMI: Forecast Data EDR API](https://www.dmi.dk/friedata/dokumentation/forecast-data-edr-api)
- [DMI: HARMONIE-parametre](https://www.dmi.dk/friedata/dokumentation/data/weather-model-harmonie-edr-api-parameter-list)
- [DMI: Meteorological Observation API](https://www.dmi.dk/friedata/dokumentation/meteorological-observation-api)
- [DMI: observationsparametre](https://www.dmi.dk/friedata/dokumentation/meteorological-observations-data)
- [Netlify: JavaScript Functions](https://docs.netlify.com/build/functions/get-started/)

## Filer

```text
public/                  HTML, CSS, browserkode og illustrationer
public/weather-model.mjs Delte tids- og anbefalingsregler
lib/dmi.mjs              DMI-kald, parsing, stationsvalg og cache
netlify/functions/       Serverfunktionen på /api/weather
scripts/                 Lokal server og build-kontrol
tests/                   Automatiske tests
netlify.toml             Deployment og sikkerhedsheaders
```
