import FirecrawlApp, { SearchResponse } from '@mendable/firecrawl-js';
import { generateObject } from 'ai';
import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { aiModelToUse } from './ai/providers';
import { z as zodSchemaValidation } from 'zod';
import { 
  basePromptToAiModel, 
  generateSerpPromptWithLearnings, 
  generateSerpAnalysisPrompt, 
  trimPrompt, 
  finalReportPrompt 
} from './prompt';
import { generateSerpSchema, generateSerpAnalysisSchema } from './schema';

// --------------------
// Type Definitions
// --------------------

/** Parameters for initiating deep research */
type DeepResearchParams = {
  query: string;
  breadth: number;
  depth: number;
  learnings?: string[];
  visitedUrls?: string[];
};

/** Final research results: accumulated learnings and visited URLs */
type ResearchResult = {
  learnings: string[];
  visitedUrls: string[];
};

/** A single SERP query with its associated research goal */
type SerpQuery = {
  query: string;
  researchGoal: string;
};

/** Parameters for generating SERP queries */
type GenerateSerpQueriesParams = {
  query: string;
  numQueries?: number;
  learnings?: string[];
};

/** Parameters for processing SERP results */
type ProcessSerpResultParams = {
  query: string;
  result: SearchResponse;
  numLearnings?: number;
  numFollowUpQuestions?: number;
};

/** Structure of the AI-generated SERP analysis result */
type SerpAnalysisResult = {
  learnings: string[];
  followUpQuestions: string[];
};

// Increase this if you have higher API rate limits
const ConcurrencyLimit = 1;
// Define a rate limit in milliseconds (adjust as needed based on API documentation)
const RATE_LIMIT_MS = 1000; // Example: 1 request per second



// Initialize Firecrawl with optional API key and base URL
const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_KEY ?? '',
  apiUrl: process.env.FIRECRAWL_BASE_URL,
});

// --------------------
// Helper Functions
// --------------------
// Sleep function to introduce a delay
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/**
 * Fetch SERP results for a given query with rate limiting.
 *
 * @param query - The query string to search.
 * @returns A promise resolving to the SearchResponse.
 */
const fetchSerpResults = async (query: string): Promise<SearchResponse> => {
  await sleep(RATE_LIMIT_MS); // Enforce rate limit before making a request
  return await firecrawl.search(query, {
    timeout: 15000,
    limit: 5,
    scrapeOptions: { formats: ['markdown'] },
  });
};

/**
 * Extracts URLs from the SERP search result.
 *
 * @param result - The SearchResponse containing data.
 * @returns An array of URLs.
 */
const extractUrlsFromResult = (result: SearchResponse): string[] => {
  return compact(result.data.map(item => item.url));
};

/**
 * Generates the next research query by combining the previous research goal and follow-up questions.
 *
 * @param researchGoal - The previous research goal.
 * @param followUpQuestions - The list of follow-up questions.
 * @returns The next query string.
 */
const generateNextResearchQuery = (researchGoal: string, followUpQuestions: string[]): string => {
  // Join follow-up questions without extra spaces.
  const followUps = followUpQuestions.map(q => q.trim()).join('\n');
  return `Previous research goal: ${researchGoal}\nFollow-up research directions: ${followUps}`;
};

/**
 * Logs errors encountered while processing a SERP query.
 *
 * @param error - The error object.
 * @param query - The query string that caused the error.
 */
const handleSerpQueryError = (error: any, query: string): void => {
  if (error.message && error.message.includes("Timeout")) {
    console.error(`Timeout error running query: ${query}:`, error);
  } else {
    console.error(`Error running query: ${query}:`, error);
  }
};

/**
 * Generates SERP queries using the provided prompt and schema.
 *
 * @param params - Parameters including the query and learnings.
 * @returns An array of SERP queries.
 */
async function generateSerpQueries(params: GenerateSerpQueriesParams): Promise<SerpQuery[]> {
  const queryResult = await generateObject({
    model: aiModelToUse,
    system: basePromptToAiModel(),
    prompt: generateSerpPromptWithLearnings(params.query, params.numQueries ?? 3, params.learnings),
    schema: generateSerpSchema(params.numQueries ?? 3),
  });
  console.log(`Created ${queryResult.object.queries.length} queries`, queryResult.object.queries);
  return queryResult.object.queries.slice(0, params.numQueries ?? 3);
}

/**
 * Extracts and trims markdown content from a SERP result.
 *
 * @param result - The SERP search response.
 * @returns A list of trimmed markdown content strings.
 */
const extractAndTrimSerpContent = (result: SearchResponse): string[] => {
  return compact(result.data.map(item => item.markdown))
    .map(content => trimPrompt(content, 25000)); // 25_000 is the same as 25000
};

/**
 * Processes a SERP result by generating a prompt, invoking the AI model, and returning analysis.
 *
 * @param params - Parameters including query, result, and optional counts.
 * @returns A promise resolving to the SERP analysis result.
 */
const processSerpResult = async (params: ProcessSerpResultParams): Promise<SerpAnalysisResult> => {
  const contents = extractAndTrimSerpContent(params.result);
  console.log(`Ran ${params.query}, found ${contents.length} contents`);

  const aiPrompt = generateSerpAnalysisPrompt(params.query, contents, params.numLearnings ?? 3);
  const aiSchema = generateSerpAnalysisSchema(params.numLearnings ?? 3, params.numFollowUpQuestions ?? 3);

  const res = await generateObject({
    model: aiModelToUse,
    abortSignal: AbortSignal.timeout(60000),
    system: basePromptToAiModel(),
    prompt: aiPrompt,
    schema: aiSchema,
  });
  console.log(`Created ${res.object.learnings.length} learnings`, res.object.learnings);
  return res.object;
};

/**
 * Processes a single SERP query: executes search, extracts learnings, and recurses if needed.
 *
 * @param serpQuery - A single SERP query to process.
 * @param breadth - The current breadth value.
 * @param depth - The current depth for recursion.
 * @param learnings - Accumulated learnings so far.
 * @param visitedUrls - Accumulated visited URLs so far.
 * @returns A promise resolving to the research result.
 */
const processSingleSerpQuery = async (
  serpQuery: SerpQuery,
  breadth: number,
  depth: number,
  learnings: string[],
  visitedUrls: string[]
): Promise<ResearchResult> => {
  try {
    const result = await fetchSerpResults(serpQuery.query);
    const newUrls = extractUrlsFromResult(result);
    const newBreadth = Math.ceil(breadth / 2);
    const newDepth = depth - 1;

    const newLearnings = await processSerpResult({
      query: serpQuery.query,
      result,
      numFollowUpQuestions: newBreadth,
    });

    const allLearnings = [...learnings, ...newLearnings.learnings];
    const allUrls = [...visitedUrls, ...newUrls];

    // Recurse if depth allows
    if (newDepth > 0) {
      console.log(`Researching deeper, breadth: ${newBreadth}, depth: ${newDepth}`);
      const nextQuery = generateNextResearchQuery(serpQuery.researchGoal, newLearnings.followUpQuestions);
      return await deepResearch({ query: nextQuery, breadth: newBreadth, depth: newDepth, learnings: allLearnings, visitedUrls: allUrls });
    }
    return { learnings: allLearnings, visitedUrls: allUrls };
  } catch (error: any) {
    handleSerpQueryError(error, serpQuery.query);
    return { learnings: [], visitedUrls: [] };
  }
};

/**
 * Generates the next research report based on the user's prompt, learnings, and visited URLs.
 *
 * @param params - An object containing the user's prompt, learnings, and visited URLs.
 * @returns A promise that resolves to the final report as a Markdown string.
 */
export async function writeFinalReport({
  prompt,
  learnings,
  visitedUrls,
}: {
  prompt: string;
  learnings: string[];
  visitedUrls: string[];
}): Promise<string> {
  // Format learnings into XML-like tags and trim if necessary
  const learningsString = trimPrompt(
    learnings.map(learning => `<learning>\n${learning}\n</learning>`).join('\n'),
    150000
  );

  const finalReportResult = await generateObject({
    model: aiModelToUse,
    system: basePromptToAiModel(),
    prompt: finalReportPrompt(prompt, learningsString),
    schema: zodSchemaValidation.object({
      reportMarkdown: zodSchemaValidation.string().describe('Final report on the topic in Markdown'),
    }),
  });

  const urlsSection = `\n\n## Sources\n\n${visitedUrls.map(url => `- ${url}`).join('\n')}`;
  return finalReportResult.object.reportMarkdown + urlsSection;
}

/**
 * Conducts deep research by recursively generating SERP queries and processing their results.
 *
 * @param params - The deep research parameters.
 * @returns A promise resolving to the final research result.
 */
export async function deepResearch(params: DeepResearchParams): Promise<ResearchResult> {
  const { query, breadth, depth, learnings = [], visitedUrls = [] } = params;
  const serpQueries = await generateSerpQueries({ query, learnings, numQueries: breadth });
  
  const limit = pLimit(ConcurrencyLimit);
  const results = await Promise.all(
    serpQueries.map(serpQuery =>
      limit(() => processSingleSerpQuery(serpQuery, breadth, depth, learnings, visitedUrls))
    )
  );

  return {
    learnings: [...new Set(results.flatMap(r => r.learnings))],
    visitedUrls: [...new Set(results.flatMap(r => r.visitedUrls))],
  };
}
