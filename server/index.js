import "dotenv/config";
import cors from "cors";
import express from "express";
import multer from "multer";
import pdf from "pdf-parse";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzePortfolio, answerPortfolioQuestion, deriveDeadlines, summarizePortfolio } from "./analyzer.js";
import {
  deleteContract, elasticStatus, ensureIndices, getContract, listContracts, listRisks,
  replaceRisks, saveContract, searchContracts,
} from "./elastic.js";
import { extractContract } from "./extraction.js";
import { geminiStatus } from "./gemini.js";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowed = [".pdf", ".txt", ".md"];
    if (allowed.includes(extname(file.originalname).toLowerCase())) callback(null, true);
    else callback(new Error("Only PDF, TXT, and MD files are supported"));
  },
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));

async function rebuildRiskRegister() {
  const contracts = await listContracts();
  const risks = await analyzePortfolio(contracts);
  await replaceRisks(risks);
  return risks;
}

app.get("/api/health", async (_req, res) => {
  const result = { status: "ok", gemini: { connected: false }, elasticsearch: { connected: false } };
  try { result.elasticsearch = await elasticStatus(); } catch (error) { result.elasticsearch.error = error.message; }
  try { result.gemini = await geminiStatus(); } catch (error) { result.gemini.error = error.message; }
  if (!result.elasticsearch.connected || !result.gemini.connected) result.status = "degraded";
  res.status(result.status === "ok" ? 200 : 503).json(result);
});

app.get("/api/portfolio", async (_req, res, next) => {
  try {
    const [contracts, risks] = await Promise.all([listContracts(), listRisks()]);
    res.json({
      summary: summarizePortfolio(contracts, risks),
      contracts,
      risks,
      deadlines: deriveDeadlines(contracts),
      agents: [
        { name: "Contract Extraction", state: "Ready", task: "Gemini extraction into Elasticsearch" },
        { name: "Conflict & Cascade", state: "Ready", task: "Portfolio-wide obligation comparison" },
        { name: "Renewal Monitor", state: "Watching", task: "Live deadline calculation" },
        { name: "Clause Drift", state: "Ready", task: "Version-to-version change detection" },
      ],
    });
  } catch (error) { next(error); }
});

app.get("/api/contracts/:id", async (req, res, next) => {
  try { res.json(await getContract(req.params.id)); } catch (error) { next(error); }
});

app.post("/api/contracts", upload.single("contract"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Choose a contract file." });
    const extension = extname(req.file.originalname).toLowerCase();
    const text = extension === ".pdf" ? (await pdf(req.file.buffer)).text : req.file.buffer.toString("utf8");
    const contract = await extractContract({ filename: req.file.originalname, text });
    await saveContract(contract);
    const risks = await rebuildRiskRegister();
    res.status(201).json({ contract, risksGenerated: risks.length, extractedCharacters: text.length });
  } catch (error) { next(error); }
});

app.delete("/api/contracts/:id", async (req, res, next) => {
  try {
    await deleteContract(req.params.id);
    const risks = await rebuildRiskRegister();
    res.json({ deleted: true, risksGenerated: risks.length });
  } catch (error) { next(error); }
});

app.post("/api/analyze", async (_req, res, next) => {
  try {
    const risks = await rebuildRiskRegister();
    res.json({ risks, analyzedAt: new Date().toISOString() });
  } catch (error) { next(error); }
});

app.post("/api/chat", async (req, res, next) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "Enter a question." });
    let contracts = await searchContracts(message, 20);
    if (!contracts.length) contracts = await listContracts(30);
    const risks = await listRisks();
    const answer = await answerPortfolioQuestion({
      message,
      contracts,
      risks,
      deadlines: deriveDeadlines(contracts),
    });
    res.json({ answer, mode: "gemini", sources: contracts.map(({ id, name }) => ({ id, name })) });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 500;
  res.status(status).json({ error: error.message || "Unexpected server error" });
});

const root = join(fileURLToPath(new URL("..", import.meta.url)), "dist");
if (existsSync(root)) {
  app.use(express.static(root));
  app.get("*", async (_req, res) => {
    res.type("html").send(await readFile(join(root, "index.html"), "utf8"));
  });
}

const port = Number(process.env.PORT || 8787);
ensureIndices()
  .then(() => app.listen(port, () => console.log(`ClauseWatch API listening on http://localhost:${port}`)))
  .catch((error) => {
    console.error(`Unable to initialize Elasticsearch: ${error.message}`);
    process.exitCode = 1;
  });
