const required = ["ELASTICSEARCH_URL", "ELASTICSEARCH_API_KEY", "ELASTICSEARCH_INDEX"];

function config() {
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing Elasticsearch configuration: ${missing.join(", ")}`);
  const contractIndex = process.env.ELASTICSEARCH_INDEX;
  return {
    baseUrl: process.env.ELASTICSEARCH_URL.replace(/\/$/, ""),
    apiKey: process.env.ELASTICSEARCH_API_KEY,
    contractIndex,
    riskIndex: `${contractIndex}-risks`,
  };
}

async function request(path, options = {}) {
  const { baseUrl, apiKey } = config();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      authorization: `ApiKey ${apiKey}`,
      "content-type": "application/json",
      ...options.headers,
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const reason = body?.error?.reason || body?.error?.root_cause?.[0]?.reason || response.statusText;
    throw new Error(`Elasticsearch ${response.status}: ${reason}`);
  }
  return body;
}

async function ensureIndex(index, properties) {
  const { baseUrl, apiKey } = config();
  const exists = await fetch(`${baseUrl}/${encodeURIComponent(index)}`, {
    method: "HEAD",
    headers: { authorization: `ApiKey ${apiKey}` },
  });
  if (exists.ok) return;
  if (exists.status !== 404) throw new Error(`Elasticsearch index check failed: ${exists.status}`);
  await request(`/${encodeURIComponent(index)}`, {
    method: "PUT",
    body: JSON.stringify({ mappings: { dynamic: true, properties } }),
  });
}

export async function ensureIndices() {
  const { contractIndex, riskIndex } = config();
  await ensureIndex(contractIndex, {
    name: { type: "text", fields: { keyword: { type: "keyword" } } },
    counterparty: { type: "keyword" },
    contractType: { type: "keyword" },
    version: { type: "keyword" },
    status: { type: "keyword" },
    effectiveDate: { type: "date", ignore_malformed: true },
    expirationDate: { type: "date", ignore_malformed: true },
    uploadedAt: { type: "date" },
    sourceText: { type: "text" },
    clauses: {
      type: "nested",
      properties: {
        section: { type: "keyword" },
        category: { type: "keyword" },
        text: { type: "text" },
        value: { type: "keyword" },
      },
    },
  });
  await ensureIndex(riskIndex, {
    title: { type: "text" },
    severity: { type: "keyword" },
    category: { type: "keyword" },
    status: { type: "keyword" },
    generatedAt: { type: "date" },
    contracts: { type: "keyword" },
  });
}

function hitsToSources(result) {
  return result.hits.hits.map((hit) => ({ id: hit._id, ...hit._source }));
}

export async function listContracts(size = 100) {
  const { contractIndex } = config();
  const result = await request(`/${encodeURIComponent(contractIndex)}/_search`, {
    method: "POST",
    body: JSON.stringify({ size, sort: [{ uploadedAt: "desc" }], query: { match_all: {} } }),
  });
  return hitsToSources(result);
}

export async function searchContracts(query, size = 20) {
  const { contractIndex } = config();
  if (!query?.trim()) return listContracts(size);
  const result = await request(`/${encodeURIComponent(contractIndex)}/_search`, {
    method: "POST",
    body: JSON.stringify({
      size,
      query: {
        bool: {
          should: [
            { multi_match: { query, fields: ["name^3", "counterparty^2", "contractType", "sourceText"] } },
            { nested: { path: "clauses", query: { match: { "clauses.text": query } } } },
          ],
          minimum_should_match: 1,
        },
      },
    }),
  });
  return hitsToSources(result);
}

export async function getContract(id) {
  const { contractIndex } = config();
  return request(`/${encodeURIComponent(contractIndex)}/_doc/${encodeURIComponent(id)}`)
    .then((result) => ({ id: result._id, ...result._source }));
}

export async function saveContract(contract) {
  const { contractIndex } = config();
  const { id, ...document } = contract;
  await request(`/${encodeURIComponent(contractIndex)}/_doc/${encodeURIComponent(id)}?refresh=wait_for`, {
    method: "PUT",
    body: JSON.stringify(document),
  });
  return contract;
}

export async function deleteContract(id) {
  const { contractIndex } = config();
  await request(`/${encodeURIComponent(contractIndex)}/_doc/${encodeURIComponent(id)}?refresh=wait_for`, {
    method: "DELETE",
  });
}

export async function listRisks(size = 100) {
  const { riskIndex } = config();
  const result = await request(`/${encodeURIComponent(riskIndex)}/_search`, {
    method: "POST",
    body: JSON.stringify({ size, query: { match_all: {} } }),
  });
  return hitsToSources(result);
}

export async function replaceRisks(risks) {
  const { riskIndex } = config();
  await request(`/${encodeURIComponent(riskIndex)}/_delete_by_query?refresh=true&conflicts=proceed`, {
    method: "POST",
    body: JSON.stringify({ query: { match_all: {} } }),
  });
  if (!risks.length) return;
  const lines = risks.flatMap(({ id, ...risk }) => [
    JSON.stringify({ index: { _index: riskIndex, _id: id } }),
    JSON.stringify(risk),
  ]);
  await request("/_bulk?refresh=wait_for", {
    method: "POST",
    headers: { "content-type": "application/x-ndjson" },
    body: `${lines.join("\n")}\n`,
  });
}

export async function elasticStatus() {
  const { contractIndex } = config();
  const cluster = await request("/");
  const count = await request(`/${encodeURIComponent(contractIndex)}/_count`);
  return {
    connected: true,
    cluster: cluster.cluster_name,
    version: cluster.version?.number,
    documents: count.count,
  };
}
