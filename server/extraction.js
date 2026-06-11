import { createHash } from "node:crypto";
import { generateJson } from "./gemini.js";

const extractionSchema = {
  type: "OBJECT",
  required: ["name", "counterparty", "contractType", "version", "status", "value", "currency", "clauses"],
  properties: {
    name: { type: "STRING" },
    counterparty: { type: "STRING" },
    contractType: { type: "STRING", enum: ["Customer", "Vendor", "Partner", "Employment", "License", "Other"] },
    version: { type: "STRING" },
    status: { type: "STRING", enum: ["Active", "Review", "Expired", "Superseded", "Unknown"] },
    effectiveDate: { type: "STRING", description: "ISO YYYY-MM-DD or empty string" },
    expirationDate: { type: "STRING", description: "ISO YYYY-MM-DD or empty string" },
    value: { type: "NUMBER" },
    currency: { type: "STRING" },
    parties: { type: "ARRAY", items: { type: "STRING" } },
    summary: { type: "STRING" },
    clauses: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["section", "category", "text", "value"],
        properties: {
          section: { type: "STRING" },
          category: {
            type: "STRING",
            enum: ["SLA", "Breach notice", "Renewal", "Termination", "Liability", "Indemnity", "IP", "Privacy", "Security", "Data retention", "Payment", "Governing law", "Other"],
          },
          text: { type: "STRING" },
          value: { type: "STRING" },
        },
      },
    },
  },
};

export async function extractContract({ filename, text }) {
  if (!text.trim()) throw new Error("No readable text was found in this document");
  const organization = process.env.ORGANIZATION_NAME || "the portfolio owner";
  const extracted = await generateJson({
    schema: extractionSchema,
    prompt: `You are a precise contract extraction engine.

Extract the contract into the required JSON schema. The organization reviewing this portfolio is "${organization}".
- Use only facts explicitly supported by the document.
- Identify the counterparty relative to the portfolio owner when possible.
- A "Customer" contract means the portfolio owner is selling to the party defined as Customer; counterparty must be that Customer.
- A "Vendor" contract means the portfolio owner is buying from the party defined as Vendor or Supplier; counterparty must be that Vendor or Supplier.
- Never return the portfolio owner's own name as counterparty when the other contracting party is identifiable.
- Preserve exact clause language in clauses.text.
- Put amounts, percentages, time periods, and caps in clauses.value.
- Include all clauses relevant to risk comparison, deadlines, liability, IP, privacy, security, and commercial obligations.
- Dates must be ISO YYYY-MM-DD or an empty string.
- Use 0 for an unknown contract value.
- Use "Unknown" when status cannot be established.

Filename: ${filename}

DOCUMENT:
${text.slice(0, 90000)}`,
  });
  const id = createHash("sha256").update(`${filename}\n${text}`).digest("hex").slice(0, 24);
  const expirationDate = extracted.expirationDate || null;
  const expiration = expirationDate ? new Date(`${expirationDate}T23:59:59Z`) : null;
  const normalizedStatus = expiration && expiration < new Date() && extracted.status === "Active"
    ? "Expired"
    : extracted.status;
  return {
    id,
    ...extracted,
    status: normalizedStatus,
    effectiveDate: extracted.effectiveDate || null,
    expirationDate,
    party: extracted.counterparty,
    type: extracted.contractType,
    uploadedAt: new Date().toISOString(),
    filename,
    sourceText: text,
    extraction: { provider: "Gemini", model: process.env.GEMINI_MODEL || "gemini-2.5-flash" },
  };
}
