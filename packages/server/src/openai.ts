import { EnvVars } from "./env";

export interface EmbeddingResult {
  vector: number[];
  model: string;
}

interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
}

export async function generateEmbedding(env: EnvVars, input: string): Promise<EmbeddingResult> {
  const body = {
    input,
    model: env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small"
  };

  const endpoint = env.OPENAI_BASE_URL ?? "https://api.openai.com/v1/embeddings";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to generate embedding: ${response.status} ${response.statusText} - ${errorBody}`);
  }

  const json = (await response.json()) as OpenAIEmbeddingResponse;
  if (!json.data?.length) {
    throw new Error("Embedding API returned no data");
  }

  return {
    vector: json.data[0].embedding,
    model: json.model
  };
}
