# Latency based IP Geolocation 

A simple tool that uses Globalping to resolve an IP to a physical location based on latency. 

Learn more about this tool and why it exists in our blog: [BLOG TITLE and LINK]()

### Install
```
git clone
cd geolocation-tool
npm install && npm link
geolocate

```

### Usage

It's recommended to run the tool with a token for a higher limit of 500 tests per hour.

This tool will read the token from the env var `GLOBALPING_TOKEN`. It's the same variable the [Globalping CLI](https://github.com/jsdelivr/globalping-cli) uses.

Get a free token in the [Globalping Dashboard](https://dash.globalping.io/).

```
Resolve an IP. A default limit of 50 probes is set per phase.
USA has 4 phases. All other countries have 3 phases.
This means the total usage is going to be Phases * Limit.
So by default 200 for USA and 150 for the rest.
+30 for continent selection in phase 1.

geolocate 213.133.116.45


-L/--limit sets a higher limit of probes per phase.
This will improve accuracy, especially for cities but will consume lots of credits

geolocate 213.133.116.45 -L 200


Provide token explicitly

GLOBALPING_TOKEN=XXX geolocate 213.133.116.45

```

### Example


```
# geolocate 45.95.160.61
Geolocating 45.95.160.61...

Phase 1: Detecting continent...
  Europe: 123.12 ms
  Oceania: 172.49 ms
  North America: 57.23 ms
  South America: 93.96 ms
  Asia: 167.03 ms
  Africa: 257.46 ms

Best continent: North America (57.23 ms)

Phase 2: Detecting country...
  Measuring from 50 probes...

  [████████████████████████████████████████] 100.0%   50/50 - Best: US (0.01 ms)                    

  United States: 0.01ms
  Canada: 42.96ms

Best country: United States (0.01ms)

Phase 3: Detecting US state...
  Measuring from 50 probes...

  [████████████████████████████████████████] 100.0%   50/50 - Best: FL (0.26 ms)                    

  Florida: 0.26ms
  Illinois: 0.38ms
  Oklahoma: 0.81ms

Best state: Florida (0.26ms)

Phase 4: Detecting city...
  Measuring from 37 probes...

  [███████████████████████████████████████░]  97.3%   36/37 - Best: Miami (0.01 ms)                 

Top 3 Locations:
─────────────────────────────────────────────────
  1. Miami, Florida, USA                      0.01 ms
  2. West Palm Beach, Florida, USA            5.38 ms
  3. Tampa, Florida, USA                      5.80 ms

═══════════════════════════════════════════════════
                      SUMMARY
═══════════════════════════════════════════════════
  Location: Miami, Florida, United States
  Minimum Latency: 0.01 ms
  Confidence: Very High
═══════════════════════════════════════════════════
```
