# ClauseWatch

ClauseWatch turns contracts stored in Elasticsearch into a living risk register.

## Live workflow

1. Upload a PDF, TXT, or Markdown contract.
2. Gemini extracts parties, dates, value, and risk-relevant clauses.
3. The structured contract and source text are indexed in Elasticsearch.
4. Gemini compares the complete indexed portfolio and rebuilds the risk register.
5. Dashboard deadlines and chat answers use the live Elastic portfolio.

There is no seeded contract or risk data.

## Run locally

Create `.env` using `.env.example`:

```env
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-2.5-flash
PORT=8787
ORGANIZATION_NAME=Your Company Legal Name

ELASTICSEARCH_URL=https://your-deployment.es.region.gcp.elastic.cloud:443
ELASTICSEARCH_API_KEY=your_elastic_api_key
ELASTICSEARCH_INDEX=contracts
```

Then run:

```powershell
npm install
npm run dev
```

Open `http://localhost:5173`.

The backend automatically creates the configured contract index and a
`<ELASTICSEARCH_INDEX>-risks` index.

## Health check

Open `http://localhost:8787/api/health`. A fully working setup returns:

```json
{
  "status": "ok",
  "gemini": { "connected": true },
  "elasticsearch": { "connected": true }
}
```

## Production

```powershell
npm run build
npm start
```

The Express service serves the API and built frontend from port `8787`.

Never commit `.env` or expose Gemini and Elasticsearch credentials in browser code.
