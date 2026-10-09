# Regntøj eller ej? — version 1.4.3

En lille dansk webapp med brugerens originale frimærke og gradient, bygget i HTML, CSS og JavaScript med en Netlify Function. Ingen database, Vue/Nuxt eller DMI API-key er nødvendig.

## Nyt i 1.4.3: enkel, fast frimærkekant

Frimærket er en almindelig HTML-flade på 312 × 456 px med hvid CSS-baggrund. En fast SVG bruges kun som CSS-maske til de gennemsigtige udskæringer: buer 24 px i diameter, mellemrum 12 px og 18 px fra hjørnet til første/sidste bue. Der er ingen kant-elementer, webkomponent eller JavaScript til størrelsesberegning. Størrelsen bevares også på mobil.

## Rettelse i 1.3.1

Aalborg kan have frisk temperatur og en tør nedbørsmåling uden en frisk skydækkemåling. Denne situation vises nu som **Ingen målt regn**, med en neutral lukket paraply. Appen gætter ikke sol eller overskyet. Manglende prognose giver fortsat **Ved ikke** på regntøjsvurderingen. En gammel eller manglende nedbørsmåling bliver ikke automatisk til tørvejr.

## Nyt i denne version

- Appen starter automatisk med et mærket **Danmarksoverblik**. Temperaturen vises som et interval fra friske danske DMI-stationer, ikke som én temperatur for hele landet.
- Data prioriteres: nationalt aktuelt vejr → national prognose → lokale målinger → lokal prognose. Prioriteten gælder igangsættelsen; en langsom national prognose forhindrer ikke lokale målinger i at blive vist.
- Aktuelle målinger og prognoser hentes i separate HTTP-kald. En langsom eller overbelastet prognosetjeneste kan derfor ikke blokere temperaturen.
- Vurderingen er **låst til de næste 6 timer**, også over midnat. Der er ingen tidsvælger.
- Enhver positiv forventet nedbør i perioden giver **Ja**, også meget små mængder. Sammenhængende regntimer grupperes og vises i frimærket. Frisk målt nedbør giver også Ja.
- Hvis data mangler, svarer appen **Ved ikke**, aldrig et ubekræftet Nej.
- Et sent nationalt svar kan ikke overskrive brugerens lokale vejr.
- En rolig illustration vises, mens GIF'en indlæses. GIF'en bruges ved aktuelt regnvejr; regn senere i perioden ændrer ikke det målte aktuelle vejrsymbol.

## Opdater den eksisterende Netlify-app

1. Pak ZIP-filen ud.
2. Erstat repositoryets filer med **indholdet af projektmappen**, så `netlify.toml` ligger i roden.
3. Medtag **alle filer**, især `lib/dmi.mjs`, `netlify/functions/weather.mjs`, `public/app.mjs` og `public/weather-model.mjs`.
4. Commit/push til repositoryet, som allerede er tilknyttet Netlify. Den eksisterende opsætning genudgiver projektet.

Der skal ikke oprettes en ny app, database eller API-key. Under kontrollen den 8. oktober 2026 kørte den offentlige side stadig den første udgave: dens API-svar indeholdt ikke de aktuelle temperaturmålinger. Frontend og serverfunktion skal opdateres samlet.

Kontrollér efter deployment:

```text
/api/weather?scope=denmark&part=current
/api/weather?scope=local&part=current&lat=55.68&lon=12.57
/api/weather?scope=local&part=forecast&lat=55.68&lon=12.57&hours=6
```

Svarene fra denne version indeholder `version: "1.4.3"` og headeren `X-App-Version: 1.4.3`.

## Start lokalt

Node.js 22 eller nyere:

```sh
npm run dev
```

Åbn `http://localhost:8888`. Ingen pakker skal installeres til appen.

```sh
npm test
npm run build
```

`npm run build` kontrollerer JavaScript og kører testene. `public/` er allerede klar til udgivelse. En ren drag-and-drop-upload af `public/` til Netlify er utilstrækkelig: serverfunktionen skal også deployes. Brug det tilknyttede Git-repository eller Netlify CLI.

## Resultat af gennemgangen

Den gamle funktion ventede på fem datakald i én samlet `Promise.allSettled`, herunder prognosen og et genforsøg. Det samlede svar kunne derfor forsinke allerede tilgængelige målinger. Den gamle nedbørsregel havde også minimumsgrænser, og meget små prognoseværdier blev afrundet væk. Begge dele er ændret.

Målt lokalt den 8. oktober 2026 med rigtige DMI-data:

| Kald | Observeret svartid |
| --- | ---: |
| Gammel samlet lokal funktion | ca. 4,4 sekunder |
| Nyt nationalt aktuelt vejr, kold cache | 726 ms |
| Nyt nationalt aktuelt vejr, varm cache | 11 ms |
| Nye lokale målinger, delt varm cache | 19 ms |
| Separat lokal prognose, DMI HTTP 429 | 228 ms |
| Prognose under kort cooldown | 7 ms |

Dette er observerede lokale svartider, ikke garantier. Netlify cold starts og brugerens netværk kan give ekstra ventetid. HTTP 429 er en servicefejl, ikke en vellykket prognose.

Funktionen returnerer `timings` og HTTP-headeren `Server-Timing` til fejlsøgning. Målingerne registreres ikke i en ekstern database.

## Datakilder og begrænsninger

### Aktuelle målinger

DMI Meteorological Observation API:

```text
https://opendataapi.dmi.dk/v2/metObs/collections/observation/items
```

Parametre: `temp_dry`, `cloud_cover` og `precip_past10min`. En samlet, kortvarigt cachet datakilde dækker danske DMI-stationer, og den genbruges ved lokationsvalg. Stationsmetadata filtreres med dato, så historiske stationsversioner ikke hentes unødigt.

En måling må højst være 30 minutter gammel. Lokal temperatur bruger den nærmeste friske station inden for 50 km. Skydække måles ved færre stationer og bruger op til 75 km. En afstand over 25 km mærkes som en **regional måling**, og station/afstand fremgår under i-knappen. Nedbør bruger højst 25 km, fordi regn kan være meget lokal.

Regnvejr prioriteres ved frisk målt nedbør. Sol, let skyet og overskyet er appens vurdering af skydække, ikke en officiel DMI-vejrkode. Målingerne gælder stationerne og kan ikke bevise vejret på brugerens præcise position. Temperatur, skydække og nedbør kan komme fra forskellige stationer.

Danmarksoverblikkets temperaturinterval bygger på friske, gyldige danske temperaturmålinger. Uden lokationsvalg gives der ikke en skjult København-temperatur som nationalt resultat.

### Prognoser

DMI Forecast Data EDR API med HARMONIE DINI:

```text
https://opendataapi.dmi.dk/v1/forecastedr/collections/harmonie_dini_sf/instances
https://opendataapi.dmi.dk/v1/forecastedr/collections/harmonie_dini_sf/instances/{run}/position
```

Appen vælger en tilgængelig modelkørsel, begrænser tidsrummet og henter kun `total-precipitation`, `temperature-2m` og `fraction-of-cloud-cover`. Formatet er CoverageJSON, som er mere kompakt end GeoJSON. GeoJSON understøttes også i parseren.

En baseline før den første intervalslutning bruges til at beregne forskelle mellem akkumulerede nedbørsværdier. kg/m² svarer til mm vand, og Kelvin konverteres til Celsius. Baseline og intervalværdier kommer fra samme modelkørsel. Modelalderen vurderes ud fra modelkørslens start, ikke starten på det begrænsede forespørgselsvindue.

Der medtages hele modeltimer, der overlapper de næste 6 timer. Den første time kan indeholde allerede falden nedbør, og den sidste kan strække sig lidt ud over perioden. Tidsrummene er derfor konservative, timebaserede intervaller. Et ekstra datapunkt kan medtages nær en timegrænse, så en kortvarigt cachet prognose stadig dækker perioden. Vurderingen filtrerer altid til de 6 timer.

`total-precipitation` inkluderer også vandækvivalent af slud/sne/hagl. Appen beregner ikke regnsandsynlighed eller radarbaseret nowcasting.

**National prognose:** Standardresultatet er et **regionalt overblik med 12 repræsentative modelpunkter** fordelt over Danmark, inklusive Bornholm. Det er ikke en fuld scanning af alle DMI-gridceller, og lokale byger mellem punkterne kan forekomme. Dette oplyses i dataoplysningerne. Ét kendt vådt punkt giver Ja. En ufuldstændig tør regional prognose må ikke give Nej. Efter lokationsvalg bruges det lokale modelpunkt.

DMI's prognoseendpoint returnerede fortsat HTTP 429 “Server is busy” i live-afprøvningen. Flere forespørgselsformer blev afprøvet, inklusive et bestemt modelrun, færre parametre og kortere tidsrum. En vellykket live-prognose kan endnu ikke bekræftes. Format og beregning er kontrolleret mod dokumentationen og testdata.

## Cache og tidsgrænser

- Nationale observationsdata genbruges på tværs af lokationer i samme varme funktion.
- Netlify CDN kan cache brugbare svar i op til 120 sekunder.
- Modelmetadata caches i 10 minutter og prognosedata i 5 minutter.
- Fejlsvar caches kort; der foretages ikke et automatisk ekstra kald ved HTTP 429.
- Prognosefejl udløser en kort cooldown, som kun påvirker prognoser, ikke målinger.
- Målekald har en tidsgrænse på 4,5 sekunder. Prognosepunktkald har højst 6,5 sekunder, og det regionale overblik har et samlet budget på cirka 14 sekunder.
- Kun to nationale prognosepunkter hentes samtidig.
- Der gemmes højst 128 cacheposter pr. funktion. Cache er midlertidig; ingen database er nødvendig.

## Design og privatliv

Frimærket bygger på brugerens [wRJWop](https://codepen.io/thomasclausen/pen/wRJWop). Gradientens farvestop fra [zmpGWZ](https://codepen.io/thomasclausen/pen/zmpGWZ) er bevaret uændret. Den hvide perforerede kant er gennemsigtig mod baggrunden. DMI-linket ligger i sin egen footer og følger normalt layout; det kan ikke lægge sig oven på frimærket.

Lokationsmenuen står direkte under vejrtype-teksten med en 2 px bundlinje og ikke-valgbare skillelinjer omkring GPS-valget. Den indeholder Danmark som standard, Brug min lokation og byerne. I-knappen står ved DMI-linket. Oplysninger og manuel opdatering findes under i-knappen. Der er ingen tidsvælger. `/design-preview.html` viser tydeligt markerede eksempeldata.

Geolokation kræver et aktivt klik og browserens tilladelse. Koordinater afrundes til to decimaler. Appen opretter ingen brugerprofil eller lokationsdatabase. Danmark er standard ved åbning. Netlify og DMI kan behandle forespørgsler i driftslogs/cache. GIF'en hentes fra GIPHY ved behov, og GIPHY kan se billedforespørgslen. Appen bruger ingen analyseværktøjer.

## Verifikation

- 30 automatiske tests består, inklusive små regnmængder, seks timer over midnat, CoverageJSON, modelalder, nationalt temperaturinterval, delvise prognoser, stationsafstande og separate måle-/prognosekald.
- Browserkontrol af Danmark som standard, byvalg, GPS-tilladelse, afvist og afbrudt GPS samt i-knappen består.
- jsdom er kun et lokalt QA-værktøj og er ikke en afhængighed i appen.
- Den faste maske er kontrolleret i en rigtig browser på desktop og mobil, inklusive pixelmål og DMI-footerens placering.
- Version 1.4.3 leveres som ZIP/kildekode og er ikke deployet til brugerens Netlify-konto fra denne chat.

## Officielle kilder

- [DMI API-oversigt](https://www.dmi.dk/friedata/dokumentation/apis)
- [DMI autentifikation og begrænsninger](https://www.dmi.dk/friedata/dokumentation/basics)
- [DMI Meteorological Observation API](https://www.dmi.dk/friedata/dokumentation/meteorological-observation-api)
- [DMI observationsparametre](https://www.dmi.dk/friedata/dokumentation/meteorological-observations-data)
- [DMI Forecast Data EDR API](https://www.dmi.dk/friedata/dokumentation/forecast-data-edr-api)
- [DMI HARMONIE-parametre](https://www.dmi.dk/friedata/dokumentation/data/weather-model-harmonie-edr-api-parameter-list)
- [Netlify JavaScript Functions](https://docs.netlify.com/build/functions/get-started/)
