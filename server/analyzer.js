import { createHash } from "node:crypto";
import { generateJson, generateText } from "./gemini.js";

const money = (value, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);

export function deriveDeadlines(contracts, now = new Date()) {
  return contracts
    .filter((contract) => contract.expirationDate && !["Superseded", "Expired"].includes(contract.status))
    .flatMap((contract) => {
      const renewal = contract.clauses?.find((clause) => clause.category === "Renewal");
      const noticeDays = Number(`${renewal?.value || ""} ${renewal?.text || ""}`.match(/(\d+)\s+(?:calendar\s+)?days/i)?.[1] || 0);
      const expiration = new Date(`${contract.expirationDate}T12:00:00Z`);
      if (Number.isNaN(expiration.valueOf())) return [];
      const deadline = new Date(expiration);
      deadline.setUTCDate(deadline.getUTCDate() - noticeDays);
      const daysRemaining = Math.ceil((deadline - now) / 86400000);
      const severity = daysRemaining <= 7 ? "Critical" : daysRemaining <= 30 ? "High" : daysRemaining <= 60 ? "Medium" : "Low";
      return [{
        id: `deadline-${contract.id}`,
        contract: contract.name,
        event: renewal ? "Non-renewal notice deadline" : "Contract expiration",
        deadline: deadline.toISOString().slice(0, 10),
        daysRemaining,
        severity,
        exposure: contract.value ? money(contract.value, contract.currency || "USD") : "Not found",
        evidence: renewal?.text || `Expiration date: ${contract.expirationDate}`,
      }];
    })
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
}

export function summarizePortfolio(contracts, risks) {
  return {
    totalContracts: contracts.length,
    activeValue: contracts
      .filter((contract) => !["Superseded", "Expired"].includes(contract.status))
      .reduce((sum, contract) => sum + Number(contract.value || 0), 0),
    openRisks: risks.length,
    urgentRisks: risks.filter((risk) => ["Critical", "High"].includes(risk.severity)).length,
  };
}

const riskSchema = {
  type: "OBJECT",
  required: ["risks"],
  properties: {
    risks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["title", "severity", "category", "status", "confidence", "summary", "impact", "action", "contracts", "evidence"],
        properties: {
          title: { type: "STRING" },
          severity: { type: "STRING", enum: ["Critical", "High", "Medium", "Low"] },
          category: { type: "STRING", enum: ["Obligation cascade", "Cross-contract conflict", "Clause drift", "Renewal", "Standalone risk"] },
          status: { type: "STRING", enum: ["Confirmed", "Potential"] },
          confidence: { type: "NUMBER" },
          summary: { type: "STRING" },
          impact: { type: "STRING" },
          action: { type: "STRING" },
          contracts: { type: "ARRAY", items: { type: "STRING" } },
          evidence: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              required: ["contract", "section", "text"],
              properties: {
                contract: { type: "STRING" },
                section: { type: "STRING" },
                text: { type: "STRING" },
              },
            },
          },
        },
      },
    },
  },
};

const numeric = {
  percent(text) {
    return [...String(text).matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((match) => Number(match[1]));
  },
  hours(text) {
    const match = String(text).match(/(\d+(?:\.\d+)?)\s*hours?/i);
    return match ? Number(match[1]) : null;
  },
  days(text) {
    const match = String(text).match(/(\d+(?:\.\d+)?)\s*(calendar\s+|business\s+)?days?/i);
    return match ? Number(match[1]) : null;
  },
  durationDays(text) {
    const value = String(text);
    const years = value.match(/(\d+(?:\.\d+)?)\s*years?/i);
    if (years) return Number(years[1]) * 365;
    const months = value.match(/(\d+(?:\.\d+)?)\s*months?/i);
    if (months) return Number(months[1]) * 30;
    return this.days(value);
  },
  money(text) {
    const match = String(text).replace(/,/g, "").match(/(?:USD|\$)\s*(\d+(?:\.\d+)?)/i);
    return match ? Number(match[1]) : null;
  },
};

function clause(contract, categories) {
  return contract.clauses?.find((item) => categories.includes(item.category));
}

function evidence(contract, item) {
  return { contract: contract.name, section: item.section || "Not found", text: item.text };
}

function makeRisk(risk) {
  return {
    status: "Confirmed",
    confidence: 98,
    ...risk,
    id: createHash("sha256").update(`${risk.category}:${risk.title}:${risk.contracts.join("|")}`).digest("hex").slice(0, 24),
    generatedAt: new Date().toISOString(),
  };
}

function deterministicPortfolioRisks(contracts) {
  const risks = [];
  const customers = contracts.filter((item) => item.contractType === "Customer" && item.status !== "Expired");
  const vendors = contracts.filter((item) => ["Vendor", "License"].includes(item.contractType) && item.status !== "Expired");

  for (const customer of customers) {
    const customerSla = clause(customer, ["SLA"]);
    const customerAvailability = numeric.percent(`${customerSla?.value || ""} ${customerSla?.text || ""}`)[0];
    const customerSecurity = clause(customer, ["Breach notice", "Security"]);
    const customerHours = numeric.hours(`${customerSecurity?.value || ""} ${customerSecurity?.text || ""}`);
    const customerRetention = clause(customer, ["Data retention"]);
    const customerRetentionDays = numeric.durationDays(`${customerRetention?.value || ""} ${customerRetention?.text || ""}`);
    const customerLiability = clause(customer, ["Liability"]);
    const customerUnlimited = /unlimited|uncapped/i.test(`${customerLiability?.value || ""} ${customerLiability?.text || ""}`);

    for (const vendor of vendors) {
      const vendorSla = clause(vendor, ["SLA"]);
      const vendorAvailability = numeric.percent(`${vendorSla?.value || ""} ${vendorSla?.text || ""}`)[0];
      if (customerSla && vendorSla && customerAvailability > vendorAvailability) {
        risks.push(makeRisk({
          title: `Availability commitment exceeds upstream SLA by ${(customerAvailability - vendorAvailability).toFixed(1)} percentage points`,
          severity: customerAvailability - vendorAvailability >= 0.4 ? "Critical" : "High",
          category: "Obligation cascade",
          summary: `${customer.name} promises ${customerAvailability}% availability, while ${vendor.name} provides only ${vendorAvailability}%.`,
          impact: "The portfolio owner may owe customer remedies for outages that do not trigger equivalent vendor protection.",
          action: "Align the upstream SLA, add service redundancy, or narrow the downstream commitment.",
          contracts: [customer.name, vendor.name],
          evidence: [evidence(customer, customerSla), evidence(vendor, vendorSla)],
        }));
      }

      const vendorSecurity = clause(vendor, ["Breach notice", "Security"]);
      const vendorHours = numeric.hours(`${vendorSecurity?.value || ""} ${vendorSecurity?.text || ""}`);
      if (customerSecurity && vendorSecurity && customerHours !== null && vendorHours !== null && customerHours < vendorHours) {
        risks.push(makeRisk({
          title: `Vendor security notice is ${vendorHours - customerHours} hours slower than customer obligation`,
          severity: vendorHours - customerHours >= 24 ? "High" : "Medium",
          category: "Cross-contract conflict",
          summary: `${customer.name} requires notice within ${customerHours} hours, but ${vendor.name} allows ${vendorHours} hours.`,
          impact: "The upstream delay may make timely downstream notification contractually impossible.",
          action: "Negotiate a shorter upstream notice period or implement independent incident detection.",
          contracts: [customer.name, vendor.name],
          evidence: [evidence(customer, customerSecurity), evidence(vendor, vendorSecurity)],
        }));
      }

      const vendorRetention = clause(vendor, ["Data retention"]);
      const vendorRetentionDays = numeric.durationDays(`${vendorRetention?.value || ""} ${vendorRetention?.text || ""}`);
      if (customerRetention && vendorRetention && customerRetentionDays && vendorRetentionDays && customerRetentionDays > vendorRetentionDays) {
        risks.push(makeRisk({
          title: "Vendor deletion period conflicts with customer retention commitment",
          severity: "High",
          category: "Cross-contract conflict",
          summary: `${customer.name} requires retention for about ${customerRetentionDays} days, while ${vendor.name} permits deletion after ${vendorRetentionDays} days.`,
          impact: "Required customer records may be unavailable before the downstream retention obligation ends.",
          action: "Extend vendor retention, export records to controlled storage, or amend the customer requirement.",
          contracts: [customer.name, vendor.name],
          evidence: [evidence(customer, customerRetention), evidence(vendor, vendorRetention)],
        }));
      }

      const vendorLiability = clause(vendor, ["Liability"]);
      if (customerLiability && vendorLiability && customerUnlimited && !/unlimited|uncapped/i.test(`${vendorLiability.value} ${vendorLiability.text}`)) {
        risks.push(makeRisk({
          title: "Unlimited customer exposure is not backed by vendor liability",
          severity: "Critical",
          category: "Obligation cascade",
          summary: `${customer.name} creates unlimited exposure for specified claims, while ${vendor.name} limits its aggregate liability.`,
          impact: "Losses caused upstream may remain largely or entirely with the portfolio owner.",
          action: "Increase vendor liability protection or cap the corresponding customer exposure.",
          contracts: [customer.name, vendor.name],
          evidence: [evidence(customer, customerLiability), evidence(vendor, vendorLiability)],
        }));
      }
    }
  }

  const byCounterparty = Map.groupBy(
    contracts.filter((item) => item.counterparty),
    (item) => item.counterparty.toLowerCase(),
  );
  for (const versions of byCounterparty.values()) {
    if (versions.length < 2) continue;
    const ordered = [...versions].sort((a, b) =>
      String(a.effectiveDate || a.version || "").localeCompare(String(b.effectiveDate || b.version || "")));
    const older = ordered.at(-2);
    const newer = ordered.at(-1);
    const comparisons = [
      { categories: ["Liability"], label: "Liability cap", parse: numeric.money.bind(numeric), worsening: (oldValue, newValue) => newValue < oldValue, unit: "USD" },
      { categories: ["Renewal"], label: "Renewal notice period", parse: numeric.days.bind(numeric), worsening: (oldValue, newValue) => newValue > oldValue, unit: "days" },
      { categories: ["Breach notice", "Security"], label: "Security notification period", parse: numeric.hours.bind(numeric), worsening: (oldValue, newValue) => newValue > oldValue, unit: "hours" },
    ];
    for (const comparison of comparisons) {
      const oldClause = clause(older, comparison.categories);
      const newClause = clause(newer, comparison.categories);
      const oldValue = comparison.parse(`${oldClause?.value || ""} ${oldClause?.text || ""}`);
      const newValue = comparison.parse(`${newClause?.value || ""} ${newClause?.text || ""}`);
      if (!oldClause || !newClause || oldValue === null || newValue === null || !comparison.worsening(oldValue, newValue)) continue;
      const reduction = comparison.unit === "USD" ? `, a ${Math.round((1 - newValue / oldValue) * 100)}% reduction` : "";
      risks.push(makeRisk({
        title: `${comparison.label} worsened from ${oldValue} to ${newValue} ${comparison.unit}`,
        severity: comparison.unit === "USD" && newValue <= oldValue / 2 ? "High" : "Medium",
        category: "Clause drift",
        summary: `${newer.name} changed the ${comparison.label.toLowerCase()} from ${oldValue} to ${newValue} ${comparison.unit}${reduction}.`,
        impact: "The newer version provides materially weaker protection or a more demanding action window.",
        action: "Review and negotiate the changed term before accepting or renewing.",
        contracts: [older.name, newer.name],
        evidence: [evidence(older, oldClause), evidence(newer, newClause)],
      }));
    }
  }
  return risks;
}

export async function analyzePortfolio(contracts) {
  if (!contracts.length) return [];
  const compact = contracts.map(({ id, name, counterparty, contractType, version, status, effectiveDate, expirationDate, value, currency, summary, clauses }) => ({
    id, name, counterparty, contractType, version, status, effectiveDate, expirationDate, value, currency, summary, clauses,
  }));
  const result = await generateJson({
    schema: riskSchema,
    maxOutputTokens: 8192,
    prompt: `You are a contract portfolio risk engine. Analyze the supplied contracts as one interconnected system.

Find only evidence-supported risks:
1. Customer commitments that exceed upstream vendor protection.
2. Cross-contract conflicts in SLA, breach notice, data retention, liability, indemnity, IP, privacy, security, termination, or delivery.
3. Material clause drift between versions of agreements with the same counterparty.
4. Urgent renewal or notice exposure.
5. Significant standalone clauses, but prioritize cross-contract findings.

Rules:
- Cite exact contract names, sections, and concise evidence.
- Do not invent relationships. Mark uncertain relationships Potential.
- Quantify differences whenever possible.
- Confidence must be 0-100.
- Return no risk when evidence is insufficient.
- Do not give definitive legal advice.

CONTRACT PORTFOLIO:
${JSON.stringify(compact)}`,
  });
  const generatedAt = new Date().toISOString();
  const modelRisks = result.risks.map((risk) => ({
    ...risk,
    id: createHash("sha256").update(`${risk.category}:${risk.title}:${risk.contracts.join("|")}`).digest("hex").slice(0, 24),
    confidence: Math.max(0, Math.min(100, Math.round(risk.confidence))),
    generatedAt,
  }));
  const deterministic = deterministicPortfolioRisks(contracts);
  const occupied = new Set(deterministic.map((risk) =>
    `${risk.category}:${[...risk.contracts].sort().join("|")}`));
  return [
    ...deterministic,
    ...modelRisks.filter((risk) =>
      !occupied.has(`${risk.category}:${[...risk.contracts].sort().join("|")}`)),
  ];
}

export async function answerPortfolioQuestion({ message, contracts, risks, deadlines }) {
  const evidence = contracts.map(({ id, name, counterparty, contractType, version, status, effectiveDate, expirationDate, value, currency, summary, clauses }) => ({
    id, name, counterparty, contractType, version, status, effectiveDate, expirationDate, value, currency, summary, clauses,
  }));
  return generateText({
    system: `You are Contract Risk Agent. Answer only from the supplied Elasticsearch portfolio evidence.
Always cite contract names and sections for factual findings. Clearly separate facts from interpretation.
If evidence is absent, say so. Do not mention demo data. Do not provide definitive legal advice.`,
    prompt: `USER QUESTION:
${message}

RELEVANT CONTRACTS:
${JSON.stringify(evidence)}

CURRENT RISK REGISTER:
${JSON.stringify(risks)}

UPCOMING DEADLINES:
${JSON.stringify(deadlines)}`,
  });
}
