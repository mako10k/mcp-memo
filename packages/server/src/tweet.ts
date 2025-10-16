import {
  tweetInputSchema,
  tweetReactionOutputSchema,
  tweetReactionOutputJsonSchema,
  type TweetInput,
  type TweetReactionOutput
} from "./schemas";
import { generateStructuredChatCompletion } from "./openai";
import type { EnvVars } from "./env";

const TWEET_SYSTEM_PROMPT = `You are a witty but kind social media user reacting to short updates. Keep responses concise (max 40 words), avoid emojis unless the tweet includes them, and stay positive or constructive. Return JSON only.`;

export function createTweetReactor(env: EnvVars) {
  return async (input: TweetInput): Promise<TweetReactionOutput> => {
    const parsedInput = tweetInputSchema.parse(input);
    const userPrompt = buildUserPrompt(parsedInput);

    const response = await generateStructuredChatCompletion(env, {
      systemPrompt: TWEET_SYSTEM_PROMPT,
      userPrompt,
      maxOutputTokens: 120,
      schema: tweetReactionOutputSchema,
      jsonSchema: tweetReactionOutputJsonSchema,
      toolName: "tweet_reaction",
      toolDescription: "Return a short reaction to the provided tweet text as JSON.",
      reasoningEffort: "minimal"
    });

    return tweetReactionOutputSchema.parse(response);
  };
}

function buildUserPrompt(input: TweetInput): string {
  const lines = [
    `Tweet text: ${input.text.trim()}`
  ];

  if (input.language === "ja") {
    lines.push("React in Japanese.");
  } else if (input.language === "en") {
    lines.push("React in English.");
  } else {
    lines.push("React in the same language as the tweet.");
  }

  return lines.join("\n\n");
}
