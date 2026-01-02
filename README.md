# Bar Replay Pro

## Data Source

Historical data is sourced from Binance Vision:
https://data.binance.vision/?prefix=data/futures/um/monthly/klines/SOLUSDT/1h/

## Adding New Data

To add more data to the project:

1. Download the CSV files and place them into the `src/data` directory.
2. Run the following commands to generate the manifest:

```bash
cd ./scripts/
node ./generate-manifest.js
```

..
