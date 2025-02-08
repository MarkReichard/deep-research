import FirecrawlApp, { SearchResponse } from '@mendable/firecrawl-js';
import { generateObject } from 'ai';
import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { o3MiniModel, trimPrompt } from './ai/providers';
import { z as zodSchemaValidation } from 'zod'; // Renamed 'z' to 'zodSchema' for clarity
import { basePromptToAiModel } from './prompt';

type ResearchResult = {
  learnings: string[];
  visitedUrls: string[];
};

// increase this if you have higher API rate limits
const ConcurrencyLimit = 2;

// Initialize Firecrawl with optional API key and optional base url
const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_KEY ?? '',
  apiUrl: process.env.FIRECRAWL_BASE_URL,
});


/**
 * Generates a SERP (Search Engine Results Page) query prompt for AI-based research generation.
 *
 * This function constructs a structured prompt to guide an AI model in generating a list of search queries
 * based on a user-provided topic. If prior research learnings are available, they are appended to refine
 * and improve the specificity of the generated queries.
 *
 * @param {string} query - The main research query provided by the user.
 * @param {number} numQueries - The maximum number of search queries to generate.
 * @param {string[]} [learnings] - (Optional) A list of insights from previous research to guide query generation.
 * @returns {string} - A well-formatted prompt string to be passed to an AI model.
 *
 * @example
 * // Basic usage without learnings
 * const prompt = generateSerpPromptWithLearnings("Effects of AI on healthcare", 5);
 * console.log(prompt);
 *
 * // Usage with learnings
 * const promptWithLearnings = generateSerpPromptWithLearnings("Effects of AI on healthcare", 5, [
 *   "AI assists in early disease detection.",
 *   "Machine learning improves patient diagnostics."
 * ]);
 * console.log(promptWithLearnings);
 */
const generateSerpPromptWithLearnings = (query: string, numQueries: number, learnings?: string[]): string => {
  // Base prompt structure
  let prompt = `Given the following prompt from the user, generate a list of SERP queries to research the topic.
Return a maximum of ${numQueries} queries, but feel free to return less if the original prompt is clear.
Make sure each query is unique and not similar to each other:
<prompt>${query}</prompt>`;

  // Append learnings only if provided
  if (learnings && learnings.length > 0) {
    prompt += `\n\nHere are some learnings from previous research, use them to generate more specific queries:\n${learnings.join('\n')}`;
  }

  return prompt;
};



/**
 * Generates a Zod schema to validate the structure of SERP (Search Engine Results Page) queries.
 *
 * This schema ensures that:
 * - The input is an object containing a `queries` field.
 * - The `queries` field is an array of objects.
 * - Each object in the array contains:
 *   - A `query` field (string) representing the actual search query.
 *   - A `researchGoal` field (string) that describes the intent and next steps for research.
 *
 * @param {number} numQueries - The maximum number of queries allowed in the array.
 * @returns {zod.ZodObject} - A Zod validation schema for validating SERP query results.
 */
const generateSerpSchema = (numQueries: number) => {
  return zodSchemaValidation.object({
    // The outer object must contain a `queries` field
    queries: zodSchemaValidation
      .array(
        // The `queries` field must be an array of objects
        zodSchemaValidation.object({
          // Each object in the array must have a `query` field
          query: zodSchemaValidation.string().describe(
            'The SERP query' // A simple search query string
          ),

          // Each object must also have a `researchGoal` field
          researchGoal: zodSchemaValidation
            .string()
            .describe(
              `First talk about the goal of the research that this query is meant to accomplish, 
              then go deeper into how to advance the research once the results are found, 
              mention additional research directions. Be as specific as possible, 
              especially for additional research directions.` // Descriptive metadata about the research goal
            ),
        })
      )
      .describe(`List of SERP queries, max of ${numQueries}`), // Limit the number of queries
  });
};

// take end user query, return a list of search engine queries
async function generateSerpQueries({
  query,
  numQueries = 3,
  learnings,
}: {
  query: string;
  numQueries?: number;
  // optional, if provided, the research will continue from the last learning
  learnings?: string[];
}) {
  //call the model to 
  const res = await generateObject({
    model: o3MiniModel,
    system: basePromptToAiModel(),
    prompt: generateSerpPromptWithLearnings(query, numQueries, learnings),
    schema: generateSerpSchema(numQueries),
  });
  console.log(
    `Created ${res.object.queries.length} queries`,
    res.object.queries,
  );

  return res.object.queries.slice(0, numQueries);
}

async function processSerpResult({
  query,
  result,
  numLearnings = 3,
  numFollowUpQuestions = 3,
}: {
  query: string;
  result: SearchResponse;
  numLearnings?: number;
  numFollowUpQuestions?: number;
}) {
  const contents = compact(result.data.map(item => item.markdown)).map(
    content => trimPrompt(content, 25_000),
  );
  console.log(`Ran ${query}, found ${contents.length} contents`);

  const res = await generateObject({
    model: o3MiniModel,
    abortSignal: AbortSignal.timeout(60_000),
    system: basePromptToAiModel(),
    prompt: `Given the following contents from a SERP search for the query <query>${query}</query>, generate a list of learnings from the contents. Return a maximum of ${numLearnings} learnings, but feel free to return less if the contents are clear. Make sure each learning is unique and not similar to each other. The learnings should be concise and to the point, as detailed and infromation dense as possible. Make sure to include any entities like people, places, companies, products, things, etc in the learnings, as well as any exact metrics, numbers, or dates. The learnings will be used to research the topic further.\n\n<contents>${contents
      .map(content => `<content>\n${content}\n</content>`)
      .join('\n')}</contents>`,
    schema: zodSchemaValidation.object({
      learnings: zodSchemaValidation
        .array(zodSchemaValidation.string())
        .describe(`List of learnings, max of ${numLearnings}`),
      followUpQuestions: zodSchemaValidation
        .array(zodSchemaValidation.string())
        .describe(
          `List of follow-up questions to research the topic further, max of ${numFollowUpQuestions}`,
        ),
    }),
  });
  console.log(
    `Created ${res.object.learnings.length} learnings`,
    res.object.learnings,
  );

  return res.object;
}

export async function writeFinalReport({
  prompt,
  learnings,
  visitedUrls,
}: {
  prompt: string;
  learnings: string[];
  visitedUrls: string[];
}) {
  const learningsString = trimPrompt(
    learnings
      .map(learning => `<learning>\n${learning}\n</learning>`)
      .join('\n'),
    150_000,
  );

  const res = await generateObject({
    model: o3MiniModel,
    system: basePromptToAiModel(),
    prompt: `Given the following prompt from the user, write a final report on the topic using the learnings from research. Make it as as detailed as possible, aim for 3 or more pages, include ALL the learnings from research:\n\n<prompt>${prompt}</prompt>\n\nHere are all the learnings from previous research:\n\n<learnings>\n${learningsString}\n</learnings>`,
    schema: zodSchemaValidation.object({
      reportMarkdown: zodSchemaValidation
        .string()
        .describe('Final report on the topic in Markdown'),
    }),
  });

  // Append the visited URLs section to the report
  const urlsSection = `\n\n## Sources\n\n${visitedUrls.map(url => `- ${url}`).join('\n')}`;
  return res.object.reportMarkdown + urlsSection;
}

export async function deepResearch({
  query,
  breadth,
  depth,
  learnings = [],
  visitedUrls = [],
}: {
  query: string;
  breadth: number;
  depth: number;
  learnings?: string[];
  visitedUrls?: string[];
}): Promise<ResearchResult> {
  const serpQueries = await generateSerpQueries({
    query,
    learnings,
    numQueries: breadth,
  });
  const limit = pLimit(ConcurrencyLimit);

  const results = await Promise.all(
    serpQueries.map(serpQuery =>
      limit(async () => {
        try {
          const result = await firecrawl.search(serpQuery.query, {
            timeout: 15000,
            limit: 5,
            scrapeOptions: { formats: ['markdown'] },
          });

          // Collect URLs from this search
          const newUrls = compact(result.data.map(item => item.url));
          const newBreadth = Math.ceil(breadth / 2);
          const newDepth = depth - 1;

          const newLearnings = await processSerpResult({
            query: serpQuery.query,
            result,
            numFollowUpQuestions: newBreadth,
          });
          const allLearnings = [...learnings, ...newLearnings.learnings];
          const allUrls = [...visitedUrls, ...newUrls];

          if (newDepth > 0) {
            console.log(
              `Researching deeper, breadth: ${newBreadth}, depth: ${newDepth}`,
            );

            const nextQuery = `
            Previous research goal: ${serpQuery.researchGoal}
            Follow-up research directions: ${newLearnings.followUpQuestions.map(q => `\n${q}`).join('')}
          `.trim();

            return deepResearch({
              query: nextQuery,
              breadth: newBreadth,
              depth: newDepth,
              learnings: allLearnings,
              visitedUrls: allUrls,
            });
          } else {
            return {
              learnings: allLearnings,
              visitedUrls: allUrls,
            };
          }
        } catch (e: any) {
          if (e.message && e.message.includes('Timeout')) {
            console.error(
              `Timeout error running query: ${serpQuery.query}: `,
              e,
            );
          } else {
            console.error(`Error running query: ${serpQuery.query}: `, e);
          }
          return {
            learnings: [],
            visitedUrls: [],
          };
        }
      }),
    ),
  );

  return {
    learnings: [...new Set(results.flatMap(r => r.learnings))],
    visitedUrls: [...new Set(results.flatMap(r => r.visitedUrls))],
  };
}
