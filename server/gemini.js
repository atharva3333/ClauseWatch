function geminiConfig() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  return {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  };
}

export async function generateJson({ prompt, schema, maxOutputTokens = 8192 }) {
  const { apiKey, model } = geminiConfig();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens,
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      }),
    },
  );
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message || `Gemini request failed: ${response.status}`);
  }
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text).join("");
  if (!text) throw new Error("Gemini returned no structured content");
  return JSON.parse(text);
}

export async function generateText({ system, prompt, maxOutputTokens = 1800 }) {
  const { apiKey, model } = geminiConfig();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens },
      }),
    },
  );
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `Gemini request failed: ${response.status}`);
  return body.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") || "";
}

export async function geminiStatus() {
  const result = await generateText({
    system: "Return only the requested token.",
    prompt: "Return exactly GEMINI_CONNECTED",
    maxOutputTokens: 20,
  });
  return { connected: result.includes("GEMINI_CONNECTED"), model: geminiConfig().model };
}
